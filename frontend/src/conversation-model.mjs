import { createPrefixResolver } from './lilim/prefix-state.js';
import { createSystemPromptCatalog, systemPromptText } from './lilim/system-prompts.js';
import { branchEntries } from './session-entries.mjs';

export const CHAT_BLOCK_GAP = 20;

export function projectChatParts(entries) {
  const summaries = new Set(entries.filter(entry => entry.type === 'branch_summary').map(entry => entry.fromId));
  const results = new Map(entries.filter(entry => entry.message?.role === 'toolResult').map(entry => [entry.message.toolCallId, entry.message]));
  const parts = new Map();
  const add = (entry, part) => {
    const group = parts.get(entry.id) || [];
    if (part.encrypted && group.at(-1)?.encrypted) return;
    group.push({ ...part, entryId: entry.id });
    parts.set(entry.id, group);
  };

  for (const entry of entries) {
    const message = entry.message;
    if (!message) {
      if (entry.type === 'branch_draft') add(entry, { kind: 'draft' });
      if (entry.type === 'compaction' || entry.type === 'branch_summary') add(entry, { kind: 'summary', text: entry.summary || '' });
      if (entry.type === 'custom_message' && entry.display) add(entry, { kind: 'custom', content: entry.content });
      continue;
    }

    if (message.role === 'system') add(entry, { kind: 'system' });
    if (message.role === 'user') add(entry, { kind: 'user', content: message.content, canBranch: !entry.optimistic && !entry.id.startsWith('stream-') });
    if (message.role === 'assistant') for (const block of message.content || []) {
      if (block.type === 'toolCall') add(entry, { kind: 'tool', call: block, result: results.get(block.id) });
      if (block.type === 'text') add(entry, { kind: 'message', text: (block.text || '').replace(/^\n+|\n+$/g, ''), summary: summaries.has(entry.id) });
      if (block.type === 'thinking') add(entry, {
        kind: 'thinking',
        encrypted: !!(block.redacted || (!block.thinking?.trim() && block.thinkingSignature)),
        text: block.redacted || (!block.thinking?.trim() && block.thinkingSignature)
          ? `Encrypted thinking${Number.isFinite(message.usage?.reasoning)
            ? ` (${message.usage.reasoning.toLocaleString('en-US')} tokens)`
            : ''}` : block.thinking?.trim() ? block.thinking.trim() : 'Thinking...',
      });
    }
    if (message.role === 'assistant' && message.stopReason === 'error') add(entry, {
      kind: 'error', text: message.errorMessage || 'The reply failed.',
    });
    if (message.role === 'bashExecution') add(entry, {
      kind: 'tool', call: { name: 'bash', arguments: { command: message.command } },
      result: { content: [{ type: 'text', text: message.output || '' }], isError: message.exitCode !== 0 },
    });
  }

  return parts;
}

