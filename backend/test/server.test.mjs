import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('local bridge protects mutation endpoints and supports live RPC, fork and refresh', async () => {
  const reserve = net.createServer().listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const root = fileURLToPath(new URL('..', import.meta.url));
  const resolver = new URL('../../packages/coding-agent/src/experimental/source-resolver.ts', import.meta.url).href;
  const child = spawn(process.execPath, ['--import', resolver, 'index.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), PI_RPC_FIXTURE: fileURLToPath(new URL('./fake-pi.mjs', import.meta.url)) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stderr.on('data', chunk => { logs += chunk; });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Server startup timed out: ${logs}`)), 5000);
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${logs}`)); });
      child.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
    });
    const base = `http://127.0.0.1:${port}`;
    const info = await (await fetch(`${base}/api/info`)).json();
    assert.equal(info.connected, false);
    const promptRoute = await fetch(`${base}/system-prompts/2`);
    assert.equal(promptRoute.status, 200);
    assert.match(promptRoute.headers.get('content-type'), /text\/html/);
    assert.match(await promptRoute.text(), /<div id="root"><\/div>/);
    assert.equal((await fetch(`${base}/api/start`, { method: 'POST', body: '{}' })).status, 403);
    const shellHeaders = { Origin: 'tauri://localhost', 'Sec-Fetch-Site': 'cross-site' };
    assert.equal((await fetch(`${base}/system-prompts/1`, { headers: shellHeaders })).status, 200);
    const bridgeInfo = await fetch(`${base}/api/info`, { headers: shellHeaders });
    assert.equal(bridgeInfo.status, 200);
    assert.equal(bridgeInfo.headers.get('access-control-allow-origin'), null);
    assert.equal((await fetch(`${base}/api/start`, { method: 'POST', headers: shellHeaders, body: '{}' })).status, 403);
    const invalidHostStatus = await new Promise((resolve, reject) => {
      http.get(`${base}/api/info`, { headers: { Host: `evil.example:${port}` } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    assert.equal(invalidHostStatus, 403);
    const post = async (endpoint, body) => {
      const response = await fetch(`${base}/api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lilim-Token': info.token }, body: JSON.stringify(body || {}) });
      const value = await response.json();
      assert.equal(response.status, 200, JSON.stringify(value));
      return value;
    };
    const started = await post('start');
    assert.equal(started.connected, true);
    assert.deepEqual(started.entries, []);
    await post('command', { type: 'prompt', message: 'Hello' });
    let state;
    for (let i = 0; i < 50; i++) {
      state = await (await fetch(`${base}/api/info`)).json();
      if (state.entries.length === 2) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(state.entries.length, 2);
    assert.equal(state.running, false);
    assert.deepEqual(state.live, []);
    assert.equal(state.entries[0].message.content, 'Hello');
    const fork = await post('command', { type: 'fork', entryId: state.entries[0].id });
    assert.equal(fork.text, 'Hello');
    assert.equal((await (await fetch(`${base}/api/info`)).json()).leafId, null);
    await post('stop');
    assert.equal((await (await fetch(`${base}/api/info`)).json()).connected, false);
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
});
