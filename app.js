const state = migrateState(loadState());
saveState();
let selectedConferenceId = state.conferences[0]?.id;
let filterState = { vertical: [], region: [], status: [] };
let opportunityFilter = null;
let sortState = { key: "score", direction: "desc" };
let calendarDate = new Date("2026-06-01T00:00:00");
let calendarCommittedOnly = false;
let clusterConfig = { regions: [], windowDays: 10 };
let visibleGapSegments = ["Fintech", "Payments", "Treasury"];
let scoutState = { gap: null, results: [], loading: false, resolvedGapKey: "" };
const relationshipSummaryCache = new Map();
// Session-state caches for the ICP Account Presence Matcher, keyed by conference
// id. Keeping predictions and drafted hooks here means clicking around the app
// or retuning scoring sliders never re-fires an expensive model call.
const accountPresenceCache = new Map();
const outreachHookCache = new Map();
let speechRecognition = null;
let isRecordingScribble = false;
let scoutRecognition = null;
let isRecordingScout = false;
let scoutMediaRecorder = null;
let scoutAudioChunks = [];
let editingConferenceId = "";
let editingLeadId = "";
let pendingScoutEventId = "";
let leadRegistryExpanded = false;

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
    ai: { provider: DEFAULT_AI_PROVIDER, key: "", model: "" },
    hubspot: { token: "" },
    scoringWeights: clone(DEFAULT_SCORE_WEIGHTS)
  };
}

function migrateState(loaded) {
  loaded = loaded || {};
  loaded.ai = loaded.ai || { provider: DEFAULT_AI_PROVIDER, key: "", model: "" };
  loaded.ai.provider = AI_PROVIDER_CONFIG[loaded.ai.provider] ? loaded.ai.provider : DEFAULT_AI_PROVIDER;
  loaded.ai.model = loaded.ai.model || (loaded.ai.key ? "gpt-4o-mini" : "");
  delete loaded.ai.baseUrl;
  loaded.hubspot = loaded.hubspot || { token: "", lastSuccessfulSync: "" };
  loaded.hubspot.lastSuccessfulSync = loaded.hubspot.lastSuccessfulSync || "";
  loaded.scoringWeights = migrateScoringWeights(loaded.scoringWeights);
  const migrateRatings = loaded.ratingScaleVersion !== 2;
  loaded.conferences = (Array.isArray(loaded.conferences) ? loaded.conferences : clone(CONFERENCES)).map((conference) => {
    const status = ["Pending", "Uncommitted"].includes(conference.status) ? "Considering" : conference.status;
    const ratings = migrateRatings ? migrateConferenceRatings(conference) : conference;
    if (Array.isArray(conference.team)) return { ...ratings, status };
    const team = conference.owner && conference.owner !== "Unassigned" ? [conference.owner] : [];
    return { ...ratings, status, team };
  });
  loaded.ratingScaleVersion = 2;
  loaded.leads = Array.isArray(loaded.leads) ? loaded.leads : clone(LEADS);
  return loaded;
}

function migrateConferenceRatings(conference) {
  const ratingKeys = ["seniority", "buyerDensity", "fxRelevance", "travelRelevance", "pspRelevance", "costTier"];
  return {
    ...conference,
    ...Object.fromEntries(ratingKeys.map((key) => [key, Math.max(1, Math.min(10, (Number(conference[key]) || 3) * 2))]))
  };
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
  const industryFit = ((c.buyerDensity || 0) / 10) * 0.45 + (Math.max(c.pspRelevance || 0, c.travelRelevance || 0) / 10) * 0.55;
  const fxExposurePain = (c.fxRelevance || 0) / 10;
  const decisionMakerSeniority = (c.seniority || 0) / 10;
  const audienceScale = reach;
  const travelBudgetRoi = ((12 - (c.costTier || 6)) / 10) * 0.65 + ((c.travelRelevance || 0) / 10) * 0.35;
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
  return buildRelationshipGroups(state.leads).groups;
}

