const state = migrateState(loadState());
saveState();
let selectedConferenceId = state.conferences[0]?.id;
let filterState = { vertical: [], region: [], status: [] };
let opportunityFilter = null;
let sortState = { key: "score", direction: "desc" };
let calendarDate = new Date("2026-06-01T00:00:00");
let clusterConfig = { regions: [], windowDays: 10 };
let visibleGapSegments = ["Fintech", "Payments", "Treasury"];
let scoutState = { gap: null, results: [], loading: false, resolvedGapKey: "" };
let speechRecognition = null;
let isRecordingScribble = false;
let scoutRecognition = null;
let isRecordingScout = false;
let scoutMediaRecorder = null;
let scoutAudioChunks = [];

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (error) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
  return {
    conferences: clone(CONFERENCES),
    leads: clone(LEADS),
    ai: { key: "", model: "gpt-4o-mini" },
    hubspot: { token: "" },
    scoringWeights: clone(DEFAULT_SCORE_WEIGHTS)
  };
}

function migrateState(loaded) {
  loaded = loaded || {};
  loaded.ai = loaded.ai || { key: "", model: "gpt-4o-mini" };
  loaded.hubspot = loaded.hubspot || { token: "", lastSuccessfulSync: "" };
  loaded.hubspot.lastSuccessfulSync = loaded.hubspot.lastSuccessfulSync || "";
  loaded.scoringWeights = migrateScoringWeights(loaded.scoringWeights);
  loaded.conferences = (Array.isArray(loaded.conferences) ? loaded.conferences : clone(CONFERENCES)).map((conference) => {
    if (Array.isArray(conference.team)) return conference;
    const team = conference.owner && conference.owner !== "Unassigned" ? [conference.owner] : [];
    return { ...conference, team };
  });
  loaded.leads = Array.isArray(loaded.leads) ? loaded.leads : clone(LEADS);
  return loaded;
}

