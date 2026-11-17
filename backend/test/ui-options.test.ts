import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readUiOptions, changeUiOptions } from '../ui-options.ts';
import { defaultUiOptions } from '../../shared/ui-options.ts';
import { uiOptionsInput } from '../inputs.ts';

test('UI preferences persist in the selected SQLite database and remain isolated', t => {
  const directory = mkdtempSync(join(tmpdir(), 'spicy-options-'));
  const previous = process.env.SPICY_HISTORY_DB;
  t.onTestFinished(() => {
    if (previous === undefined) delete process.env.SPICY_HISTORY_DB;
    else process.env.SPICY_HISTORY_DB = previous;
    rmSync(directory, { recursive: true, force: true });
  });
  const first = join(directory, 'first.sqlite');
  process.env.SPICY_HISTORY_DB = first;
  assert.deepEqual(readUiOptions(directory), defaultUiOptions);
  changeUiOptions(directory, { codeLinewrap: true, chatArrowCursor: true, pasteImagePaths: true, viewMode: 'focused' });
  assert.deepEqual(readUiOptions(directory), {
    codeLinewrap: true, chatArrowCursor: true, pasteImagePaths: true, viewMode: 'focused',
  });
  changeUiOptions(directory, { codeLinewrap: false });
  assert.equal(readUiOptions(directory).codeLinewrap, false);
  assert.equal(readUiOptions(directory).chatArrowCursor, true);
  process.env.SPICY_HISTORY_DB = join(directory, 'second.sqlite');
  assert.deepEqual(readUiOptions(directory), defaultUiOptions);
  changeUiOptions(directory, { viewMode: 'side' });
  process.env.SPICY_HISTORY_DB = first;
  assert.equal(readUiOptions(directory).viewMode, 'focused');
});

test('UI option input rejects unknown keys and invalid values', () => {
  assert.equal(uiOptionsInput.safeParse({ codeLinewrap: 'true' }).success, false);
  assert.equal(uiOptionsInput.safeParse({ viewMode: 'unknown' }).success, false);
  assert.equal(uiOptionsInput.safeParse({ other: true }).success, false);
  assert.deepEqual(uiOptionsInput.parse({ codeLinewrap: false }), { codeLinewrap: false });
});
