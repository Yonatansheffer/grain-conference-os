const STORAGE_KEY = "grain-conference-os";

const state = loadState();
let selectedConferenceId = state.conferences[0]?.id;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) return JSON.parse(saved);
  return {
    conferences: clone(CONFERENCES),
    leads: clone(LEADS),
    ai: { key: "", model: "gpt-4o-mini" },
    hubspot: { token: "" }
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function formatDateRange(item) {
  const start = new Date(item.startDate + "T00:00:00");
  const end = new Date(item.endDate + "T00:00:00");
  const opts = { month: "short", day: "numeric" };
  if (start.getMonth() === end.getMonth()) {
    return `${start.toLocaleDateString("en-US", opts)}-${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${start.toLocaleDateString("en-US", opts)}-${end.toLocaleDateString("en-US", opts)}, ${end.getFullYear()}`;
}

function scoreConference(c) {
  const reach = Math.min(5, Math.log10(Math.max(c.audience, 100)) - 1);
  const raw =
    (c.buyerDensity / 5) * 20 +
    (c.pspRelevance / 5) * 18 +
    (c.fxRelevance / 5) * 20 +
    (c.travelRelevance / 5) * 12 +
    (c.seniority / 5) * 14 +
    (reach / 5) * 10 -
    (c.costTier / 5) * 8 +
    6;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function tierFor(score) {
  if (score >= 78) return "A";
  if (score >= 62) return "B";
  return "C";
}

function normalize(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

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

function leadMatchScore(a, b) {
  const emailMatch = a.email && b.email && normalize(a.email) === normalize(b.email) ? 1 : 0;
  const companyMatch = similarity(a.company, b.company);
  const nameMatch = Math.max(
    similarity(`${a.firstName} ${a.lastName}`, `${b.firstName} ${b.lastName}`),
    initials(a) && initials(a) === initials(b) ? 0.72 : 0
  );
  return Math.max(emailMatch, nameMatch * 0.62 + companyMatch * 0.38);
}

function relationshipGroups() {
  const groups = [];
  for (const lead of state.leads) {
    let group = groups.find((g) => g.some((existing) => leadMatchScore(existing, lead) >= 0.72));
    if (group) group.push(lead);
    else groups.push([lead]);
  }
  return groups
    .filter((g) => g.length > 1)
    .map((g) => g.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
}

function relationshipVerdict(group) {
  const strong = group.filter((l) => l.sentiment === "Strong").length;
  const immediate = group.filter((l) => ["Immediate", "This quarter"].includes(l.urgency)).length;
  const conferences = new Set(group.map((l) => l.conferenceId)).size;
  const hasBudgetConcern = group.some((l) => /budget|benchmark|curious|exploring/i.test(l.notes));
  if (strong >= 2 || immediate >= 2) return "Warming relationship: ask for a concrete buying meeting.";
  if (conferences >= 2 && hasBudgetConcern) return "Repeat interest, not yet pain-confirmed: qualify budget and owner before more nurturing.";
  return "Known face: keep context visible, but avoid over-weighting the repeat count.";
}

function renderNav() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".nav-item").forEach((b) => b.classList.remove("active"));
      $$(".view").forEach((v) => v.classList.remove("active"));
      button.classList.add("active");
      $(`#${button.dataset.view}`).classList.add("active");
      $("#viewTitle").textContent = button.textContent;
      renderAll();
    });
  });
}

function renderFilters() {
  const verticals = [...new Set(state.conferences.flatMap((c) => c.verticals))].sort();
  const regions = [...new Set(state.conferences.map((c) => c.region))].sort();
  const statuses = [...new Set(state.conferences.map((c) => c.status))].sort();
  fillSelect("#verticalFilter", ["All verticals", ...verticals]);
  fillSelect("#regionFilter", ["All regions", ...regions]);
  fillSelect("#statusFilter", ["All statuses", ...statuses]);
  $("#leadConference").innerHTML = state.conferences
    .map((c) => `<option value="${c.id}">${c.name} - ${c.city}</option>`)
    .join("");
}

