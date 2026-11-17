import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseBashCommand } from '../src/bash-command.ts';
import { applyRecord } from '../src/stream.ts';

test('shell prefixes select model context without changing the command body', () => {
  assert.deepEqual(parseBashCommand('! pwd'), { type: 'bash', command: 'pwd', excludeFromContext: false });
  assert.deepEqual(parseBashCommand('!!echo "!"'), { type: 'bash', command: 'echo "!"', excludeFromContext: true });
  assert.equal(parseBashCommand('hello!'), undefined);
  assert.throws(() => parseBashCommand('!!  '), /empty/);
  assert.throws(() => parseBashCommand('!pwd', true), /image/);
});

test('shell output streams separately from assistant messages and is removed on completion', () => {
  const messages = [{ role: 'assistant', content: [] }];
  let live = applyRecord(messages, { type: 'bash_execution_start', command: 'pwd', excludeFromContext: true, timestamp: 1 });
  live = applyRecord(live, { type: 'bash_execution_update', delta: '/tmp' });
  live = applyRecord(live, { type: 'bash_execution_update', delta: '\n' });
  assert.equal(live[1].output, '/tmp\n');
  assert.equal(live[1].excludeFromContext, true);
  assert.deepEqual(applyRecord(live, { type: 'bash_execution_end' }), messages);
});
