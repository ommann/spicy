import { CHAT_BLOCK_GAP, conversationNodeHeight } from './conversation-model.mjs';

export function singleConversationNodes(graph, lane) {
  const path = [];
  const seen = new Set();
  let node = graph.leaves[Math.max(0, Math.min(lane, graph.leaves.length - 1))];
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    path.push(node);
    node = node.parent;
  }
  return path.reverse();
}

// Single has no branch packing or connector geometry. Only the selected path
// participates in measurement and layout; the session graph remains shared.
export function layoutSingleConversation(graph, { width, viewportWidth, lane, heights = {}, composerHeights = {},
  rowGap = CHAT_BLOCK_GAP, edgeGap = 24 }) {
  const focused = Math.max(0, Math.min(lane, graph.leaves.length - 1));
  const nodes = singleConversationNodes(graph, focused);
  const leaf = graph.leaves[focused];
  const inset = Math.max(edgeGap, (viewportWidth - width) / 2);
  const prefixHeight = Math.max(0, ...nodes.filter(node => node.entry.message?.role === 'system').map(node => heights[node.id] || 60));
  const items = new Map();
  let previous;
  for (const node of nodes) {
    const system = node.entry.message?.role === 'system';
    const hasPrompt = graph.prefix.get(node.id).captured || (node.entry.type === 'compaction' && node.entry.parentId === null
      && graph.prefix.get(leaf.id).captured);
    const top = system ? rowGap : previous ? previous.top + previous.height + rowGap
      : rowGap + (hasPrompt ? prefixHeight + rowGap : 0);
    const height = conversationNodeHeight(node, heights, rowGap);
    const position = { top, height, hidden: system, column: focused, left: inset, span: width, cardLeft: 0 };
    items.set(node.id, position);
    if (!system) previous = position;
  }
  const bottom = Math.max(rowGap + prefixHeight, previous ? previous.top + previous.height : 0);
  const inlineComposers = graph.leaves.length === 1 && leaf.id === 'empty-chat-draft';
  const composers = graph.leaves.map((_, index) => ({ left: inset, top: bottom + rowGap, height: composerHeights[index] || 40 }));
  return { items, composers, inlineComposers, paths: [], inset, starts: graph.leaves.map(() => 0),
    width: inset * 2 + width, height: inlineComposers ? composers[focused].top + composers[focused].height : bottom,
    lane: focused, hasHorizontal: width + edgeGap * 2 > viewportWidth };
}
