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

// Number captured prompt states in recording order, independently of the active lane.
export function createSystemPromptCatalog(entries, assignedNumbers = new Map()) {
  const prefix = createPrefixResolver(entries);
  const numbers = new Map();
  const versions = [];
  for (const entry of entries) {
    if (entry.message?.role !== 'system' && !(entry.type === 'compaction' && entry.systemMessage)) continue;
    const state = prefix.get(entry.id);
    if (!state.captured) continue;
    const text = systemPromptText(state);
    if (numbers.has(text)) continue;
    if (!assignedNumbers.has(text)) assignedNumbers.set(text, Math.max(0, ...assignedNumbers.values()) + 1);
    const number = assignedNumbers.get(text);
    const previous = prefix.get(entry.parentId);
    const previousText = previous.captured ? systemPromptText(previous) : undefined;
    const previousNumber = numbers.get(previousText);
    numbers.set(text, number);
    versions.push({
      key: text,
      number,
      previousNumber,
      priorityReason: previous.captured && (entry.message?.toolsAdded?.length || entry.message?.toolsRemoved?.length)
        ? 'Priority: tool definitions changed.' : undefined,
      full: systemEntryForState(entry, state),
      unified: {
        ...entry, message: { role: 'system' }, prefixPreview: true, unifiedDiff: true,
        prefixDiff: promptDocument(previous.captured ? previous : state, state),
      },
      previousKey: previousText,
      detail: previous.captured
        ? { ...entry, message: { role: 'system' }, prefixPreview: true, prefixDiff: diffPrefixes(previous, state) }
        : systemEntryForState(entry, state),
    });
  }
  versions.sort((left, right) => left.number - right.number);
  return { versions, numberFor: state => state?.captured ? numbers.get(systemPromptText(state)) : undefined };
}