// Turns the trajectory analysis into a rep-facing read. The interpretation
// (warming vs. polite tire-kicker) comes from how sentiment and urgency moved
// across encounters, not from how many times the person showed up.
function relationshipVerdict(group) {
  const a = analyzeRelationship(group);
  const span = a.spanDays >= 30 ? ` over ${a.spanDays} days` : "";
  switch (a.stage) {
    case "champion":
      return `Warming relationship worth closing: ${a.encounters} encounters${span}, sentiment held strong and urgency is near-term. Get the right commercial and treasury stakeholders into a focused demo now.`;
    case "warming":
      return `Trending up: interest rose across ${a.encounters} encounters${span}. Real momentum — propose a concrete next step (working session or scoped pilot) while it is warm.`;
    case "cooling":
      return `Cooling: engagement dropped since the first encounter. Re-qualify the pain and decision owner before investing more, or park it politely.`;
    case "stalled":
      return a.longCycle
        ? `Long-cycle listener: ${a.encounters} encounters${span} with no lift in sentiment${a.hasBudgetSignal ? " and recurring budget hesitation" : ""}. Likely a polite tire-kicker — make one direct budget/owner ask, then de-prioritize if it stays flat.`
        : `Medium engagement: repeat interest is present, but sentiment has not moved${a.hasBudgetSignal ? "; budget and owner remain unconfirmed" : ""}. Qualify the buying owner before more nurturing.`;
    default:
      return `Known contact across ${a.encounters} encounters${span}. Keep the context visible without over-weighting the repeat count.`;
  }
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

  // Only apply a custom width when expanded; collapsed always uses the narrow
  // icon rail. Otherwise a saved inline width would override the collapsed rule
  // and leave a wide bar showing only icons.
  if (saved.collapsed) {
    shell.classList.add("sidebar-collapsed");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Expand sidebar");
  } else if (saved.width) {
    shell.style.setProperty("--sidebar-width", `${saved.width}px`);
  }

  toggle.addEventListener("click", () => {
    const collapsed = !shell.classList.contains("sidebar-collapsed");
    shell.classList.toggle("sidebar-collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    applySidebarWidth(shell, collapsed);
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

// Collapsed drops any inline width so the narrow icon rail applies; expanded
// restores the user's saved width if they had resized the sidebar.
function applySidebarWidth(shell, collapsed) {
  const width = savedSidebar().width;
  if (collapsed || !width) {
    shell.style.removeProperty("--sidebar-width");
  } else {
    shell.style.setProperty("--sidebar-width", `${width}px`);
  }
}

function collapseSidebar() {
  const shell = $("#appShell");
  const toggle = $("#sidebarToggle");
  if (!shell || shell.classList.contains("sidebar-collapsed")) return;
  shell.classList.add("sidebar-collapsed");
  toggle?.setAttribute("aria-expanded", "false");
  toggle?.setAttribute("aria-label", "Expand sidebar");
  applySidebarWidth(shell, true);
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
    `<div class="filter-action-pair">
      <button class="filter-clear" type="button" data-filter-select-all="clusterRegion">Select All</button>
      <button class="filter-clear" type="button" data-filter-clear="clusterRegion">Clear All</button>
    </div>`,
    ...regions.map((region) => renderMultiOption(region, clusterConfig.regions.includes(region)))
  ].join("");
  menu.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      clusterConfig.regions = Array.from(menu.querySelectorAll("input:checked")).map((item) => item.value);
      renderFilters();
      renderPlanning();
    });
  });
  menu.querySelector("[data-filter-select-all]")?.addEventListener("click", () => {
    clusterConfig.regions = [...regions];
    renderFilters();
    renderPlanning();
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
    `<div class="filter-action-pair">
      <button class="filter-clear" type="button" data-filter-select-all="${key}">Select All</button>
      <button class="filter-clear" type="button" data-filter-clear="${key}">Clear All</button>
    </div>`,
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
  menu.querySelector("[data-filter-select-all]")?.addEventListener("click", () => {
    opportunityFilter = null;
    filterState[key] = [...options];
    renderFilters();
    renderConferenceRows();
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
  $("#calendarCommittedOnly").addEventListener("change", (event) => {
    calendarCommittedOnly = event.currentTarget.checked;
    renderCalendar();
  });
  $("#clusterWindow").addEventListener("input", (event) => {
    const value = Number(event.currentTarget.value);
    clusterConfig.windowDays = Math.max(1, Math.min(90, Number.isFinite(value) ? value : 10));
    renderPlanning();
  });
  $("#runScoutSearch")?.addEventListener("click", runScoutSearch);
  $("#scoutMic")?.addEventListener("click", toggleScoutVoicePrompt);
}

async function aiChat(messages, { json = false } = {}) {
  const provider = state.ai.provider || DEFAULT_AI_PROVIDER;
  const request = buildAiMessageRequest(provider, messages, json);
  const response = await fetch(request.url, request.options);
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json();
  if (provider === "gemini") return data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  if (provider === "anthropic") return data.content?.map((part) => part.text || "").join("") || "";
  return data.choices?.[0]?.message?.content || "";
}

function buildAiMessageRequest(provider, messages, json) {
  const config = AI_PROVIDER_CONFIG[provider];
  if (provider === "gemini") {
    const systemInstruction = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const contents = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: String(message.content || "") }]
      }));
    return {
      url: `${config.messagesUrl}/${encodeURIComponent(state.ai.model)}:generateContent?key=${encodeURIComponent(state.ai.key)}`,
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
          contents,
          ...(json ? { generationConfig: { responseMimeType: "application/json" } } : {})
        })
      }
    };
  }
  if (provider === "anthropic") {
    const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    return {
      url: config.messagesUrl,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": state.ai.key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
          model: state.ai.model,
          max_tokens: 2048,
          ...(system ? { system: json ? `${system}\n\nReturn valid JSON only.` : system } : {}),
          messages: messages
            .filter((message) => message.role !== "system")
            .map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: String(message.content || "") }))
        })
      }
    };
  }
  return {
    url: config.messagesUrl,
    options: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.ai.key}`
      },
      body: JSON.stringify({
        model: state.ai.model,
        ...(json ? { response_format: { type: "json_object" } } : {}),
        messages
      })
    }
  };
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
  const content = await aiChat(
    [
      {
        role: "system",
        content: [
          "You are Grain's Proactive AI Pipeline Scout.",
          "Return only JSON with an events array.",
          "Each event must have name, startDate, endDate, city, country, region, verticals, audience, seniority, buyerDensity, fxRelevance, travelRelevance, pspRelevance, costTier, source, and pitchHook.",
          "All evaluation criteria must use integers from 1 to 10.",
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
    ],
    { json: true }
  );
  return JSON.parse(content || "{}").events || [];
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
      seniority: 8,
      buyerDensity: 8,
      fxRelevance: 10,
      travelRelevance: 10,
      pspRelevance: 4,
      costTier: 6,
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
      seniority: 10,
      buyerDensity: 8,
      fxRelevance: 8,
      travelRelevance: 10,
      pspRelevance: 4,
      costTier: 6,
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
      seniority: 8,
      buyerDensity: 8,
      fxRelevance: 8,
      travelRelevance: 10,
      pspRelevance: 4,
      costTier: 4,
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
      seniority: 10,
      buyerDensity: 10,
      fxRelevance: 10,
      travelRelevance: 4,
      pspRelevance: 10,
      costTier: 8,
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
    seniority: clampRating(event.seniority, 8),
    buyerDensity: clampRating(event.buyerDensity, 8),
    fxRelevance: clampRating(event.fxRelevance, 8),
    travelRelevance: clampRating(event.travelRelevance, 8),
    pspRelevance: clampRating(event.pspRelevance, 4),
    costTier: clampRating(event.costTier, 6),
    status: "Committed",
    owner: "Unassigned",
    source: String(event.source || "").trim(),
    pitchHook: String(event.pitchHook || "").trim()
  };
}

function clampRating(value, fallback) {
  return Math.max(1, Math.min(10, Math.round(Number(value) || fallback)));
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
  editingConferenceId = "";
  pendingScoutEventId = id;
  populateConferenceForm(result.event);
  $("#addConferenceTitle").textContent = "Review AI Scout Event";
  $("#conferenceFormDescription").textContent = "Verify the discovered event data and scoring inputs before adding it to the active directory.";
  $("#conferenceFormSubmit").textContent = "Add to table";
  document.querySelector("#addConferenceModal .modal-close")?.setAttribute("aria-label", "Close AI Scout event review");
  openModal("#addConferenceModal");
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
    $("#scoutStatus").textContent = "Save an OpenAI key to use Whisper transcription, or type the scout prompt.";
    return;
  }
  if (state.ai.provider !== "openai") {
    $("#scoutStatus").textContent = "Voice transcription currently requires OpenAI. Switch providers or type the scout prompt.";
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
      opportunityFilter.eventIds?.length
        ? opportunityFilter.eventIds.includes(c.id)
        : (
          c.verticals.includes(opportunityFilter.vertical) &&
          opportunityFilter.statuses.includes(c.status) &&
          scoreConference(c) >= opportunityFilter.minScore
        )
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
  const considering = items.filter((c) => c.status === "Considering").length;
  const tierA = items.filter((c) => tierFor(scoreConference(c)) === "A").length;
  const confirmedReach = items.filter((c) => CONFIRMED_STATUSES.includes(c.status));
  const audience = confirmedReach.reduce((sum, c) => sum + c.audience, 0);
  const total = items.length || 1;
  $("#metrics").innerHTML = [
    ["Events", items.length, `${considering} considering coverage`],
    ["Tier A targets", tierA, `${Math.round((tierA / total) * 100)}% of the shortlist`],
    ["Committed", committed.length, `${items.length - committed.length} still open`],
    ["Reach", audience.toLocaleString(), `${confirmedReach.length} approved event${confirmedReach.length === 1 ? "" : "s"}`]
  ]
    .map(([label, value, sub]) => renderMetricCard(label, value, sub))
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
    .join("") + renderAddConferenceRow();
  $$("#conferenceRows tr").forEach((row) => {
    if (!row.dataset.id) return;
    row.addEventListener("click", () => {
      selectedConferenceId = row.dataset.id;
      openConferenceDetail(selectedConferenceId);
    });
  });
  $$("[data-row-action]").forEach((control) => {
    control.addEventListener("click", (event) => event.stopPropagation());
  });
  $$("[data-row-menu-toggle]").forEach((button) => {
    button.addEventListener("click", () => toggleRowActionMenu(button));
  });
  $$("[data-edit-conference]").forEach((button) => {
    button.addEventListener("click", () => openEditConferenceForm(button.dataset.editConference));
  });
  $$("[data-delete-conference]").forEach((button) => {
    button.addEventListener("click", () => deleteConference(button.dataset.deleteConference));
  });
  $("#addConferenceRowButton")?.addEventListener("click", openAddConferenceForm);
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
    editor.querySelector("[data-team-select-all]")?.addEventListener("click", () => {
      editor.querySelectorAll("input").forEach((input) => {
        input.checked = true;
      });
      handleTeamEdit(editor);
    });
    editor.querySelector("[data-team-clear-all]")?.addEventListener("click", () => {
      editor.querySelectorAll("input").forEach((input) => {
        input.checked = false;
      });
      handleTeamEdit(editor);
    });
  });
  if (!items.some((c) => c.id === selectedConferenceId)) selectedConferenceId = items[0]?.id;
}

function toggleRowActionMenu(button) {
  const menu = document.querySelector(`[data-row-menu="${CSS.escape(button.dataset.rowMenuToggle)}"]`);
  const willOpen = !menu?.classList.contains("open");
  closeRowActionMenus();
  if (!menu || !willOpen) return;
  menu.classList.add("open");
  button.setAttribute("aria-expanded", "true");
}

function closeRowActionMenus() {
  $$(".row-action-menu.open").forEach((menu) => menu.classList.remove("open"));
  $$("[data-row-menu-toggle][aria-expanded='true']").forEach((button) => button.setAttribute("aria-expanded", "false"));
}

function renderAddConferenceRow() {
  return `<tr class="add-conference-row">
    <td colspan="8">
      <button id="addConferenceRowButton" class="add-conference-row-button" type="button">
        <span aria-hidden="true">+</span>
        Add New Event
      </button>
    </td>
  </tr>`;
}

function deleteConference(id) {
  const conference = state.conferences.find((item) => item.id === id);
  if (!conference) return;
  closeRowActionMenus();
  if (conference.status === "Committed") {
    showToast("Cannot delete a committed conference. Please change the status to Considering or Watchlist first.", "warning", { duration: 5200 });
    return;
  }
  if (!window.confirm(`Delete ${conference.name}? This cannot be undone.`)) return;
  state.conferences = state.conferences.filter((item) => item.id !== id);
  state.leads = state.leads.filter((lead) => lead.conferenceId !== id);
  selectedConferenceId = state.conferences[0]?.id || "";
  saveState();
  renderFilters();
  renderAll();
  showToast(`${conference.name} deleted.`, "success");
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
  const conferenceTitle = c.source
    ? `<a class="detail-title-link" href="${escapeHtml(c.source)}" target="_blank" rel="noreferrer">${escapeHtml(c.name)}</a>`
    : escapeHtml(c.name);
  $("#conferenceDetailBody").innerHTML = `<div class="modal-head">
    <span class="eyebrow">Selected event</span>
    <h3 id="conferenceDetailTitle">${conferenceTitle}</h3>
    <p class="muted">${formatDateRange(c)} in ${c.city}, ${c.country}. Estimated ${c.audience.toLocaleString()} attendees.</p>
  </div>
  <div class="detail-grid">
    <div>
      <p><strong>Status:</strong> ${c.status}</p>
      <p><strong>Team:</strong> ${teamLabel(c)}</p>
      <p><strong>Region:</strong> ${c.region}</p>
    </div>
    <div>
      <p class="eyebrow">Why it ranks ${score}</p>
      <p>${scoreNarrative(c)}</p>
    </div>
  </div>
  <div class="account-presence" id="accountPresence" data-conf-id="${c.id}"></div>`;
  renderAccountPresence(c);
}

// --- ICP Account Presence Matcher ---------------------------------------------
// Predicts which HubSpot target accounts are likely on the floor and surfaces a
// clickable count badge with a color-coded, AI-reasoned breakdown.
async function predictAccountPresence(conference) {
  if (accountPresenceCache.has(conference.id)) return accountPresenceCache.get(conference.id);
  let matches;
  try {
    matches = state.ai.key ? await fetchAccountPresence(conference) : localAccountPresence(conference);
  } catch (error) {
    matches = localAccountPresence(conference);
  }
  accountPresenceCache.set(conference.id, matches);
  return matches;
}

async function fetchAccountPresence(conference) {
  const content = await aiChat(
    [
      {
        role: "system",
        content: [
          "You are Grain's ICP Account Presence Matcher.",
          "Given a conference and a list of HubSpot target accounts, predict which accounts are likely to attend or sponsor.",
          "Weigh geographic alignment (account HQ vs conference region), industry vertical fit, and typical corporate event behavior.",
          "Return only JSON: { \"matches\": [ { \"company_name\", \"match_probability\", \"ai_reasoning\" } ] }.",
          "match_probability must be exactly one of: Confirmed, High, Medium. Only include accounts that genuinely match; omit weak fits.",
          "ai_reasoning must be a single contextual sales-justification sentence. Use company_name values exactly as provided."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({
          conference: {
            name: conference.name,
            city: conference.city,
            country: conference.country,
            region: conference.region,
            verticals: conference.verticals,
            fxRelevance: conference.fxRelevance,
            pspRelevance: conference.pspRelevance,
            travelRelevance: conference.travelRelevance
          },
          hubspotAccounts: HUBSPOT_ACCOUNTS.map((a) => ({
            company_name: a.company_name,
            hubspot_status: a.hubspot_status,
            vertical: a.vertical,
            hq: a.hq,
            confirmedSponsor: Array.isArray(a.knownSponsorOf) && a.knownSponsorOf.includes(conference.id)
          }))
        })
      }
    ],
    { json: true }
  );
  return normalizeAccountMatches(JSON.parse(content || "{}").matches);
}

async function renderAccountPresence(conference) {
  const container = $("#accountPresence");
  if (!container) return;
  const cached = accountPresenceCache.has(conference.id);
  container.innerHTML = `
    <div class="presence-head">
      <p class="eyebrow">ICP Account Presence</p>
      <span class="muted">${state.ai.key ? "AI prediction" : "Local heuristic"} from your HubSpot target book</span>
    </div>
    <div class="presence-body">${cached ? "" : '<span class="muted presence-loading">Matching target accounts…</span>'}</div>`;
  const body = container.querySelector(".presence-body");
  const matches = await predictAccountPresence(conference);
  // Bail if the user navigated to a different conference while we awaited.
  if (container.dataset.confId !== conference.id) return;
  body.innerHTML = renderPresenceMatches(conference, matches);
  wirePresenceInteractions(conference, body);
}

function renderPresenceMatches(conference, matches) {
  if (!matches.length) {
    return '<p class="muted">No target accounts from the current HubSpot book map to this event.</p>';
  }
  const rows = matches
    .map(
      (m) => `<li class="presence-row">
        <div class="presence-row-head">
          <span class="presence-dot ${presenceDotClass(m.match_probability)}" aria-hidden="true"></span>
          <span class="presence-company">${escapeHtml(m.company_name)}</span>
          <span class="presence-meta">${escapeHtml(m.match_probability)} — HubSpot: ${escapeHtml(m.hubspot_status)}</span>
        </div>
        <p class="presence-insight"><span class="presence-branch" aria-hidden="true">└─</span> AI Insight: ${escapeHtml(m.ai_reasoning)}</p>
      </li>`
    )
    .join("");
  return `
    <button class="presence-badge" type="button" id="presenceBadge" aria-expanded="false">
      <span aria-hidden="true">📊</span> ${matches.length} Target Account${matches.length === 1 ? "" : "s"} Matched
      <span class="presence-caret" aria-hidden="true">▾</span>
    </button>
    <div class="presence-popover" id="presencePopover" hidden>
      <ul class="presence-list">${rows}</ul>
      <button class="presence-draft-button" type="button" id="draftHooksButton">🪄 Draft Outreach Hooks for Matched Accounts</button>
      <div class="presence-hooks" id="presenceHooks"></div>
    </div>`;
}

function wirePresenceInteractions(conference, body) {
  const badge = body.querySelector("#presenceBadge");
  const popover = body.querySelector("#presencePopover");
  if (badge && popover) {
    badge.addEventListener("click", () => {
      const open = popover.hidden;
      popover.hidden = !open;
      badge.setAttribute("aria-expanded", String(open));
    });
  }
  const draftButton = body.querySelector("#draftHooksButton");
  if (draftButton) {
    draftButton.addEventListener("click", () => draftOutreachHooks(conference, draftButton));
  }
  if (outreachHookCache.has(conference.id)) {
    renderOutreachHooks(body, outreachHookCache.get(conference.id));
  }
}

async function draftOutreachHooks(conference, button) {
  const hooksSlot = $("#presenceHooks");
  if (outreachHookCache.has(conference.id)) {
    renderOutreachHooks(button.closest(".presence-popover"), outreachHookCache.get(conference.id));
    return;
  }
  const matches = accountPresenceCache.get(conference.id) || [];
  if (!matches.length) return;
  button.disabled = true;
  const original = button.textContent;
  button.textContent = state.ai.key ? "Drafting hooks…" : "Building hooks…";
  if (hooksSlot) hooksSlot.innerHTML = "";
  let hooks;
  try {
    hooks = state.ai.key ? await fetchOutreachHooks(conference, matches) : localOutreachHooks(conference, matches);
  } catch (error) {
    hooks = localOutreachHooks(conference, matches);
  }
  outreachHookCache.set(conference.id, hooks);
  renderOutreachHooks(button.closest(".presence-popover"), hooks);
  button.disabled = false;
  button.textContent = original;
}

async function fetchOutreachHooks(conference, matches) {
  const content = await aiChat(
    [
      {
        role: "system",
        content: [
          "You are a Grain SDR writing first-touch outreach hooks for accounts likely attending a conference.",
          "Return only JSON: { \"hooks\": [ { \"company_name\", \"hook\" } ] }.",
          "Each hook is one or two sentences, references the specific event and the account's FX/payments/treasury pain, and is ready to drop into a LinkedIn or email opener.",
          "Use company_name values exactly as provided."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({
          conference: { name: conference.name, city: conference.city, region: conference.region, verticals: conference.verticals },
          accounts: matches.map((m) => ({ company_name: m.company_name, vertical: m.vertical, hubspot_status: m.hubspot_status, match_probability: m.match_probability }))
        })
      }
    ],
    { json: true }
  );
  const parsed = JSON.parse(content || "{}").hooks;
  const byName = new Set(matches.map((m) => m.company_name));
  const hooks = (Array.isArray(parsed) ? parsed : [])
    .filter((h) => byName.has(h?.company_name) && String(h?.hook || "").trim())
    .map((h) => ({ company_name: h.company_name, hook: h.hook.trim() }));
  return hooks.length ? hooks : localOutreachHooks(conference, matches);
}

function localOutreachHooks(conference, matches) {
  return matches.map((m) => ({
    company_name: m.company_name,
    hook: `Saw ${m.company_name} lines up with ${conference.name} — given your ${m.vertical.toLowerCase()} footprint, worth comparing how teams are containing FX margin leakage before the show. Open to a quick floor chat in ${conference.city}?`
  }));
}

function renderOutreachHooks(scope, hooks) {
  const slot = scope ? scope.querySelector("#presenceHooks") : $("#presenceHooks");
  if (!slot) return;
  slot.innerHTML = hooks
    .map(
      (h) => `<div class="presence-hook">
        <strong>${escapeHtml(h.company_name)}</strong>
        <p>${escapeHtml(h.hook)}</p>
      </div>`
    )
    .join("");
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
    $("#clusters").innerHTML = clusters.length
      ? clusters.map(renderTripCluster).join("")
      : "<p class='muted'>No clusters found.</p>";
    $$("[data-add-to-trip]").forEach((button) => {
      button.addEventListener("click", () => addEventToTrip(button.dataset.addToTrip));
    });
    $$("[data-fill-trip-gap]").forEach((button) => {
      button.addEventListener("click", () => fillTripGapViaScout(button));
    });

    const verticals = allVerticals();
    renderGapSegmentFilter(verticals);
    $("#gaps").innerHTML = verticals
      .filter((vertical) => visibleGapSegments.includes(vertical))
      .map(renderGapCard)
      .join("");
    $$("[data-gap-opportunities]").forEach((button) => {
      button.addEventListener("click", () => {
        const eventIds = (button.dataset.gapEventIds || "").split(",").filter(Boolean);
        viewSegmentOpportunities(button.dataset.gapOpportunities, eventIds);
      });
    });
    $$("[data-gap-scout]").forEach((button) => {
      button.addEventListener("click", () => resolveSegmentGapViaScout(button.dataset.gapScout));
    });
  } catch (error) {
    $("#scoutResults").innerHTML = "";
    $("#eventCalendar").innerHTML = `<div class="empty-state"><strong>Planning could not load.</strong><span>Reset demo data or refresh the page to rebuild the event calendar.</span></div>`;
    $("#clusters").innerHTML = "";
    $("#gaps").innerHTML = "";
  }
}

function renderScoutWorkspace() {
  const badge = $("#scoutModeBadge");
  if (badge) {
    badge.textContent = state.ai.key ? "AI scout active" : "Local scout ready";
    badge.className = `status-badge ${state.ai.key ? "status-active" : "status-muted"}`;
  }
  renderScoutResults();
}

function routePromptToScout(prompt) {
  document.querySelector("[data-view='conferences']")?.click();
  const input = $("#scoutPrompt");
  if (input) input.value = prompt;
  setTimeout(() => {
    $("#pipelineScout")?.scrollIntoView({ behavior: "smooth", block: "start" });
    input?.focus();
  }, 120);
}

function resolveSegmentGapViaScout(segmentName) {
  const segment = segmentName || "target";
  routePromptToScout(`Find leading high-ICP ${segment} conferences in Europe or North America for the upcoming 2026 and 2027 pipeline period, with dense CFO, treasurer, finance leader, PSP, payments, or enterprise buyer attendance relevant to Grain's FX hedging product.`);
}

