import type { ConversationGraph, ConversationNode, ConversationLane } from './conversation-model.ts';
import { requiredMapValue } from '../../shared/required-map-value.ts';

// Keep the existing shared cards; remove only nodes no shown leaf needs.
export function filterConversationBranches(graph: ConversationGraph, leafIds: string[]): ConversationGraph {
  const selected = new Set(leafIds);
  const leaves = graph.leaves.filter(leaf => selected.has(leaf.id));
  if (leaves.length === graph.leaves.length) return graph;
  const kept = new Set();
  for (const leaf of leaves) {
    let node: ConversationNode | undefined = leaf;
    while (node && !kept.has(node.id)) {
      kept.add(node.id);
      node = node.parent;
    }
  }
  const nodes = new Map<string, ConversationNode>([...graph.nodes].filter(([id]) => kept.has(id)).map(([id, node]) => [id, {
    ...node, first: Infinity, last: -1, parent: undefined, children: [],
    promptFork: node.promptFork && selected.has(id) && node.children.some(child => kept.has(child.id)),
  }]));
  for (const node of nodes.values()) {
    const parentId = requiredMapValue(graph.nodes, node.id).parent?.id;
    node.parent = parentId ? nodes.get(parentId) : undefined;
    if (node.parent) node.parent.children.push(node);
  }
  const shownLeaves = leaves.map(leaf => requiredMapValue(nodes, leaf.id));
  shownLeaves.forEach((leaf, index) => {
    for (let node: ConversationNode | undefined = leaf; node; node = node.parent) {
      node.first = Math.min(node.first, index);
      node.last = Math.max(node.last, index);
    }
  });
  return { ...graph, nodes, leaves: shownLeaves,
    roots: graph.roots.filter(node => kept.has(node.id)).map(node => requiredMapValue(nodes, node.id)),
    ids: graph.ids.filter(id => kept.has(id)),
    activeLeaf: shownLeaves.find(leaf => leaf.id === graph.activeLeaf?.id) ?? shownLeaves.at(-1),
    forks: [...nodes.values()].filter(node => node.children.length > 1 || node.promptFork),
  };
}

export function followHiddenLeaves(hiddenIds: string[], previous: ConversationLane[], next: ConversationLane[]) {
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
