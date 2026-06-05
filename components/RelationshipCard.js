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
      ${mutation ? `<span class="mutation-badge">AI Mutation Detected: ${escapeHtml(mutation)}</span>` : ""}
      <p>${escapeHtml(lead.notes || "No floor notes captured.")}</p>
    </div>
  </div>`;
}

function relationshipMutationText(previousLead, lead) {
  if (!previousLead) return "";
  if (previousLead.company && lead.company && normalize(previousLead.company) !== normalize(lead.company)) {
    return `Company changed from ${previousLead.company} to ${lead.company} since last encounter.`;
  }
  if (previousLead.title && lead.title && normalize(previousLead.title) !== normalize(lead.title)) {
    return `${titleMutationVerb(previousLead.title, lead.title)} from ${previousLead.title} to ${lead.title} since last encounter.`;
  }
  return "";
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

function relationshipSignal(group) {
  const explicitFollowUp = group.some((lead) => /book|demo|intro|call|meeting|cfo|treasury lead|solutions engineering/i.test(`${lead.nextStep || ""} ${lead.notes || ""}`));
  const buyingIndicators = group.some((lead) => /budget|asked|wants|vendor shortlist|benchmark|treasury|hedging|slippage|exposure|demo/i.test(`${lead.notes || ""} ${lead.nextStep || ""}`));
  const highTierIcp = group.some((lead) => ["Payments", "Travel", "Banking"].includes(lead.vertical) && lead.sentiment === "Strong");
  const withinSixMonths = group.length > 1 && (new Date(group[group.length - 1].createdAt) - new Date(group[0].createdAt)) / 86400000 <= 183;
  if (group.length > 1 && highTierIcp && explicitFollowUp) {
    return { tone: "champion", label: "High-Velocity Champion" };
  }
  if (group.length > 1 && withinSixMonths && buyingIndicators) {
    return { tone: "warming", label: "Warming Opportunity" };
  }
  return { tone: "latent", label: "Latent / Low Touch" };
}

function formatLeadDate(value) {
  return new Date(value || Date.now()).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
