function renderConferenceRow(conference, score, tier) {
  return `<tr data-id="${conference.id}">
    <td><strong>${escapeHtml(conference.name)}</strong></td>
    <td>${escapeHtml(formatDateRange(conference))}</td>
    <td><strong>${escapeHtml(conference.region)}</strong><br><span class="muted">${escapeHtml(conference.city)}, ${escapeHtml(conference.country)}</span></td>
    <td><div class="vertical-pill-group">${conference.verticals.map((vertical) => `<span class="vertical-pill">${escapeHtml(vertical)}</span>`).join("")}</div></td>
    <td>${conference.audience.toLocaleString()}</td>
    <td><div class="score"><strong>${score} <span class="pill tier-${tier.toLowerCase()}">Tier ${tier}</span></strong><div class="score-bar"><div class="score-fill" style="width:${score}%"></div></div></div></td>
    <td>${renderTeamSelect(conference)}</td>
    <td>${renderStatusSelect(conference)}</td>
  </tr>`;
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
