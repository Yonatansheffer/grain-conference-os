function renderMultiOption(option, isSelected) {
  const safeOption = escapeHtml(option);
  return `<label class="multi-option"><input type="checkbox" value="${safeOption}" ${isSelected ? "checked" : ""}> <span>${safeOption}</span></label>`;
}

function renderFilterChip(key, value, label) {
  const safeLabel = escapeHtml(label);
  const safeValue = escapeHtml(value);
  return `<span class="filter-chip"><span>${safeLabel}: ${safeValue}</span><button type="button" data-filter-chip="${key}" data-filter-value="${safeValue}" aria-label="Clear ${safeLabel} ${safeValue}">x</button></span>`;
}
