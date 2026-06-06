// Confidence bands for deciding whether two captured leads are the same person.
// AUTO merges silently; SUGGEST surfaces a "possible same person" nudge for the
// rep to confirm. Keeping a false merge out of the CRM matters more than catching
// every repeat, so the bar to auto-merge is deliberately high.
const MATCH_AUTO = 0.84;
const MATCH_SUGGEST = 0.66;

const SENTIMENT_RANK = { Strong: 3, Medium: 2, Weak: 1 };
const URGENCY_RANK = { Immediate: 4, "This quarter": 3, Exploring: 2, "Not a fit": 1 };

function initials(lead) {
  return `${(lead.firstName || "")[0] || ""}${(lead.lastName || "")[0] || ""}`.toLowerCase();
}

function similarity(a, b) {
  a = normalize(a);
  b = normalize(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.82;
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return 1 - matrix[a.length][b.length] / Math.max(a.length, b.length);
}

// Identity score in [0, 1]. An exact email is definitive. Otherwise the name
// anchors identity (last name weighted highest so two different people at the
// same company do not merge) and company / shared work-email domain only
// corroborate. A job-changer with a perfect name but new company lands in the
// SUGGEST band on purpose, so the rep confirms rather than the tool guessing.
function leadMatchScore(a, b) {
  if (a.email && b.email && normalize(a.email) === normalize(b.email)) return 1;
  const firstSim = similarity(a.firstName, b.firstName);
  const lastSim = similarity(a.lastName, b.lastName);
  const fullNameSim = similarity(`${a.firstName} ${a.lastName}`, `${b.firstName} ${b.lastName}`);
  const initialsCorroborate = initials(a) && initials(a) === initials(b) && lastSim > 0.5
    ? Math.min(0.78, 0.5 + lastSim * 0.35)
    : 0;
  const nameSim = Math.max(fullNameSim, lastSim * 0.6 + firstSim * 0.4, initialsCorroborate);
  const corroboration = Math.max(similarity(a.company, b.company), sameEmailDomain(a, b) ? 1 : 0);
  return Math.min(1, nameSim * 0.72 + corroboration * 0.28);
}

function sameEmailDomain(a, b) {
  const da = domainFromLead(a);
  const db = domainFromLead(b);
  return Boolean(da && db && da === db);
}

// Transitive, order-independent clustering of repeat contacts via union-find.
// Returns confident groups plus the medium-confidence pairs that did NOT merge,
// so the UI can ask the rep to confirm borderline matches instead of guessing.
function buildRelationshipGroups(leads) {
  const parent = leads.map((_, index) => index);
  const find = (index) => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (i, j) => {
    parent[find(i)] = find(j);
  };

  const suggestions = [];
  for (let i = 0; i < leads.length; i++) {
    for (let j = i + 1; j < leads.length; j++) {
      const score = leadMatchScore(leads[i], leads[j]);
      if (score >= MATCH_AUTO) union(i, j);
      else if (score >= MATCH_SUGGEST) suggestions.push({ a: leads[i], b: leads[j], score });
    }
  }

  const byRoot = new Map();
  leads.forEach((lead, index) => {
    const root = find(index);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(lead);
  });

  const groups = [...byRoot.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));

  const rootById = new Map(leads.map((lead, index) => [lead.id, find(index)]));
  const pending = suggestions.filter((pair) => rootById.get(pair.a.id) !== rootById.get(pair.b.id));

  return { groups, suggestions: pending };
}

// Reads the relationship as a trajectory rather than a count. The sentiment and
// urgency series over time tell us whether a repeat contact is genuinely warming
// or a polite tire-kicker who has been listening for a year without moving.
function analyzeRelationship(group) {
  const ordered = [...group].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const first = ordered[0];
  const latest = ordered[ordered.length - 1];
  const encounters = ordered.length;
  const conferences = new Set(ordered.map((lead) => lead.conferenceId)).size;
  const spanDays = Math.max(0, Math.round((new Date(latest.createdAt) - new Date(first.createdAt)) / 86400000));

  const sentiments = ordered.map((lead) => SENTIMENT_RANK[lead.sentiment] || 2);
  const urgencies = ordered.map((lead) => URGENCY_RANK[lead.urgency] || 2);
  const sentimentDelta = sentiments[sentiments.length - 1] - sentiments[0];
  const urgencyDelta = urgencies[urgencies.length - 1] - urgencies[0];
  const peakSentiment = Math.max(...sentiments);
  const latestSentiment = sentiments[sentiments.length - 1];
  const latestUrgency = urgencies[urgencies.length - 1];
  const momentum = sentimentDelta + urgencyDelta;
  const direction = momentum > 0 ? "rising" : momentum < 0 ? "cooling" : "flat";

  const companyChanged = distinctCount(ordered, (lead) => normalize(lead.company)) > 1;
  const titleChanged = distinctCount(ordered, (lead) => normalize(lead.title)) > 1;
  const domainChanged = distinctCount(ordered, (lead) => domainFromLead(lead)) > 1;
  const hasBudgetSignal = ordered.some((lead) =>
    /budget|benchmark|curious|exploring|not approved|no project owner|tire/i.test(lead.notes || "")
  );

  let stage;
  if (encounters >= 2 && latestSentiment >= 3 && latestUrgency >= 3 && direction !== "cooling") {
    stage = "champion";
  } else if (encounters >= 2 && direction === "rising" && latestSentiment >= 2) {
    stage = "warming";
  } else if (encounters >= 2 && direction === "cooling") {
    stage = "cooling";
  } else if (encounters >= 2 && direction === "flat" && peakSentiment <= 2) {
    stage = "stalled";
  } else {
    stage = "steady";
  }
  const longCycle = stage === "stalled" && spanDays >= 150;

  return {
    ordered,
    first,
    latest,
    encounters,
    conferences,
    spanDays,
    sentimentDelta,
    urgencyDelta,
    direction,
    peakSentiment,
    latestSentiment,
    latestUrgency,
    companyChanged,
    titleChanged,
    domainChanged,
    hasBudgetSignal,
    stage,
    longCycle
  };
}

function distinctCount(items, accessor) {
  return new Set(items.map(accessor).filter(Boolean)).size;
}
