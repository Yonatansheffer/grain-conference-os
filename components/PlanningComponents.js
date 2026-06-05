function renderCalendarEvent(event) {
  const team = teamLabel(event);
  return `<button class="calendar-event tier-${tierFor(scoreConference(event)).toLowerCase()}" type="button" aria-label="${escapeHtml(event.name)} details" data-calendar-event="${event.id}">
    <span>${escapeHtml(event.name)}</span>
    <span class="calendar-tooltip" role="tooltip">
      <strong>${escapeHtml(event.name)}</strong>
      <span>${escapeHtml(event.city)}, ${escapeHtml(event.country)}</span>
      <span>Team: ${escapeHtml(team)}</span>
    </span>
  </button>`;
}

function renderTripCluster(cluster) {
  const committedCount = cluster.events.filter((event) => event.status === "Committed").length;
  const pendingEvents = cluster.events.filter((event) => event.status !== "Committed");
  const potential = cluster.events.reduce((sum, event) => sum + scoreConference(event), 0);
  const windowDays = clusterWindowDays(cluster.events);
  return `<div class="cluster trip-cluster">
    <div class="cluster-head">
      <strong>${escapeHtml(cluster.city || cluster.region)} cluster</strong>
      <span>${committedCount}/${cluster.events.length} committed</span>
    </div>
    <p class="cluster-efficiency">${cluster.events.length} Events in a ${Math.max(windowDays, 1)}-day window | Combined ICP Potential ${potential}</p>
    <div class="cluster-events">
      ${cluster.events.map(renderClusterEvent).join("")}
    </div>
    ${pendingEvents.length ? `<div class="cluster-actions">${pendingEvents.map((event) => `<button class="add-trip-button" type="button" data-add-to-trip="${event.id}">Add to Trip: ${escapeHtml(event.name)}</button>`).join("")}</div>` : ""}
  </div>`;
}

function renderClusterEvent(event) {
  const committed = event.status === "Committed";
  return `<span class="cluster-event ${committed ? "cluster-event-committed" : "cluster-event-pending"}">
    <span>${escapeHtml(event.name)}</span>
    <small>${escapeHtml(formatDateRange(event))} | ${escapeHtml(event.city)}</small>
  </span>`;
}

function clusterWindowDays(events) {
  const times = events.map((event) => new Date(event.startDate).getTime()).sort((a, b) => a - b);
  if (times.length < 2) return 1;
  return Math.max(1, Math.ceil((times[times.length - 1] - times[0]) / 86400000));
}
