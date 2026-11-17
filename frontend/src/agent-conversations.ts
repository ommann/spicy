import type { Snapshot, Wire } from './types.ts';
import type { ConversationGraph } from './conversation-model.ts';

type Agent = Snapshot & { streamUserOnly?: boolean };
const savedMessages = new WeakMap<Wire[], Set<string>>();
const streamProjections = new WeakMap<Agent, {
  entries: Wire[]; live: Wire[]; leafId: string | null; userOnly?: boolean; result: Wire[];
}>();
const leafProjections = new WeakMap<ConversationGraph, WeakMap<Agent, {
  stream: Wire[]; leafId: string | null; visibleLeaf?: string;
}>>();

// Shared ancestors retain their IDs; only streamed messages need agent-local IDs.
export function agentStreamEntries(agent: Agent): Wire[] {
  const cached = streamProjections.get(agent);
  if (cached && cached.entries === agent.entries && cached.live === agent.live
    && cached.leafId === agent.leafId && cached.userOnly === agent.streamUserOnly) return cached.result;
  let parentId = agent.leafId;
  let saved = savedMessages.get(agent.entries);
  if (!saved) {
    saved = new Set(agent.entries.flatMap(entry => {
      const message = entry.message;
      return message && Number.isFinite(message.timestamp) ? [`${message.role}:${message.timestamp}`] : [];
    }));
    savedMessages.set(agent.entries, saved);
  }
  const result = (agent.live || []).flatMap((message, index) => {
    if (agent.streamUserOnly && message.role !== 'user') return [];
    if (Number.isFinite(message.timestamp) && saved.has(`${message.role}:${message.timestamp}`)) return [];
    const entry = { type: 'message', id: `stream-${agent.agentId}-${index}`, parentId, message };
    parentId = entry.id;
    return [entry];
  });
  streamProjections.set(agent, { entries: agent.entries, live: agent.live, leafId: agent.leafId,
    userOnly: agent.streamUserOnly, result });
  return result;
}

export function mergeAgentEntries(agents: Agent[], origins: Record<string, { baseline: string[]; draftId: string }> = {}) {
  const entries = new Map<string, Wire>();
  // Keep each agent's branch in the same order when live entries become saved
  // entries, so simultaneous streams cannot exchange columns or input drafts.
  for (const agent of agents) {
    const origin = agent.agentId ? origins[agent.agentId] : undefined;
    let marked = false;
    for (const entry of [...agent.entries, ...agentStreamEntries(agent)]) {
      const startsBranch = origin && !marked && entry.message?.role === 'user' && !origin.baseline.includes(entry.id);
      entries.set(entry.id, startsBranch ? { ...entry, laneOriginId: origin.draftId } : entry);
      if (startsBranch) marked = true;
    }
  }
  return [...entries.values()];
}

export function agentForLeaf(graph: ConversationGraph, agents: Agent[], leafId: string, preferredId?: string) {
  let leaves = leafProjections.get(graph);
  if (!leaves) leafProjections.set(graph, leaves = new WeakMap());
  const matches = agents.filter(agent => {
    const stream = agentStreamEntries(agent);
    let cached = leaves.get(agent);
    if (!cached || cached.stream !== stream || cached.leafId !== agent.leafId) {
      const head = stream.findLast(entry => graph.nodes.has(entry.id))?.id ?? agent.leafId;
      cached = { stream, leafId: agent.leafId, visibleLeaf: graph.ancestors(head).find(id => graph.nodes.has(id)) };
      leaves.set(agent, cached);
    }
    return cached.visibleLeaf === leafId;
  });
  return matches.find(agent => agent.agentId === preferredId) ?? matches[0];
}

export function agentForEntry(agents: Agent[], entryId: string, preferredId?: string) {
  const matches = agents.filter(agent => agent.entries.some(entry => entry.id === entryId));
  return matches.find(agent => agent.agentId === preferredId) ?? matches[0];
}