export function createConversationGraph(entries, promptVersions) {
  // An empty conversation is a draft lane, rendered exactly like a branch draft.
  if (!projectChatParts(entries).size) return createConversationGraph([...entries, {
    id: 'empty-chat-draft', parentId: entries.at(-1)?.id || null, type: 'branch_draft', optimistic: true,
  }], promptVersions);
  const raw = new Map(entries.filter(entry => entry.parentId !== undefined).map(entry => [entry.id, entry]));
  const parts = projectChatParts(entries);
  const prefix = createPrefixResolver(entries);
  const prompts = promptVersions ? { versions: promptVersions, numberFor: state => state?.captured
    ? promptVersions.find(version => version.key === (state.promptKey ?? systemPromptText(state)))?.number : undefined
  } : createSystemPromptCatalog(entries);
  const nodes = new Map([...parts].filter(([id]) => raw.has(id)).map(([id, content]) => [id, {
    id, entry: raw.get(id), parts: content, children: [], anchors: [],
    isPrefixDelta: prefix.isDelta(raw.get(id)), parent: undefined,
    first: 0, last: 0, depth: 0,
  }]));
  const labels = new Map();
  const toolOwners = new Map();

  for (const entry of entries) {
    if (entry.type === 'label') {
      if (entry.label) labels.set(entry.targetId, entry.label);
      else labels.delete(entry.targetId);
    }
    if (entry.message?.role === 'assistant') for (const block of entry.message.content || []) {
      if (block.type === 'toolCall') toolOwners.set(block.id, entry.id);
    }
  }

  for (const [id, label] of labels) {
    let target = raw.get(id);
    if (target?.message?.role === 'toolResult') target = raw.get(toolOwners.get(target.message.toolCallId)) || target;
    const seen = new Set();
    while (target && !nodes.has(target.id) && !seen.has(target.id)) {
      seen.add(target.id);
      target = raw.get(target.parentId);
    }
    if (target) nodes.get(target.id)?.anchors.push(label);
  }

  const roots = [];
  for (const node of nodes.values()) {
    let parentId = node.entry.parentId;
    const seen = new Set();
    while (parentId && !nodes.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId);
      parentId = raw.get(parentId)?.parentId;
    }
    node.parent = nodes.get(parentId);
    if (node.parent) node.parent.children.push(node);
    else roots.push(node);
  }

  for (const node of nodes.values()) {
    const source = nodes.get(node.entry.draftSourceId);
    if (source) {
      const siblings = node.parent ? node.parent.children : roots;
      siblings.splice(siblings.indexOf(node), 1);
      siblings.splice(siblings.indexOf(source) + 1, 0, node);
    }
  }

  const leaves = [];
  function assign(node, depth) {
    node.depth = depth;
    node.first = leaves.length;
    // A required tool-set update starts a new presentation lane. The real parent
    // remains the endpoint of the old lane; recorded parent links stay untouched.
    node.promptFork = node.children.some(child => prefix.changesPrefix(child.entry)
      && (child.entry.message?.toolsAdded?.length || child.entry.message?.toolsRemoved?.length));
    if (!node.children.length || node.promptFork) leaves.push(node);
    for (const child of node.children) assign(child, depth + 1);
    node.last = leaves.length - 1;
  }
  for (const root of roots) assign(root, 0);

  const branch = branchEntries(entries.filter(entry => !entry.draftSourceId));
  const order = new Map(branch.map((entry, index) => [entry.id, index]));
  const activeLeaf = leaves.filter(leaf => order.has(leaf.id)).sort((a, b) => order.get(b.id) - order.get(a.id))[0] || leaves.at(-1);
  const ancestors = id => {
    const path = [];
    const seen = new Set();
    while (id && raw.has(id) && !seen.has(id)) {
      seen.add(id);
      path.push(id);
      id = raw.get(id).parentId;
    }
    return path;
  };

  return { raw, nodes, roots, leaves, activeLeaf, prefix, prompts, ancestors,
    ids: [...nodes.keys()], forks: [...nodes.values()].filter(node => node.children.length > 1 || node.promptFork) };
}

export function matchConversationLanes(graph, previous = []) {
  const used = new Set();
  const currentIds = new Set(graph.leaves.map(leaf => leaf.id));
  const lanes = graph.leaves.map(leaf => {
    const saved = previous.find(lane => lane.leafId === leaf.id);
    if (saved) used.add(saved.key);
    const path = graph.ancestors(leaf.id);
    return { key: saved?.key, leafId: leaf.id, path: [...path, ...path.map(id => graph.raw.get(id)?.laneOriginId).filter(Boolean)] };
  });

  for (const lane of lanes) {
    if (lane.key) continue;
    const candidates = previous.filter(saved => !used.has(saved.key) && !currentIds.has(saved.leafId))
      .map(saved => ({ saved, score: Math.max(0, ...lane.path.filter(id => saved.path.includes(id)).map(id => saved.path.length - saved.path.indexOf(id))) }))
      .sort((a, b) => b.score - a.score);
    const origins = lane.path.map(id => graph.raw.get(id)?.laneOriginId).filter(Boolean);
    const saved = previous.find(saved => !used.has(saved.key) && origins.some(id => saved.path.includes(id)))
      ?? (candidates[0]?.score ? candidates[0].saved : undefined);
    lane.key = saved?.key || `lane:${lane.leafId}`;
    used.add(lane.key);
  }

  return lanes;
}

export function continuationTarget(graph, id) {
  const seen = new Set([id]);
  let target = id;
  while (true) {
    const hidden = [...graph.raw.values()].findLast(entry => entry.parentId === target && !graph.nodes.has(entry.id) && !seen.has(entry.id));
    if (!hidden) return target;
    target = hidden.id;
    seen.add(target);
  }
}

