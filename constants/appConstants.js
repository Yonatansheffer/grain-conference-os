const STORAGE_KEY = "grain-conference-os";
const DEFAULT_AI_PROVIDER = "openai";
const AI_PROVIDER_CONFIG = {
  openai: {
    label: "OpenAI",
    modelsUrl: "https://api.openai.com/v1/models",
    messagesUrl: "https://api.openai.com/v1/chat/completions"
  },
  gemini: {
    label: "Google Gemini",
    modelsUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    messagesUrl: "https://generativelanguage.googleapis.com/v1beta/models"
  },
  anthropic: {
    label: "Anthropic Claude",
    modelsUrl: "https://api.anthropic.com/v1/models",
    messagesUrl: "https://api.anthropic.com/v1/messages"
  }
};
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
const SCORE_PROFILE_PRESETS = {
  enterprise: {
    icon: "&#127919;",
    label: "Hyper-Targeted Enterprise Mode",
    weights: {
      industryFit: 100,
      fxExposurePain: 95,
      decisionMakerSeniority: 85,
      audienceScale: 20,
      travelBudgetRoi: 10
    }
  },
  travelLean: {
    icon: "&#128737;",
    label: "High-ROI / Travel Lean Mode",
    weights: {
      industryFit: 90,
      fxExposurePain: 80,
      decisionMakerSeniority: 70,
      audienceScale: 30,
      travelBudgetRoi: 85
    }
  },
  footprint: {
    icon: "&#128640;",
    label: "Aggressive Footprint Mode",
    weights: {
      industryFit: 80,
      fxExposurePain: 75,
      decisionMakerSeniority: 60,
      audienceScale: 80,
      travelBudgetRoi: 40
    }
  }
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
