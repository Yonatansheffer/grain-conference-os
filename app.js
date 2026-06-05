const STORAGE_KEY = "grain-conference-os";
const SIDEBAR_KEY = "grain-conference-sidebar";
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 380;
const STATUS_OPTIONS = ["Committed", "Considering", "Watchlist"];
const TEAM_OPTIONS = ["Maya", "Noah", "Lior", "Dana", "Alex"];
const DEFAULT_SCORE_WEIGHTS = {
  buyerDensity: 20,
  pspRelevance: 18,
  fxRelevance: 20,
  travelRelevance: 12,
  seniority: 14,
  audienceReach: 10,
  costPenalty: 8
};
const SCORE_WEIGHT_LABELS = {
  buyerDensity: "Buyer density",
  pspRelevance: "PSP/payment fit",
  fxRelevance: "FX exposure",
  travelRelevance: "Travel relevance",
  seniority: "Decision-maker seniority",
  audienceReach: "Audience reach",
  costPenalty: "Travel cost penalty"
};
const CONFIRMED_STATUSES = ["Committed", "Approved", "Confirmed"];
const PAGE_TITLES = {
  conferences: "Conferences",
  planning: "Planning",
  capture: "Capture",
  relationships: "Relationships",
  settings: "Settings"
};
const PAGE_DESCRIPTIONS = {
  conferences: "Prioritize events by ICP fit, coverage needs, and expected pipeline value.",
  planning: "Track the event calendar, spot coverage gaps, and tune trip-cluster rules.",
  capture: "Log high-signal conversations quickly while reps are on the conference floor.",
  relationships: "Review repeat contacts, relationship arcs, and recommended next steps.",
  settings: "Configure ICP scoring weights, optional AI assistance, and HubSpot export or sync settings."
};
const METRIC_ICONS = {
  Events: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 2v4M16 2v4M4 9h16M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/></svg>`,
  "Tier A targets": `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.2 1 6-5.4-2.9-5.4 2.9 1-6-4.4-4.2 6.1-.9Z"/></svg>`,
  Committed: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20 6-11 11-5-5"/></svg>`,
  Reach: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM2 12h20M12 2a12 12 0 0 1 0 20M12 2a12 12 0 0 0 0 20"/></svg>`
};

const state = migrateState(loadState());
let selectedConferenceId = state.conferences[0]?.id;
let filterState = { vertical: [], region: [], status: [] };
let opportunityFilter = null;
let sortState = { key: "score", direction: "desc" };
let calendarDate = new Date("2026-06-01T00:00:00");
let clusterConfig = { regions: [], windowDays: 30 };
let speechRecognition = null;
let isRecordingScribble = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) return JSON.parse(saved);
  return {
    conferences: clone(CONFERENCES),
    leads: clone(LEADS),
    ai: { key: "", model: "gpt-4o-mini" },
    hubspot: { token: "" },
    scoringWeights: clone(DEFAULT_SCORE_WEIGHTS)
  };
}

function migrateState(loaded) {
  loaded.ai = loaded.ai || { key: "", model: "gpt-4o-mini" };
  loaded.hubspot = loaded.hubspot || { token: "" };
  loaded.scoringWeights = { ...DEFAULT_SCORE_WEIGHTS, ...(loaded.scoringWeights || {}) };
  loaded.conferences = loaded.conferences.map((conference) => {
    if (Array.isArray(conference.team)) return conference;
    const team = conference.owner && conference.owner !== "Unassigned" ? [conference.owner] : [];
    return { ...conference, team };
  });
  return loaded;
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
  const weights = { ...DEFAULT_SCORE_WEIGHTS, ...(state.scoringWeights || {}) };
  const reach = Math.min(5, Math.log10(Math.max(c.audience, 100)) - 1);
  const raw =
    (c.buyerDensity / 5) * weights.buyerDensity +
    (c.pspRelevance / 5) * weights.pspRelevance +
    (c.fxRelevance / 5) * weights.fxRelevance +
    (c.travelRelevance / 5) * weights.travelRelevance +
    (c.seniority / 5) * weights.seniority +
    (reach / 5) * weights.audienceReach -
    (c.costTier / 5) * weights.costPenalty +
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
  if (strong >= 2 || immediate >= 2) return "Warming relationship: schedule a focused demo call with the right commercial and treasury stakeholders.";
  if (conferences >= 2 && hasBudgetConcern) return "Repeat interest, not yet pain-confirmed: qualify budget and owner before more nurturing.";
  return "Known face: keep context visible, but avoid over-weighting the repeat count.";
}

function renderNav() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      const previousView = $(".nav-item.active")?.dataset.view;
      $$(".nav-item").forEach((b) => b.classList.remove("active"));
      $$(".view").forEach((v) => v.classList.remove("active"));
      button.classList.add("active");
      $(`#${button.dataset.view}`).classList.add("active");
      $("#pageTitle").textContent = PAGE_TITLES[button.dataset.view] || "Grain Conference Tool";
      $("#pageDescription").textContent = PAGE_DESCRIPTIONS[button.dataset.view] || "";
      if (previousView !== button.dataset.view) collapseSidebar();
      renderAll();
    });
  });
}

function setupSidebar() {
  const shell = $("#appShell");
  const toggle = $("#sidebarToggle");
  const resizer = $("#sidebarResizer");
  const saved = JSON.parse(localStorage.getItem(SIDEBAR_KEY) || "{}");

  if (saved.width) {
    shell.style.setProperty("--sidebar-width", `${saved.width}px`);
  }
  if (saved.collapsed) {
    shell.classList.add("sidebar-collapsed");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Expand sidebar");
  }

  toggle.addEventListener("click", () => {
    const collapsed = !shell.classList.contains("sidebar-collapsed");
    shell.classList.toggle("sidebar-collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    localStorage.setItem(SIDEBAR_KEY, JSON.stringify({ ...savedSidebar(), collapsed }));
  });

  resizer.addEventListener("pointerdown", (event) => {
    if (shell.classList.contains("sidebar-collapsed") || window.matchMedia("(max-width: 980px)").matches) return;
    event.preventDefault();
    resizer.classList.add("is-dragging");
    resizer.setPointerCapture(event.pointerId);
  });

  resizer.addEventListener("pointermove", (event) => {
    if (!resizer.classList.contains("is-dragging")) return;
    const width = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, event.clientX));
    shell.style.setProperty("--sidebar-width", `${width}px`);
    localStorage.setItem(SIDEBAR_KEY, JSON.stringify({ ...savedSidebar(), width, collapsed: false }));
  });

  resizer.addEventListener("pointerup", (event) => {
    resizer.classList.remove("is-dragging");
    resizer.releasePointerCapture(event.pointerId);
  });

  resizer.addEventListener("pointercancel", () => {
    resizer.classList.remove("is-dragging");
  });
}

