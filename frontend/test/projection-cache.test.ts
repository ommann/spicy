import test from 'node:test';
import assert from 'node:assert/strict';
import { projectChatParts } from '../src/conversation-model.ts';
import { agentStreamEntries } from '../src/agent-conversations.ts';

test('unchanged history retains parts while streamed tool results invalidate their owner', () => {
  const history = { id: 'history', parentId: null, message: { role: 'user', content: 'hello' } };
  const call = { id: 'call', parentId: 'history', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'bash', name: 'bash', arguments: {} }] } };
  const result = text => ({ id: 'result', parentId: 'call', message: { role: 'toolResult', toolCallId: 'bash', content: [{ type: 'text', text }] } });
  const initial = projectChatParts([history, call, result('one')]);
  const updated = projectChatParts([history, call, result('two')]);
  assert.equal(initial.get('history'), updated.get('history'));
  assert.notEqual(initial.get('call'), updated.get('call'));
  assert.equal(updated.get('call')[0].result.content[0].text, 'two');
  const summary = projectChatParts([history, call, { type: 'branch_summary', fromId: 'call' }]);
  assert.notEqual(summary.get('call'), updated.get('call'));
});

test('stream projection is reused until live messages, saved history or branch changes', () => {
  const agent = { agentId: 'a', leafId: 'root', entries: [], live: [{ role: 'user', timestamp: 1, content: 'hello' }] };
  const initial = agentStreamEntries(agent);
  assert.equal(agentStreamEntries(agent), initial);
  agent.leafId = 'other';
  assert.equal(agentStreamEntries(agent)[0].parentId, 'other');
  agent.entries = [{ message: agent.live[0] }];
  assert.deepEqual(agentStreamEntries(agent), []);
  agent.live = [{ role: 'assistant', timestamp: 2, content: [] }];
  assert.equal(agentStreamEntries(agent).length, 1);
  agent.streamUserOnly = true;
  assert.deepEqual(agentStreamEntries(agent), []);
});
