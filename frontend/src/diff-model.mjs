import { diffWordsWithSpace, parsePatch } from 'diff';
import { diffLines } from './lilim/prefix-diff.js';

export function recordedEditDiff(details, path, edits = []) {
  if (typeof details?.patch === 'string' && details.patch.trim()) {
    try {
      const files = parsePatch(details.patch);
      if (files.some(file => file.hunks.length)) return files.map(file => ({
        name: file.newFileName === '/dev/null' ? file.oldFileName : file.newFileName || path,
        hunks: file.hunks.map(hunk => {
          let oldLine = hunk.oldStart, newLine = hunk.newStart;
          return { ...hunk, rows: hunk.lines.filter(line => /^[ +-]/.test(line)).map(line => {
            const kind = line[0] === '+' ? 'add' : line[0] === '-' ? 'remove' : 'context';
            const row = { kind, text: line.slice(1), oldLine: kind === 'add' ? undefined : oldLine, newLine: kind === 'remove' ? undefined : newLine };
            if (kind !== 'add') oldLine++;
            if (kind !== 'remove') newLine++;
            return row;
          }) };
        }),
      }));
    } catch { /* Older recordings may contain only the display-oriented diff. */ }
  }
  if (typeof details?.diff !== 'string' || !details.diff.trim()) {
    const fragments = Array.isArray(edits) ? edits.filter(edit => typeof edit.oldText === 'string' && typeof edit.newText === 'string') : [];
    return fragments.length ? [{ name: path || 'Edit', hunks: fragments.map((edit, index) => ({
      label: `Replacement ${index + 1}`,
      rows: diffLines(edit.oldText, edit.newText).map(row => ({ kind: row.kind, text: row.text })),
    })) }] : [];
  }
  const rows = details.diff.split('\n').map(line => {
    const match = /^([ +-])\s*(\d+) (.*)$/.exec(line);
    if (!match) return { kind: 'meta', text: line.trim() };
    const kind = match[1] === '+' ? 'add' : match[1] === '-' ? 'remove' : 'context';
    return { kind, text: match[3], oldLine: kind === 'add' ? undefined : Number(match[2]), newLine: kind === 'remove' ? undefined : Number(match[2]) };
  });
  return [{ name: path || 'Edit', hunks: [{ rows }] }];
}

// Annotate replacement runs once, not on hover or for each syntax token.
export function emphasizeRows(rows) {
  const result = rows.map(row => ({ ...row, emphasis: [] }));
  for (let start = 0; start < result.length;) {
    if (!['add', 'remove'].includes(result[start].kind)) { start++; continue; }
    let end = start;
    while (end < result.length && ['add', 'remove'].includes(result[end].kind)) end++;
    const removed = result.slice(start, end).filter(row => row.kind === 'remove');
    const added = result.slice(start, end).filter(row => row.kind === 'add');
    if (removed.length && added.length) {
      const before = removed.map(row => row.text).join('\n');
      const after = added.map(row => row.text).join('\n');
      if (before.length + after.length <= 30000) {
        const changes = diffWordsWithSpace(before, after, { timeout: 30, maxEditLength: 2000 });
        const ranges = { remove: [], add: [] };
        let oldOffset = 0, newOffset = 0;
        for (const change of changes || []) {
          if (change.removed) ranges.remove.push([oldOffset, oldOffset + change.value.length]);
          if (change.added) ranges.add.push([newOffset, newOffset + change.value.length]);
          if (!change.added) oldOffset += change.value.length;
          if (!change.removed) newOffset += change.value.length;
        }
        for (const [kind, group] of [['remove', removed], ['add', added]]) {
          let offset = 0;
          for (const row of group) {
            row.emphasis = ranges[kind].filter(([a, b]) => b > offset && a < offset + row.text.length)
              .map(([a, b]) => [Math.max(0, a - offset), Math.min(row.text.length, b - offset)]);
            offset += row.text.length + 1;
          }
        }
      }
    }
    start = end;
  }
  return result;
}
