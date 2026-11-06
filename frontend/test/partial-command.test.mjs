import test from 'node:test';
import assert from 'node:assert/strict';
import { partialCommand } from '../src/partial-command.mjs';

test('bash heredocs appear progressively at every JSON chunk boundary', () => {
  const command = 'cat <<\'EOF\' > file.txt\nhello "world"\\path\nEOF\n';
  const json = JSON.stringify({ command });
  let previous = '';
  for (let i = 0; i <= json.length; i++) {
    const value = partialCommand(json.slice(0, i));
    assert.ok(command.startsWith(value));
    assert.ok(value.startsWith(previous));
    previous = value;
  }
  assert.equal(previous, command);
});

test('incomplete escapes wait without losing already streamed command text', () => {
  assert.equal(partialCommand('{"command":"echo \\u00'), 'echo ');
  assert.equal(partialCommand('{"command":"echo \\u0041'), 'echo A');
  assert.equal(partialCommand('{'), '');
  assert.equal(partialCommand('{"timeout":10,"command":"echo hi'), 'echo hi');
});
