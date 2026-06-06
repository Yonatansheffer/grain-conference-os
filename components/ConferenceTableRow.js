function renderConferenceRow(conference, score, tier) {
  const conferenceName = conference.source
    ? `<a class="conference-source-link" href="${escapeHtml(conference.source)}" target="_blank" rel="noreferrer" data-row-action>${escapeHtml(conference.name)}</a>`
    : `<strong>${escapeHtml(conference.name)}</strong>`;
  const rationale = scoreNarrative(conference);
  return `<tr data-id="${conference.id}">
    <td>${conferenceName}</td>
    <td>${escapeHtml(formatDateRange(conference))}</td>
    <td><strong>${escapeHtml(conference.region)}</strong><br><span class="muted">${escapeHtml(conference.city)}, ${escapeHtml(conference.country)}</span></td>
    <td><div class="vertical-pill-group">${conference.verticals.map((vertical) => `<span class="vertical-pill ${verticalPillClass(vertical)}">${escapeHtml(vertical)}</span>`).join("")}</div></td>
    <td>${conference.audience.toLocaleString()}</td>
    <td><div class="score score-with-tooltip" tabindex="0" aria-describedby="score-rationale-${conference.id}">
      <strong>${score} <span class="pill tier-${tier.toLowerCase()}">Tier ${tier}</span></strong>
      <div class="score-bar"><div class="score-fill score-fill-tier-${tier.toLowerCase()}" style="width:${score}%"></div></div>
      <span class="score-tooltip" id="score-rationale-${conference.id}" role="tooltip">${escapeHtml(rationale)}</span>
    </div></td>
    <td class="status-team-cell">${renderStatusTeamCell(conference)}</td>
    <td class="row-actions-cell">
      <button class="row-delete-button" type="button" data-delete-conference="${conference.id}" data-row-action aria-label="Delete ${escapeHtml(conference.name)}" title="Delete conference">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>
      </button>
    </td>
  </tr>`;
}

function renderStatusTeamCell(conference) {
  return `<div class="status-team-stack">
    ${renderStatusSelect(conference)}
    ${conference.status === "Committed" ? `<div class="committed-team-control">
      <span class="status-team-label">Team</span>
      ${renderTeamSelect(conference)}
    </div>` : ""}
  </div>`;
}

function renderStatusSelect(conference) {
  return `<select class="table-select status-select" data-edit="status" data-id="${conference.id}" aria-label="Status for ${escapeHtml(conference.name)}">
    ${STATUS_OPTIONS.map((status) => `<option value="${status}" ${conference.status === status ? "selected" : ""}>${status}</option>`).join("")}
  </select>`;
}

function renderTeamSelect(conference) {
  const team = Array.isArray(conference.team) ? conference.team : [];
  return `<div class="team-editor" data-id="${conference.id}">
    <button class="table-select team-button" type="button" aria-label="Team for ${escapeHtml(conference.name)}">${escapeHtml(teamLabel(conference))}</button>
    <div class="team-menu">
      ${TEAM_OPTIONS.map((person) => renderMultiOption(person, team.includes(person))).join("")}
    </div>
  </div>`;
}