function fillSelect(selector, values) {
  const element = $(selector);
  const current = element.value;
  element.innerHTML = values.map((v) => `<option>${v}</option>`).join("");
  if (values.includes(current)) element.value = current;
}

function filteredConferences() {
  const query = normalize($("#searchInput").value);
  const vertical = $("#verticalFilter").value;
  const region = $("#regionFilter").value;
  const status = $("#statusFilter").value;
  return state.conferences
    .filter((c) => {
      const haystack = normalize(`${c.name} ${c.city} ${c.country} ${c.verticals.join(" ")}`);
      return !query || haystack.includes(query);
    })
    .filter((c) => vertical === "All verticals" || c.verticals.includes(vertical))
    .filter((c) => region === "All regions" || c.region === region)
    .filter((c) => status === "All statuses" || c.status === status)
    .sort((a, b) => scoreConference(b) - scoreConference(a));
}

function renderMetrics(items) {
  const committed = items.filter((c) => c.status === "Committed");
  const tierA = items.filter((c) => tierFor(scoreConference(c)) === "A").length;
  const audience = items.reduce((sum, c) => sum + c.audience, 0);
  $("#metrics").innerHTML = [
    ["Events", items.length],
    ["Tier A targets", tierA],
    ["Committed", committed.length],
    ["Reach", audience.toLocaleString()]
  ]
    .map(([label, value]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`)
    .join("");
}

function renderConferenceRows() {
  const items = filteredConferences();
  renderMetrics(items);
  $("#conferenceRows").innerHTML = items
    .map((c) => {
      const score = scoreConference(c);
      const tier = tierFor(score);
      return `<tr data-id="${c.id}">
        <td><strong>${c.name}</strong><br><span class="muted">${c.owner}</span></td>
        <td>${formatDateRange(c)}</td>
        <td>${c.city}, ${c.country}</td>
        <td>${c.verticals.map((v) => `<span class="pill">${v}</span>`).join(" ")}</td>
        <td>${c.audience.toLocaleString()}</td>
        <td><div class="score"><strong>${score}</strong><div class="score-bar"><div class="score-fill" style="width:${score}%"></div></div></div></td>
        <td><span class="pill tier-${tier.toLowerCase()}">Tier ${tier}</span></td>
        <td><span class="pill status-${c.status.toLowerCase()}">${c.status}</span></td>
      </tr>`;
    })
    .join("");
  $$("#conferenceRows tr").forEach((row) => {
    row.addEventListener("click", () => {
      selectedConferenceId = row.dataset.id;
      renderSelectedConference();
    });
  });
  if (!items.some((c) => c.id === selectedConferenceId)) selectedConferenceId = items[0]?.id;
  renderSelectedConference();
}

function renderSelectedConference() {
  const c = state.conferences.find((item) => item.id === selectedConferenceId);
  if (!c) {
    $("#selectedConference").innerHTML = "<p>No conference selected.</p>";
    return;
  }
  const score = scoreConference(c);
  const nearby = state.conferences
    .filter((other) => other.id !== c.id && Math.abs(new Date(other.startDate) - new Date(c.startDate)) / 86400000 <= 30)
    .slice(0, 3);
  $("#selectedConference").innerHTML = `<div class="detail-grid">
    <div>
      <p class="eyebrow">Selected event</p>
      <h3>${c.name}</h3>
      <p>${formatDateRange(c)} in ${c.city}, ${c.country}. Estimated ${c.audience.toLocaleString()} attendees.</p>
      <p><a href="${c.source}" target="_blank" rel="noreferrer">Source</a></p>
    </div>
    <div>
      <p class="eyebrow">Why it ranks ${score}</p>
      <p>${scoreNarrative(c)}</p>
      <p><strong>Trip piggyback:</strong> ${nearby.length ? nearby.map((n) => `${n.name} (${n.city})`).join(", ") : "No close cluster in the next 30 days."}</p>
    </div>
  </div>`;
}

function scoreNarrative(c) {
  const reasons = [];
  if (c.pspRelevance >= 4) reasons.push("dense PSP/payment audience");
  if (c.fxRelevance >= 4) reasons.push("clear FX exposure pain");
  if (c.travelRelevance >= 4) reasons.push("travel-wholesaler relevance");
  if (c.seniority >= 4) reasons.push("senior decision makers");
  if (c.costTier >= 4) reasons.push("higher travel or sponsorship cost");
  return reasons.join(", ") + ".";
}

function renderPlanning() {
  const months = Array.from({ length: 12 }, (_, i) => ({ index: i, label: new Date(2026, i, 1).toLocaleString("en-US", { month: "short" }), events: [] }));
  state.conferences.forEach((c) => months[new Date(c.startDate + "T00:00:00").getMonth()].events.push(c));
  const max = Math.max(...months.map((m) => m.events.length), 1);
  $("#coverageSummary").textContent = `${state.conferences.filter((c) => c.status === "Committed").length} committed events`;
  $("#timeline").innerHTML = months
    .map((m) => `<div class="month-row">
      <strong>${m.label}</strong>
      <div class="month-track"><div class="month-fill" style="width:${(m.events.length / max) * 100}%"></div></div>
      <span>${m.events.length}</span>
    </div>`)
    .join("");

  const clusters = findClusters();
  $("#clusters").innerHTML = clusters.length
    ? clusters.map((cluster) => `<div class="cluster"><strong>${cluster.city || cluster.region} cluster</strong><span>${cluster.events.map((e) => `${e.name} (${formatDateRange(e)})`).join(" | ")}</span></div>`).join("")
    : "<p class='muted'>No clusters found.</p>";

  const verticals = ["Payments", "Travel", "Fintech", "SaaS"];
  $("#gaps").innerHTML = verticals
    .map((v) => {
      const relevant = state.conferences.filter((c) => c.verticals.includes(v));
      const committed = relevant.filter((c) => c.status === "Committed");
      const avg = relevant.length ? Math.round(relevant.reduce((sum, c) => sum + scoreConference(c), 0) / relevant.length) : 0;
      const gap = avg >= 68 && committed.length < 2;
      return `<div class="gap"><strong>${v}</strong><p>${committed.length}/${relevant.length} committed. Average ICP score ${avg}.</p><p class="${gap ? "heat" : "muted"}">${gap ? "Under-invested: add coverage or piggyback." : "Coverage looks proportional."}</p></div>`;
    })
    .join("");
}

function findClusters() {
  const sorted = [...state.conferences].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
  const clusters = [];
  sorted.forEach((event, index) => {
    const window = sorted.slice(index + 1).filter((other) => {
      const days = (new Date(other.startDate) - new Date(event.startDate)) / 86400000;
      return days >= 0 && days <= 30 && (other.region === event.region || other.city === event.city);
    });
    if (window.length) clusters.push({ region: event.region, city: window.some((w) => w.city === event.city) ? event.city : "", events: [event, ...window] });
  });
  return clusters.slice(0, 5);
}

function renderRelationships() {
  const groups = relationshipGroups();
  $("#relationshipList").innerHTML = groups.length
    ? groups.map(renderRelationship).join("")
    : "<div class='panel'><p class='muted'>No repeat contacts yet. Capture a lead and this view will update automatically.</p></div>";
  $$("[data-draft]").forEach((button) => {
    button.addEventListener("click", () => draftFollowUp(button.dataset.draft));
  });
}

function renderRelationship(group) {
  const latest = group[group.length - 1];
  const conferences = group.map((lead) => state.conferences.find((c) => c.id === lead.conferenceId)?.name || "Unknown");
  const encodedId = encodeURIComponent(group.map((lead) => lead.id).join(","));
  return `<div class="relationship">
    <div>
      <strong>${latest.firstName} ${latest.lastName} at ${latest.company}</strong>
      <p>${relationshipVerdict(group)}</p>
      <p class="muted">${group.length} encounters: ${conferences.join(" -> ")}</p>
      <p class="muted">${group.map((l) => `${l.title || "Unknown title"}: ${l.notes}`).join(" ")}</p>
    </div>
    <div class="actions">
      <span class="pill ${latest.sentiment === "Strong" ? "tier-a" : "tier-b"}">${latest.sentiment}</span>
      <button class="ghost-button" data-draft="${encodedId}">Draft follow-up</button>
    </div>
  </div>`;
}

function renderScoringExplain() {
  const top = [...state.conferences].sort((a, b) => scoreConference(b) - scoreConference(a)).slice(0, 4);
  $("#scoringExplain").innerHTML = top
    .map((c) => `<div class="cluster"><strong>${c.name}: ${scoreConference(c)} / Tier ${tierFor(scoreConference(c))}</strong><span>${scoreNarrative(c)}</span></div>`)
    .join("");
}

function setupCapture() {
  ["firstName", "lastName", "company", "email"].forEach((id) => {
    $(`#${id}`).addEventListener("input", renderMatchPreview);
  });
  $("#leadForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const lead = {
      id: createId(),
      conferenceId: $("#leadConference").value,
      firstName: $("#firstName").value.trim(),
      lastName: $("#lastName").value.trim(),
      company: $("#company").value.trim(),
      title: $("#title").value.trim(),
      email: $("#email").value.trim(),
      phone: $("#phone").value.trim(),
      vertical: $("#leadVertical").value,
      urgency: $("#urgency").value,
      notes: $("#notes").value.trim(),
      sentiment: $("input[name='sentiment']:checked").value,
      nextStep: $("#nextStep").value.trim(),
      createdAt: new Date().toISOString()
    };
    state.leads.push(lead);
    saveState();
    $("#leadForm").reset();
    $("#sentStrong").checked = true;
    renderAll();
    alert("Lead saved. Relationship tracking updated.");
  });
}

