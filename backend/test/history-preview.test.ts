import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareHistory, presentHistoryRows } from '../history-preview.ts';
import { changeBranchLabel, readBranchLabels } from '../branch-labels.ts';

test('branch labels persist, transfer and clear in SQLite', t => {
  const directory = mkdtempSync(join(tmpdir(), 'spicy-labels-'));
  const previous = process.env.SPICY_HISTORY_DB;
  process.env.SPICY_HISTORY_DB = join(directory, 'history.sqlite');
  t.after(() => {
    if (previous === undefined) delete process.env.SPICY_HISTORY_DB;
    else process.env.SPICY_HISTORY_DB = previous;
    rmSync(directory, { recursive: true, force: true });
  });
  assert.deepEqual(readBranchLabels(directory), {});
  const label = { text: 'WORK', color: 'blue' };
  changeBranchLabel(directory, { key: 'lane:a', label });
  assert.deepEqual(readBranchLabels(directory), { 'lane:a': label });
  changeBranchLabel(directory, { key: 'lane:b', from: 'lane:a' });
  changeBranchLabel(directory, { key: 'lane:b', from: 'lane:b' });
  assert.deepEqual(readBranchLabels(directory), { 'lane:b': label });
  changeBranchLabel(directory, { key: 'lane:b' });
  assert.deepEqual(readBranchLabels(directory), {});
});

test('previews deduplicate branches, link rows and attach labels without returning entries', () => {
  const entry = (id: string, parentId: string | null, role: string, content: string) => ({ id, parentId, type: 'message', message: { role, content } });
  const a = entry('a', null, 'user', 'First');
  const b = entry('b', 'a', 'assistant', 'Reply');
  const c = entry('c', 'a', 'user', 'Branch');
  const label = { text: 'WORK', color: 'blue' };
  const result = prepareHistory([
    { entries: [a, b], state: { sessionUrlId: 'first' } },
    { entries: [a, c], state: { sessionUrlId: 'second' } },
  ], { 'lane:c': label });
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[0].href, '/b/first');
  assert.deepEqual(result.rows.map(row => row.id), ['a', 'b', 'c']);
  assert.equal(result.rows[2].href, '/b/second');
  assert.deepEqual(result.rows[2].labels, [label]);
  assert.equal(result.rows[2].padding, '2ch');
  assert.ok(result.rows.every(row => !('children' in row)));
  assert.ok(!('entries' in result));
});

test('display rows collapse chains, normalize text and gather labels on the backend', () => {
  const end = { id: 'b', text: ' Last\n reply ', href: '/b/end', user: false, associatedPrompt: 2,
    label: { text: 'END', color: 'blue' }, annotation: ' Saved\n title ', children: [] };
  const rows = presentHistoryRows([{ id: 'a', text: ' First\n question ', href: '/b/start', user: true,
    associatedPrompt: 2, compactionStart: true, label: { text: 'START', color: 'red' }, children: [end] }]);
  assert.deepEqual(rows, [{
    id: 'a', text: 'First question', href: '/b/start', user: true,
    end: { text: 'Last reply', href: '/b/end', user: false },
    prompt: '#2', compactionStart: true, padding: '0ch',
    labels: [{ text: 'START', color: 'red' }, { text: 'END', color: 'blue' }], annotation: 'Saved title',
  }]);
});
