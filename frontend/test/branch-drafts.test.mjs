import test from 'node:test';
import assert from 'node:assert/strict';
import { hasCommittedDraft } from '../src/branch-drafts.mjs';

const draft = { parentId: 'fork', text: 'New message', sentAt: 100 };
const user = parentId => ({ id: 'user', parentId, message: { role: 'user', content: draft.text, timestamp: 101 } });

test('committed branch replaces its optimistic copy across system-prompt deltas', () => {
  const entries = [
    { id: 'delta1', parentId: 'fork', message: { role: 'system', sections: { tools: 'changed' } } },
    { id: 'delta2', parentId: 'delta1', message: { role: 'system', toolsAdded: [] } },
    user('delta2'),
  ];
  assert.equal(hasCommittedDraft(entries, draft), true);
  assert.equal(hasCommittedDraft([user('fork')], draft), true);
  assert.equal(hasCommittedDraft(entries, { ...draft, sentAt: undefined }), false);
  assert.equal(hasCommittedDraft(entries, { ...draft, text: 'Different message' }), false);
  assert.equal(hasCommittedDraft(entries, { ...draft, parentId: 'other fork' }), false);
});

test('other conversation messages are not transparent branch ancestors', () => {
  const entries = [
    { id: 'reply', parentId: 'fork', message: { role: 'assistant', content: [] } },
    user('reply'),
  ];
  assert.equal(hasCommittedDraft(entries, draft), false);
  assert.equal(hasCommittedDraft([{ ...user('fork'), message: { role: 'user', content: draft.text } }], draft), false);
});
