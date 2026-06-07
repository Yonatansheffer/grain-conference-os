const GENERIC_SCOUT_QUERIES = new Set([
  "any event",
  "any events",
  "all events",
  "show all",
  "show all events",
  "show events",
  "events",
  "event",
  "conferences",
  "conference",
  "any conferences",
  "all conferences"
]);

const GLOBAL_DISCOVERY_PROMPT = "High-ICP B2B Fintech, Payments, and Banking conferences worldwide scheduled for the remaining months of 2026";

const SCOUT_PARAMETER_PATTERN = /\b(2026|2027|q[1-4]|january|february|march|april|may|june|july|august|september|october|november|december|first half|second half|europe|north america|apac|asia|middle east|latam|payments?|fintech|treasury|travel|wholesale|airline|banking|saas|cfo|finance)\b/i;

function classifyScoutQuery(value, now = new Date()) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ");
  const generic = !normalized || GENERIC_SCOUT_QUERIES.has(normalized) || !SCOUT_PARAMETER_PATTERN.test(normalized);
  return generic
    ? {
        mode: "global",
        prompt: GLOBAL_DISCOVERY_PROMPT,
        dateRange: remainingScoutYearRange(now)
      }
    : {
        mode: "parameterized",
        prompt: String(value || "").trim(),
        dateRange: parseScoutDateRange(value)
      };
}

function remainingScoutYearRange(now = new Date()) {
  const supportedYear = [2026, 2027].includes(now.getFullYear()) ? now.getFullYear() : 2026;
  const today = new Date(supportedYear, supportedYear === now.getFullYear() ? now.getMonth() : 0, supportedYear === now.getFullYear() ? now.getDate() : 1);
  return {
    startDate: toLocalIsoDate(today),
    endDate: `${supportedYear}-12-31`,
    source: "global-discovery"
  };
}

function parseScoutEventPayload(content) {
  if (Array.isArray(content)) return content;
  const raw = String(content || "").trim();
  if (!raw) return [];
  const unfenced = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(unfenced);
  if (Array.isArray(parsed)) return parsed;
  return Array.isArray(parsed?.events) ? parsed.events : [];
}

function preferExternalScoutResults(verifiedResults, fallbackResults, scoreEvent, minimumScore = 68, limit = 8) {
  const external = (Array.isArray(verifiedResults) ? verifiedResults : [])
    .filter((result) => !result.duplicate && Number(scoreEvent(result.event)) >= minimumScore)
    .sort((a, b) => Number(scoreEvent(b.event)) - Number(scoreEvent(a.event)))
    .slice(0, limit);
  return external.length
    ? external
    : (Array.isArray(fallbackResults) ? fallbackResults : []).slice(0, limit);
}
