const METRIC_ICONS = {
  Events: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 2v4M16 2v4M4 9h16M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/></svg>`,
  "Tier A targets": `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.2 1 6-5.4-2.9-5.4 2.9 1-6-4.4-4.2 6.1-.9Z"/></svg>`,
  Committed: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20 6-11 11-5-5"/></svg>`,
  Reach: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM2 12h20M12 2a12 12 0 0 1 0 20M12 2a12 12 0 0 0 0 20"/></svg>`
};

function renderMetricCard(label, value) {
  return `<div class="metric">
    <span class="metric-icon">${METRIC_ICONS[label]}</span>
    <strong>${value}</strong>
    <span>${label}</span>
    ${label === "Reach" ? `<small>From approved attendance only</small>` : ""}
  </div>`;
}
