import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { historyCards } from '../history.ts';
import { treePreviewCache, withDatabase, writeStoredHistory, appendStoredEntry } from '../../packages/coding-agent/src/core/session-storage.ts';
import { cachedPreviews } from '../preview-cache.ts';
import { changeBranchLabel } from '../branch-labels.ts';

function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'spicy-preview-cache-'));
  const previous = process.env.SPICY_HISTORY_DB;
  process.env.SPICY_HISTORY_DB = join(directory, 'history.sqlite');
  t.onTestFinished(() => {
    if (previous === undefined) delete process.env.SPICY_HISTORY_DB;
    else process.env.SPICY_HISTORY_DB = previous;
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

test('cached output bypasses building until saved history or labels change', async t => {
  const directory = setup(t);
  let builds = 0;
  const build = async () => ({ builds: ++builds, rows: [] });
  assert.equal((await cachedPreviews(directory, build)).builds, 1);
  assert.equal((await cachedPreviews(directory, build)).builds, 1);
  const session = join(directory, 'session.jsonl');
  writeStoredHistory(session, [{ type: 'session', version: 3, id: 'session', timestamp: new Date().toISOString(), cwd: directory }]);
  assert.equal((await cachedPreviews(directory, build)).builds, 2);
  appendStoredEntry(session, { type: 'message', id: 'user', parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: 'hello', timestamp: Date.now() } });
  assert.equal((await cachedPreviews(directory, build)).builds, 3);
  changeBranchLabel(directory, { key: 'lane:user', label: { text: 'WORK', color: 'blue' } });
  assert.equal((await cachedPreviews(directory, build)).builds, 4);
  assert.equal((await cachedPreviews(directory, build)).builds, 4);
  changeBranchLabel(directory, { key: 'lane:user' });
  assert.equal((await cachedPreviews(directory, build)).builds, 5);
});

test('concurrent readers share a build; changes during it prevent caching outdated output', async t => {
  const directory = setup(t);
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  let builds = 0;
  const build = async () => { builds++; await wait; return { builds }; };
  const first = cachedPreviews(directory, build);
  const second = cachedPreviews(directory, build);
  assert.equal(builds, 1);
  changeBranchLabel(directory, { key: 'lane:x', label: { text: 'NEW', color: 'red' } });
  release();
  await Promise.all([first, second]);
  assert.equal((await cachedPreviews(directory, async () => ({ builds: ++builds }))).builds, 2);
  assert.equal((await cachedPreviews(directory, async () => ({ builds: ++builds }))).builds, 2);
});

test('editing one chat rebuilds only its tree; labels and new branches invalidate their own tree', async t => {
  const directory = setup(t);
  const files = ['a', 'b'].map(id => join(directory, id + '.jsonl'));
  for (const [index, file] of files.entries()) writeStoredHistory(file, [
    { type: 'session', version: 3, id: String(index), timestamp: new Date().toISOString(), cwd: directory },
    { type: 'message', id: 'entry-' + index, parentId: null, timestamp: new Date().toISOString(),
      message: { role: 'user', content: 'chat ' + index, timestamp: Date.now() } },
  ]);
  const first = await historyCards(directory);
  assert.equal(first.length, 2);
  // Mark B's stored preview, so the marker survives only if B is actually reused.
  const cached = withDatabase(directory, false, db => db.select().from(treePreviewCache).all())!;
  const b = cached.find(row => row.key.endsWith(files[1]))!;
  const card = JSON.parse(b.payload);
  card.latest.text = 'cached B';
  withDatabase(directory, true, db => db.update(treePreviewCache).set({ payload: JSON.stringify(card) })
    .where(eq(treePreviewCache.key, b.key)).run());
  appendStoredEntry(files[0], { type: 'message', id: 'new-a', parentId: 'entry-0', timestamp: new Date().toISOString(),
    message: { role: 'assistant', content: 'new A', timestamp: Date.now() + 1 } });
  const second = await historyCards(directory);
  assert.ok(second.some(card => card.latest?.text === 'new A'));
  assert.ok(second.some(card => card.latest?.text === 'cached B'), 'Unchanged B comes from its own cache');
  changeBranchLabel(directory, { key: 'lane:entry-1', label: { text: 'B', color: 'blue' } });
  const third = await historyCards(directory);
  const rebuiltB = third.find(card => card.latest?.text === 'chat 1')!;
  assert.ok(rebuiltB.rows.some(row => row.labels.some(label => label.text === 'B')));
  const branch = join(directory, 'branch.jsonl');
  writeStoredHistory(branch, [
    { type: 'session', version: 3, id: 'branch', parentSession: files[1], timestamp: new Date().toISOString(), cwd: directory },
    { type: 'message', id: 'branch-user', parentId: null, timestamp: new Date().toISOString(),
      message: { role: 'user', content: 'new branch', timestamp: Date.now() + 2 } },
  ]);
  const fourth = await historyCards(directory);
  assert.equal(fourth.length, 2);
  assert.ok(fourth.some(card => card.latest?.text === 'new branch'));
});
