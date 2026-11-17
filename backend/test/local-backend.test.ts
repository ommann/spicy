import { test } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PiRpc } from '../rpc.ts';

test('web bridge and agent use the local fork without built packages', { timeout: 20000 }, async t => {
  const repository = new URL('../../', import.meta.url);
  // Check production Node resolution, not Vitest's module aliases.
  const resolved = execFileSync(process.execPath, [
    '--import', new URL('packages/coding-agent/src/experimental/source-resolver.ts', repository).href,
    '--input-type=module', '--eval', "console.log(import.meta.resolve('@earendil-works/pi-coding-agent'))",
  ], { cwd: fileURLToPath(repository), encoding: 'utf8' }).trim();
  assert.equal(
    resolved,
    new URL('packages/coding-agent/src/index.ts', repository).href,
  );
  const rpc = new PiRpc();
  t.onTestFinished(() => rpc.stop());
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