function savedSidebar() {
  return JSON.parse(localStorage.getItem(SIDEBAR_KEY) || "{}");
}

function collapseSidebar() {
  const shell = $("#appShell");
  const toggle = $("#sidebarToggle");
  if (!shell || shell.classList.contains("sidebar-collapsed")) return;
  shell.classList.add("sidebar-collapsed");
  toggle?.setAttribute("aria-expanded", "false");
  toggle?.setAttribute("aria-label", "Expand sidebar");
  localStorage.setItem(SIDEBAR_KEY, JSON.stringify({ ...savedSidebar(), collapsed: true }));
}

function renderFilters() {
  const verticals = [...new Set(state.conferences.flatMap((c) => c.verticals))].sort();
  const regions = [...new Set(state.conferences.map((c) => c.region))].sort();
  const statuses = [...new Set([...STATUS_OPTIONS, ...state.conferences.map((c) => c.status)])].sort();
  renderMultiFilter("vertical", verticals, "verticals");
  renderMultiFilter("region", regions, "regions");
  renderMultiFilter("status", statuses, "statuses");
  renderActiveFilterChips();
  renderClusterRegionFilter(regions);
  $("#leadConference").innerHTML = state.conferences
    .map((c) => `<option value="${c.id}">${c.name} - ${c.city}</option>`)
    .join("");
}

function renderClusterRegionFilter(regions) {
  const menu = $("#clusterRegionFilter");
  const button = $("#clusterRegionButton");
  if (!menu || !button) return;
  button.textContent = clusterConfig.regions.length ? `${clusterConfig.regions.length} regions` : "All regions";
  menu.innerHTML = [
    `<button class="filter-clear" type="button" data-filter-clear="clusterRegion">Clear regions</button>`,
    ...regions.map((region) => `<label class="multi-option"><input type="checkbox" value="${region}" ${clusterConfig.regions.includes(region) ? "checked" : ""}> <span>${region}</span></label>`)
  ].join("");
  menu.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      clusterConfig.regions = Array.from(menu.querySelectorAll("input:checked")).map((item) => item.value);
      renderFilters();
      renderPlanning();
    });
  });
  menu.querySelector("[data-filter-clear]")?.addEventListener("click", () => {
    clusterConfig.regions = [];
    renderFilters();
    renderPlanning();
  });
}

function renderMultiFilter(key, options, pluralLabel) {
  const menu = $(`#${key}Filter`);
  const button = $(`#${key}FilterButton`);
  const selected = filterState[key] || [];
  button.classList.toggle("has-selection", selected.length > 0);
  button.textContent = selected.length ? `${selected.length} ${pluralLabel}` : `All ${pluralLabel}`;
  menu.innerHTML = [
    `<button class="filter-clear" type="button" data-filter-clear="${key}">Clear ${key}</button>`,
    ...options.map((option) => `<label class="multi-option"><input type="checkbox" value="${option}" ${selected.includes(option) ? "checked" : ""}> <span>${option}</span></label>`)
  ].join("");
  menu.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      opportunityFilter = null;
      filterState[key] = Array.from(menu.querySelectorAll("input:checked")).map((item) => item.value);
      renderFilters();
      renderConferenceRows();
    });
  });
  menu.querySelector("[data-filter-clear]")?.addEventListener("click", () => {
    opportunityFilter = null;
    filterState[key] = [];
    renderFilters();
    renderConferenceRows();
  });
}

function renderActiveFilterChips() {
  const container = $("#activeFilterChips");
  if (!container) return;
  const labels = { vertical: "Vertical", region: "Region", status: "Status" };
  const chips = Object.entries(filterState).flatMap(([key, values]) =>
    values.map((value) => ({ key, value, label: labels[key] || key }))
  );
  container.innerHTML = chips.length
    ? chips.map(({ key, value, label }) => `<span class="filter-chip"><span>${label}: ${value}</span><button type="button" data-filter-chip="${key}" data-filter-value="${value}" aria-label="Clear ${label} ${value}">x</button></span>`).join("")
    : "";
  container.querySelectorAll("[data-filter-chip]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.filterChip;
      opportunityFilter = null;
      filterState[key] = (filterState[key] || []).filter((value) => value !== button.dataset.filterValue);
      renderFilters();
      renderConferenceRows();
    });
  });
}

function setupFilterControls() {
  $$("[data-filter-button]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const key = button.dataset.filterButton;
      $$(".multi-filter-menu").forEach((menu) => {
        if (menu.dataset.filter !== key) menu.classList.remove("open");
      });
      $(`#${key}Filter`).classList.toggle("open");
    });
  });

  $$(".multi-filter-menu").forEach((menu) => {
    menu.addEventListener("click", (event) => event.stopPropagation());
  });

  document.addEventListener("click", () => {
    $$(".multi-filter-menu").forEach((menu) => menu.classList.remove("open"));
    $$(".team-menu").forEach((menu) => menu.classList.remove("open"));
  });
}

function setupSorting() {
  $$(".sort-button").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;
      if (sortState.key === key) {
        sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
      } else {
        sortState = { key, direction: ["audience", "score", "date"].includes(key) ? "desc" : "asc" };
      }
      renderConferenceRows();
    });
  });
}

function setupPlanningControls() {
  $("#calendarPrev").addEventListener("click", () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1);
    renderPlanning();
  });
  $("#calendarNext").addEventListener("click", () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1);
    renderPlanning();
  });
  $("#clusterWindow").addEventListener("input", (event) => {
    const value = Number(event.currentTarget.value);
    clusterConfig.windowDays = Math.max(1, Math.min(90, Number.isFinite(value) ? value : 30));
    renderPlanning();
  });
}

