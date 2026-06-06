const SCOUT_MONTHS = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11
};

const SCOUT_MONTH_PATTERN = Object.keys(SCOUT_MONTHS).join("|");

function parseScoutDateRange(prompt, fallbackYear = 2026) {
  const text = String(prompt || "").toLowerCase().replace(/[–—]/g, "-");
  const explicitYear = Number(text.match(/\b(2026|2027)\b/)?.[1]) || fallbackYear;
  const quarterSpan = text.match(/\bq([1-4])\s*(?:-|through|to)\s*q([1-4])(?:\s+(2026|2027))?\b/i);
  if (quarterSpan) {
    return quarterBoundaryRange(Number(quarterSpan[1]), Number(quarterSpan[2]), Number(quarterSpan[3]) || explicitYear, "quarter-span");
  }

  const half = text.match(/\b(first|second|1st|2nd)\s+half(?:\s+of\s+(?:the\s+)?year)?(?:\s+(2026|2027))?\b/i);
  if (half) {
    const year = Number(half[2]) || explicitYear;
    const secondHalf = /second|2nd/i.test(half[1]);
    return monthBoundaryRange(secondHalf ? 6 : 0, secondHalf ? 11 : 5, year, "half-year");
  }

  const monthSpan = text.match(new RegExp(`\\b(${SCOUT_MONTH_PATTERN})\\s*(?:-|through|thru|to|until|and)\\s*(${SCOUT_MONTH_PATTERN})(?:\\s+(2026|2027))?\\b`, "i"));
  if (monthSpan) {
    return monthBoundaryRange(
      SCOUT_MONTHS[monthSpan[1].toLowerCase()],
      SCOUT_MONTHS[monthSpan[2].toLowerCase()],
      Number(monthSpan[3]) || explicitYear,
      "month-span"
    );
  }

  const singleQuarter = text.match(/\bq([1-4])(?:\s+(2026|2027))?\b/i);
  if (singleQuarter) {
    const quarter = Number(singleQuarter[1]);
    return quarterBoundaryRange(quarter, quarter, Number(singleQuarter[2]) || explicitYear, "quarter");
  }

  const singleMonth = text.match(new RegExp(`\\b(${SCOUT_MONTH_PATTERN})(?:\\s+(2026|2027))?\\b`, "i"));
  if (singleMonth) {
    const month = SCOUT_MONTHS[singleMonth[1].toLowerCase()];
    return monthBoundaryRange(month, month, Number(singleMonth[2]) || explicitYear, "month");
  }

  return {
    startDate: `${fallbackYear}-01-01`,
    endDate: `${fallbackYear + 1}-12-31`,
    source: "default-window"
  };
}

function quarterBoundaryRange(startQuarter, endQuarter, year, source) {
  const normalizedEnd = Math.max(startQuarter, endQuarter);
  return monthBoundaryRange((startQuarter - 1) * 3, normalizedEnd * 3 - 1, year, source);
}

function monthBoundaryRange(startMonth, endMonth, year, source) {
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, endMonth + 1, 0);
  return {
    startDate: toLocalIsoDate(start),
    endDate: toLocalIsoDate(end),
    source
  };
}

function toLocalIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function scoutDateWithinRange(event, range) {
  return event.startDate >= range.startDate && event.endDate <= range.endDate;
}

function normalizeScoutEventDates(event, queryRange) {
  const rawStart = parseIsoDate(event?.startDate);
  const rawEnd = parseIsoDate(event?.endDate) || rawStart;
  const exactDatesValid = rawStart && rawEnd && isScoutCalendarYear(rawStart.getFullYear()) && isScoutCalendarYear(rawEnd.getFullYear());
  if (exactDatesValid) {
    return {
      startDate: toLocalIsoDate(rawStart),
      endDate: toLocalIsoDate(rawEnd < rawStart ? rawStart : rawEnd),
      tentative: event.dateConfirmed === false || event.tentative === true
    };
  }

  const historicalStart = rawStart || parseHistoricalMonth(event?.historicalMonth, queryRange.startDate);
  const canEstimate = event?.recurringAnnual || event?.dateConfirmed === false || event?.tentative === true;
  if (!historicalStart && !canEstimate) return null;
  const targetYear = Number(queryRange.startDate.slice(0, 4));
  const targetMonth = historicalStart?.getMonth() ?? Number(queryRange.startDate.slice(5, 7)) - 1;
  const targetDay = Math.min(historicalStart?.getDate() || 1, new Date(targetYear, targetMonth + 1, 0).getDate());
  const duration = rawStart && rawEnd ? Math.max(0, Math.round((rawEnd - rawStart) / 86400000)) : 2;
  const estimatedStart = new Date(targetYear, targetMonth, targetDay);
  const estimatedEnd = new Date(estimatedStart);
  estimatedEnd.setDate(estimatedEnd.getDate() + duration);
  return {
    startDate: toLocalIsoDate(estimatedStart),
    endDate: toLocalIsoDate(estimatedEnd),
    tentative: true
  };
}

function parseHistoricalMonth(value, fallbackDate) {
  const month = SCOUT_MONTHS[String(value || "").toLowerCase()];
  if (!Number.isInteger(month)) return null;
  return new Date(Number(fallbackDate.slice(0, 4)), month, 1);
}

function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isScoutCalendarYear(year) {
  return year === 2026 || year === 2027;
}
