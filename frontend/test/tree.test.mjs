import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRecord } from '../src/stream.mjs';
import { createPrefixResolver } from '../src/chat/prefix-state.js';
import { diffPrefixes } from '../src/prefix-diff.js';

test('existing spicy prefix replay and diffs remain branch-relative', () => {
  const entries = [
    { id: 'root', parentId: null, message: { role: 'system', sections: { cwd: '/project', rules: 'one' } } },
    { id: 'left', parentId: 'root', message: { role: 'system', sections: { rules: 'two' } } },
    { id: 'right', parentId: 'root', message: { role: 'user', content: 'Original rules' } },
  ];
  const prefix = createPrefixResolver(entries);
  assert.equal(prefix.get('left').sections.get('rules'), 'two');
  assert.equal(prefix.get('right').sections.get('rules'), 'one');
  assert.equal(diffPrefixes(prefix.get('root'), prefix.get('left'))[0].name, 'sections.rules');
});

test('tool output arrives before completion and the final message replaces it', () => {
  const update = (messages, id, text) => applyRecord(messages, {
    type: 'tool_execution_update', toolCallId: id, toolName: 'bash',
    partialResult: { content: [{ type: 'text', text }] },
  });
  let messages = update([], 'a', 'first\n');
  const previous = messages;
  messages = update(messages, 'a', 'first\nsecond\n');
  assert.equal(previous[0].content[0].text, 'first\n');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content[0].text, 'first\nsecond\n');
  messages = update(messages, 'b', 'other command');
  const final = { role: 'toolResult', toolCallId: 'a', toolName: 'bash', timestamp: 42,
    content: [{ type: 'text', text: 'complete' }] };
  messages = applyRecord(messages, { type: 'message_start', message: final });
  messages = applyRecord(messages, { type: 'message_end', message: final });
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], final);
  assert.equal(messages[1].toolCallId, 'b');
});

test('RPC deltas reconstruct partial messages and final messages replace them', () => {
  let messages = applyRecord([], { type: 'message_start', message: { role: 'assistant', timestamp: 1, stopReason: 'pending', content: [] } });
  const update = event => { messages = applyRecord(messages, { type: 'message_update', assistantMessageEvent: event }); };
  update({ type: 'text_delta', contentIndex: 0, delta: 'Hello ' });
  const previous = messages;
  update({ type: 'text_delta', contentIndex: 0, delta: 'world' });
  assert.equal(previous[0].content[0].text, 'Hello ', 'Published messages stay immutable');
  assert.equal(messages[0].content[0].text, 'Hello world');
  const final = { role: 'assistant', timestamp: 1, stopReason: 'stop', content: [{ type: 'text', text: 'Authoritative' }] };
  messages = applyRecord(messages, { type: 'message_end', message: final });
  assert.deepEqual(messages, [final]);

  messages = [{ ...final, stopReason: 'pending', content: [final.content[0], { type: 'toolCall', id: 'call', partial: '' }] }];
  const beforeToolDelta = messages;
  update({ type: 'toolcall_delta', contentIndex: 1, delta: '{' });
  assert.equal(messages[0].content[0], beforeToolDelta[0].content[0], 'Unchanged blocks are shared, not deep-copied');
  assert.equal(beforeToolDelta[0].content[1].partial, '');
  assert.equal(messages[0].content[1].partial, '{');
});
