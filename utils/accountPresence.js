// ICP Account Presence Matcher — pure logic.
// Predicts which HubSpot target accounts are likely present at a conference and
// why. The AI path (in app.js) calls the model; this module owns the local
// fallback and the normalization/validation that both paths share, so the UI
// always receives a clean, ordered list regardless of source.

const PRESENCE_RANK = { Confirmed: 0, High: 1, Medium: 2 };

// Conference-vertical keywords each ICP segment maps to. Kept loose on purpose:
// a payments account is "present" at most fintech/banking events too.
const VERTICAL_KEYWORDS = {
  "PSP": ["payment", "merchant", "ecommerce", "fintech", "fraud", "retail"],
  "Cross-Border Payments": ["payment", "fintech", "banking", "embedded"],
  "FX & Treasury": ["payment", "banking", "fintech", "treasury"],
  "Cross-Border Payroll": ["payment", "fintech", "banking", "saas", "policy"],
  "Travel Wholesaler": ["travel", "wholesaler", "tourism", "airline", "hospitality"],
  "Travel Tech": ["travel", "tech", "tourism", "saas", "airline"]
};

function verticalAligns(account, conference) {
  const keywords = VERTICAL_KEYWORDS[account.vertical] || [];
  const haystack = (conference.verticals || []).join(" ").toLowerCase();
  // Word-start match: catches plurals ("payment" → "Payments") while keeping
  // "tech" from false-matching inside "fintech".
  return keywords.some((word) => new RegExp(`\\b${word}`).test(haystack));
}

function geoAligns(account, conference) {
  return account.hq && account.hq.region === conference.region;
}

// Local, transparent heuristic used whenever no AI key is configured (or the AI
// call fails). Mirrors the probability vocabulary the AI is asked to return.
function localAccountPresence(conference, accounts = HUBSPOT_ACCOUNTS) {
  const matches = [];
  accounts.forEach((account) => {
    const confirmed = Array.isArray(account.knownSponsorOf) && account.knownSponsorOf.includes(conference.id);
    const vertical = verticalAligns(account, conference);
    const geo = geoAligns(account, conference);
    const fxPull = account.vertical === "FX & Treasury" && (conference.fxRelevance || 0) >= 4;

    let probability = null;
    let reasoning = "";
    if (confirmed) {
      probability = "Confirmed";
      reasoning = `Confirmed exhibitor at ${conference.name} — booked for the floor, so a face-to-face is already in reach.`;
    } else if (vertical && geo) {
      probability = "High";
      reasoning = `Strong ${account.vertical} fit and regional geo-alignment with their ${account.hq.city} HQ.`;
    } else if (vertical && fxPull) {
      probability = "High";
      reasoning = `Event leans heavily on FX-exposure themes that map directly to their treasury book.`;
    } else if (vertical) {
      probability = "Medium";
      reasoning = `${account.vertical} focus aligns with the agenda, though their ${account.hq.city} HQ is out of region.`;
    } else if (geo) {
      probability = "Medium";
      reasoning = `${account.hq.city} HQ puts them in-region for a low-travel-cost touch even with a lighter vertical fit.`;
    }

    if (probability) {
      matches.push({
        company_name: account.company_name,
        match_probability: probability,
        ai_reasoning: reasoning,
        hubspot_status: account.hubspot_status,
        vertical: account.vertical
      });
    }
  });
  return sortPresenceMatches(matches);
}

// Re-attach trusted CRM fields (status/vertical) from the source book and drop
// anything the model hallucinated or mis-labeled. Never trust the model for the
// HubSpot status — only for which accounts match and why.
function normalizeAccountMatches(raw, accounts = HUBSPOT_ACCOUNTS) {
  const byName = new Map(accounts.map((a) => [a.company_name.toLowerCase(), a]));
  const seen = new Set();
  const cleaned = [];
  (Array.isArray(raw) ? raw : []).forEach((item) => {
    const source = byName.get(String(item?.company_name || "").toLowerCase());
    if (!source || seen.has(source.company_name)) return;
    const probability = PRESENCE_RANK[item?.match_probability] !== undefined ? item.match_probability : "Medium";
    seen.add(source.company_name);
    cleaned.push({
      company_name: source.company_name,
      match_probability: probability,
      ai_reasoning: String(item?.ai_reasoning || "").trim() || `${source.vertical} account flagged as a likely fit for this event.`,
      hubspot_status: source.hubspot_status,
      vertical: source.vertical
    });
  });
  return sortPresenceMatches(cleaned);
}

function sortPresenceMatches(matches) {
  return matches.sort((a, b) => PRESENCE_RANK[a.match_probability] - PRESENCE_RANK[b.match_probability]);
}

function presenceDotClass(probability) {
  if (probability === "Confirmed") return "presence-dot-confirmed";
  if (probability === "High") return "presence-dot-high";
  return "presence-dot-medium";
}
