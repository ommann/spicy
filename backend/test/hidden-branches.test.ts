import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changeHiddenBranch, readHiddenBranches } from '../hidden-branches.ts';
import { hiddenBranchInput } from '../inputs.ts';

test('hidden branches persist, transfer, unhide and remain database-scoped', t => {
  const directory = mkdtempSync(join(tmpdir(), 'spicy-hidden-'));
  const previous = process.env.SPICY_HISTORY_DB;
  t.after(() => {
    if (previous === undefined) delete process.env.SPICY_HISTORY_DB;
    else process.env.SPICY_HISTORY_DB = previous;
    rmSync(directory, { recursive: true, force: true });
  });
  const first = join(directory, 'first.sqlite');
  process.env.SPICY_HISTORY_DB = first;
  assert.deepEqual(readHiddenBranches(directory), []);
  changeHiddenBranch(directory, { leafId: 'a', hidden: true });
  changeHiddenBranch(directory, { leafId: 'a', hidden: true });
  changeHiddenBranch(directory, { leafId: 'other', hidden: true });
  changeHiddenBranch(directory, { from: 'a', to: 'b' });
  changeHiddenBranch(directory, { from: 'b', to: 'b' });
  changeHiddenBranch(directory, { from: 'missing', to: 'unexpected' });
  assert.deepEqual(readHiddenBranches(directory).sort(), ['b', 'other']);
  process.env.SPICY_HISTORY_DB = join(directory, 'second.sqlite');
  assert.deepEqual(readHiddenBranches(directory), []);
  process.env.SPICY_HISTORY_DB = first;
  changeHiddenBranch(directory, { leafId: 'b', hidden: false });
  changeHiddenBranch(directory, { from: 'b', to: 'c' });
  assert.deepEqual(readHiddenBranches(directory), ['other']);
});

test('hidden branch input rejects invalid changes', () => {
  assert.equal(hiddenBranchInput.safeParse({ leafId: '', hidden: true }).success, false);
  assert.equal(hiddenBranchInput.safeParse({ leafId: 'a', hidden: 'true' }).success, false);
  assert.equal(hiddenBranchInput.safeParse({ from: 'a' }).success, false);
});
