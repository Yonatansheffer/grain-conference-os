const SEGMENT_COVERAGE_THRESHOLDS = Object.freeze({
  good: 60,
  medium: 30
});

function calculateSegmentCoverage(events, options = {}) {
  const segmentEvents = Array.isArray(events) ? events : [];
  const scoreEvent = typeof options.scoreEvent === "function" ? options.scoreEvent : () => Number.NaN;
  const isCommitted = typeof options.isCommitted === "function" ? options.isCommitted : () => false;
  const committedEvents = segmentEvents.filter(isCommitted);
  const scoredEvents = segmentEvents
    .map((event) => ({ event, score: Number(scoreEvent(event)) }))
    .filter(({ score }) => Number.isFinite(score) && score > 0);
  const totalScore = scoredEvents.reduce((sum, item) => sum + item.score, 0);
  const committedScore = scoredEvents
    .filter(({ event }) => isCommitted(event))
    .reduce((sum, item) => sum + item.score, 0);
  const hasCompleteScoreData = segmentEvents.length > 0 && scoredEvents.length === segmentEvents.length && totalScore > 0;
  const rawRatio = hasCompleteScoreData
    ? committedScore / totalScore
    : (segmentEvents.length ? committedEvents.length / segmentEvents.length : 0);
  const percentage = Math.max(0, Math.min(100, Math.round(rawRatio * 100)));

  return {
    percentage,
    method: hasCompleteScoreData ? "score" : "count",
    committedEvents,
    uncommittedEvents: segmentEvents.filter((event) => !isCommitted(event)),
    committedScore,
    totalScore,
    tier: segmentCoverageTier(percentage)
  };
}

function segmentCoverageTier(percentage) {
  if (percentage >= SEGMENT_COVERAGE_THRESHOLDS.good) {
    return {
      key: "good",
      tone: "healthy",
      label: "Good Coverage",
      investment: "High Investment"
    };
  }
  if (percentage >= SEGMENT_COVERAGE_THRESHOLDS.medium) {
    return {
      key: "medium",
      tone: "warning",
      label: "Medium Coverage",
      investment: "Moderate Investment"
    };
  }
  return {
    key: "low",
    tone: "danger",
    label: "Low Coverage",
    investment: "Under-Invested Segment"
  };
}