function migrateScoringWeights(savedWeights = {}) {
  const hasNewWeights = Object.keys(DEFAULT_SCORE_WEIGHTS).some((key) => Object.prototype.hasOwnProperty.call(savedWeights, key));
  if (hasNewWeights) {
    return Object.fromEntries(
      Object.keys(DEFAULT_SCORE_WEIGHTS).map((key) => [key, clampWeight(savedWeights[key] ?? DEFAULT_SCORE_WEIGHTS[key])])
    );
  }
  if (Object.keys(savedWeights).length) {
    return {
      industryFit: clampWeight(((savedWeights.buyerDensity || 0) + (savedWeights.pspRelevance || 0) + (savedWeights.travelRelevance || 0)) * 1.5 || DEFAULT_SCORE_WEIGHTS.industryFit),
      fxExposurePain: clampWeight((savedWeights.fxRelevance || 0) * 4 || DEFAULT_SCORE_WEIGHTS.fxExposurePain),
      decisionMakerSeniority: clampWeight((savedWeights.seniority || 0) * 5 || DEFAULT_SCORE_WEIGHTS.decisionMakerSeniority),
      audienceScale: clampWeight((savedWeights.audienceReach || 0) * 6 || DEFAULT_SCORE_WEIGHTS.audienceScale),
      travelBudgetRoi: clampWeight(Math.max(0, 100 - (savedWeights.costPenalty || 0) * 6) || DEFAULT_SCORE_WEIGHTS.travelBudgetRoi)
    };
  }
  return { ...DEFAULT_SCORE_WEIGHTS };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function scoreConference(c) {
  const weights = { ...DEFAULT_SCORE_WEIGHTS, ...(state.scoringWeights || {}) };
  const totalWeight = Object.values(weights).reduce((sum, value) => sum + clampWeight(value), 0) || 1;
  const reach = Math.min(1, Math.max(0, (Math.log10(Math.max(c.audience || 0, 100)) - 2) / 3));
  const industryFit = ((c.buyerDensity || 0) / 5) * 0.45 + (Math.max(c.pspRelevance || 0, c.travelRelevance || 0) / 5) * 0.55;
  const fxExposurePain = (c.fxRelevance || 0) / 5;
  const decisionMakerSeniority = (c.seniority || 0) / 5;
  const audienceScale = reach;
  const travelBudgetRoi = ((6 - (c.costTier || 3)) / 5) * 0.65 + ((c.travelRelevance || 0) / 5) * 0.35;
  const weightedScore =
    industryFit * clampWeight(weights.industryFit) +
    fxExposurePain * clampWeight(weights.fxExposurePain) +
    decisionMakerSeniority * clampWeight(weights.decisionMakerSeniority) +
    audienceScale * clampWeight(weights.audienceScale) +
    travelBudgetRoi * clampWeight(weights.travelBudgetRoi);
  return Math.max(0, Math.min(100, Math.round((weightedScore / totalWeight) * 100)));
}

function clampWeight(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function tierFor(score) {
  if (score >= 78) return "A";
  if (score >= 62) return "B";
  return "C";
}

function allVerticals() {
  const strategicVerticals = ["Payments", "Fintech", "Treasury", "Travel", "Wholesalers", "Banking", "SaaS", "Travel Tech", "Corporate Travel", "Airlines"];
  return [...new Set([...(state?.conferences || []).flatMap((conference) => conference.verticals || []), ...strategicVerticals])].sort();
}

function activeConferenceStatuses() {
  return [...CONFIRMED_STATUSES, "Booked"];
}

function quarterKey(dateValue) {
  const date = new Date(`${dateValue}T00:00:00`);
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return `Q${quarter} ${date.getFullYear()}`;
}

function quarterDateRange(label) {
  const match = /^Q([1-4])\s+(\d{4})$/.exec(label || "");
  if (!match) return { start: "2026-07-01", end: "2026-09-30" };
  const quarter = Number(match[1]);
  const year = Number(match[2]);
  const startMonth = (quarter - 1) * 3;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0);
  return { start: toIsoDate(start), end: toIsoDate(end) };
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function conferenceMatchesVertical(conference, vertical) {
  const terms = String(vertical || "").split(/\s+|\/|,/).filter(Boolean).map(normalize);
  const verticals = (conference.verticals || []).map(normalize);
  return terms.some((term) => verticals.some((item) => item.includes(term) || term.includes(item)));
}

function analyzePipelineGap() {
  if (scoutState.resolvedGapKey === "__all__") return null;
  const activeStatuses = activeConferenceStatuses();
  const activeEvents = state.conferences.filter((event) => activeStatuses.includes(event.status));
  const criticalVerticals = ["Travel Wholesalers", "Payments", "Fintech", "Banking"];
  const startDate = new Date("2026-07-01T00:00:00");
  const quarters = ["Q3 2026", "Q4 2026", "Q1 2027", "Q2 2027"];
  const gaps = quarters.flatMap((quarter) => {
    const quarterEvents = activeEvents.filter((event) => quarterKey(event.startDate) === quarter);
    return criticalVerticals.map((vertical) => {
      const covered = quarterEvents.filter((event) => conferenceMatchesVertical(event, vertical));
      const coverage = quarterEvents.length ? Math.round((covered.length / quarterEvents.length) * 100) : 0;
      return {
        key: `${vertical}-${quarter}`,
        vertical,
        quarter,
        coverage,
        eventCount: covered.length,
        totalEvents: quarterEvents.length,
        ...quarterDateRange(quarter)
      };
    });
  });
  return gaps.find((gap) => gap.coverage < 15 && gap.key !== scoutState.resolvedGapKey && new Date(`${gap.start}T00:00:00`) >= startDate) || null;
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
    ...regions.map((region) => renderMultiOption(region, clusterConfig.regions.includes(region)))
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
    ...options.map((option) => renderMultiOption(option, selected.includes(option)))
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
  const query = $("#searchInput")?.value.trim();
  const chips = Object.entries(filterState).flatMap(([key, values]) =>
    values.map((value) => ({ key, value, label: labels[key] || key }))
  );
  const hasActiveFilters = chips.length > 0 || Boolean(query) || Boolean(opportunityFilter);
  container.innerHTML = hasActiveFilters
    ? `${chips.map(({ key, value, label }) => renderFilterChip(key, value, label)).join("")}
      ${query ? `<span class="filter-chip search-filter-chip"><span>Search: ${escapeHtml(query)}</span></span>` : ""}
      ${opportunityFilter ? `<span class="filter-chip search-filter-chip"><span>Opportunity: ${escapeHtml(opportunityFilter.vertical)}</span></span>` : ""}
      <button class="clear-all-filters" type="button" data-clear-all-filters>Clear All Filters</button>`
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
  container.querySelector("[data-clear-all-filters]")?.addEventListener("click", clearAllConferenceFilters);
}

function clearAllConferenceFilters() {
  filterState = { vertical: [], region: [], status: [] };
  opportunityFilter = null;
  sortState = { key: "score", direction: "desc" };
  if ($("#searchInput")) $("#searchInput").value = "";
  renderFilters();
  renderConferenceRows();
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
    clusterConfig.windowDays = Math.max(1, Math.min(90, Number.isFinite(value) ? value : 10));
    renderPlanning();
  });
  $("#runScoutSearch")?.addEventListener("click", runScoutSearch);
  $("#scoutMic")?.addEventListener("click", toggleScoutVoicePrompt);
}

