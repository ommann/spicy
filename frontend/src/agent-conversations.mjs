// Shared ancestors retain their IDs; only streamed messages need agent-local IDs.
export function agentStreamEntries(agent) {
  let parentId = agent.leafId;
  const saved = new Set(agent.entries.filter(entry => Number.isFinite(entry.message?.timestamp))
    .map(entry => `${entry.message.role}:${entry.message.timestamp}`));
  return (agent.live || []).flatMap((message, index) => {
    if (agent.streamUserOnly && message.role !== 'user') return [];
    if (Number.isFinite(message.timestamp) && saved.has(`${message.role}:${message.timestamp}`)) return [];
    const entry = { type: 'message', id: `stream-${agent.agentId}-${index}`, parentId, message };
    parentId = entry.id;
    return [entry];
  });
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
  const matches = agents.filter(agent => {
    const head = agentStreamEntries(agent).findLast(entry => graph.nodes.has(entry.id))?.id ?? agent.leafId;
    return graph.ancestors(head).find(id => graph.nodes.has(id)) === leafId;
  });
  return matches.find(agent => agent.agentId === preferredId) ?? matches[0];
}

export function agentForEntry(agents, entryId, preferredId) {
  const matches = agents.filter(agent => agent.entries.some(entry => entry.id === entryId));
  return matches.find(agent => agent.agentId === preferredId) ?? matches[0];
}
