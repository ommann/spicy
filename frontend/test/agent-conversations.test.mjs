import test from 'node:test';
import assert from 'node:assert/strict';
import { agentForEntry, agentForLeaf, agentStreamEntries, mergeAgentEntries } from '../src/agent-conversations.mjs';
import { createConversationGraph, matchConversationLanes } from '../src/conversation-model.mjs';

const message = (id, parentId, role, text) => ({ id, parentId, type: 'message', message: { role,
  content: role === 'user' ? text : [{ type: 'text', text }] } });
const base = [message('user', null, 'user', 'Shared request'), message('answer', 'user', 'assistant', 'Shared answer')];
const agent = (id, entries = base, live = []) => ({ agentId: id, entries, leafId: entries.at(-1)?.id ?? null, live });

test('shared ancestry appears once and each live stream has its own IDs and parents', () => {
  const left = agent('left', base, [{ role: 'user', content: 'Left' }, { role: 'assistant', content: [{ type: 'text', text: 'Left response' }] }]);
  const right = agent('right', base, [{ role: 'user', content: 'Right' }, { role: 'assistant', content: [{ type: 'text', text: 'Right response' }] }]);
  const entries = mergeAgentEntries([left, right]);
  assert.equal(entries.length, 6);
  assert.deepEqual(agentStreamEntries(left).map(entry => entry.parentId), ['answer', 'stream-left-0']);
  assert.deepEqual(agentStreamEntries(right).map(entry => entry.parentId), ['answer', 'stream-right-0']);
  const graph = createConversationGraph(entries);
  assert.equal(graph.leaves.length, 2);
  assert.equal(agentForLeaf(graph, [left, right], 'stream-left-1').agentId, 'left');
  assert.equal(agentForLeaf(graph, [left, right], 'stream-right-1').agentId, 'right');
  assert.equal(agentForEntry([left, right], 'answer', 'right').agentId, 'right');
  assert.equal(agentForEntry([left, right], 'missing'), undefined);
});

test('a stream settling first does not exchange column identities or drafts', () => {
  const live = text => [{ role: 'user', content: text }, { role: 'assistant', content: [{ type: 'text', text: `${text} response` }] }];
  const left = agent('left', base, live('Left'));
  const right = agent('right', base, live('Right'));
  const before = matchConversationLanes(createConversationGraph(mergeAgentEntries([left, right])));
  const savedRight = agent('right', [...base, message('right-user', 'answer', 'user', 'Right'), message('right-answer', 'right-user', 'assistant', 'Right response')]);
  const during = matchConversationLanes(createConversationGraph(mergeAgentEntries([left, savedRight])), before);
  assert.deepEqual(during.map(lane => lane.key), before.map(lane => lane.key));
  assert.deepEqual(during.map(lane => lane.leafId), ['stream-left-1', 'right-answer']);
  const savedLeft = agent('left', [...base, message('left-user', 'answer', 'user', 'Left'), message('left-answer', 'left-user', 'assistant', 'Left response')]);
  const after = matchConversationLanes(createConversationGraph(mergeAgentEntries([savedLeft, savedRight])), during);
  assert.deepEqual(after.map(lane => lane.key), before.map(lane => lane.key));
});

test('a branch before the first message keeps its input column through streaming and persistence', () => {
  const draft = { id: 'draft', parentId: null, type: 'branch_draft', draftSourceId: 'user', optimistic: true };
  const before = matchConversationLanes(createConversationGraph([...base, draft]));
  const origins = { fork: { draftId: 'draft', baseline: [] } };
  const streaming = agent('fork', [], [{ role: 'user', content: 'Edited root' }, { role: 'assistant', content: [{ type: 'text', text: 'New response' }] }]);
  const during = matchConversationLanes(createConversationGraph(mergeAgentEntries([agent('source'), streaming], origins)), before);
  assert.equal(during.find(lane => lane.leafId === 'stream-fork-1').key, before.find(lane => lane.leafId === 'draft').key);
  const saved = agent('fork', [message('fork-user', null, 'user', 'Edited root'), message('fork-answer', 'fork-user', 'assistant', 'New response')]);
  const after = matchConversationLanes(createConversationGraph(mergeAgentEntries([agent('source'), saved], origins)), during);
  assert.equal(after.find(lane => lane.leafId === 'fork-answer').key, before.find(lane => lane.leafId === 'draft').key);
});

test('hidden metadata and pending empty messages still route a column to its own agent', () => {
  const metadata = { id: 'metadata', parentId: 'answer', type: 'custom', customType: 'test' };
  const left = agent('left', [...base, metadata], [{ role: 'assistant', content: [], stopReason: 'pending' }]);
  const graph = createConversationGraph(mergeAgentEntries([left]));
  assert.equal(agentForLeaf(graph, [left], 'answer').agentId, 'left');
  assert.equal(agentForLeaf(graph, [left], 'unknown'), undefined);
});