async function runScoutSearch() {
  const prompt = $("#scoutPrompt")?.value.trim();
  if (!prompt) {
    $("#scoutStatus").textContent = "Enter a scout prompt or resolve the active gap first.";
    return;
  }
  scoutState.loading = true;
  $("#scoutStatus").textContent = "Building structured conference candidates...";
  renderScoutResults();
  try {
    const rawResults = state.ai.key ? await fetchAiScoutResults(prompt) : localScoutResults(prompt);
    scoutState.results = processScoutResults(rawResults);
    $("#scoutStatus").textContent = scoutState.results.length
      ? `${scoutState.results.length} validated candidates ready.`
      : "No validated 2026/2027 candidates matched the guardrails.";
  } catch (error) {
    scoutState.results = processScoutResults(localScoutResults(prompt));
    $("#scoutStatus").textContent = `AI scout fell back to local heuristics: ${error.message}`;
  } finally {
    scoutState.loading = false;
    renderScoutResults();
  }
}

async function fetchAiScoutResults(prompt) {
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
          content: [
            "You are Grain's Proactive AI Pipeline Scout.",
            "Return only JSON with an events array.",
            "Each event must have name, startDate, endDate, city, country, region, verticals, audience, seniority, buyerDensity, fxRelevance, travelRelevance, pspRelevance, costTier, source, and pitchHook.",
            "Only include realistic conference dates in 2026 or 2027.",
            "Prioritize PSPs, payments, travel wholesalers, CFOs, treasurers, finance leaders, and enterprise FX exposure."
          ].join(" ")
        },
        {
          role: "user",
          content: JSON.stringify({
            prompt,
            existingEvents: state.conferences.map((event) => ({
              id: event.id,
              name: event.name,
              startDate: event.startDate,
              city: event.city,
              country: event.country,
              verticals: event.verticals
            }))
          })
        }
      ]
    })
  });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "{}";
  return JSON.parse(content).events || [];
}

