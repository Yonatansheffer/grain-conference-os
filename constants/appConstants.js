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
