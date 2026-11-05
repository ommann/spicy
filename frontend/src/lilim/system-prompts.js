import { SAVED_SYSTEM_PROMPT_ENTRY } from '../../../packages/coding-agent/src/core/system-prompt-document.ts';
import { createPrefixResolver, systemEntryForState } from './prefix-state.js';
import { diffLines, diffPrefixes } from './prefix-diff.js';

// Show all system instructions, including the available tool definitions.
export function systemPromptText(state) {
  const content = typeof state.content === 'string' ? state.content
    : (state.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
  const tools = state.tools.size ? `## Tool definitions\n\n${JSON.stringify([...state.tools.values()], null, 2)}` : '';
  return [content, ...state.sections.values(), tools].filter(text => text !== null && text.length > 0).join('\n\n');
}

export function promptDocument(before, after) {
  const rows = diffLines(systemPromptText(before), systemPromptText(after));
  return [{ name: 'content', hunks: [{ rows }] }];
}

// Reply chunks change message bodies, not prompt history. Keep expensive prompt
// serialization and diffs out of that hot path while tracking all parent links.
export function createMemoizedSystemPromptCatalog() {
  let previous = [];
  let catalog;
  return entries => {
    const inputs = entries.map(entry => [entry.id, entry.parentId, entry.type,
      entry.message?.role, entry.message?.role === 'system' ? entry.message : undefined,
      entry.systemMessage, entry.systemPromptKey, entry.customType,
      entry.type === 'custom' && entry.customType === SAVED_SYSTEM_PROMPT_ENTRY ? entry.data : undefined]);
    if (!catalog || inputs.length !== previous.length || inputs.some((fields, index) =>
      fields.some((value, field) => value !== previous[index][field]))) {
      catalog = createSystemPromptCatalog(entries);
      previous = inputs;
    }
    return catalog;
  };
}

// Number captured prompt states in recording order, independently of the active lane.
export function createSystemPromptCatalog(entries) {
  const prefix = createPrefixResolver(entries);
  const numbers = new Map();
  const versions = [];
  for (const recorded of entries) {
    const saved = recorded.type === 'custom' && recorded.customType === SAVED_SYSTEM_PROMPT_ENTRY;
    const entry = saved ? { ...recorded, parentId: null, systemPromptKey: recorded.id, message: {
      role: 'system', ...recorded.data.output, toolsAdded: recorded.data.toolsAdded,
      promptBuilder: { document: recorded.data.document, excludedIds: recorded.data.excludedIds },
    } } : recorded;
    if (entry.message?.role !== 'system' && !(entry.type === 'compaction' && entry.systemMessage)) continue;
    const state = saved ? createPrefixResolver([entry]).get(entry.id) : prefix.get(entry.id);
    if (!state.captured) continue;
    const text = systemPromptText(state);
    const key = entry.systemPromptKey ?? state.promptKey ?? text;
    if (numbers.has(key)) continue;
    const number = versions.length + 1;
    const previous = prefix.get(entry.parentId);
    const previousText = previous.captured ? systemPromptText(previous) : undefined;
    const previousKey = previous.promptKey ?? previousText;
    const previousNumber = numbers.get(previousKey);
    numbers.set(key, number);
    versions.push({
      key,
      number,
      previousNumber,
      priorityReason: previous.captured && (entry.message?.toolsAdded?.length || entry.message?.toolsRemoved?.length)
        ? 'Priority: tool definitions changed.' : undefined,
      full: systemEntryForState(entry, state),
      unified: {
        ...entry, message: { role: 'system' }, prefixPreview: true, unifiedDiff: true,
        prefixDiff: promptDocument(previous.captured ? previous : state, state),
      },
      previousKey,
      detail: previous.captured
        ? { ...entry, message: { role: 'system' }, prefixPreview: true, prefixDiff: diffPrefixes(previous, state) }
        : systemEntryForState(entry, state),
    });
  }
  versions.sort((left, right) => left.number - right.number);
  return { versions, numberFor: state => state?.captured ? numbers.get(state.promptKey ?? systemPromptText(state)) : undefined };
}
