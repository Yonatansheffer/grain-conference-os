function initials(lead) {
  return `${(lead.firstName || "")[0] || ""}${(lead.lastName || "")[0] || ""}`.toLowerCase();
}

function similarity(a, b) {
  a = normalize(a);
  b = normalize(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.82;
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return 1 - matrix[a.length][b.length] / Math.max(a.length, b.length);
}

function leadMatchScore(a, b) {
  const emailMatch = a.email && b.email && normalize(a.email) === normalize(b.email) ? 1 : 0;
  const companyMatch = similarity(a.company, b.company);
  const nameMatch = Math.max(
    similarity(`${a.firstName} ${a.lastName}`, `${b.firstName} ${b.lastName}`),
    initials(a) && initials(a) === initials(b) ? 0.72 : 0
  );
  return Math.max(emailMatch, nameMatch * 0.62 + companyMatch * 0.38);
}