function fillTripGapViaScout(button) {
  const clusterRegion = button.dataset.clusterRegion || "the active trip region";
  const gapStart = button.dataset.gapStart || "the open itinerary start date";
  const gapEnd = button.dataset.gapEnd || "the open itinerary end date";
  routePromptToScout(`Find target high-ICP fintech, payment, or corporate conferences taking place in ${clusterRegion} between ${gapStart} and ${gapEnd} to optimize an existing sales travel itinerary.`);
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
  const eventTitle = event.source
    ? `<a class="scout-title-link" href="${escapeHtml(event.source)}" target="_blank" rel="noreferrer">${escapeHtml(event.name)}</a>`
    : `<strong>${escapeHtml(event.name)}</strong>`;
  return `<div class="scout-card ${duplicate ? "scout-card-duplicate" : ""}">
    <div class="scout-card-head">
      <div>
        ${eventTitle}
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
    `<div class="filter-action-pair">
      <button class="filter-clear" type="button" data-gap-segment-all>Select All</button>
      <button class="filter-clear" type="button" data-gap-segment-clear>Clear All</button>
    </div>`,
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
  menu.querySelector("[data-gap-segment-clear]")?.addEventListener("click", () => {
    visibleGapSegments = [];
    renderPlanning();
  });
}

function renderGapCard(vertical) {
  const relevant = state.conferences.filter((c) => c.verticals.includes(vertical));
  const committed = relevant.filter((c) => isCommittedConference(c));
  const uncommitted = relevant.filter((c) => !isCommittedConference(c));
  const avg = relevant.length ? Math.round(relevant.reduce((sum, c) => sum + scoreConference(c), 0) / relevant.length) : 0;
  const ratio = relevant.length ? committed.length / relevant.length : 0;
  const progress = Math.round(ratio * 100);
  const fullyCovered = committed.length > 0 && uncommitted.length === 0;
  const dataGap = relevant.length === 0;
  const highValueUncommitted = uncommitted.filter((c) => scoreConference(c) >= 68);
  const underInvested = !fullyCovered && !dataGap && (progress < 100 || highValueUncommitted.length > 0);
  const missedReach = uncommitted.reduce((sum, c) => sum + (Number(c.audience) || 0), 0);
  const tone = fullyCovered ? "healthy" : (dataGap ? "danger" : (underInvested ? "warning" : "healthy"));
  const status = gapCardStatus({
    vertical,
    fullyCovered,
    dataGap,
    underInvested,
    uncommitted,
    missedReach
  });
  return `<div class="gap gap-${tone}">
    <div class="gap-head">
      <strong>${vertical}</strong>
      <span>${progress}% covered</span>
    </div>
    <div class="gap-progress" aria-label="${vertical} committed coverage">
      <span style="width:${Math.min(100, progress)}%"></span>
    </div>
    <p>${committed.length}/${relevant.length} committed. Average ICP score ${avg}.</p>
    ${status}
    ${renderVerticalScoutUtility(vertical)}
  </div>`;
}

function isCommittedConference(conference) {
  return ["Committed", "Approved", "Confirmed", "Booked"].includes(conference?.status);
}

function gapCardStatus({ vertical, fullyCovered, dataGap, underInvested, uncommitted, missedReach }) {
  if (fullyCovered) {
    return `<p class="gap-status gap-status-covered">Fully Covered</p>
      <p class="muted">All known ${escapeHtml(vertical)} events are covered. Great job!</p>`;
  }
  if (dataGap) {
    return `<p class="gap-status heat">Under-invested: critical pipeline gap.</p>
      <p class="muted">No known ${escapeHtml(vertical)} events are currently listed in the directory.</p>`;
  }
  if (underInvested && uncommitted.length) {
    const eventIds = uncommitted.map((conference) => conference.id).join(",");
    return `<p class="gap-status heat">Under-invested: local opportunities available.</p>
      <p class="muted gap-cost">Missing out on ${missedReach.toLocaleString()} potential reach across ${uncommitted.length} uncommitted events.</p>
      <button class="gap-action" type="button" data-gap-opportunities="${escapeHtml(vertical)}" data-gap-event-ids="${escapeHtml(eventIds)}">View Opportunities in Table</button>`;
  }
  return `<p class="gap-status muted">Coverage looks proportional.</p>`;
}

function renderVerticalScoutUtility(segmentName) {
  return `<div class="vertical-scout-utility">
    <button type="button" data-gap-scout="${escapeHtml(segmentName)}">
      <span aria-hidden="true">&#128269;</span>
      Discover more events in this vertical via AI Scout
    </button>
  </div>`;
}

function viewSegmentOpportunities(vertical, eventIds = []) {
  const specificEvents = state.conferences.filter((conference) => eventIds.includes(conference.id));
  const statuses = [...new Set(specificEvents.map((conference) => conference.status))];
  filterState = {
    vertical: [vertical],
    region: [],
    status: statuses
  };
  opportunityFilter = { vertical, eventIds };
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
    const inMonth = eventDate.getFullYear() === year && eventDate.getMonth() === month;
    return inMonth && (!calendarCommittedOnly || event.status === "Committed");
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

// Medium-confidence matches are never merged silently — they are shown as a
// "possible same person" prompt so the rep, not the tool, makes the call. This
// keeps false merges out of the CRM while still catching name variations.
function renderMatchSuggestions(suggestions) {
  if (!suggestions.length) return "";
  const rows = suggestions
    .map((pair) => {
      const confAName = state.conferences.find((c) => c.id === pair.a.conferenceId)?.name || "a conference";
      const confBName = state.conferences.find((c) => c.id === pair.b.conferenceId)?.name || "a conference";
      return `<li><strong>${escapeHtml(pair.a.firstName)} ${escapeHtml(pair.a.lastName)}</strong> (${escapeHtml(pair.a.company)}, ${escapeHtml(confAName)}) and <strong>${escapeHtml(pair.b.firstName)} ${escapeHtml(pair.b.lastName)}</strong> (${escapeHtml(pair.b.company)}, ${escapeHtml(confBName)}) &mdash; ${Math.round(pair.score * 100)}% match</li>`;
    })
    .join("");
  return `<div class="panel match-suggestions">
    <strong>Possible same person &mdash; worth a quick check</strong>
    <p class="muted">Close but not certain, so we did not merge these automatically. Confirm in the field if they are the same contact.</p>
    <ul>${rows}</ul>
  </div>`;
}

function renderRelationships() {
  const { groups, suggestions } = buildRelationshipGroups(state.leads);
  const cards = groups.length
    ? groups.map(renderRelationshipCard).join("")
    : "<div class='panel'><p class='muted'>No repeat contacts yet. Capture a lead and this view will update automatically.</p></div>";
  $("#relationshipList").innerHTML = renderMatchSuggestions(suggestions) + cards;
  $$("[data-next-step]").forEach((button) => {
    button.addEventListener("click", () => handleNextStep(button.dataset.nextStep, button.dataset.group, button));
  });
  $$("[data-copy-context]").forEach((button) => {
    button.addEventListener("click", () => copyRelationshipContext(button.dataset.copyContext));
  });
  $$("[data-arc-summary]").forEach((button) => {
    button.addEventListener("click", () => summarizeRelationshipArc(button.dataset.arcSummary, button));
  });
  rehydrateRelationshipSummaries();
}

function relationshipKey(group) {
  return group.map((lead) => lead.id).slice().sort().join(",");
}

function renderArcSummary(slot, summary) {
  slot.innerHTML = `<strong>AI summary</strong><span>${escapeHtml(summary)}</span>`;
}

// Re-paint any summaries we have already generated after the list re-renders,
// so capturing a new lead elsewhere does not wipe a brief the rep just read.
function rehydrateRelationshipSummaries() {
  $$("[data-summary-slot]").forEach((slot) => {
    const group = decodeLeadGroup(slot.dataset.summarySlot);
    if (group.length < 2) return;
    const cached = relationshipSummaryCache.get(relationshipKey(group));
    if (cached) renderArcSummary(slot, cached);
  });
}

// The relationship-arc summary is the one place AI clearly beats rules: it weighs
// the trajectory, the notes, and the job changes into a short human read. Results
// are cached per contact so we never re-bill a key for an unchanged relationship.
async function summarizeRelationshipArc(encodedIds, button) {
  const group = decodeLeadGroup(encodedIds);
  if (group.length < 2) return;
  const slot = button.closest(".relationship")?.querySelector(".relationship-ai-summary");
  if (!slot) return;
  const key = relationshipKey(group);
  if (relationshipSummaryCache.has(key)) {
    renderArcSummary(slot, relationshipSummaryCache.get(key));
    return;
  }
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = state.ai.key ? "Summarizing..." : "Building...";
  renderArcSummary(slot, state.ai.key ? "Generating an AI summary..." : "Building a local summary...");
  let summary;
  try {
    summary = state.ai.key ? await summarizeArcWithAi(group) : localArcSummary(group);
  } catch (error) {
    summary = localArcSummary(group);
  }
  relationshipSummaryCache.set(key, summary);
  renderArcSummary(slot, summary);
  button.disabled = false;
  button.textContent = originalLabel;
}

async function summarizeArcWithAi(group) {
  const analysis = analyzeRelationship(group);
  const facts = {
    stage: analysis.stage,
    direction: analysis.direction,
    encounters: analysis.encounters,
    spanDays: analysis.spanDays,
    companyChanged: analysis.companyChanged,
    titleChanged: analysis.titleChanged,
    domainChanged: analysis.domainChanged
  };
  const encounters = analysis.ordered.map((lead) => ({
    conference: state.conferences.find((c) => c.id === lead.conferenceId)?.name || "Unknown",
    date: lead.createdAt,
    title: lead.title,
    company: lead.company,
    sentiment: lead.sentiment,
    urgency: lead.urgency,
    notes: lead.notes
  }));
  const content = await aiChat([
    {
      role: "system",
      content: "You brief Grain sales reps (FX risk fintech serving PSPs, payments, travel wholesalers, and treasury). Summarize a cross-conference relationship arc in 2 sentences, then give one concrete next step on its own line. Use the sentiment/urgency trajectory to judge whether this is a warming buyer or a polite repeat tire-kicker. Be direct, no generic CRM filler."
    },
    {
      role: "user",
      content: JSON.stringify({ facts, encounters })
    }
  ]);
  return content.trim();
}

// Deterministic fallback that is still genuinely useful: the encounter path plus
// the trajectory verdict, so the feature works with no key and offline.
function localArcSummary(group) {
  const analysis = analyzeRelationship(group);
  const path = analysis.ordered
    .map((lead) => {
      const conference = state.conferences.find((c) => c.id === lead.conferenceId)?.name || "a conference";
      return `${conference} (${lead.sentiment}/${lead.urgency})`;
    })
    .join(" -> ");
  return `${analysis.latest.firstName} ${analysis.latest.lastName} at ${analysis.latest.company}: ${path}. ${relationshipVerdict(group)}`;
}

function relationshipNextSteps(group) {
  const { stage } = analyzeRelationship(group);
  const steps = [{ action: "gmail", label: "Draft Email Follow-up" }];
  if (stage === "champion" || stage === "warming") {
    steps.push({ action: "demo", label: "Schedule Demo Call" });
  } else if (stage === "stalled" || stage === "cooling") {
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
    const existingLead = editingLeadId
      ? state.leads.find((lead) => lead.id === editingLeadId)
      : null;
    const lead = {
      ...(existingLead || {}),
      id: existingLead?.id || createId(),
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
      createdAt: existingLead?.createdAt || new Date().toISOString()
    };
    if (existingLead) Object.assign(existingLead, lead);
    else state.leads.push(lead);
    saveState();
    resetLeadForm();
    renderAll();
    showToast(existingLead ? "Lead updated." : "Lead saved. Relationship tracking updated.", "success");
  });
}

function resetLeadForm() {
  editingLeadId = "";
  $("#leadForm").reset();
  $("#scribbleInput").value = "";
  $("#scribbleStatus").textContent = "";
  $("#sentStrong").checked = true;
  document.querySelector("#leadForm .capture-actions .primary-button").textContent = "Save lead";
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
  const content = await aiChat(
    [
      {
        role: "system",
        content: "Extract a conference lead from messy sales notes. Return only JSON with keys: firstName,lastName,company,title,email,phone,conferenceId,vertical,urgency,sentiment,painPoints,nextStep,notes. Use null for unknown. sentiment must be Strong, Medium, or Weak. urgency must be Immediate, This quarter, Exploring, or Not a fit. Choose conferenceId only from the provided conference list."
      },
      {
        role: "user",
        content: JSON.stringify({ raw, conferences })
      }
    ],
    { json: true }
  );
  return JSON.parse(content);
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
  $("#notes").value = cleanScribblePayload(raw);
}

function cleanScribblePayload(raw) {
  const cleaned = String(raw || "")
    .replace(/\braw floor scribble\s*:\s*/gi, "")
    .replace(/\bquick note\s*:\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const duplicate = cleaned.match(/^(.+?)\s+\1$/i);
  return duplicate?.[1]?.trim() || cleaned;
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
  showToast(labels[action] || "Context copied.", "success");
}

function copyRelationshipContext(encodedIds) {
  const group = decodeLeadGroup(encodedIds);
  navigator.clipboard?.writeText(buildRelationshipContext(group));
  showToast("Relationship context copied to clipboard.", "success");
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
    `Great speaking again. I was thinking about your ${latest.company} use case around ${(latest.vertical || "FX").toLowerCase()} FX exposure, especially after hearing: "${latest.notes || "the context you shared"}".`,
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
  showToast("LinkedIn search opened. Connection note copied to clipboard.", "info");
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
  const content = await aiChat([
    {
      role: "system",
      content: "You create concise B2B sales enrichment briefs for Grain, an FX risk fintech. Use only the provided lead data and generally known company/domain context; do not invent facts. Return 2 short sentences plus one suggested qualification question."
    },
    {
      role: "user",
      content: JSON.stringify({ lead, domain, relationshipContext: buildRelationshipContext(group) })
    }
  ]);
  return content.trim();
}

function localCompanyBrief(lead, group) {
  const domain = domainFromLead(lead);
  const vertical = (lead.vertical || "FX-exposed").toLowerCase();
  return `${lead.company}${domain ? ` (${domain})` : ""} appears in this relationship as a ${vertical} account with ${group.length} conference touchpoints. Qualify current FX exposure, decision owner, and whether the next conversation should include finance or treasury leadership.`;
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
  $("#addConferenceForm").addEventListener("submit", submitConferenceForm);
  $$("[data-native-multi-actions]").forEach((controls) => {
    const select = document.getElementById(controls.dataset.nativeMultiActions);
    controls.querySelector("[data-native-select-all]")?.addEventListener("click", () => {
      Array.from(select?.options || []).forEach((option) => {
        option.selected = true;
      });
    });
    controls.querySelector("[data-native-clear-all]")?.addEventListener("click", () => {
      Array.from(select?.options || []).forEach((option) => {
        option.selected = false;
      });
    });
  });
  $$("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => closeModals());
  });
  $$(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeModals();
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeRowActionMenus();
      closeModals();
    }
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".row-actions-cell, .lead-actions-cell")) closeRowActionMenus();
  });
}

function renderLeadRegistry() {
  const hub = $("#leadRegistryHub");
  if (!hub) return;
  if (!state.leads.length) {
    leadRegistryExpanded = false;
    hub.classList.add("lead-registry-empty");
    hub.innerHTML = "<div class='empty-state'><strong>No leads captured yet.</strong><span>Use the free-text or audio capture tool above to instantly hydrate your active event pipeline.</span></div>";
    return;
  }
  hub.classList.remove("lead-registry-empty");
  hub.innerHTML = `<button id="leadRegistryToggle" class="lead-registry-toggle" type="button" aria-expanded="${leadRegistryExpanded}" aria-controls="leadRegistryBody">
    <span><strong>Active Lead Registry</strong> <small>(${state.leads.length} ${state.leads.length === 1 ? "Lead" : "Leads"})</small></span>
    <svg class="lead-registry-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5"/></svg>
  </button>
  <div id="leadRegistryBody" class="lead-registry-body ${leadRegistryExpanded ? "expanded" : ""}">
    <div class="lead-registry-body-inner">
      <div class="table-wrap lead-registry-table-wrap">
        <table class="lead-registry-table">
          <thead>
            <tr><th class="actions-header" aria-label="Lead actions"></th><th>Contact Details</th><th>Contact Info</th><th>Company &amp; Segment</th><th>Encounter Source</th><th>Quick Note Context</th></tr>
          </thead>
          <tbody>
            ${[...state.leads].reverse().map(renderLeadRegistryRow).join("")}
          </tbody>
        </table>
      </div>
      <div class="table-actions lead-registry-actions">
        <span class="muted">Review your active pipeline records captured across all live events before exporting to your CRM or CSV.</span>
        <button id="exportCsv" class="ghost-button export-button" type="button">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 20h14"/></svg>
          <span>Export CSV</span>
        </button>
      </div>
    </div>
  </div>`;
  $("#leadRegistryToggle")?.addEventListener("click", () => {
    leadRegistryExpanded = !leadRegistryExpanded;
    const body = $("#leadRegistryBody");
    body?.classList.toggle("expanded", leadRegistryExpanded);
    $("#leadRegistryToggle").setAttribute("aria-expanded", String(leadRegistryExpanded));
  });
  $("#exportCsv")?.addEventListener("click", exportCsv);
  $$("[data-lead-row-menu-toggle]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleRowActionMenu(button);
    });
  });
  $$("[data-edit-lead]").forEach((button) => {
    button.addEventListener("click", () => openEditLeadForm(button.dataset.editLead));
  });
  $$("[data-delete-lead]").forEach((button) => {
    button.addEventListener("click", () => deleteLead(button.dataset.deleteLead));
  });
}

function renderLeadRegistryRow(lead) {
  const conference = state.conferences.find((item) => item.id === lead.conferenceId);
  const vertical = lead.vertical || "Other";
  return `<tr>
    <td class="lead-actions-cell">
      <button class="row-menu-button" type="button" data-lead-row-menu-toggle="${escapeHtml(lead.id)}" data-row-menu-toggle="lead-${escapeHtml(lead.id)}" aria-label="Options for ${escapeHtml(lead.firstName || "lead")}" title="Lead options" aria-haspopup="menu" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
      </button>
      <div class="row-action-menu" role="menu" data-row-menu="lead-${escapeHtml(lead.id)}">
        <button type="button" role="menuitem" data-edit-lead="${escapeHtml(lead.id)}">Edit Lead</button>
        <button class="danger-action" type="button" role="menuitem" data-delete-lead="${escapeHtml(lead.id)}">Delete Lead</button>
      </div>
    </td>
    <td><div class="lead-contact-cell"><strong>${escapeHtml([lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unnamed lead")}</strong><small>${escapeHtml(lead.title || "Title not captured")}</small></div></td>
    <td><div class="lead-contact-info"><a href="mailto:${escapeHtml(lead.email || "")}">${escapeHtml(lead.email || "Email not captured")}</a><a href="tel:${escapeHtml(lead.phone || "")}">${escapeHtml(lead.phone || "Phone not captured")}</a></div></td>
    <td><div class="lead-company-cell"><strong>${escapeHtml(lead.company || "Unknown company")}</strong><span class="vertical-pill ${verticalPillClass(vertical)}">${escapeHtml(vertical)}</span></div></td>
    <td>${escapeHtml(conference?.name || "Unknown event")}</td>
    <td class="lead-note-cell">${escapeHtml(cleanScribblePayload(lead.notes) || "No note captured")}</td>
  </tr>`;
}

function openEditLeadForm(id) {
  const lead = state.leads.find((item) => item.id === id);
  if (!lead) return;
  editingLeadId = id;
  closeRowActionMenus();
  $("#leadConference").value = lead.conferenceId || state.conferences[0]?.id || "";
  $("#firstName").value = lead.firstName || "";
  $("#lastName").value = lead.lastName || "";
  $("#company").value = lead.company || "";
  $("#title").value = lead.title || "";
  $("#email").value = lead.email || "";
  $("#phone").value = lead.phone || "";
  $("#leadVertical").value = lead.vertical || "Other";
  $("#urgency").value = lead.urgency || "Exploring";
  const sentiment = ["Strong", "Medium", "Weak"].includes(lead.sentiment) ? lead.sentiment : "Medium";
  $(`input[name='sentiment'][value='${sentiment}']`).checked = true;
  $("#nextStep").value = lead.nextStep || "";
  $("#notes").value = cleanScribblePayload(lead.notes);
  document.querySelector("#leadForm .capture-actions .primary-button").textContent = "Save changes";
  $("#leadForm").scrollIntoView({ behavior: "smooth", block: "start" });
  setTimeout(() => $("#firstName")?.focus(), 180);
}

function deleteLead(id) {
  const lead = state.leads.find((item) => item.id === id);
  if (!lead) return;
  closeRowActionMenus();
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "this lead";
  if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;
  state.leads = state.leads.filter((item) => item.id !== id);
  if (editingLeadId === id) resetLeadForm();
  saveState();
  renderAll();
  showToast(`${name} deleted.`, "success");
}

function openAddConferenceForm() {
  editingConferenceId = "";
  pendingScoutEventId = "";
  $("#addConferenceForm").reset();
  $("#newConferenceAudience").value = "2500";
  $("#newBuyerDensity").value = "8";
  $("#newPspRelevance").value = "8";
  $("#newFxRelevance").value = "8";
  $("#newTravelRelevance").value = "6";
  $("#newSeniority").value = "8";
  $("#newCostTier").value = "6";
  $("#addConferenceTitle").textContent = "Add Conference";
  $("#conferenceFormDescription").textContent = "Create a new event row with enough context to score, filter, and plan coverage.";
  $("#conferenceFormSubmit").textContent = "Add to table";
  document.querySelector("#addConferenceModal .modal-close")?.setAttribute("aria-label", "Close add conference");
  openModal("#addConferenceModal");
}

function openEditConferenceForm(id) {
  const conference = state.conferences.find((item) => item.id === id);
  if (!conference) return;
  editingConferenceId = id;
  pendingScoutEventId = "";
  closeRowActionMenus();
  populateConferenceForm(conference);
  $("#addConferenceTitle").textContent = "Edit Conference";
  $("#conferenceFormDescription").textContent = "Update this event's directory, scoring, and coverage details.";
  $("#conferenceFormSubmit").textContent = "Save changes";
  document.querySelector("#addConferenceModal .modal-close")?.setAttribute("aria-label", "Close edit conference");
  openModal("#addConferenceModal");
}

function populateConferenceForm(conference) {
  $("#newConferenceName").value = conference.name || "";
  $("#newConferenceStatus").value = conference.status || "Considering";
  $("#newConferenceStart").value = conference.startDate || "";
  $("#newConferenceEnd").value = conference.endDate || conference.startDate || "";
  $("#newConferenceCity").value = conference.city || "";
  $("#newConferenceCountry").value = conference.country || "";
  $("#newConferenceRegion").value = conference.region || "Europe";
  $("#newConferenceVerticals").value = Array.isArray(conference.verticals) ? conference.verticals.join(", ") : "";
  $("#newConferenceAudience").value = String(Number(conference.audience) || 100);
  $("#newConferenceSource").value = conference.source || "";
  $("#newBuyerDensity").value = String(Number(conference.buyerDensity) || 3);
  $("#newPspRelevance").value = String(Number(conference.pspRelevance) || 3);
  $("#newFxRelevance").value = String(Number(conference.fxRelevance) || 3);
  $("#newTravelRelevance").value = String(Number(conference.travelRelevance) || 3);
  $("#newSeniority").value = String(Number(conference.seniority) || 3);
  $("#newCostTier").value = String(Number(conference.costTier) || 3);
  Array.from($("#newConferenceTeam").options).forEach((option) => {
    option.selected = Array.isArray(conference.team) && conference.team.includes(option.value);
  });
}

function submitConferenceForm(event) {
  event.preventDefault();
  const startDate = $("#newConferenceStart").value;
  const endDate = $("#newConferenceEnd").value || startDate;
  const existingConference = editingConferenceId
    ? state.conferences.find((conference) => conference.id === editingConferenceId)
    : null;
  const conference = {
    ...(existingConference || {}),
    id: existingConference?.id || createConferenceId($("#newConferenceName").value),
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
  if (existingConference) {
    Object.assign(existingConference, conference);
  } else {
    state.conferences.push(conference);
  }
  if (pendingScoutEventId) {
    scoutState.results = scoutState.results.filter((item) => item.event.id !== pendingScoutEventId);
    if (scoutState.gap) scoutState.resolvedGapKey = "__all__";
    visibleGapSegments = allVerticals();
    $("#scoutStatus").textContent = `${conference.name} added to the active directory.`;
  }
  selectedConferenceId = conference.id;
  saveState();
  filterState = { vertical: [], region: [], status: [] };
  opportunityFilter = null;
  closeModals();
  renderFilters();
  renderAll();
  showToast(existingConference ? `${conference.name} updated.` : `${conference.name} added.`, "success");
  if (!existingConference) openConferenceDetail(conference.id);
  editingConferenceId = "";
  pendingScoutEventId = "";
}

function boundedScore(selector) {
  return Math.max(1, Math.min(10, Number($(selector).value) || 6));
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
  $("#aiProvider").value = state.ai.provider || DEFAULT_AI_PROVIDER;
  $("#aiKey").value = state.ai.key || "";
  const savedModels = state.ai.key && state.ai.model ? [state.ai.model] : [];
  populateAiModelSelect(savedModels, state.ai.model);
  updateAiProviderFields();
  $("#hubspotToken").value = state.hubspot.token || "";
  renderSettingsStatus();
  renderWeightControls();
  $("#aiProvider").addEventListener("change", () => {
    const provider = $("#aiProvider").value;
    const providerChanged = provider !== state.ai.provider;
    $("#aiKey").value = providerChanged ? "" : state.ai.key || "";
    clearAiModelSelect();
    $("#aiModelError").textContent = "";
    updateAiProviderFields();
    renderSettingsStatus();
  });
  $("#saveAi").addEventListener("click", saveKeyAndLoadModels);
  $("#aiModel").addEventListener("change", (event) => {
    if (!event.currentTarget.value) return;
    state.ai.model = event.currentTarget.value;
    saveState();
    showToast(`AI model set to ${state.ai.model}.`, "success");
  });
  $("#saveHubspot").addEventListener("click", () => {
    state.hubspot.token = $("#hubspotToken").value.trim();
    saveState();
    renderSettingsStatus();
    showToast("HubSpot settings saved in this browser.", "success");
  });
  $("#saveWeights").addEventListener("click", saveScoringWeights);
  $("#pushHubspot").addEventListener("click", pushHubspot);
}

async function saveKeyAndLoadModels() {
  const provider = $("#aiProvider").value;
  const key = $("#aiKey").value.trim();
  const button = $("#saveAi");
  const error = $("#aiModelError");
  error.textContent = "";
  if (!key) {
    clearAiModelSelect();
    error.textContent = "Could not fetch models. Please check your API key.";
    return;
  }
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Loading models...";
  try {
    const response = await fetchProviderModels(provider, key);
    if (!response.ok) throw new Error("Model request failed");
    const payload = await response.json();
    const modelIds = [...new Set(parseProviderModelIds(provider, payload))]
      .sort((a, b) => a.localeCompare(b));
    if (!modelIds.length) throw new Error("No models returned");
    const previousModel = state.ai.provider === provider ? state.ai.model : "";
    const selectedModel = modelIds.includes(previousModel)
      ? previousModel
      : preferredProviderModel(provider, modelIds);
    state.ai = { provider, key, model: selectedModel };
    saveState();
    populateAiModelSelect(modelIds, selectedModel);
    renderSettingsStatus();
    showToast(`${AI_PROVIDER_CONFIG[provider].label} key validated. Models loaded.`, "success");
  } catch (fetchError) {
    state.ai = { provider, key: "", model: "" };
    saveState();
    clearAiModelSelect();
    error.textContent = "Could not fetch models. Please check your API key.";
    renderSettingsStatus();
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

function fetchProviderModels(provider, key) {
  const config = AI_PROVIDER_CONFIG[provider];
  if (provider === "gemini") {
    return fetch(`${config.modelsUrl}?key=${encodeURIComponent(key)}`, { method: "GET" });
  }
  if (provider === "anthropic") {
    return fetch(config.modelsUrl, {
      method: "GET",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      }
    });
  }
  return fetch(config.modelsUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` }
  });
}

