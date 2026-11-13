import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { PiRpc } from '../rpc.ts';

test('web bridge and agent use the local fork without built packages', { timeout: 20000 }, async t => {
  const repository = new URL('../../', import.meta.url);
  assert.equal(
    import.meta.resolve('@earendil-works/pi-coding-agent'),
    new URL('packages/coding-agent/src/index.ts', repository).href,
  );
  const rpc = new PiRpc();
  t.after(() => rpc.stop());
  const state = await rpc.start(process.execPath, [
    '--import', new URL('packages/coding-agent/src/experimental/source-resolver.ts', repository).href,
    fileURLToPath(new URL('packages/coding-agent/src/cli.ts', repository)),
    '--mode', 'rpc', '--no-session', '--no-extensions', '--no-skills', '--no-prompt-templates',
  ], fileURLToPath(repository));
  assert.equal(typeof state.sessionId, 'string');
  const result = await rpc.command({ type: 'get_entries' });
  assert.ok(Array.isArray(result.entries));
  assert.equal(result.entries.some(entry => entry.type === 'message'), false);
});