function createId() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return `lead-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function draftFollowUp(encodedIds) {
  const ids = decodeURIComponent(encodedIds).split(",");
  const group = ids.map((id) => state.leads.find((lead) => lead.id === id)).filter(Boolean);
  const latest = group[group.length - 1];
  const conference = state.conferences.find((c) => c.id === latest.conferenceId);
  const draft = [
    `Subject: Good seeing you after ${conference?.name || "the conference"}`,
    "",
    `Hi ${latest.firstName},`,
    "",
    `Great speaking again. I was thinking about your ${latest.company} use case around ${latest.vertical.toLowerCase()} FX exposure, especially after hearing: "${latest.notes || "the context you shared"}".`,
    "",
    `${relationshipVerdict(group)} My suggested next step is: ${latest.nextStep || "a short working session with the relevant commercial and treasury owners"}.`,
    "",
    "Best,"
  ].join("\n");
  navigator.clipboard?.writeText(draft);
  alert(`Follow-up draft copied:\n\n${draft}`);
}

function renderMatchPreview() {
  const draft = {
    firstName: $("#firstName").value,
    lastName: $("#lastName").value,
    company: $("#company").value,
    email: $("#email").value
  };
  const matches = state.leads
    .map((lead) => ({ lead, score: leadMatchScore(draft, lead) }))
    .filter((m) => m.score >= 0.62)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  $("#matchPreview").innerHTML = matches.length
    ? `<strong>Possible repeat contact</strong><br>${matches.map((m) => `${m.lead.firstName} ${m.lead.lastName}, ${m.lead.company} (${Math.round(m.score * 100)}% match)`).join("<br>")}`
    : "No likely repeat contact yet.";
}

async function generateAiSummaries() {
  const groups = relationshipGroups();
  if (!groups.length) return;
  if (!state.ai.key) {
    alert("No AI key saved. Showing local relationship summaries instead.");
    renderRelationships();
    return;
  }
  $("#relationshipList").innerHTML = "<div class='panel'><p>Generating summaries...</p></div>";
  try {
    const prompt = `You are helping Grain, an FX risk fintech, brief sales reps. Summarize each repeat contact in 2 sentences and include one practical next step. Data: ${JSON.stringify(groups)}`;
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.ai.key}`
      },
      body: JSON.stringify({
        model: state.ai.model || "gpt-4o-mini",
        messages: [
          { role: "system", content: "Return concise sales guidance, not generic CRM text." },
          { role: "user", content: prompt }
        ]
      })
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    $("#relationshipList").innerHTML = `<div class="panel"><h3>AI relationship briefing</h3><p>${data.choices[0].message.content.replace(/\n/g, "<br>")}</p></div>` + groups.map(renderRelationship).join("");
  } catch (error) {
    $("#relationshipList").innerHTML = `<div class="panel"><p class="heat">AI request failed. Check the key/model, then try again.</p><p class="muted">${error.message}</p></div>`;
  }
}

