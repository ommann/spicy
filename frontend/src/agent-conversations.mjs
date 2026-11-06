const savedMessages = new WeakMap();
const streamProjections = new WeakMap();
const leafProjections = new WeakMap();

// Shared ancestors retain their IDs; only streamed messages need agent-local IDs.
export function agentStreamEntries(agent) {
  const cached = streamProjections.get(agent);
  if (cached && cached.entries === agent.entries && cached.live === agent.live
    && cached.leafId === agent.leafId && cached.userOnly === agent.streamUserOnly) return cached.result;
  let parentId = agent.leafId;
  let saved = savedMessages.get(agent.entries);
  if (!saved) {
    saved = new Set(agent.entries.filter(entry => Number.isFinite(entry.message?.timestamp))
      .map(entry => `${entry.message.role}:${entry.message.timestamp}`));
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

export function mergeAgentEntries(agents, origins = {}) {
  const entries = new Map();
  // Keep each agent's branch in the same order when live entries become saved
  // entries, so simultaneous streams cannot exchange columns or input drafts.
  for (const agent of agents) {
    const origin = origins[agent.agentId];
    let marked = false;
    for (const entry of [...agent.entries, ...agentStreamEntries(agent)]) {
      const startsBranch = origin && !marked && entry.message?.role === 'user' && !origin.baseline.includes(entry.id);
      entries.set(entry.id, startsBranch ? { ...entry, laneOriginId: origin.draftId } : entry);
      if (startsBranch) marked = true;
    }
  }
  return [...entries.values()];
}

export function agentForLeaf(graph, agents, leafId, preferredId) {
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

export function agentForEntry(agents, entryId, preferredId) {
  const matches = agents.filter(agent => agent.entries.some(entry => entry.id === entryId));
  return matches.find(agent => agent.agentId === preferredId) ?? matches[0];
}