function parseProviderModelIds(provider, payload) {
  if (provider === "gemini") {
    return (Array.isArray(payload.models) ? payload.models : [])
      .filter((model) => !Array.isArray(model.supportedGenerationMethods) || model.supportedGenerationMethods.includes("generateContent"))
      .map((model) => String(model?.name || "").replace(/^models\//, "").trim())
      .filter(Boolean);
  }
  return (Array.isArray(payload.data) ? payload.data : [])
    .map((model) => String(model?.id || "").trim())
    .filter(Boolean);
}

function preferredProviderModel(provider, modelIds) {
  const preferences = {
    openai: ["gpt-4o-mini", "gpt-4.1-mini"],
    gemini: ["gemini-2.5-flash", "gemini-2.0-flash"],
    anthropic: ["claude-sonnet-4-20250514", "claude-3-5-sonnet-latest"]
  };
  return preferences[provider]?.find((model) => modelIds.includes(model)) || modelIds[0];
}

function populateAiModelSelect(modelIds, selectedModel = "") {
  const select = $("#aiModel");
  if (!select) return;
  const models = Array.isArray(modelIds) ? modelIds.filter(Boolean) : [];
  select.innerHTML = models.length
    ? models.map((id) => `<option value="${escapeHtml(id)}" ${id === selectedModel ? "selected" : ""}>${escapeHtml(id)}</option>`).join("")
    : '<option value="">Load models after saving a valid key</option>';
  select.disabled = !models.length;
  $("#aiModelField").hidden = !models.length;
}

function clearAiModelSelect() {
  populateAiModelSelect([], "");
}

function updateAiProviderFields() {
  const provider = $("#aiProvider")?.value || DEFAULT_AI_PROVIDER;
  const label = AI_PROVIDER_CONFIG[provider]?.label || AI_PROVIDER_CONFIG[DEFAULT_AI_PROVIDER].label;
  if ($("#aiKeyLabel")) $("#aiKeyLabel").textContent = `${label} API Key`;
}

function renderSettingsStatus() {
  const selectedProvider = $("#aiProvider")?.value || state.ai.provider || DEFAULT_AI_PROVIDER;
  const hasAiKey = selectedProvider === state.ai.provider && Boolean((state.ai.key || "").trim());
  const hasHubspotToken = Boolean(($("#hubspotToken")?.value || state.hubspot.token || "").trim());
  const aiBadge = $("#aiStatusBadge");
  const hubspotBadge = $("#hubspotStatusBadge");
  if (aiBadge) {
    aiBadge.textContent = hasAiKey ? `${AI_PROVIDER_CONFIG[state.ai.provider].label} Active` : "Local Heuristics";
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
  const groups = [
    {
      title: "1. Core Target Qualifiers (Deal Breakers)",
      className: "weight-group-core",
      keys: ["industryFit", "fxExposurePain", "decisionMakerSeniority"]
    },
    {
      title: "2. Operational Modifiers (Logistical Optimizers)",
      className: "weight-group-operational",
      keys: ["travelBudgetRoi", "audienceScale"]
    }
  ];
  $("#scoreProfilePresets").innerHTML = Object.entries(SCORE_PROFILE_PRESETS)
    .map(([key, preset]) => `<button class="score-profile-button" type="button" data-score-profile="${key}"><span aria-hidden="true">${preset.icon}</span>${escapeHtml(preset.label)}</button>`)
    .join("");
  $("#weightControls").innerHTML = groups.map((group) => `<section class="weight-group ${group.className}">
    <h4>${escapeHtml(group.title)}</h4>
    <div class="weight-group-controls">
      ${group.keys.map((key) => `<label class="weight-control">
        <span>${escapeHtml(SCORE_WEIGHT_LABELS[key])}</span>
        <input type="range" min="0" max="100" step="1" value="${weights[key]}" data-score-weight="${key}" aria-label="${escapeHtml(SCORE_WEIGHT_LABELS[key])} weight">
        <input type="number" min="0" max="100" step="1" value="${weights[key]}" data-score-weight-number="${key}" aria-label="${escapeHtml(SCORE_WEIGHT_LABELS[key])} percentage">
        <strong data-score-share="${key}">0% share</strong>
      </label>`).join("")}
    </div>
  </section>`).join("");
  $$("[data-score-profile]").forEach((button) => {
    button.addEventListener("click", () => applyScoreProfile(button.dataset.scoreProfile));
  });
  $$("[data-score-weight]").forEach((range) => {
    range.addEventListener("input", () => syncWeightInput(range.dataset.scoreWeight, range.value));
  });
  $$("[data-score-weight-number]").forEach((input) => {
    input.addEventListener("input", () => syncWeightInput(input.dataset.scoreWeightNumber, input.value));
  });
  updateRelativeWeightShares();
  updateActiveScoreProfile();
}

function syncWeightInput(key, value) {
  const cleanValue = clampWeight(value);
  const range = $(`[data-score-weight="${key}"]`);
  const number = $(`[data-score-weight-number="${key}"]`);
  if (range) range.value = cleanValue;
  if (number) number.value = cleanValue;
  updateRelativeWeightShares();
  updateActiveScoreProfile();
}

function applyScoreProfile(profileKey) {
  const preset = SCORE_PROFILE_PRESETS[profileKey];
  if (!preset) return;
  Object.entries(preset.weights).forEach(([key, value]) => {
    const range = $(`[data-score-weight="${key}"]`);
    const number = $(`[data-score-weight-number="${key}"]`);
    if (range) range.value = value;
    if (number) number.value = value;
  });
  updateRelativeWeightShares();
  updateActiveScoreProfile(profileKey);
}

function updateRelativeWeightShares() {
  const values = Object.keys(DEFAULT_SCORE_WEIGHTS).map((key) => [
    key,
    clampWeight($(`[data-score-weight-number="${key}"]`)?.value)
  ]);
  const total = values.reduce((sum, [, value]) => sum + value, 0);
  values.forEach(([key, value]) => {
    const badge = $(`[data-score-share="${key}"]`);
    if (badge) badge.textContent = `${total ? ((value / total) * 100).toFixed(1) : "0.0"}% share`;
  });
}

function updateActiveScoreProfile(forcedKey = "") {
  const current = Object.fromEntries(
    Object.keys(DEFAULT_SCORE_WEIGHTS).map((key) => [
      key,
      clampWeight($(`[data-score-weight-number="${key}"]`)?.value)
    ])
  );
  $$("[data-score-profile]").forEach((button) => {
    const preset = SCORE_PROFILE_PRESETS[button.dataset.scoreProfile];
    const active = button.dataset.scoreProfile === forcedKey ||
      (!forcedKey && Object.entries(preset.weights).every(([key, value]) => current[key] === value));
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
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
  showToast("Scoring weights saved. ICP rankings refreshed.", "success");
}

function renderAll() {
  renderConferenceRows();
  renderScoutWorkspace();
  renderPlanning();
  renderLeadRegistry();
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
  $("#seedReset").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });
  renderAll();
}

setup();
