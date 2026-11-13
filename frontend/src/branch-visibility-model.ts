// Keep the existing shared cards; remove only nodes no shown leaf needs.
export function filterConversationBranches(graph, leafIds) {
  const selected = new Set(leafIds);
  const leaves = graph.leaves.filter(leaf => selected.has(leaf.id));
  if (leaves.length === graph.leaves.length) return graph;
  const kept = new Set();
  for (const leaf of leaves) {
    let node = leaf;
    while (node && !kept.has(node.id)) {
      kept.add(node.id);
      node = node.parent;
    }
  }
  const nodes = new Map([...graph.nodes].filter(([id]) => kept.has(id)).map(([id, node]) => [id, {
    ...node, first: Infinity, last: -1, parent: undefined, children: [],
    promptFork: node.promptFork && selected.has(id) && node.children.some(child => kept.has(child.id)),
  }]));
  for (const node of nodes.values()) {
    node.parent = nodes.get(graph.nodes.get(node.id).parent?.id);
    if (node.parent) node.parent.children.push(node);
  }
  const shownLeaves = leaves.map(leaf => nodes.get(leaf.id));
  shownLeaves.forEach((leaf, index) => {
    for (let node = leaf; node; node = node.parent) {
      node.first = Math.min(node.first, index);
      node.last = Math.max(node.last, index);
    }
  });
  return { ...graph, nodes, leaves: shownLeaves,
    roots: graph.roots.filter(node => kept.has(node.id)).map(node => nodes.get(node.id)),
    ids: graph.ids.filter(id => kept.has(id)),
    activeLeaf: shownLeaves.find(leaf => leaf.id === graph.activeLeaf?.id) ?? shownLeaves.at(-1),
    forks: [...nodes.values()].filter(node => node.children.length > 1 || node.promptFork),
  };
}

export function followHiddenLeaves(hiddenIds, previous, next) {
  const hidden = new Set(hiddenIds);
  for (const lane of next) {
    const old = previous.find(item => item.key === lane.key);
    if (old && old.leafId !== lane.leafId && hiddenIds.includes(old.leafId)) {
      hidden.delete(old.leafId);
      hidden.add(lane.leafId);
    }
  }
  return [...hidden];
}
