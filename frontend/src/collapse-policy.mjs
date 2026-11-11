// Grow previews with the content, but don't let a preview dominate the viewport.
export function previewHeight(fullHeight, lineHeight, viewportHeight) {
  const minimum = 10 * lineHeight;
  const maximum = Math.max(minimum, viewportHeight * 0.6);
  return Math.min(maximum, Math.max(minimum, Math.sqrt(fullHeight / lineHeight) * 3 * lineHeight));
}

// Keep context around every change. If changes alone exceed the budget, share
// space between change regions rather than dropping the later regions entirely.
export function collapseDiffRows(rows, budget, context = 2) {
  const keep = new Set();
  const changes = [];
  for (let i = 0; i < rows.length;) {
    if (!['add', 'remove'].includes(rows[i].kind)) { i++; continue; }
    const start = i;
    while (i < rows.length && ['add', 'remove'].includes(rows[i].kind)) i++;
    changes.push([start, i]);
  }
  if (!changes.length || rows.length <= budget) return rows;
  const changeCount = changes.reduce((sum, [start, end]) => sum + end - start, 0);
  const allowance = Math.max(2, Math.floor((budget - changes.length * (context * 2 + 1)) / changes.length));
  for (const [start, end] of changes) {
    for (let i = Math.max(0, start - context); i < Math.min(rows.length, end + context); i++) {
      if (i < start || i >= end || changeCount <= budget || end - start <= allowance || i < start + Math.ceil(allowance / 2) || i >= end - Math.floor(allowance / 2)) keep.add(i);
    }
  }
  const result = [];
  for (let i = 0; i < rows.length;) {
    if (keep.has(i)) { result.push(rows[i++]); continue; }
    const start = i;
    const omittedKind = rows[i].kind;
    while (i < rows.length && !keep.has(i) && rows[i].kind === omittedKind) i++;
    // Each gap has its own one-line marker. Keep the original lines unless
    // this individual gap saves at least four lines after that marker.
    if (i - start - 1 < 4) {
      result.push(...rows.slice(start, i));
      continue;
    }
    const description = omittedKind === 'add' ? 'added' : omittedKind === 'remove' ? 'removed' : 'unchanged';
    result.push({ kind: 'omitted', omittedKind, text: `${i - start} ${description} lines hidden`, tokens: [] });
  }
  // The control costs a line: require four more lines of actual savings.
  return rows.length - result.length >= 5 ? result : rows;
}