function localScoutResults(prompt) {
  const wantsTravel = /travel|wholesale|tour|airline/i.test(prompt);
  const wantsQ3 = /july|august|september|q3/i.test(prompt);
  const candidates = [
    {
      name: "GBTA Convention 2026",
      startDate: "2026-07-20",
      endDate: "2026-07-22",
      city: "Denver",
      country: "USA",
      region: "North America",
      verticals: ["Travel", "Travel Tech", "Wholesalers", "Corporate Travel"],
      audience: 5300,
      seniority: 4,
      buyerDensity: 4,
      fxRelevance: 5,
      travelRelevance: 5,
      pspRelevance: 2,
      costTier: 3,
      source: "https://www.gbta.org/convention",
      pitchHook: "Corporate travel buyers and wholesale operators face live currency-margin exposure across global supplier contracts. Emphasize Grain's automated hedging workflows and forward booking controls."
    },
    {
      name: "Skift Global Forum 2026",
      startDate: "2026-09-16",
      endDate: "2026-09-18",
      city: "New York",
      country: "USA",
      region: "North America",
      verticals: ["Travel", "Hospitality", "Airlines", "Wholesalers"],
      audience: 1400,
      seniority: 5,
      buyerDensity: 4,
      fxRelevance: 4,
      travelRelevance: 5,
      pspRelevance: 2,
      costTier: 3,
      source: "https://skift.com/events/",
      pitchHook: "Travel executives are actively comparing margin protection strategies for international inventory. Lead with CFO-level volatility control and faster booking-policy enforcement."
    },
    {
      name: "BTN Group Business Travel Show America 2026",
      startDate: "2026-08-12",
      endDate: "2026-08-13",
      city: "New York",
      country: "USA",
      region: "North America",
      verticals: ["Travel", "Corporate Travel", "SaaS", "Wholesalers"],
      audience: 2200,
      seniority: 4,
      buyerDensity: 4,
      fxRelevance: 4,
      travelRelevance: 5,
      pspRelevance: 2,
      costTier: 2,
      source: "https://www.businesstravelshowamerica.com/",
      pitchHook: "Managed travel and supplier-payment teams are exposed to FX slippage across negotiated global programs. Position Grain as the control layer between forecasted bookings and treasury execution."
    },
    {
      name: "Money 20/20 Europe",
      startDate: "2026-06-02",
      endDate: "2026-06-04",
      city: "Amsterdam",
      country: "Netherlands",
      region: "Europe",
      verticals: ["Payments", "Fintech", "Banking"],
      audience: 7400,
      seniority: 5,
      buyerDensity: 5,
      fxRelevance: 5,
      travelRelevance: 2,
      pspRelevance: 5,
      costTier: 4,
      source: "https://europe.money2020.com/",
      pitchHook: "This is already represented in the active directory and should be deduped rather than inserted again."
    }
  ];
  return candidates.filter((event) => !wantsTravel || event.verticals.some((vertical) => /travel|wholesale|airline/i.test(vertical)))
    .filter((event) => !wantsQ3 || ["2026-07", "2026-08", "2026-09"].some((prefix) => event.startDate.startsWith(prefix)));
}

function processScoutResults(events) {
  return (Array.isArray(events) ? events : [])
    .map(sanitizeScoutEvent)
    .filter(Boolean)
    .filter((event) => validateScoutDate(event.startDate) && validateScoutDate(event.endDate))
    .map((event) => {
      const duplicate = findDuplicateConference(event);
      return {
        event,
        duplicate,
        pitchHook: event.pitchHook || scoutPitchHook(event),
        piggyback: duplicate ? "" : piggybackOpportunity(event)
      };
    });
}

function sanitizeScoutEvent(event) {
  if (!event || typeof event !== "object") return null;
  const name = String(event.name || "").trim();
  const startDate = String(event.startDate || "").slice(0, 10);
  const endDate = String(event.endDate || startDate).slice(0, 10);
  if (!name || !startDate) return null;
  return {
    id: uniqueConferenceId(name, startDate),
    name,
    startDate,
    endDate,
    city: titleCase(String(event.city || "TBD").trim()),
    country: titleCase(String(event.country || "TBD").trim()),
    region: titleCase(String(event.region || "Global").trim()),
    verticals: Array.isArray(event.verticals) ? event.verticals.map((item) => titleCase(String(item).trim())).filter(Boolean) : ["Travel"],
    audience: Math.max(100, Math.round(Number(event.audience) || 1000)),
    seniority: clampRating(event.seniority, 4),
    buyerDensity: clampRating(event.buyerDensity, 4),
    fxRelevance: clampRating(event.fxRelevance, 4),
    travelRelevance: clampRating(event.travelRelevance, 4),
    pspRelevance: clampRating(event.pspRelevance, 2),
    costTier: clampRating(event.costTier, 3),
    status: "Committed",
    owner: "Unassigned",
    source: String(event.source || "").trim(),
    pitchHook: String(event.pitchHook || "").trim()
  };
}

function clampRating(value, fallback) {
  return Math.max(1, Math.min(5, Math.round(Number(value) || fallback)));
}

function validateScoutDate(value) {
  const date = new Date(`${value}T00:00:00`);
  const year = date.getFullYear();
  return Number.isFinite(date.getTime()) && year >= 2026 && year <= 2027;
}

function uniqueConferenceId(name, startDate) {
  const base = normalize(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 44) || "scout-event";
  const year = new Date(`${startDate}T00:00:00`).getFullYear() || 2026;
  let id = `${base}-${year}`;
  let count = 2;
  while (state.conferences.some((event) => event.id === id)) {
    id = `${base}-${year}-${count}`;
    count += 1;
  }
  return id;
}

