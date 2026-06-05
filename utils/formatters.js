function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function formatCalendarDate(date) {
  return date.toISOString().replace(/[-:]|\.\d{3}/g, "");
}

function normalize(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
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

function titleCase(text) {
  return String(text || "").replace(/\w\S*/g, (word) => {
    if (/^(VP|CFO|CEO|CTO|COO|PSP|FX)$/i.test(word)) return word.toUpperCase();
    if (/^saas$/i.test(word)) return "SaaS";
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

function extractAfter(text, regex) {
  const match = text.match(regex);
  return match?.[1]?.trim().replace(/\s+/g, " ") || "";
}

function teamLabel(conference) {
  return Array.isArray(conference?.team) && conference.team.length ? conference.team.join(", ") : "Unassigned";
}

function domainFromLead(lead) {
  return lead.email?.split("@")[1]?.toLowerCase() || "";
}
