import type { Wire } from './types.ts';

export function branchEntries(entries: Wire[], leafId: string | null | undefined = entries.findLast(entry => entry.parentId !== undefined)?.id) {
  const byId = new Map(entries.filter(entry => entry.parentId !== undefined).map(entry => [entry.id, entry]));
  const branch = [];
  const seen = new Set();

  while (leafId && byId.has(leafId) && !seen.has(leafId)) {
    seen.add(leafId);
    const entry: Wire | undefined = byId.get(leafId);
    if (!entry) break;
    branch.push(entry);
    leafId = entry.parentId;
  }

  return branch.reverse();
}