function findDuplicateConference(event) {
  const candidate = normalizeConferenceName(event.name);
  return state.conferences.find((existing) => {
    const sameName = normalizeConferenceName(existing.name) === candidate || normalizeConferenceName(existing.name).includes(candidate) || candidate.includes(normalizeConferenceName(existing.name));
    const sameMarket = normalize(existing.city) === normalize(event.city) || normalize(existing.country) === normalize(event.country);
    const closeDate = Math.abs(new Date(existing.startDate) - new Date(event.startDate)) / 86400000 <= 14;
    return sameName && sameMarket && closeDate;
  });
}

function normalizeConferenceName(name) {
  return normalize(name).replace(/\b(eu|europe|usa|us|global|forum|conference|summit|convention)\b/g, "").replace(/\s+/g, " ").trim();
}

function piggybackOpportunity(event) {
  const active = state.conferences
    .filter((existing) => activeConferenceStatuses().includes(existing.status))
    .map((existing) => ({
      event: existing,
      days: Math.round((new Date(event.startDate) - new Date(existing.endDate || existing.startDate)) / 86400000)
    }))
    .filter((item) => item.days >= 0 && item.days <= 10 && (item.event.region === event.region || item.event.country === event.country))
    .sort((a, b) => a.days - b.days)[0];
  return active ? `This event takes place ${active.days} days after your approved trip to ${active.event.city}.` : "";
}

function scoutPitchHook(event) {
  if ((event.verticals || []).some((vertical) => /travel|wholesale|airline/i.test(vertical))) {
    return "Airlines and wholesale tour operators at this conference are facing currency-margin exposure. Emphasize Grain's automated forward contract booking mechanics.";
  }
  return "Prioritize CFO and treasury conversations where payment volume, cross-border settlement, and margin exposure create a measurable FX pain point.";
}

function addScoutEventToDirectory(id) {
  const result = scoutState.results.find((item) => item.event.id === id);
  if (!result || result.duplicate) return;
  const event = { ...result.event };
  delete event.pitchHook;
  state.conferences.push(event);
  if (scoutState.gap) scoutState.resolvedGapKey = "__all__";
  scoutState.results = scoutState.results.filter((item) => item.event.id !== id);
  selectedConferenceId = event.id;
  saveState();
  visibleGapSegments = allVerticals();
  renderFilters();
  renderAll();
  $("#scoutStatus").textContent = `${event.name} added to the active directory.`;
}

function toggleScoutVoicePrompt() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const button = $("#scoutMic");
  if (!SpeechRecognition) {
    toggleScoutWhisperRecording();
    return;
  }
  if (!scoutRecognition) {
    scoutRecognition = new SpeechRecognition();
    scoutRecognition.continuous = true;
    scoutRecognition.interimResults = true;
    scoutRecognition.lang = "en-US";
    scoutRecognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0].transcript).join(" ");
      $("#scoutPrompt").value = transcript.trim();
    };
    scoutRecognition.onend = () => {
      isRecordingScout = false;
      button?.classList.remove("recording");
      $("#scoutStatus").textContent = "Voice prompt captured.";
    };
  }
  if (isRecordingScout) {
    scoutRecognition.stop();
    return;
  }
  isRecordingScout = true;
  button?.classList.add("recording");
  $("#scoutStatus").textContent = "Listening for scout prompt...";
  scoutRecognition.start();
}

async function toggleScoutWhisperRecording() {
  const button = $("#scoutMic");
  if (!state.ai.key) {
    $("#scoutStatus").textContent = "Save an OpenAI-compatible API key to use Whisper transcription, or type the scout prompt.";
    return;
  }
  if (isRecordingScout && scoutMediaRecorder) {
    scoutMediaRecorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    $("#scoutStatus").textContent = "Audio recording is not supported in this browser.";
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    scoutAudioChunks = [];
    scoutMediaRecorder = new MediaRecorder(stream);
    scoutMediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) scoutAudioChunks.push(event.data);
    });
    scoutMediaRecorder.addEventListener("stop", async () => {
      stream.getTracks().forEach((track) => track.stop());
      isRecordingScout = false;
      button?.classList.remove("recording");
      await transcribeScoutAudio();
    });
    isRecordingScout = true;
    button?.classList.add("recording");
    $("#scoutStatus").textContent = "Recording scout prompt. Click the mic again to transcribe.";
    scoutMediaRecorder.start();
  } catch (error) {
    $("#scoutStatus").textContent = `Microphone access failed: ${error.message}`;
  }
}