function filteredConferences() {
  const query = normalize($("#searchInput").value);
  return state.conferences
    .filter((c) => {
      const haystack = normalize(`${c.name} ${c.city} ${c.country} ${c.region} ${c.verticals.join(" ")} ${teamLabel(c)}`);
      return !query || haystack.includes(query);
    })
    .filter((c) => !filterState.vertical.length || c.verticals.some((vertical) => filterState.vertical.includes(vertical)))
    .filter((c) => !filterState.region.length || filterState.region.includes(c.region))
    .filter((c) => !filterState.status.length || filterState.status.includes(c.status))
    .filter((c) => !opportunityFilter || (
      c.verticals.includes(opportunityFilter.vertical) &&
      opportunityFilter.statuses.includes(c.status) &&
      scoreConference(c) >= opportunityFilter.minScore
    ))
    .sort(compareConferences);
}

function compareConferences(a, b) {
  const direction = sortState.direction === "asc" ? 1 : -1;
  const valueA = sortValue(a, sortState.key);
  const valueB = sortValue(b, sortState.key);
  if (typeof valueA === "number" && typeof valueB === "number") return (valueA - valueB) * direction;
  return String(valueA).localeCompare(String(valueB), undefined, { numeric: true, sensitivity: "base" }) * direction;
}

function sortValue(c, key) {
  const values = {
    name: c.name,
    date: new Date(c.startDate).getTime(),
    location: `${c.region} ${c.city} ${c.country}`,
    verticals: c.verticals.join(", "),
    audience: c.audience,
    score: scoreConference(c),
    team: teamLabel(c),
    status: c.status
  };
  return values[key] ?? "";
}

function renderMetrics(items) {
  const committed = items.filter((c) => c.status === "Committed");
  const tierA = items.filter((c) => tierFor(scoreConference(c)) === "A").length;
  const audience = items
    .filter((c) => CONFIRMED_STATUSES.includes(c.status))
    .reduce((sum, c) => sum + c.audience, 0);
  $("#metrics").innerHTML = [
    ["Events", items.length],
    ["Tier A targets", tierA],
    ["Committed", committed.length],
    ["Reach", audience.toLocaleString()]
  ]
    .map(([label, value]) => `<div class="metric">
      <span class="metric-icon">${METRIC_ICONS[label]}</span>
      <strong>${value}</strong>
      <span>${label}</span>
      ${label === "Reach" ? `<small>From approved attendance only</small>` : ""}
    </div>`)
    .join("");
}

function renderConferenceRows() {
  const items = filteredConferences();
  renderMetrics(items);
  renderSortButtons();
  $("#conferenceRows").innerHTML = items
    .map((c) => {
      const score = scoreConference(c);
      const tier = tierFor(score);
      return `<tr data-id="${c.id}">
        <td><strong>${c.name}</strong></td>
        <td>${formatDateRange(c)}</td>
        <td><strong>${c.region}</strong><br><span class="muted">${c.city}, ${c.country}</span></td>
        <td><div class="vertical-pill-group">${c.verticals.map((v) => `<span class="vertical-pill">${v}</span>`).join("")}</div></td>
        <td>${c.audience.toLocaleString()}</td>
        <td><div class="score"><strong>${score} <span class="pill tier-${tier.toLowerCase()}">Tier ${tier}</span></strong><div class="score-bar"><div class="score-fill" style="width:${score}%"></div></div></div></td>
        <td>${renderTeamSelect(c)}</td>
        <td>${renderStatusSelect(c)}</td>
      </tr>`;
    })
    .join("");
  $$("#conferenceRows tr").forEach((row) => {
    row.addEventListener("click", () => {
      selectedConferenceId = row.dataset.id;
      openConferenceDetail(selectedConferenceId);
    });
  });
  $$(".table-select").forEach((select) => {
    select.addEventListener("click", (event) => event.stopPropagation());
    select.addEventListener("change", handleTableEdit);
  });
  $$(".team-editor").forEach((editor) => {
    editor.addEventListener("click", (event) => event.stopPropagation());
    editor.querySelector(".team-button").addEventListener("click", () => {
      $$(".team-menu").forEach((menu) => {
        if (menu !== editor.querySelector(".team-menu")) menu.classList.remove("open");
      });
      editor.querySelector(".team-menu").classList.toggle("open");
    });
    editor.querySelectorAll("input").forEach((input) => {
      input.addEventListener("change", () => handleTeamEdit(editor));
    });
  });
  if (!items.some((c) => c.id === selectedConferenceId)) selectedConferenceId = items[0]?.id;
}

function renderSortButtons() {
  $$(".sort-button").forEach((button) => {
    const active = button.dataset.sort === sortState.key;
    button.classList.toggle("active", active);
    button.dataset.direction = active ? sortState.direction : "";
    button.setAttribute("aria-sort", active ? (sortState.direction === "asc" ? "ascending" : "descending") : "none");
  });
}

function renderStatusSelect(c) {
  return `<select class="table-select status-select" data-edit="status" data-id="${c.id}" aria-label="Status for ${c.name}">
    ${STATUS_OPTIONS.map((status) => `<option value="${status}" ${c.status === status ? "selected" : ""}>${status}</option>`).join("")}
  </select>`;
}

function renderTeamSelect(c) {
  const team = Array.isArray(c.team) ? c.team : [];
  return `<div class="team-editor" data-id="${c.id}">
    <button class="table-select team-button" type="button" aria-label="Team for ${c.name}">${teamLabel(c)}</button>
    <div class="team-menu">
      ${TEAM_OPTIONS.map((person) => `<label class="multi-option"><input type="checkbox" value="${person}" ${team.includes(person) ? "checked" : ""}> <span>${person}</span></label>`).join("")}
    </div>
  </div>`;
}

function handleTableEdit(event) {
  const conference = state.conferences.find((c) => c.id === event.currentTarget.dataset.id);
  if (!conference) return;
  conference.status = event.currentTarget.value;
  saveState();
  renderAll();
}

function handleTeamEdit(editor) {
  const conference = state.conferences.find((c) => c.id === editor.dataset.id);
  if (!conference) return;
  conference.team = Array.from(editor.querySelectorAll("input:checked")).map((input) => input.value);
  saveState();
  renderAll();
}

