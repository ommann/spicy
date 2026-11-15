// Small, dependency-free line diff. Limit quadratic work for very large replacements.
export function diffLines(before, after) {
  const a = before === '' ? [] : before.split('\n');
  const b = after === '' ? [] : after.split('\n');
  let start = 0, end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const rows = a.slice(0, start).map(text => ({kind: 'context', text}));
  const x = a.slice(start, a.length - end), y = b.slice(start, b.length - end);
  if (x.length * y.length > 1000000) {
    rows.push(...x.map(text => ({kind: 'remove', text})), ...y.map(text => ({kind: 'add', text})));
  } else {
    const table = Array.from({length: x.length + 1}, () => new Uint32Array(y.length + 1));
    for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) {
      table[i][j] = x[i] === y[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
    let i = 0, j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) {
        rows.push({kind: 'context', text: x[i++]});
        j++;
      }
      else if (i < x.length && (j === y.length || table[i + 1][j] >= table[i][j + 1])) rows.push({kind: 'remove', text: x[i++]});
      else rows.push({kind: 'add', text: y[j++]});
    }
  }
  if (end) rows.push(...a.slice(a.length - end).map(text => ({kind: 'context', text})));
  let oldLine = 1, newLine = 1;
  return rows.map(row => {
    const result = {...row, oldLine, newLine};
    if (row.kind !== 'add') oldLine++;
    if (row.kind !== 'remove') newLine++;
    return result;
  });
}
function hunks(rows, context = 2) {
  const ranges = [];
  rows.forEach((row, index) => {
    if (row.kind === 'context') return;
    const start = Math.max(0, index - context), end = Math.min(rows.length, index + context + 1);
    const previous = ranges.at(-1);
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
    else ranges.push({start, end});
  });
  return ranges.map(({start, end}) => {
    const selected = rows.slice(start, end);
    return {oldStart: selected[0].oldLine, newStart: selected[0].newLine,
      oldCount: selected.filter(r => r.kind !== 'add').length,
      newCount: selected.filter(r => r.kind !== 'remove').length, rows: selected};
  });
}
export function diffPrefixes(before, after, { fullContext = false } = {}) {
  const files = [];
  function compare(name, a, b) {
    if (a === b && !fullContext) return;
    const rows = diffLines(a, b);
    if (!rows.length) return;
    files.push({name, hunks: fullContext ? [{
      oldStart: 1, newStart: 1,
      oldCount: rows.filter(row => row.kind !== 'add').length,
      newCount: rows.filter(row => row.kind !== 'remove').length,
      rows,
    }] : hunks(rows)});
  }
  const text = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  compare('content', text(before.content), text(after.content));
  for (const name of new Set([...before.sections.keys(), ...after.sections.keys()])) {
    compare(`sections.${name}`, before.sections.has(name) ? text(before.sections.get(name)) : '', after.sections.has(name) ? text(after.sections.get(name)) : '');
  }
  for (const name of new Set([...before.tools.keys(), ...after.tools.keys()])) {
    compare(`tools.${name}`, before.tools.has(name) ? text(before.tools.get(name)) : '', after.tools.has(name) ? text(after.tools.get(name)) : '');
  }
  return files;
}
