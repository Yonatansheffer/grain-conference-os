function renderRelationshipCard(group) {
  const latest = group[group.length - 1];
  const conferences = group.map((lead) => state.conferences.find((conference) => conference.id === lead.conferenceId)?.name || "Unknown");
  const encodedId = encodeURIComponent(group.map((lead) => lead.id).join(","));
  return `<div class="relationship">
    <div>
      <div class="relationship-title">
        <strong>${escapeHtml(latest.firstName)} ${escapeHtml(latest.lastName)} at ${escapeHtml(latest.company)}</strong>
        <button class="copy-context-button" type="button" title="Copy relationship context" aria-label="Copy relationship context" data-copy-context="${encodedId}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h10v12H8z"/><path d="M6 16H4V4h12v2"/></svg>
        </button>
      </div>
      <p class="relationship-summary">${escapeHtml(relationshipVerdict(group))}</p>
      <p class="muted">${group.length} encounters: ${escapeHtml(conferences.join(" -> "))}</p>
      <p class="muted">${escapeHtml(group.map((lead) => `${lead.title || "Unknown title"}: ${lead.notes}`).join(" "))}</p>
      <div class="lead-enrichment" aria-live="polite"></div>
    </div>
    <div class="actions">
      <span class="pill ${latest.sentiment === "Strong" ? "tier-a" : "tier-b"}">${escapeHtml(latest.sentiment)}</span>
      <div class="next-steps">
        <span class="muted">Next steps</span>
        ${relationshipNextSteps(group).map((step) => `<button class="ghost-button action-${step.action}" type="button" data-next-step="${step.action}" data-group="${encodedId}">${escapeHtml(step.label)}</button>`).join("")}
      </div>
    </div>
  </div>`;
}