function teamLabel(c) {
  return Array.isArray(c.team) && c.team.length ? c.team.join(", ") : "Unassigned";
}

function openConferenceDetail(id) {
  selectedConferenceId = id;
  renderSelectedConference();
  openModal("#conferenceDetailModal");
}

function renderSelectedConference() {
  const c = state.conferences.find((item) => item.id === selectedConferenceId);
  if (!c) {
    $("#conferenceDetailBody").innerHTML = "<p>No conference selected.</p>";
    return;
  }
  const score = scoreConference(c);
  const nearby = state.conferences
    .filter((other) => other.id !== c.id && Math.abs(new Date(other.startDate) - new Date(c.startDate)) / 86400000 <= 30)
    .slice(0, 3);
  $("#conferenceDetailBody").innerHTML = `<div class="modal-head">
    <span class="eyebrow">Selected event</span>
    <h3 id="conferenceDetailTitle">${c.name}</h3>
    <p class="muted">${formatDateRange(c)} in ${c.city}, ${c.country}. Estimated ${c.audience.toLocaleString()} attendees.</p>
  </div>
  <div class="detail-grid">
    <div>
      <p class="eyebrow">Coverage</p>
      <p><strong>Status:</strong> ${c.status}</p>
      <p><strong>Team:</strong> ${teamLabel(c)}</p>
      <p><strong>Region:</strong> ${c.region}</p>
      <p>${c.source ? `<a href="${c.source}" target="_blank" rel="noreferrer">Source</a>` : "No source URL saved."}</p>
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
  try {
    $("#coverageSummary").textContent = `${state.conferences.filter((c) => c.status === "Committed").length} committed events`;
    renderCalendar();

    const clusters = findClusters();
    $("#clusterSummary").textContent = `${clusterConfig.windowDays}-day window`;
    $("#clusters").innerHTML = clusters.length
      ? clusters.map((cluster) => `<div class="cluster"><strong>${cluster.city || cluster.region} cluster</strong><span>${cluster.events.map((e) => `${e.name} (${formatDateRange(e)})`).join(" | ")}</span></div>`).join("")
      : "<p class='muted'>No clusters found.</p>";

    const verticals = ["Payments", "Travel", "Fintech", "SaaS"];
    $("#gaps").innerHTML = verticals
      .map(renderGapCard)
      .join("");
    $$("[data-gap-opportunities]").forEach((button) => {
      button.addEventListener("click", () => viewSegmentOpportunities(button.dataset.gapOpportunities));
    });
  } catch (error) {
    console.error("Planning render failed", error);
    $("#eventCalendar").innerHTML = `<div class="empty-state"><strong>Planning could not load.</strong><span>Reset demo data or refresh the page to rebuild the event calendar.</span></div>`;
    $("#clusters").innerHTML = "";
    $("#gaps").innerHTML = "";
  }
}

function renderGapCard(vertical) {
  const relevant = state.conferences.filter((c) => c.verticals.includes(vertical));
  const committed = relevant.filter((c) => c.status === "Committed");
  const avg = relevant.length ? Math.round(relevant.reduce((sum, c) => sum + scoreConference(c), 0) / relevant.length) : 0;
  const ratio = relevant.length ? committed.length / relevant.length : 0;
  const progress = Math.round(ratio * 100);
  const gap = avg >= 68 && committed.length < 2;
  const pending = relevant
    .filter((c) => c.status !== "Committed" && scoreConference(c) >= 68)
    .sort((a, b) => scoreConference(b) - scoreConference(a));
  const missedReach = pending.reduce((sum, c) => sum + c.audience, 0);
  const tone = gap ? (progress === 0 ? "danger" : "warning") : "healthy";
  return `<div class="gap gap-${tone}">
    <div class="gap-head">
      <strong>${vertical}</strong>
      <span>${progress}% covered</span>
    </div>
    <div class="gap-progress" aria-label="${vertical} committed coverage">
      <span style="width:${Math.min(100, progress)}%"></span>
    </div>
    <p>${committed.length}/${relevant.length} committed. Average ICP score ${avg}.</p>
    <p class="${gap ? "heat" : "muted"}">${gap ? "Under-invested: add coverage or piggyback." : "Coverage looks proportional."}</p>
    ${gap ? `<p class="muted gap-cost">Missing out on ${missedReach.toLocaleString()} potential reach across ${pending.length} pending events.</p>
      <button class="gap-action" type="button" data-gap-opportunities="${vertical}">View Opportunities</button>` : ""}
  </div>`;
}

function viewSegmentOpportunities(vertical) {
  filterState = {
    vertical: [vertical],
    region: [],
    status: ["Considering", "Watchlist"]
  };
  opportunityFilter = { vertical, statuses: ["Considering", "Watchlist"], minScore: 68 };
  sortState = { key: "score", direction: "desc" };
  renderFilters();
  document.querySelector("[data-view='conferences']").click();
  $("#searchInput").value = "";
  renderConferenceRows();
  document.querySelector("#conferences")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const label = calendarDate.toLocaleString("en-US", { month: "long", year: "numeric" });
  $("#calendarLabel").textContent = label;
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const blanks = first.getDay();
  const monthEvents = state.conferences.filter((event) => {
    const eventDate = new Date(event.startDate + "T00:00:00");
    return eventDate.getFullYear() === year && eventDate.getMonth() === month;
  });
  const cells = [];
  for (let i = 0; i < blanks; i += 1) cells.push(`<div class="calendar-day empty"></div>`);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const events = monthEvents.filter((event) => new Date(event.startDate + "T00:00:00").getDate() === day);
    cells.push(`<div class="calendar-day">
      <strong>${day}</strong>
      <div class="calendar-events">
        ${events.map((event) => `<button class="calendar-event tier-${tierFor(scoreConference(event)).toLowerCase()}" type="button" title="${event.name}" data-calendar-event="${event.id}">${event.name}</button>`).join("")}
      </div>
    </div>`);
  }
  $("#eventCalendar").innerHTML = `
    <div class="calendar-weekdays">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<span>${day}</span>`).join("")}</div>
    <div class="calendar-grid">${cells.join("")}</div>
  `;
  $$("[data-calendar-event]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedConferenceId = button.dataset.calendarEvent;
      document.querySelector("[data-view='conferences']").click();
      openConferenceDetail(selectedConferenceId);
    });
  });
}

