import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCompactionCommand } from '../src/compaction-command.mjs';

test('compact selects a method and keeps optional instructions', () => {
  for (const [command, method, customInstructions] of [
    ['/compact', 1, undefined],
    ['/compact 1', 1, undefined],
    ['/compact 2', 2, undefined],
    [' /compact 2 keep the paths ', 2, 'keep the paths'],
    ['/compact 1 keep the paths', 1, 'keep the paths'],
    ['/compact keep the paths', 1, 'keep the paths'],
  ]) assert.deepEqual(parseCompactionCommand(command), { method, customInstructions });
});

test('compact rejects unknown numbers and does not catch ordinary messages', () => {
  assert.throws(() => parseCompactionCommand('/compact 3'), /Unknown compaction method/);
  assert.throws(() => parseCompactionCommand('/compact 0 keep paths'), /Unknown compaction method/);
  for (const message of ['hello', '/compaction', 'please /compact 2']) assert.equal(parseCompactionCommand(message), null);
});
