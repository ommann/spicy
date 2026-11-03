import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('local bridge protects mutation endpoints and supports live RPC, fork and refresh', async () => {
  const reserve = net.createServer().listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const root = fileURLToPath(new URL('..', import.meta.url));
  const resolver = new URL('../../packages/coding-agent/src/experimental/source-resolver.ts', import.meta.url).href;
  const temporary = await mkdtemp(path.join(tmpdir(), 'spicy-agents-test-'));
  const child = spawn(process.execPath, ['--import', resolver, 'index.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), PI_SESSION_DIR: path.join(temporary, 'sessions'), PI_RPC_FIXTURE: fileURLToPath(new URL('./fake-pi.mjs', import.meta.url)) }, stdio: ['ignore', 'pipe', 'pipe'] });
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
    const post = async (endpoint, body, status = 200) => {
      const response = await fetch(`${base}/api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lilim-Token': info.token }, body: JSON.stringify(body || {}) });
      const value = await response.json();
      assert.equal(response.status, status, JSON.stringify(value));
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
    const get = async agentId => (await fetch(`${base}/api/info?agentId=${agentId}`)).json();
    const settled = async (agentId, count) => {
      for (let i = 0; i < 100; i++) {
        const value = await get(agentId);
        if (!value.running && value.entries.length === count) return value;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.fail(`Agent ${agentId} did not settle`);
    };
    const anchor = state.entries[1].id;
    const sourceFile = state.state.sessionFile;
    const sourceContent = await readFile(sourceFile, 'utf8');
    const [left, right] = await Promise.all([
      post('agents', { sourceAgentId: 'default', entryId: anchor }, 201),
      post('agents', { sourceAgentId: 'default', entryId: anchor }, 201),
    ]);
    assert.notEqual(left.agentId, right.agentId);
    assert.notEqual(left.state.sessionFile, right.state.sessionFile);
    assert.equal(left.leafId, anchor);
    assert.equal(right.leafId, anchor);
    assert.deepEqual(left.entries, state.entries);
    assert.deepEqual(right.entries, state.entries);
    assert.equal(left.source.entryId, anchor);
    assert.equal(left.source.sessionId, Buffer.from(sourceFile).toString('base64url'));

    const controllers = [];
    const streams = [];
    const subscribe = async agentId => {
      const controller = new AbortController();
      controllers.push(controller);
      const response = await fetch(`${base}/api/events?agentId=${agentId}`, { signal: controller.signal });
      const reader = response.body.getReader();
      const stream = { text: '' };
      const decoder = new TextDecoder();
      const initial = await reader.read();
      stream.text += decoder.decode(initial.value, { stream: true });
      assert.ok(stream.text.includes(`"agentId":"${agentId}"`));
      streams.push((async () => {
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            stream.text += decoder.decode(chunk.value, { stream: true });
          }
        } catch (error) { if (error.name !== 'AbortError') throw error; }
      })());
      return stream;
    };
    try {
      const leftEvents = await subscribe(left.agentId);
      const rightEvents = await subscribe(right.agentId);
      await Promise.all([
        post('command', { agentId: left.agentId, type: 'prompt', message: 'Left branch' }),
        post('command', { agentId: right.agentId, type: 'prompt', message: 'Right branch' }),
      ]);
      const active = await Promise.all([get(left.agentId), get(right.agentId)]);
      assert.ok(active.every(agent => agent.running));
      const [leftDone, rightDone] = await Promise.all([settled(left.agentId, 4), settled(right.agentId, 4)]);
      assert.equal(leftDone.entries[2].parentId, anchor);
      assert.equal(rightDone.entries[2].parentId, anchor);
      assert.equal(leftDone.entries[2].message.content, 'Left branch');
      assert.equal(rightDone.entries[2].message.content, 'Right branch');
      assert.equal((await get('default')).leafId, null);
      assert.equal(await readFile(sourceFile, 'utf8'), sourceContent);
      assert.ok(leftEvents.text.includes('Left branch'));
      assert.ok(!leftEvents.text.includes('Right branch'));
      assert.ok(rightEvents.text.includes('Right branch'));
      assert.ok(!rightEvents.text.includes('Left branch'));

      await post('start', { agentId: right.agentId, sessionId: Buffer.from(leftDone.state.sessionFile).toString('base64url') }, 400);
      assert.equal((await get(right.agentId)).leafId, rightDone.leafId);
      await post('command', { agentId: left.agentId, type: 'fork', entryId: leftDone.entries[2].id });
      assert.equal((await get(left.agentId)).leafId, anchor);
      assert.equal((await get(right.agentId)).leafId, rightDone.leafId);

      await Promise.all([
        post('command', { agentId: left.agentId, type: 'prompt', message: 'Abort only left' }),
        post('command', { agentId: right.agentId, type: 'prompt', message: 'Keep right running' }),
      ]);
      await post('command', { agentId: left.agentId, type: 'abort' });
      assert.equal((await get(left.agentId)).running, false);
      assert.equal((await get(right.agentId)).running, true);
      const liveFork = await post('agents', { sourceAgentId: right.agentId, entryId: anchor }, 201);
      assert.equal(liveFork.leafId, anchor);
      assert.deepEqual(liveFork.entries, state.entries);
      await post('stop', { agentId: liveFork.agentId });
      await settled(right.agentId, 6);
      await post('stop', { agentId: left.agentId });
      const stopped = await get(left.agentId);
      assert.equal(stopped.connected, false);
      assert.equal((await get(right.agentId)).connected, true);
      const resumed = await post('start', { agentId: left.agentId });
      assert.equal(resumed.state.sessionFile, stopped.state.sessionFile);
      assert.deepEqual(resumed.entries, stopped.entries);
      await post('stop', { agentId: left.agentId });
      const savedRight = await readFile(rightDone.state.sessionFile, 'utf8');
      assert.ok(savedRight.includes('Right branch'));
      assert.ok(!savedRight.includes('Left branch'));

      const project = path.join(temporary, 'different-project');
      await mkdir(project);
      const other = await post('agents', { cwd: project }, 201);
      assert.equal(other.cwd, project);
      assert.equal(other.entries.length, 0);
      await post('command', { agentId: other.agentId, type: 'prompt', message: 'Other project' });
      await settled(other.agentId, 2);
      assert.equal((await get(right.agentId)).entries.length, 6);
      const listed = await (await fetch(`${base}/api/agents`)).json();
      assert.equal(listed.length, 5);
      assert.equal(listed.find(agent => agent.agentId === other.agentId).cwd, project);
      await post('command', { agentId: 'missing-agent', type: 'abort' }, 400);
    } finally {
      for (const controller of controllers) controller.abort();
      await Promise.all(streams);
    }
    assert.equal((await get(right.agentId)).connected, true);
    await post('stop');
    assert.equal((await (await fetch(`${base}/api/info`)).json()).connected, false);
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit');
    await rm(temporary, { recursive: true, force: true });
  }
});
