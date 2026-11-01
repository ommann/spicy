export function branchEntries(entries, leafId = entries.findLast(entry => entry.parentId !== undefined)?.id) {
  const byId = new Map(entries.filter(entry => entry.parentId !== undefined).map(entry => [entry.id, entry]));
  const branch = [];
  const seen = new Set();

  while (leafId && byId.has(leafId) && !seen.has(leafId)) {
    seen.add(leafId);
    const entry = byId.get(leafId);
    branch.push(entry);
    leafId = entry.parentId;
  }

  return branch.reverse();
}
