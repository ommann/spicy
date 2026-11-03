import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationGraph, layoutConversation, projectChatParts } from '../src/conversation-model.mjs';

test('empty chats use a normal first column and composer in both modes', () => {
  for (const mode of ['side', 'focused']) {
    const graph = createConversationGraph([]);
    assert.equal(graph.leaves[0].parts[0].kind, 'draft');
    const layout = layoutConversation(graph, {
      mode, width: 720, viewportWidth: 1200, viewportHeight: 800, lane: 0,
    });
    assert.deepEqual(layout.starts, [0]);
    assert.equal(layout.composers.length, 1);
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
