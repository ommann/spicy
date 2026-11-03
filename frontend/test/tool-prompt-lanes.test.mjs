import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationGraph, layoutConversation } from '../src/conversation-model.mjs';

const entries = [
  { id: 'original', parentId: null, type: 'message', message: { role: 'system', content: 'Instructions' } },
  { id: 'hello', parentId: 'original', type: 'message', message: { role: 'user', content: 'Hello' } },
  { id: 'search', parentId: 'hello', type: 'message', message: { role: 'assistant', content: [
    { type: 'toolCall', id: 'call', name: 'tool_search', arguments: { query: 'search' } },
  ] } },
  { id: 'result', parentId: 'search', type: 'message', message: {
    role: 'toolResult', toolCallId: 'call', toolName: 'tool_search', content: [{ type: 'text', text: 'Loaded tool' }],
  } },
  { id: 'updated', parentId: 'result', type: 'message', message: { role: 'system', toolsAdded: [
    { name: 'search_procedures', description: 'Search procedures', parameters: { type: 'object' } },
  ] } },
  { id: 'answer', parentId: 'updated', type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Found it' }] } },
];

test('loaded tools add a parallel prompt lane without replacing earlier history', () => {
  const original = structuredClone(entries);
  const graph = createConversationGraph(entries);
  assert.deepEqual(graph.leaves.map(leaf => leaf.id), ['search', 'answer']);
  assert.deepEqual(graph.leaves.map(leaf => graph.prompts.numberFor(graph.prefix.get(leaf.id))), [1, 2]);
  assert.equal(graph.activeLeaf.id, 'answer');
  const options = { mode: 'side', width: 720, viewportWidth: 1200, viewportHeight: 800 };
  for (const lane of [0, 1]) {
    const layout = layoutConversation(graph, { ...options, lane });
    assert.equal(layout.items.get('hello').column, lane);
    assert.equal(layout.items.get('search').column, lane);
    assert.equal(layout.items.get('answer').column, 1);
    assert.ok(layout.items.get('answer').top > layout.items.get('search').top);
    assert.ok(layout.paths.some(path => path.id === 'answer' && path.fork));
  }
  const focused = layoutConversation(graph, { ...options, mode: 'focused', lane: 0 });
  assert.equal(focused.items.get('answer').hidden, true);
  assert.deepEqual(entries, original);
});

test('repeating an unchanged tool definition does not create another lane', () => {
  const graph = createConversationGraph([...entries,
    { ...entries[4], id: 'unchanged', parentId: 'answer' },
    { id: 'last', parentId: 'unchanged', type: 'message', message: { role: 'user', content: 'Continue' } },
  ]);
  assert.deepEqual(graph.leaves.map(leaf => leaf.id), ['search', 'last']);
});
