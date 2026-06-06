function renderConferenceRow(conference, score, tier) {
  const conferenceName = conference.source
    ? `<a class="conference-source-link" href="${escapeHtml(conference.source)}" target="_blank" rel="noreferrer" data-row-action>${escapeHtml(conference.name)}</a>`
    : `<strong>${escapeHtml(conference.name)}</strong>`;
  const rationale = scoreNarrative(conference);
  return `<tr data-id="${conference.id}">
    <td class="row-actions-cell">
      <button class="row-menu-button" type="button" data-row-menu-toggle="${conference.id}" data-row-action aria-label="Options for ${escapeHtml(conference.name)}" title="Event options" aria-haspopup="menu" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
      </button>
      <div class="row-action-menu" role="menu" data-row-menu="${conference.id}">
        <button type="button" role="menuitem" data-edit-conference="${conference.id}" data-row-action>Edit Event</button>
        <button class="danger-action" type="button" role="menuitem" data-delete-conference="${conference.id}" data-row-action>Delete Event</button>
      </div>
    </td>
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
