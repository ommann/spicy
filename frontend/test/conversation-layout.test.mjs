import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationGraph, isUnstartedCompaction, layoutConversation, projectChatParts } from '../src/conversation-model.mjs';
import { layoutSingleConversation } from '../src/single-conversation-model.mjs';

test('compaction roots get independent columns and a switchable prompt until their first message', () => {
  const entries = [
    { id: 'original', parentId: null, type: 'message', message: { role: 'user', content: 'Old history' } },
    { id: 'summary', parentId: null, type: 'compaction', summary: 'Compact context', firstKeptEntryId: 'summary' },
    { id: 'prompt', parentId: 'summary', type: 'message', message: {
      role: 'system', content: 'Inherited prompt', systemPromptSnapshot: true,
    } },
  ];
  const graph = createConversationGraph(entries);
  assert.deepEqual(graph.roots.map(node => node.id), ['original', 'summary']);
  assert.deepEqual(graph.leaves.map(node => node.id), ['original', 'prompt']);
  assert.equal(isUnstartedCompaction(graph, 'prompt'), true);
  assert.equal(isUnstartedCompaction(graph, 'original'), false);
  assert.deepEqual(graph.ancestors('prompt'), ['prompt', 'summary']);
  assert.equal(graph.prefix.get('prompt').content, 'Inherited prompt');
  const layout = layoutConversation(graph, { mode: 'side', width: 1040, viewportWidth: 1200, viewportHeight: 800, lane: 1 });
  assert.equal(layout.composers.length, 2);
  const started = createConversationGraph([...entries, {
    id: 'new-message', parentId: 'prompt', type: 'message', message: { role: 'user', content: 'Continue' },
  }]);
  assert.equal(isUnstartedCompaction(started, 'new-message'), false);
});

test('Single view ends at the last card as it grows, while side view retains overscroll', () => {
  const graph = createConversationGraph([
    { id: 'user', parentId: null, type: 'message', message: { role: 'user', content: 'Hello' } },
    { id: 'reply', parentId: 'user', type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Streaming' }] } },
  ]);
  const options = { width: 720, viewportWidth: 1200, viewportHeight: 800, lane: 0 };
  for (const height of [100, 1200, 1800]) {
    const focused = layoutSingleConversation(graph, { ...options, heights: { reply: height } });
    const last = focused.items.get('reply');
    assert.equal(focused.height, last.top + last.height, 'no blank scrollable tail');
    const side = layoutConversation(graph, { ...options, mode: 'side', heights: { reply: height } });
    const composer = side.composers[0];
    assert.equal(side.height, composer.top + composer.height + 600, 'side-view overscroll is unchanged');
  }
});

test('empty chats use a normal first column and composer in both modes', () => {
  for (const mode of ['side', 'focused']) {
    const graph = createConversationGraph([]);
    assert.equal(graph.leaves[0].parts[0].kind, 'draft');
    const layout = (mode === 'focused' ? layoutSingleConversation : layoutConversation)(graph, {
      width: 720, viewportWidth: 1200, viewportHeight: 800, lane: 0,
    });
    assert.deepEqual(layout.starts, [0]);
    assert.equal(layout.composers.length, 1);
    assert.equal(layout.inlineComposers, true, 'Empty focused chat keeps the input next to its placeholders');
    assert.ok(layout.height >= layout.composers[0].top + layout.composers[0].height);
    assert.equal(layout.composers[0].left, layout.inset);
    assert.ok(layout.width >= 720);
    assert.ok(layout.composers[0].top > 84, 'input sits below the separate 60px draft placeholder');
  }
});

test('encrypted thinking displays reported reasoning tokens without inventing block counts', () => {
  const project = (content, reasoning) => projectChatParts([{ id: 'a', type: 'message', message: {
    role: 'assistant', content, usage: { reasoning },
  } }]).get('a');
  const encrypted = { type: 'thinking', thinking: '', thinkingSignature: 'opaque' };
  assert.equal(project([encrypted], 1234)[0].text, 'Encrypted thinking (1,234 tokens)');
  assert.equal(project([encrypted], 0)[0].text, 'Encrypted thinking (0 tokens)');
  assert.equal(project([encrypted], undefined)[0].text, 'Encrypted thinking');
  const consecutive = project([encrypted, encrypted, encrypted], 1234);
  assert.equal(consecutive.length, 1);
  assert.equal(consecutive[0].text, 'Encrypted thinking (1,234 tokens)');
  const separated = project([encrypted, { type: 'text', text: 'Answer' }, encrypted], 1234);
  assert.equal(separated.length, 3);
});

test('prompt references stay in their original columns when hovering later lanes', () => {
  const graph = createConversationGraph([
    { id: 's1', type: 'message', parentId: null, message: { role: 'system', content: 'Original' } },
    { id: 'u1', type: 'message', parentId: 's1', message: { role: 'user', content: 'Hello' } },
    { id: 's2', type: 'message', parentId: 'u1', message: { role: 'system', content: 'Updated', toolsAdded: [{ name: 'read', description: 'Read files' }] } },
    { id: 'u2', type: 'message', parentId: 's2', message: { role: 'user', content: 'Continue' } },
  ]);
  assert.ok(graph.leaves.length > 1);
  const options = { mode: 'side', width: 720, viewportWidth: 1200, viewportHeight: 800 };
  const first = layoutConversation(graph, { ...options, lane: 0 });
  const later = layoutConversation(graph, { ...options, lane: graph.leaves.length - 1 });
  // Prompt references are rendered once per leaf in the fixed prefix row,
  // not as movable system-message cards in the conversation layout.
  assert.deepEqual(later.starts, first.starts);
  assert.deepEqual(graph.leaves.map(leaf => graph.prompts.numberFor(graph.prefix.get(leaf.id))), [1, 2]);
  for (const id of ['s1', 's2']) assert.equal(later.items.get(id).hidden, true);
  assert.equal(graph.prompts.numberFor(graph.prefix.get('s1')), 1);
  assert.equal(graph.prompts.numberFor(graph.prefix.get('s2')), 2);
});
