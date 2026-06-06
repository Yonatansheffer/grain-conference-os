const STORAGE_KEY = "grain-conference-os";
const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
const SIDEBAR_KEY = "grain-conference-sidebar";
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 380;
const STATUS_OPTIONS = ["Committed", "Considering", "Watchlist"];
const TEAM_OPTIONS = ["Maya", "Noah", "Lior", "Dana", "Alex"];
const DEFAULT_SCORE_WEIGHTS = {
  industryFit: 80,
  fxExposurePain: 85,
  decisionMakerSeniority: 75,
  audienceScale: 55,
  travelBudgetRoi: 60
};
const SCORE_WEIGHT_LABELS = {
  industryFit: "ICP Industry Fit",
  fxExposurePain: "FX Exposure Pain",
  decisionMakerSeniority: "Decision-Maker Seniority",
  audienceScale: "Audience Scale",
  travelBudgetRoi: "Travel & Budget ROI"
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
