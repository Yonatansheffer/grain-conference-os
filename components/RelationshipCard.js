function renderRelationshipCard(group) {
  const orderedGroup = [...group].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const latest = orderedGroup[orderedGroup.length - 1];
  const encodedId = encodeURIComponent(orderedGroup.map((lead) => lead.id).join(","));
  const signal = relationshipSignal(orderedGroup);
  return `<div class="relationship">
    <div>
      <div class="relationship-title">
        <div>
          <strong>${escapeHtml(latest.firstName)} ${escapeHtml(latest.lastName)} at ${escapeHtml(latest.company)}</strong>
          <p class="relationship-summary">${escapeHtml(relationshipVerdict(orderedGroup))}</p>
        </div>
        <button class="copy-context-button" type="button" title="Copy relationship context" aria-label="Copy relationship context" data-copy-context="${encodedId}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h10v12H8z"/><path d="M6 16H4V4h12v2"/></svg>
        </button>
      </div>
      <div class="relationship-timeline">
        ${orderedGroup.map((lead, index) => renderRelationshipTimelineStep(lead, orderedGroup[index - 1])).join("")}
      </div>
      <div class="relationship-summary-control">
        <button class="ghost-button arc-summary-button" type="button" data-arc-summary="${encodedId}" aria-expanded="false">Generate AI summary</button>
        <div class="relationship-ai-summary" data-summary-slot="${encodedId}" aria-live="polite"></div>
      </div>
      <div class="lead-enrichment" aria-live="polite"></div>
    </div>
    <div class="actions">
      <span class="relationship-signal signal-${signal.tone}">${escapeHtml(signal.label)}</span>
      <div class="next-steps">
        <span class="muted">Next steps</span>
        ${relationshipNextSteps(orderedGroup).map((step) => `<button class="ghost-button action-${step.action}" type="button" data-next-step="${step.action}" data-group="${encodedId}">${escapeHtml(step.label)}</button>`).join("")}
      </div>
    </div>
  </div>`;
}

function renderRelationshipTimelineStep(lead, previousLead) {
  const conference = state.conferences.find((item) => item.id === lead.conferenceId);
  const mutation = relationshipMutationText(previousLead, lead);
  return `<div class="timeline-step">
    <div class="timeline-date">${escapeHtml(formatLeadDate(lead.createdAt))}</div>
    <div class="timeline-body">
      <div class="timeline-head">
        <strong>${escapeHtml(conference?.name || "Unknown conference")}</strong>
        <span>${escapeHtml(lead.title || "Unknown title")} | ${escapeHtml(lead.company || "Unknown company")}</span>
      </div>
      ${mutation ? `<span class="mutation-badge">Change detected: ${escapeHtml(mutation)}</span>` : ""}
      <p>${escapeHtml(lead.notes || "No floor notes captured.")}</p>
    </div>
  </div>`;
}

// Surfaces the job-change signals across consecutive encounters. A new work-email
// domain is the strongest "they switched employers" tell, so it is called out
// explicitly rather than left to fuzzy name matching.
function relationshipMutationText(previousLead, lead) {
  if (!previousLead) return "";
  const changes = [];
  if (previousLead.company && lead.company && normalize(previousLead.company) !== normalize(lead.company)) {
    changes.push(`Company ${previousLead.company} -> ${lead.company}`);
  }
  const previousDomain = domainFromLead(previousLead);
  const currentDomain = domainFromLead(lead);
  if (previousDomain && currentDomain && previousDomain !== currentDomain) {
    changes.push(`New work email (${previousDomain} -> ${currentDomain}), likely changed employer`);
  }
  if (previousLead.title && lead.title && normalize(previousLead.title) !== normalize(lead.title)) {
    changes.push(`${titleMutationVerb(previousLead.title, lead.title)} ${previousLead.title} -> ${lead.title}`);
  }
  return changes.join(" | ");
}

function titleMutationVerb(previousTitle, currentTitle) {
  const seniorityRank = (title) => {
    if (/chief|cfo|treasurer|head|vp|vice president/i.test(title)) return 3;
    if (/director/i.test(title)) return 2;
    if (/manager|lead/i.test(title)) return 1;
    return 0;
  };
  return seniorityRank(currentTitle) > seniorityRank(previousTitle) ? "Promoted" : "Changed";
}

// The badge reflects the relationship trajectory (see analyzeRelationship), so a
// flat repeat contact reads as a tire-kicker risk while a rising one reads as
// warming, rather than every repeat looking the same.
function relationshipSignal(group) {
  const { stage } = analyzeRelationship(group);
  switch (stage) {
    case "champion":
    case "warming":
      return { tone: "strong", label: "Strong" };
    case "cooling":
      return { tone: "weak", label: "Weak" };
    case "stalled":
    default:
      return { tone: "medium", label: "Medium" };
  }
}

function formatLeadDate(value) {
  return new Date(value || Date.now()).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
