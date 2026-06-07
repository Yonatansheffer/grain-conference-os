function renderScoutResultCard(result) {
  const event = result.event;
  const score = scoreConference(event);
  const tier = tierFor(score);
  const duplicate = result.duplicate;
  const eventTitle = `<a class="scout-title-link" href="${escapeHtml(event.source)}" target="_blank" rel="noreferrer">${escapeHtml(event.name)}</a>`;
  const verificationBadge = event.verificationStatus === "Tentative"
    ? '<span class="status-badge scout-status-tentative">Tentative dates</span>'
    : event.verificationStatus === "Directory"
      ? '<span class="status-badge status-muted">Directory opportunity</span>'
      : '<span class="status-badge status-active">Verified dates</span>';
  return `<div class="scout-card ${duplicate ? "scout-card-duplicate" : ""}">
    <div class="scout-card-head">
      <div>
        <div class="scout-title-row">${eventTitle}${verificationBadge}</div>
        <span>${escapeHtml(formatDateRange(event))} | ${escapeHtml(event.city)}, ${escapeHtml(event.country)}</span>
      </div>
      <span class="tier-flag tier-${tier.toLowerCase()}">Tier ${tier} - Score: ${score}</span>
    </div>
    <div class="scout-meta-grid">
      <span>${escapeHtml(event.region)}</span>
      <span>${Number(event.audience || 0).toLocaleString()} attendees</span>
      <span>${escapeHtml((event.verticals || []).join(", "))}</span>
    </div>
    <p class="scout-hook">${escapeHtml(result.pitchHook)}</p>
    ${result.piggyback ? `<span class="piggyback-badge">Trip Piggyback Opportunity: ${escapeHtml(result.piggyback)}</span>` : ""}
    ${event.tentative ? '<p class="muted">The event is recurring and its live site is active, but the displayed dates are estimated from its historical annual schedule.</p>' : ""}
    ${result.existingOpportunity
      ? `<button class="ghost-button" type="button" data-open-scout-conference="${escapeHtml(event.id)}">Review Directory Event</button>`
      : duplicate
        ? `<p class="muted">Semantic match found: ${escapeHtml(duplicate.name)}. Directory insertion is blocked to prevent duplication.</p>`
        : `<button class="primary-button" type="button" data-add-scout-event="${escapeHtml(event.id)}">Add to Active Directory</button>`}
  </div>`;
}