// Retain the established packing, shared-card placement, connector paths, and overscroll.
// This function has no browser or rendering dependency.
export function layoutConversation(graph, { mode, width, viewportWidth, viewportHeight, lane, heights = {}, composerHeights = {},
  rowGap = CHAT_BLOCK_GAP, columnGap = 48, edgeGap = 24 }) {
  const focused = Math.max(0, Math.min(lane, graph.leaves.length - 1));
  const gap = columnGap;
  const inset = mode === 'focused' ? Math.max(edgeGap, (viewportWidth - width) / 2) : Math.max(edgeGap, viewportWidth / 2);
  const pending = node => node.entry.type === 'branch_draft' && node.entry.draftSourceId;
  const committed = graph.leaves.filter(node => !pending(node));
  const drafts = graph.leaves.filter(pending);
  const starts = graph.leaves.map(node => {
    const column = pending(node) ? committed.length + drafts.indexOf(node) : committed.indexOf(node);
    return mode === 'focused' ? 0 : column * (width + gap);
  });
  const anchor = pending(graph.leaves[focused]) ? committed.find(leaf => leaf.id === graph.leaves[focused].entry.draftAnchorId) : undefined;
  const historyFocus = anchor ? graph.leaves.indexOf(anchor) : pending(graph.leaves[focused])
    ? graph.leaves.indexOf(committed.find(leaf => graph.ancestors(leaf.id).includes(graph.leaves[focused].entry.draftSourceId))) : focused;
  const totalWidth = inset * 2 + (mode === 'focused' ? width : Math.max(0, graph.leaves.length * (width + gap) - gap));
  const items = new Map();
  const prefixHeight = Math.max(0, ...[...graph.nodes.values()].filter(node => node.entry.message?.role === 'system').map(node => heights[node.id] || 60));

  for (const node of [...graph.nodes.values()].sort((a, b) => a.depth - b.depth)) {
    const onPath = node.first <= focused && node.last >= focused;
    const candidates = graph.leaves.map((_, index) => index).filter(index => index >= node.first && index <= node.last
      && (pending(node) || !pending(graph.leaves[index])));
    const range = candidates.map(index => starts[index]);
    const target = pending(node) ? focused : historyFocus;
    const column = candidates.reduce((closest, index) =>
      Math.abs(starts[index] - starts[target]) < Math.abs(starts[closest] - starts[target]) ? index : closest, candidates[0]);
    const system = node.entry.message?.role === 'system';
    const hidden = system || (mode === 'focused' && !onPath);
    let parent = node.parent;
    while (parent?.entry.message?.role === 'system') parent = parent.parent;
    const top = system ? rowGap : parent ? items.get(parent.id).top + items.get(parent.id).height + rowGap
      : rowGap + (graph.prefix.get(node.id).captured ? prefixHeight + rowGap : 0);
    const height = system ? 0 : heights[node.id] || (pending(node) ? 60 : node.entry.type === 'branch_draft' ? 120 + rowGap
      : node.parts.reduce((sum, part) => sum + (part.kind === 'message' || part.kind === 'thinking' ? 44 : 60), 0));
    const first = Math.min(...range);
    items.set(node.id, { top, height, hidden, column,
      left: inset + first, span: Math.max(...range) + width - first, cardLeft: starts[column] - first });
  }

  const composers = graph.leaves.map((_, index) => {
    const bottom = Math.max(rowGap + prefixHeight, ...[...graph.nodes.values()]
      .filter(node => !items.get(node.id).hidden && node.first <= index && node.last >= index)
      .map(node => items.get(node.id).top + items.get(node.id).height));
    return { left: inset + starts[index], top: bottom + rowGap, height: composerHeights[index] || 40 };
  });
  const height = Math.max(rowGap + prefixHeight,
    ...(mode === 'side' ? composers.map(composer => composer.top + composer.height) : []),
    ...[...graph.nodes.values()].filter(node => !items.get(node.id).hidden).map(node => items.get(node.id).top + items.get(node.id).height))
    + Math.max(80, viewportHeight * .75);
  const paths = [];

  if (mode === 'side') for (const node of graph.nodes.values()) {
    const position = items.get(node.id);
    if (position.hidden || node.entry.message?.role === 'system') continue;
    let parent = node.parent;
    while (parent?.entry.message?.role === 'system') parent = parent.parent;
    if (!parent || (parent.children.length < 2 && !parent.promptFork)) continue;

    const previous = items.get(parent.id);
    paths.push({ id: node.id, fork: parent.children.length > 1 || parent.promptFork,
      d: `M ${inset + starts[previous.column] + rowGap} ${previous.top + previous.height} V ${position.top - rowGap / 2} H ${inset + starts[position.column] + rowGap} V ${position.top}` });
  }

  return { items, composers, paths, inset, starts, width: totalWidth, height, lane: focused,
    hasHorizontal: mode !== 'focused' || width + edgeGap * 2 > viewportWidth };
}
