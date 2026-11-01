import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { PiRpc } from '../rpc.mjs';
const fixture = fileURLToPath(new URL('./fake-pi.mjs', import.meta.url));
test('RPC correlates concurrent commands and preserves Unicode separators in JSONL', async () => {
  const rpc = new PiRpc();
  try {
    await rpc.start(process.execPath, [fixture], process.cwd());
    const results = await Promise.all([rpc.command({ type: 'echo', value: 'a\u2028b\u2029c' }), rpc.command({ type: 'echo', value: 'second' })]);
    assert.deepEqual(results, ['a\u2028b\u2029c', 'second']);
    await assert.rejects(rpc.command({ type: 'unknown' }), /Unsupported/);
    const settled = new Promise(resolve => rpc.on('record', record => { if (record.type === 'agent_settled') resolve(); }));
    await rpc.command({ type: 'prompt', message: 'hello' });
    await settled;
    const state = await rpc.command({ type: 'get_entries' });
    assert.equal(state.entries.length, 2);
    assert.equal(state.entries[1].message.content[0].text, 'Hello\u2028from fake Pi.');
  } finally { await rpc.stop(); }
});
test('startup failures reject pending requests and leave client disconnected', async () => {
  const rpc = new PiRpc();
  await assert.rejects(rpc.start('/does/not/exist/lilim-pi', [], process.cwd()), /ENOENT/);
  assert.equal(rpc.child, null);
  assert.equal(rpc.pending.size, 0);
});
