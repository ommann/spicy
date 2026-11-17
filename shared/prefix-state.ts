import type { PrefixState, Wire } from './trace-types.ts';
export type { PrefixState } from './trace-types.ts';

// Replay captured prefix fields along parent links. Never modify trace entries.
function emptyState(): PrefixState {
  return {captured: false, rootId: null, content: '', sections: new Map(), tools: new Map(), key: ''};
}
function applyMessage(previous: PrefixState, message: Wire, sourceId: string): PrefixState {
  const inherited = previous;
  if (message.systemPromptSnapshot) previous = {...emptyState(), rootId: previous.rootId, tools: previous.tools};
  const state: PrefixState = {
    captured: true,
    key: '',
    rootId: previous.rootId || sourceId,
    content: previous.content,
    sections: new Map(previous.sections),
    tools: new Map(previous.tools),
  };
  if (message.content && (typeof message.content !== 'string' || message.content.length)) state.content = message.content;
  for (const [name, value] of Object.entries(message.sections as Record<string, string | null> || {})) {
    if (value === null) state.sections.delete(name);
    else state.sections.set(name, value);
  }
  for (const name of message.toolsRemoved || []) state.tools.delete(name);
  for (const tool of message.toolsAdded || []) state.tools.set(tool.name, tool);
  state.key = JSON.stringify([state.content, [...state.sections], [...state.tools]]);
  state.promptKey = message.systemPromptKey ?? (state.key === inherited.key ? inherited.promptKey : undefined);
  state.promptBuilder = message.promptBuilder ?? (
    !message.systemPromptSnapshot && !message.sections && !message.content?.length ? inherited.promptBuilder : undefined
  );
  return state;
}
export function createPrefixResolver(entries: Wire[]) {
  const byId = new Map(entries.filter(entry => entry.parentId !== undefined).map(entry => [entry.id, entry]));
  const cache = new Map<string, PrefixState>();
  const empty = emptyState();
  function get(id: string | null | undefined): PrefixState {
    if (!id) return empty;
    const cached = cache.get(id);
    if (cached) return cached;
    const chain: Wire[] = [], seen = new Set<string>();
    let cursor = id;
    while (cursor && byId.has(cursor) && !cache.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor);
      const entry = byId.get(cursor);
      if (!entry) break;
      chain.push(entry);
      cursor = entry.parentId;
    }
    let state = (cursor ? cache.get(cursor) : undefined) || empty;
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
    isDelta: (entry: Wire) => entry.message?.role === 'system' && get(entry.parentId).captured,
    changesPrefix: (entry: Wire) => entry.message?.role === 'system' && get(entry.parentId).captured && get(entry.parentId).key !== get(entry.id).key,
  };
}
export function systemEntryForState(source: Wire, state: PrefixState) {
  return {
    ...source,
    type: 'message',
    prefixPreview: false,
    message: {
      ...source.message,
      role: 'system',
      promptBuilder: state.promptBuilder,
      content: state.content,
      sections: Object.fromEntries(state.sections),
      toolsAdded: [...state.tools.values()],
      toolsRemoved: [],
    },
  };
}