async function transcribeScoutAudio() {
  if (!scoutAudioChunks.length) return;
  $("#scoutStatus").textContent = "Transcribing voice prompt with Whisper...";
  const audioBlob = new Blob(scoutAudioChunks, { type: scoutAudioChunks[0]?.type || "audio/webm" });
  const formData = new FormData();
  formData.append("model", "whisper-1");
  formData.append("file", audioBlob, "pipeline-scout.webm");
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${state.ai.key}` },
    body: formData
  });
  if (!response.ok) {
    $("#scoutStatus").textContent = `Whisper transcription failed: ${await response.text()}`;
    return;
  }
  const data = await response.json();
  $("#scoutPrompt").value = String(data.text || "").trim();
  $("#scoutStatus").textContent = "Voice prompt transcribed.";
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
    .map(([label, value]) => renderMetricCard(label, value))
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
      return renderConferenceRow(c, score, tier);
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
    scoutState.gap = analyzePipelineGap();
    renderPipelineGapAlert();
    renderScoutWorkspace();
    $("#coverageSummary").textContent = `${state.conferences.filter((c) => c.status === "Committed").length} committed events`;
    renderCalendar();

    const clusters = findClusters();
    $("#clusters").innerHTML = clusters.length
      ? clusters.map(renderTripCluster).join("")
      : "<p class='muted'>No clusters found.</p>";
    $$("[data-add-to-trip]").forEach((button) => {
      button.addEventListener("click", () => addEventToTrip(button.dataset.addToTrip));
    });

    const verticals = allVerticals();
    renderGapSegmentFilter(verticals);
    $("#gaps").innerHTML = verticals
      .filter((vertical) => visibleGapSegments.includes(vertical))
      .map(renderGapCard)
      .join("");
    $$("[data-gap-opportunities]").forEach((button) => {
      button.addEventListener("click", () => viewSegmentOpportunities(button.dataset.gapOpportunities));
    });
  } catch (error) {
    $("#pipelineGapAlert").innerHTML = "";
    $("#scoutResults").innerHTML = "";
    $("#eventCalendar").innerHTML = `<div class="empty-state"><strong>Planning could not load.</strong><span>Reset demo data or refresh the page to rebuild the event calendar.</span></div>`;
    $("#clusters").innerHTML = "";
    $("#gaps").innerHTML = "";
  }
}

function renderPipelineGapAlert() {
  const container = $("#pipelineGapAlert");
  if (!container) return;
  const gap = scoutState.gap;
  if (!gap) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `<div class="gap-alert-card">
    <div>
      <span class="eyebrow">AI Gap Alert</span>
      <h3>⚠️ AI Gap Alert: Under-invested Vertical</h3>
      <p>We currently have ${gap.coverage}% sales team coverage in the ${escapeHtml(gap.vertical)} vertical for ${escapeHtml(gap.quarter)}. This creates a critical pipeline gap for our enterprise FX hedging product.</p>
    </div>
    <button class="primary-button" type="button" data-resolve-gap>🪄 Resolve Gap via AI Scout</button>
  </div>`;
  container.querySelector("[data-resolve-gap]")?.addEventListener("click", resolveGapViaScout);
}

function resolveGapViaScout() {
  const prompt = scoutPromptForGap(scoutState.gap);
  $("#scoutPrompt").value = prompt;
  $("#pipelineScout")?.scrollIntoView({ behavior: "smooth", block: "start" });
  setTimeout(() => $("#scoutPrompt")?.focus(), 350);
}

function scoutPromptForGap(gap) {
  if (!gap) return "";
  if (/travel/i.test(gap.vertical) && /Q3 2026/i.test(gap.quarter)) {
    return "Find leading corporate travel wholesale and international fintech conferences in Europe or North America taking place between July and September 2026 with a high density of CFOs and finance leaders.";
  }
  const range = quarterDateRange(gap.quarter);
  return `Find leading ${gap.vertical} conferences in Europe or North America taking place between ${range.start} and ${range.end} with a high density of CFOs, treasurers, and finance leaders.`;
}

function renderScoutWorkspace() {
  const badge = $("#scoutModeBadge");
  if (badge) {
    badge.textContent = state.ai.key ? "AI scout active" : "Local scout ready";
    badge.className = `status-badge ${state.ai.key ? "status-active" : "status-muted"}`;
  }
  renderScoutResults();
}

function renderScoutResults() {
  const container = $("#scoutResults");
  if (!container) return;
  if (scoutState.loading) {
    container.innerHTML = "<div class='empty-state'><strong>Scouting pipeline gaps...</strong><span>Validating calendar fit, dedupe risk, and trip proximity.</span></div>";
    return;
  }
  container.innerHTML = scoutState.results.length
    ? scoutState.results.map(renderScoutResultCard).join("")
    : "";
  $$("[data-add-scout-event]").forEach((button) => {
    button.addEventListener("click", () => addScoutEventToDirectory(button.dataset.addScoutEvent));
  });
}

function renderScoutResultCard(result) {
  const event = result.event;
  const score = scoreConference(event);
  const tier = tierFor(score);
  const duplicate = result.duplicate;
  return `<div class="scout-card ${duplicate ? "scout-card-duplicate" : ""}">
    <div class="scout-card-head">
      <div>
        <strong>${escapeHtml(event.name)}</strong>
        <span>${escapeHtml(formatDateRange(event))} | ${escapeHtml(event.city)}, ${escapeHtml(event.country)}</span>
      </div>
      <span class="tier-flag tier-${tier.toLowerCase()}">Tier ${tier} - Score: ${score}</span>
    </div>
    <div class="scout-meta-grid">
      <span>${escapeHtml(event.region)}</span>
      <span>${Number(event.audience || 0).toLocaleString()} attendees</span>
      <span>${escapeHtml((event.verticals || []).join(", "))}</span>
    </div>
    <p class="scout-hook">${escapeHtml(result.pitchHook)}</p>
    ${result.piggyback ? `<span class="piggyback-badge">💡 Trip Piggyback Opportunity: ${escapeHtml(result.piggyback)}</span>` : ""}
    ${duplicate ? `<p class="muted">Semantic match found: ${escapeHtml(duplicate.name)}. Directory insertion is blocked to prevent duplication.</p>` : `<button class="primary-button" type="button" data-add-scout-event="${escapeHtml(event.id)}">➕ Add to Active Directory</button>`}
  </div>`;
}

function renderGapSegmentFilter(verticals) {
  const menu = $("#gapSegmentFilter");
  const button = $("#gapSegmentButton");
  if (!menu || !button) return;
  const selected = visibleGapSegments.filter((segment) => verticals.includes(segment));
  button.textContent = selected.length === verticals.length ? "All verticals" : `${selected.length} verticals`;
  button.classList.toggle("has-selection", selected.length !== verticals.length);
  menu.innerHTML = [
    `<button class="filter-clear" type="button" data-gap-segment-all>Show all verticals</button>`,
    ...verticals.map((vertical) => renderMultiOption(vertical, selected.includes(vertical)))
  ].join("");
  menu.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      visibleGapSegments = Array.from(menu.querySelectorAll("input:checked")).map((item) => item.value);
      renderPlanning();
    });
  });
  menu.querySelector("[data-gap-segment-all]")?.addEventListener("click", () => {
    visibleGapSegments = [...verticals];
    renderPlanning();
  });
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
        ${events.map(renderCalendarEvent).join("")}
      </div>
    </div>`);
  }
  $("#eventCalendar").innerHTML = `
    <div class="calendar-weekdays">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<span>${day}</span>`).join("")}</div>
    <div class="calendar-grid">${cells.join("")}</div>
  `;
  $$("[data-calendar-event]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectedConferenceId = button.dataset.calendarEvent;
      openConferenceDetail(selectedConferenceId);
    });
  });
}

function addEventToTrip(id) {
  const conference = state.conferences.find((event) => event.id === id);
  if (!conference || conference.status === "Committed") return;
  conference.status = "Committed";
  saveState();
  renderFilters();
  renderConferenceRows();
  renderPlanning();
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
    ? groups.map(renderRelationshipCard).join("")
    : "<div class='panel'><p class='muted'>No repeat contacts yet. Capture a lead and this view will update automatically.</p></div>";
  $$("[data-next-step]").forEach((button) => {
    button.addEventListener("click", () => handleNextStep(button.dataset.nextStep, button.dataset.group, button));
  });
  $$("[data-copy-context]").forEach((button) => {
    button.addEventListener("click", () => copyRelationshipContext(button.dataset.copyContext));
  });
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
    parsed = parseScribbleLocally(raw);
    $("#scribbleStatus").textContent = "AI unavailable. Local draft ready.";
  }
  applyParsedLead(parsed, raw);
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
    $("#relationshipList").innerHTML = `<div class="panel"><h3>AI relationship briefing</h3><p>${data.choices[0].message.content.replace(/\n/g, "<br>")}</p></div>` + groups.map(renderRelationshipCard).join("");
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
    state.hubspot.lastSuccessfulSync = new Date().toISOString();
    saveState();
    renderSettingsStatus();
    $("#hubspotResult").textContent = `${pushed} contacts pushed or already existed.`;
  } catch (error) {
    $("#hubspotResult").textContent = `HubSpot push failed: ${error.message}`;
  }
}

function setupSettings() {
  $("#aiKey").value = state.ai.key || "";
  $("#aiModel").value = state.ai.model || "gpt-4o-mini";
  $("#hubspotToken").value = state.hubspot.token || "";
  renderSettingsStatus();
  renderWeightControls();
  $("#saveAi").addEventListener("click", () => {
    state.ai.key = $("#aiKey").value.trim();
    state.ai.model = $("#aiModel").value.trim();
    saveState();
    renderSettingsStatus();
    alert("AI settings saved in this browser.");
  });
  $("#saveHubspot").addEventListener("click", () => {
    state.hubspot.token = $("#hubspotToken").value.trim();
    saveState();
    renderSettingsStatus();
    alert("HubSpot settings saved in this browser.");
  });
  $("#saveWeights").addEventListener("click", saveScoringWeights);
  $("#pushHubspot").addEventListener("click", pushHubspot);
  $("#aiSummaries").addEventListener("click", generateAiSummaries);
}

function renderSettingsStatus() {
  const hasAiKey = Boolean(($("#aiKey")?.value || state.ai.key || "").trim());
  const hasHubspotToken = Boolean(($("#hubspotToken")?.value || state.hubspot.token || "").trim());
  const aiBadge = $("#aiStatusBadge");
  const hubspotBadge = $("#hubspotStatusBadge");
  if (aiBadge) {
    aiBadge.textContent = hasAiKey ? "Active" : "Local Heuristics";
    aiBadge.className = `status-badge ${hasAiKey ? "status-active" : "status-muted"}`;
  }
  if (hubspotBadge) {
    hubspotBadge.textContent = hasHubspotToken ? "Active" : "Disconnected";
    hubspotBadge.className = `status-badge ${hasHubspotToken ? "status-active" : "status-muted"}`;
  }
  const lastSync = state.hubspot.lastSuccessfulSync
    ? new Date(state.hubspot.lastSuccessfulSync).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "Never";
  if ($("#hubspotLastSync")) $("#hubspotLastSync").textContent = `Last successful sync: ${lastSync}`;
}

function renderWeightControls() {
  const weights = { ...DEFAULT_SCORE_WEIGHTS, ...(state.scoringWeights || {}) };
  $("#weightControls").innerHTML = Object.entries(SCORE_WEIGHT_LABELS)
    .map(([key, label]) => `<label class="weight-control">
      <span>${label}</span>
      <input type="range" min="0" max="100" step="1" value="${weights[key]}" data-score-weight="${key}" aria-label="${label} weight">
      <input type="number" min="0" max="100" step="1" value="${weights[key]}" data-score-weight-number="${key}" aria-label="${label} percentage">
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
  const cleanValue = clampWeight(value);
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
      return [key, clampWeight(input?.value)];
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
    renderActiveFilterChips();
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
