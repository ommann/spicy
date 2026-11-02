// Replay captured prefix fields along parent links. Never modify trace entries.
function emptyState() {
  return {captured: false, rootId: null, content: '', sections: new Map(), tools: new Map(), key: ''};
}
function applyMessage(previous, message, sourceId) {
  const inherited = previous;
  if (message.systemPromptSnapshot) previous = {...emptyState(), rootId: previous.rootId, tools: previous.tools};
  const state = {
    captured: true,
    rootId: previous.rootId || sourceId,
    content: previous.content,
    sections: new Map(previous.sections),
    tools: new Map(previous.tools),
  };
  if (message.content && (typeof message.content !== 'string' || message.content.length)) state.content = message.content;
  for (const [name, value] of Object.entries(message.sections || {})) {
    if (value === null) state.sections.delete(name);
    else state.sections.set(name, value);
  }
  for (const name of message.toolsRemoved || []) state.tools.delete(name);
  for (const tool of message.toolsAdded || []) state.tools.set(tool.name, tool);
  state.key = JSON.stringify([state.content, [...state.sections], [...state.tools]]);
  state.promptKey = message.systemPromptKey ?? (state.key === inherited.key ? inherited.promptKey : undefined);
  return state;
}
export function createPrefixResolver(entries) {
  const byId = new Map(entries.filter(entry => entry.parentId !== undefined).map(entry => [entry.id, entry]));
  const cache = new Map();
  const empty = emptyState();
  function get(id) {
    if (!id) return empty;
    if (cache.has(id)) return cache.get(id);
    const chain = [], seen = new Set();
    let cursor = id;
    while (cursor && byId.has(cursor) && !cache.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor);
      const entry = byId.get(cursor);
      chain.push(entry);
      cursor = entry.parentId;
    }
    let state = cache.get(cursor) || empty;
    for (const entry of chain.reverse()) {
      if (entry.message?.role === 'system') state = applyMessage(state, entry.message, entry.id);
      else if (entry.type === 'compaction' && entry.systemMessage) {
        // A compaction's captured system message is a complete checkpoint.
        state = applyMessage({...emptyState(), rootId: state.rootId}, entry.systemMessage, entry.id);
      }
      cache.set(entry.id, state);
    }
    return cache.get(id) || empty;
  }
  return {
    get,
    isDelta: entry => entry.message?.role === 'system' && get(entry.parentId).captured,
    changesPrefix: entry => entry.message?.role === 'system' && get(entry.parentId).captured && get(entry.parentId).key !== get(entry.id).key,
  };
}
export function systemEntryForState(source, state) {
  return {
    ...source,
    type: 'message',
    prefixPreview: false,
    message: {
      ...source.message,
      role: 'system',
      content: state.content,
      sections: Object.fromEntries(state.sections),
      toolsAdded: [...state.tools.values()],
      toolsRemoved: [],
    },
  };
}