function findClusters() {
  const sorted = [...state.conferences].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
  const clusters = [];
  sorted.forEach((event, index) => {
    const window = sorted.slice(index + 1).filter((other) => {
      const days = (new Date(other.startDate) - new Date(event.startDate)) / 86400000;
      const regionAllowed = !clusterConfig.regions.length || clusterConfig.regions.includes(event.region) || clusterConfig.regions.includes(other.region);
      return regionAllowed && days >= 0 && days <= clusterConfig.windowDays && (other.region === event.region || other.city === event.city);
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
  $$("[data-next-step]").forEach((button) => {
    button.addEventListener("click", () => handleNextStep(button.dataset.nextStep, button.dataset.group, button));
  });
  $$("[data-copy-context]").forEach((button) => {
    button.addEventListener("click", () => copyRelationshipContext(button.dataset.copyContext));
  });
}

function renderRelationship(group) {
  const latest = group[group.length - 1];
  const conferences = group.map((lead) => state.conferences.find((c) => c.id === lead.conferenceId)?.name || "Unknown");
  const encodedId = encodeURIComponent(group.map((lead) => lead.id).join(","));
  return `<div class="relationship">
    <div>
      <div class="relationship-title">
        <strong>${latest.firstName} ${latest.lastName} at ${latest.company}</strong>
        <button class="copy-context-button" type="button" title="Copy relationship context" aria-label="Copy relationship context" data-copy-context="${encodedId}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h10v12H8z"/><path d="M6 16H4V4h12v2"/></svg>
        </button>
      </div>
      <p class="relationship-summary">${relationshipVerdict(group)}</p>
      <p class="muted">${group.length} encounters: ${conferences.join(" -> ")}</p>
      <p class="muted">${group.map((l) => `${l.title || "Unknown title"}: ${l.notes}`).join(" ")}</p>
      <div class="lead-enrichment" aria-live="polite"></div>
    </div>
    <div class="actions">
      <span class="pill ${latest.sentiment === "Strong" ? "tier-a" : "tier-b"}">${latest.sentiment}</span>
      <div class="next-steps">
        <span class="muted">Next steps</span>
        ${relationshipNextSteps(group).map((step) => `<button class="ghost-button action-${step.action}" type="button" data-next-step="${step.action}" data-group="${encodedId}">${step.label}</button>`).join("")}
      </div>
    </div>
  </div>`;
}

function relationshipNextSteps(group) {
  const verdict = relationshipVerdict(group);
  const steps = [{ action: "gmail", label: "Draft Email Follow-up" }];
  if (/Warming relationship/i.test(verdict)) {
    steps.push({ action: "demo", label: "Schedule Demo Call" });
  } else if (/budget|owner/i.test(verdict)) {
    steps.push({ action: "qualify", label: "Qualify budget owner" });
  } else {
    steps.push({ action: "nurture", label: "Add nurture task" });
  }
  steps.push({ action: "linkedin", label: "Connect on LinkedIn" });
  steps.push({ action: "enrich", label: "Enrich Lead Data" });
  return steps;
}

function renderScoringExplain() {
  if (!$("#scoringExplain")) return;
  const top = [...state.conferences].sort((a, b) => scoreConference(b) - scoreConference(a)).slice(0, 4);
  $("#scoringExplain").innerHTML = top
    .map((c) => `<div class="cluster"><strong>${c.name}: ${scoreConference(c)} / Tier ${tierFor(scoreConference(c))}</strong><span>${scoreNarrative(c)}</span></div>`)
    .join("");
}

function setupCapture() {
  ["firstName", "lastName", "company", "email"].forEach((id) => {
    $(`#${id}`).addEventListener("input", renderMatchPreview);
  });
  $("#parseScribble").addEventListener("click", parseFloorScribble);
  $("#recordScribble").addEventListener("click", toggleScribbleRecording);
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
    $("#scribbleInput").value = "";
    $("#scribbleStatus").textContent = "";
    $("#sentStrong").checked = true;
    renderAll();
    alert("Lead saved. Relationship tracking updated.");
  });
}

async function parseFloorScribble() {
  const raw = $("#scribbleInput").value.trim();
  if (!raw) {
    $("#scribbleStatus").textContent = "Add a scribble first.";
    return;
  }
  $("#scribbleStatus").textContent = state.ai.key ? "Parsing with AI..." : "Parsing locally...";
  let parsed;
  try {
    parsed = state.ai.key ? await parseScribbleWithAi(raw) : parseScribbleLocally(raw);
  } catch (error) {
    console.warn("AI parse failed, using local parser", error);
    parsed = parseScribbleLocally(raw);
    $("#scribbleStatus").textContent = "AI unavailable. Local draft ready.";
  }
  applyParsedLead(parsed, raw);
  revealLeadForm();
  renderMatchPreview();
  $("#scribbleStatus").textContent = state.ai.key ? "AI draft ready." : "Local draft ready.";
}

async function parseScribbleWithAi(raw) {
  const conferences = state.conferences.map((c) => ({ id: c.id, name: c.name, city: c.city, region: c.region, aliases: [c.name.toLowerCase(), c.city.toLowerCase()] }));
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.ai.key}`
    },
    body: JSON.stringify({
      model: state.ai.model || "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Extract a conference lead from messy sales notes. Return only JSON with keys: firstName,lastName,company,title,email,phone,conferenceId,vertical,urgency,sentiment,painPoints,nextStep,notes. Use null for unknown. sentiment must be Strong, Medium, or Weak. urgency must be Immediate, This quarter, Exploring, or Not a fit. Choose conferenceId only from the provided conference list."
        },
        {
          role: "user",
          content: JSON.stringify({ raw, conferences })
        }
      ]
    })
  });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

function parseScribbleLocally(raw) {
  const email = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  const phone = raw.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0] || "";
  const company = titleCase(extractAfter(raw, /\b(?:at|from)\s+([A-Za-z0-9&.\- ]{2,40}?)(?=,|\.|\s+at\s+|\s+his\s+|\s+her\s+|\s+their\s+|\s+wants|\s+struggl|$)/i));
  const title = titleCase(extractAfter(raw, /\b((?:vp|vice president|head|director|cfo|finance lead|treasury lead|manager)(?:\s+(?!at\b|from\b)[A-Za-z/&-]+){0,4})\b/i));
  const nameMatch = raw.match(/\b(?:met|spoke with|talked to|conversation with)\s+([A-Za-z]+)\s+([A-Za-z]+)/i);
  const firstName = titleCase(nameMatch?.[1] || "");
  const lastName = titleCase(nameMatch?.[2] || "");
  const conference = findConferenceFromText(raw) || state.conferences[0];
  const vertical = inferVertical(raw);
  const urgency = /demo|next month|this month|urgent|asap|immediate/i.test(raw) ? "This quarter" : /not a fit|no budget/i.test(raw) ? "Not a fit" : "Exploring";
  const sentiment = /demo|urgent|wants|asked|budget|cfo|treasury/i.test(raw) ? "Strong" : "Medium";
  const nextStep = extractAfter(raw, /\b(?:wants|asked for|next step is|follow up with)\s+([^.;]+)/i) || "";
  const painPoints = extractAfter(raw, /\b(?:struggling with|pain is|problem is|needs|concerned about)\s+(.+?)(?=,\s*wants|\s+wants|\.|;|$)/i) || "";
  return { firstName, lastName, company, title, email, phone, conferenceId: conference.id, vertical, urgency, sentiment, painPoints, nextStep, notes: "" };
}

function extractAfter(text, regex) {
  const match = text.match(regex);
  return match?.[1]?.trim().replace(/\s+/g, " ") || "";
}

function titleCase(text) {
  return String(text || "").replace(/\w\S*/g, (word) => {
    if (/^(VP|CFO|CEO|CTO|COO|PSP|FX)$/i.test(word)) return word.toUpperCase();
    if (/^saas$/i.test(word)) return "SaaS";
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

function inferVertical(text) {
  if (/travel|airline|hotel|corridor|wholesaler/i.test(text)) return "Travel";
  if (/payment|psp|merchant|settlement|payout/i.test(text)) return "Payments";
  if (/bank|treasury/i.test(text)) return "Banking";
  if (/saas|platform|software/i.test(text)) return "SaaS";
  return "Fintech";
}

function applyParsedLead(parsed, raw) {
  const fullName = [parsed.firstName, parsed.lastName].filter(Boolean).join(" ");
  if (!parsed.firstName && !parsed.lastName && parsed.name) {
    const parts = String(parsed.name).trim().split(/\s+/);
    parsed.firstName = parts[0] || "";
    parsed.lastName = parts.slice(1).join(" ");
  }
  $("#firstName").value = parsed.firstName || "";
  $("#lastName").value = parsed.lastName || "";
  $("#company").value = parsed.company || "";
  $("#title").value = parsed.title || "";
  $("#email").value = parsed.email || "";
  $("#phone").value = parsed.phone || "";
  $("#leadConference").value = state.conferences.some((c) => c.id === parsed.conferenceId) ? parsed.conferenceId : guessConferenceId(raw);
  $("#leadVertical").value = [...$("#leadVertical").options].some((o) => o.value === parsed.vertical) ? parsed.vertical : inferVertical(raw);
  $("#urgency").value = [...$("#urgency").options].some((o) => o.value === parsed.urgency) ? parsed.urgency : "Exploring";
  const sentiment = ["Strong", "Medium", "Weak"].includes(parsed.sentiment) ? parsed.sentiment : "Medium";
  $(`input[name='sentiment'][value='${sentiment}']`).checked = true;
  $("#nextStep").value = parsed.nextStep || "";
  const extractedNotes = [...new Set([parsed.painPoints, parsed.notes].filter(Boolean).map((item) => String(item).trim()))].join(" ");
  $("#notes").value = `${extractedNotes ? `${extractedNotes}\n\n` : ""}Raw floor scribble: ${raw}`;
}

function guessConferenceId(raw) {
  return findConferenceFromText(raw)?.id || state.conferences[0]?.id || "";
}

function findConferenceFromText(text) {
  const normalizedText = normalize(text);
  return state.conferences.find((c) => {
    const name = normalize(c.name);
    const compactName = name.replace(/20/g, "2020");
    return normalizedText.includes(name) || normalizedText.includes(compactName) || normalizedText.includes(normalize(c.city));
  });
}

function revealLeadForm() {
  $("#leadForm")?.classList.remove("review-hidden");
}

function hideLeadForm() {
  $("#leadForm")?.classList.remove("review-hidden");
}

function toggleScribbleRecording() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    $("#scribbleStatus").textContent = "Speech capture is not supported in this browser.";
    return;
  }
  if (!speechRecognition) {
    speechRecognition = new SpeechRecognition();
    speechRecognition.continuous = true;
    speechRecognition.interimResults = true;
    speechRecognition.lang = "en-US";
    speechRecognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0].transcript).join(" ");
      $("#scribbleInput").value = transcript.trim();
    };
    speechRecognition.onerror = () => {
      $("#scribbleStatus").textContent = "Recording stopped.";
      $("#recordScribble").classList.remove("recording");
      isRecordingScribble = false;
    };
    speechRecognition.onend = () => {
      $("#recordScribble").classList.remove("recording");
      if (isRecordingScribble) speechRecognition.start();
    };
  }
  isRecordingScribble = !isRecordingScribble;
  $("#recordScribble").classList.toggle("recording", isRecordingScribble);
  $("#scribbleStatus").textContent = isRecordingScribble ? "Recording..." : "Recording stopped.";
  if (isRecordingScribble) speechRecognition.start();
  else speechRecognition.stop();
}

function createId() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return `lead-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function handleNextStep(action, encodedIds, button) {
  const group = decodeLeadGroup(encodedIds);
  if (action === "gmail") {
    openGmailDraft(group);
    return;
  }
  if (action === "demo") {
    openDemoCalendarEvent(group);
    return;
  }
  if (action === "linkedin") {
    openLinkedInSearch(group);
    return;
  }
  if (action === "enrich") {
    await enrichLeadData(group, button);
    return;
  }
  const context = buildRelationshipContext(group);
  navigator.clipboard?.writeText(context);
  const labels = {
    qualify: "Budget qualification context copied.",
    nurture: "Nurture task context copied."
  };
  alert(labels[action] || "Context copied.");
}

function copyRelationshipContext(encodedIds) {
  const group = decodeLeadGroup(encodedIds);
  navigator.clipboard?.writeText(buildRelationshipContext(group));
  alert("Relationship context copied.");
}

function decodeLeadGroup(encodedIds) {
  const ids = decodeURIComponent(encodedIds).split(",");
  return ids.map((id) => state.leads.find((lead) => lead.id === id)).filter(Boolean);
}

function buildEmailDraft(group) {
  const latest = group[group.length - 1];
  const conference = state.conferences.find((c) => c.id === latest.conferenceId);
  const subject = `Good seeing you after ${conference?.name || "the conference"}`;
  const body = [
    `Hi ${latest.firstName},`,
    "",
    `Great speaking again. I was thinking about your ${latest.company} use case around ${latest.vertical.toLowerCase()} FX exposure, especially after hearing: "${latest.notes || "the context you shared"}".`,
    "",
    `${relationshipVerdict(group)} My suggested next step is: ${latest.nextStep || "a short working session with the relevant commercial and treasury owners"}.`,
    "",
    "Best,"
  ].join("\n");
  return { to: latest.email || "", subject, body };
}

function openGmailDraft(group) {
  const draft = buildEmailDraft(group);
  const url = new URL("https://mail.google.com/mail/");
  url.searchParams.set("view", "cm");
  url.searchParams.set("fs", "1");
  if (draft.to) url.searchParams.set("to", draft.to);
  url.searchParams.set("su", draft.subject);
  url.searchParams.set("body", draft.body);
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

function openDemoCalendarEvent(group) {
  const latest = group[group.length - 1];
  const conference = state.conferences.find((c) => c.id === latest.conferenceId);
  const start = new Date(Date.now() + 7 * 86400000);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60000);
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", `Grain demo call - ${latest.company}`);
  url.searchParams.set("dates", `${formatCalendarDate(start)}/${formatCalendarDate(end)}`);
  url.searchParams.set("details", [
    `Contact: ${latest.firstName} ${latest.lastName}, ${latest.title || "Unknown title"}`,
    `Company: ${latest.company}`,
    `Source: ${conference?.name || "Conference"}`,
    relationshipVerdict(group),
    `Notes: ${latest.notes || "Add demo agenda and stakeholders."}`
  ].join("\n"));
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

function formatCalendarDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function openLinkedInSearch(group) {
  const latest = group[group.length - 1];
  const conference = state.conferences.find((c) => c.id === latest.conferenceId);
  const note = [
    `Hi ${latest.firstName}, good meeting you at ${conference?.name || "the conference"}.`,
    `I enjoyed the conversation about ${latest.company}'s FX exposure and would be glad to stay connected.`
  ].join(" ");
  navigator.clipboard?.writeText(note);
  const url = new URL("https://www.linkedin.com/search/results/people/");
  url.searchParams.set("keywords", `${latest.firstName} ${latest.lastName} ${latest.company}`);
  window.open(url.toString(), "_blank", "noopener,noreferrer");
  alert("LinkedIn search opened. Connection note copied to clipboard.");
}

async function enrichLeadData(group, button) {
  const latest = group[group.length - 1];
  const target = button?.closest(".relationship")?.querySelector(".lead-enrichment");
  if (!target) return;
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = "Enriching...";
  target.innerHTML = "<strong>Company brief</strong><span>Building a short relationship brief...</span>";
  try {
    const summary = state.ai.key ? await enrichLeadWithAi(latest, group) : localCompanyBrief(latest, group);
    target.innerHTML = `<strong>Company brief</strong><span>${escapeHtml(summary)}</span>`;
  } catch (error) {
    console.warn("Lead enrichment failed", error);
    target.innerHTML = `<strong>Company brief</strong><span>${escapeHtml(localCompanyBrief(latest, group))}</span>`;
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function enrichLeadWithAi(lead, group) {
  const domain = domainFromLead(lead);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.ai.key}`
    },
    body: JSON.stringify({
      model: state.ai.model || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You create concise B2B sales enrichment briefs for Grain, an FX risk fintech. Use only the provided lead data and generally known company/domain context; do not invent facts. Return 2 short sentences plus one suggested qualification question."
        },
        {
          role: "user",
          content: JSON.stringify({ lead, domain, relationshipContext: buildRelationshipContext(group) })
        }
      ]
    })
  });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json();
  return data.choices[0].message.content.trim();
}

function localCompanyBrief(lead, group) {
  const domain = domainFromLead(lead);
  return `${lead.company}${domain ? ` (${domain})` : ""} appears in this relationship as a ${lead.vertical.toLowerCase()} account with ${group.length} conference touchpoints. Qualify current FX exposure, decision owner, and whether the next conversation should include finance or treasury leadership.`;
}

function domainFromLead(lead) {
  return lead.email?.split("@")[1]?.toLowerCase() || "";
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function buildRelationshipContext(group) {
  const latest = group[group.length - 1];
  const conferences = group.map((lead) => state.conferences.find((c) => c.id === lead.conferenceId)?.name || "Unknown");
  return [
    `${latest.firstName} ${latest.lastName} at ${latest.company}`,
    relationshipVerdict(group),
    `${group.length} encounters: ${conferences.join(" -> ")}`,
    `Latest next step: ${latest.nextStep || "Not set"}`,
    `Notes: ${group.map((lead) => lead.notes).filter(Boolean).join(" ")}`
  ].join("\n");
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

function exportConferencesCsv() {
  const rows = [
    ["Conference", "Date", "Location", "Region", "Verticals", "Audience", "ICP Score", "Tier", "Team", "Status", "Source"],
    ...filteredConferences().map((conference) => {
      const score = scoreConference(conference);
      return [
        conference.name,
        formatDateRange(conference),
        `${conference.city}, ${conference.country}`,
        conference.region,
        conference.verticals.join("; "),
        conference.audience,
        score,
        tierFor(score),
        teamLabel(conference),
        conference.status,
        conference.source || ""
      ];
    })
  ];
  downloadCsv(rows, "grain-conferences-current-view.csv");
}

function downloadCsv(rows, filename) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function setupConferenceActions() {
  $("#exportConferencesCsv").addEventListener("click", exportConferencesCsv);
  $("#addConferenceButton").addEventListener("click", () => {
    $("#addConferenceForm").reset();
    $("#newConferenceAudience").value = "2500";
    $("#newBuyerDensity").value = "4";
    $("#newPspRelevance").value = "4";
    $("#newFxRelevance").value = "4";
    $("#newTravelRelevance").value = "3";
    $("#newSeniority").value = "4";
    $("#newCostTier").value = "3";
    openModal("#addConferenceModal");
  });
  $("#addConferenceForm").addEventListener("submit", addConferenceFromForm);
  $$("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => closeModals());
  });
  $$(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeModals();
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModals();
  });
}

function addConferenceFromForm(event) {
  event.preventDefault();
  const startDate = $("#newConferenceStart").value;
  const endDate = $("#newConferenceEnd").value || startDate;
  const conference = {
    id: createConferenceId($("#newConferenceName").value),
    name: $("#newConferenceName").value.trim(),
    startDate,
    endDate: new Date(endDate) < new Date(startDate) ? startDate : endDate,
    city: $("#newConferenceCity").value.trim(),
    country: $("#newConferenceCountry").value.trim(),
    region: $("#newConferenceRegion").value,
    verticals: $("#newConferenceVerticals").value.split(",").map((item) => titleCase(item.trim())).filter(Boolean),
    audience: Math.max(100, Number($("#newConferenceAudience").value) || 100),
    seniority: boundedScore("#newSeniority"),
    buyerDensity: boundedScore("#newBuyerDensity"),
    fxRelevance: boundedScore("#newFxRelevance"),
    travelRelevance: boundedScore("#newTravelRelevance"),
    pspRelevance: boundedScore("#newPspRelevance"),
    costTier: boundedScore("#newCostTier"),
    status: $("#newConferenceStatus").value,
    source: $("#newConferenceSource").value.trim(),
    team: Array.from($("#newConferenceTeam").selectedOptions).map((option) => option.value)
  };
  state.conferences.push(conference);
  selectedConferenceId = conference.id;
  saveState();
  filterState = { vertical: [], region: [], status: [] };
  opportunityFilter = null;
  closeModals();
  renderFilters();
  renderAll();
  openConferenceDetail(conference.id);
}

function boundedScore(selector) {
  return Math.max(1, Math.min(5, Number($(selector).value) || 3));
}

function createConferenceId(name) {
  const base = normalize(name).slice(0, 28) || "conference";
  let id = `${base}-${new Date().getFullYear()}`;
  let index = 2;
  while (state.conferences.some((conference) => conference.id === id)) {
    id = `${base}-${new Date().getFullYear()}-${index}`;
    index += 1;
  }
  return id;
}

function openModal(selector) {
  const modal = $(selector);
  if (!modal) return;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeModals() {
  $$(".modal-overlay").forEach((modal) => {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  });
  document.body.classList.remove("modal-open");
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
  renderWeightControls();
  $("#saveAi").addEventListener("click", () => {
    state.ai.key = $("#aiKey").value.trim();
    state.ai.model = $("#aiModel").value.trim();
    state.hubspot.token = $("#hubspotToken").value.trim();
    saveState();
    alert("Settings saved in this browser.");
  });
  $("#saveWeights").addEventListener("click", saveScoringWeights);
  $("#pushHubspot").addEventListener("click", pushHubspot);
  $("#aiSummaries").addEventListener("click", generateAiSummaries);
}

function renderWeightControls() {
  const weights = { ...DEFAULT_SCORE_WEIGHTS, ...(state.scoringWeights || {}) };
  $("#weightControls").innerHTML = Object.entries(SCORE_WEIGHT_LABELS)
    .map(([key, label]) => `<label class="weight-control">
      <span>${label}</span>
      <input type="range" min="0" max="30" step="1" value="${weights[key]}" data-score-weight="${key}" aria-label="${label} weight">
      <input type="number" min="0" max="30" step="1" value="${weights[key]}" data-score-weight-number="${key}" aria-label="${label} percentage">
      <strong>${weights[key]}%</strong>
    </label>`)
    .join("");
  $$("[data-score-weight]").forEach((range) => {
    range.addEventListener("input", () => syncWeightInput(range.dataset.scoreWeight, range.value));
  });
  $$("[data-score-weight-number]").forEach((input) => {
    input.addEventListener("input", () => syncWeightInput(input.dataset.scoreWeightNumber, input.value));
  });
}

function syncWeightInput(key, value) {
  const cleanValue = Math.max(0, Math.min(30, Math.round(Number(value) || 0)));
  const range = $(`[data-score-weight="${key}"]`);
  const number = $(`[data-score-weight-number="${key}"]`);
  const label = number?.nextElementSibling;
  if (range) range.value = cleanValue;
  if (number) number.value = cleanValue;
  if (label) label.textContent = `${cleanValue}%`;
}

function saveScoringWeights() {
  state.scoringWeights = Object.fromEntries(
    Object.keys(DEFAULT_SCORE_WEIGHTS).map((key) => {
      const input = $(`[data-score-weight-number="${key}"]`);
      return [key, Math.max(0, Math.min(30, Math.round(Number(input?.value) || 0)))];
    })
  );
  saveState();
  sortState = { key: "score", direction: "desc" };
  renderAll();
  alert("Scoring weights saved. ICP rankings refreshed.");
}

function renderAll() {
  renderConferenceRows();
  renderPlanning();
  renderRelationships();
  renderWeightControls();
  renderScoringExplain();
  renderMatchPreview();
}

function setup() {
  setupSidebar();
  renderNav();
  renderFilters();
  setupFilterControls();
  setupSorting();
  setupPlanningControls();
  setupConferenceActions();
  setupCapture();
  setupSettings();
  $("#searchInput").addEventListener("input", () => {
    opportunityFilter = null;
    renderConferenceRows();
  });
  $("#exportCsv").addEventListener("click", exportCsv);
  $("#seedReset").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });
  renderAll();
}

setup();
