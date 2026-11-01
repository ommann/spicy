import test from 'node:test';
import assert from 'node:assert/strict';
import register from '../tree-navigation.mjs';

test('web reload command reloads resources without sending a model prompt', async () => {
  const commands = new Map();
  register({ registerCommand: (name, command) => commands.set(name, command) });
  let reloads = 0;
  await commands.get('lilim-reload').handler('', { reload: async () => { reloads++; } });
  assert.equal(reloads, 1);
});