function exportCsv() {
  const rows = [
    ["Email", "First Name", "Last Name", "Company", "Job Title", "Phone", "Conference", "Lead Status", "Notes", "Next Step"],
    ...state.leads.map((lead) => {
      const conf = state.conferences.find((c) => c.id === lead.conferenceId);
      return [lead.email, lead.firstName, lead.lastName, lead.company, lead.title, lead.phone, conf?.name || "", lead.sentiment, lead.notes, lead.nextStep];
    })
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "grain-conference-leads-hubspot.csv";
  link.click();
  URL.revokeObjectURL(url);
}

async function pushHubspot() {
  state.hubspot.token = $("#hubspotToken").value.trim();
  saveState();
  const token = state.hubspot.token;
  if (!token) {
    $("#hubspotResult").textContent = "Add a HubSpot private app token first, or use CSV export.";
    return;
  }
  $("#hubspotResult").textContent = "Pushing contacts...";
  try {
    let pushed = 0;
    for (const lead of state.leads) {
      if (!lead.email) continue;
      const response = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          properties: {
            email: lead.email,
            firstname: lead.firstName,
            lastname: lead.lastName,
            company: lead.company,
            jobtitle: lead.title,
            phone: lead.phone,
            lifecyclestage: "lead",
            hs_lead_status: lead.sentiment
          }
        })
      });
      if (response.ok || response.status === 409) pushed += 1;
    }
    $("#hubspotResult").textContent = `${pushed} contacts pushed or already existed.`;
  } catch (error) {
    $("#hubspotResult").textContent = `HubSpot push failed: ${error.message}`;
  }
}

function setupSettings() {
  $("#aiKey").value = state.ai.key || "";
  $("#aiModel").value = state.ai.model || "gpt-4o-mini";
  $("#hubspotToken").value = state.hubspot.token || "";
  $("#saveAi").addEventListener("click", () => {
    state.ai.key = $("#aiKey").value.trim();
    state.ai.model = $("#aiModel").value.trim();
    state.hubspot.token = $("#hubspotToken").value.trim();
    saveState();
    alert("Settings saved in this browser.");
  });
  $("#pushHubspot").addEventListener("click", pushHubspot);
  $("#aiSummaries").addEventListener("click", generateAiSummaries);
}

function renderAll() {
  renderConferenceRows();
  renderPlanning();
  renderRelationships();
  renderScoringExplain();
  renderMatchPreview();
}

function setup() {
  renderNav();
  renderFilters();
  setupCapture();
  setupSettings();
  ["searchInput", "verticalFilter", "regionFilter", "statusFilter"].forEach((id) => $(`#${id}`).addEventListener("input", renderConferenceRows));
  $("#exportCsv").addEventListener("click", exportCsv);
  $("#seedReset").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });
  renderAll();
}

setup();
