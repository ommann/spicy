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
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';

test('local bridge protects mutation endpoints and supports live oRPC, fork and refresh', async () => {
  const reserve = net.createServer().listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const root = fileURLToPath(new URL('..', import.meta.url));
  const resolver = new URL('../../packages/coding-agent/src/experimental/source-resolver.ts', import.meta.url).href;
  const temporary = await mkdtemp(path.join(tmpdir(), 'spicy-agents-test-'));
  const child = spawn(process.execPath, ['--import', resolver, 'index.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), PI_SESSION_DIR: path.join(temporary, 'sessions'), PI_RPC_FIXTURE: fileURLToPath(new URL('./fake-pi.mjs', import.meta.url)) }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let logs = '';
  child.stderr.on('data', chunk => { logs += chunk; });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Server startup timed out: ${logs}`)), 5000);
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${logs}`)); });
      child.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
    });
    const base = `http://127.0.0.1:${port}`;
    let token;
    const api = createORPCClient(new RPCLink({ url: `${base}/rpc`, headers: () => token ? { 'X-Spicy-Token': token } : {} }));
    const info = await api.info({});
    assert.equal(info.connected, false);
    const promptRoute = await fetch(`${base}/system-prompts/2`);
    assert.equal(promptRoute.status, 200);
    assert.match(promptRoute.headers.get('content-type'), /text\/html/);
    assert.match(await promptRoute.text(), /<div id="root"><\/div>/);
    await assert.rejects(api.start({}), error => error.code === 'FORBIDDEN');
    token = info.token;
    const shellHeaders = { Origin: 'tauri://localhost', 'Sec-Fetch-Site': 'cross-site' };
    assert.equal((await fetch(`${base}/system-prompts/1`, { headers: shellHeaders })).status, 200);
    const bridgeInfo = await fetch(`${base}/rpc/info`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ json: {} }) });
    assert.equal(bridgeInfo.status, 200);
    await bridgeInfo.text();
    assert.equal(bridgeInfo.headers.get('access-control-allow-origin'), null);
    assert.equal((await fetch(`${base}/rpc/info`, { headers: shellHeaders })).status, 403);
    assert.equal((await fetch(`${base}/rpc/start`, { method: 'POST', headers: { ...shellHeaders, 'X-Spicy-Token': token }, body: '{}' })).status, 403);
    const invalidHostStatus = await new Promise((resolve, reject) => {
      http.get(`${base}/rpc/info`, { headers: { Host: `evil.example:${port}` } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    assert.equal(invalidHostStatus, 403);
    assert.equal((await fetch(`${base}/api/info`)).status, 404);
    const started = await api.start({});
    assert.equal(started.connected, true);
    assert.deepEqual(started.entries, []);
    await api.command({ type: 'prompt', message: 'Hello' });
    const settled = async (agentId, count) => {
      for (let i = 0; i < 100; i++) {
        const value = await api.info({ agentId });
        if (!value.running && value.entries.length === count) return value;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.fail(`Agent ${agentId} did not settle`);
    };
    const state = await settled('default', 2);
    assert.equal(state.running, false);
    assert.deepEqual(state.live, []);
    assert.equal(state.entries[0].message.content, 'Hello');
    const fork = await api.command({ type: 'fork', entryId: state.entries[0].id });
    assert.equal(fork.text, 'Hello');
    assert.equal((await api.info({})).leafId, null);
    const anchor = state.entries[1].id;
    const sourceFile = state.state.sessionFile;
    const sourceContent = await readFile(sourceFile, 'utf8');
    const [left, right] = await Promise.all([
      api.agents.create({ sourceAgentId: 'default', entryId: anchor }),
      api.agents.create({ sourceAgentId: 'default', entryId: anchor }),
    ]);
    assert.notEqual(left.agentId, right.agentId);
    assert.notEqual(left.state.sessionFile, right.state.sessionFile);
    assert.equal(left.leafId, anchor);
    assert.equal(right.leafId, anchor);
    assert.deepEqual(left.entries, state.entries);
    assert.deepEqual(right.entries, state.entries);
    assert.equal(left.source.entryId, anchor);
    assert.equal(left.source.sessionId, Buffer.from(sourceFile).toString('base64url'));
    const reset = await api.events({ agentIds: ['obsolete-agent'] });
    assert.deepEqual((await reset.next()).value, { type: 'reset' });
    assert.equal((await reset.next()).done, true);
    const controllers = [];
    const streams = [];
    const subscribe = async agentIds => {
      const controller = new AbortController();
      controllers.push(controller);
      const iterator = await api.events({ agentIds }, { signal: controller.signal });
      const initial = await iterator.next();
      assert.equal(initial.value.agentId, agentIds[0]);
      assert.equal(initial.value.event, 'snapshot');
      const events = [initial.value];
      streams.push((async () => {
        try { for await (const event of iterator) events.push(event); }
        catch (error) { if (error.name !== 'AbortError') throw error; }
      })());
      return events;
    };
    try {
      const leftEvents = await subscribe([left.agentId]);
      const rightEvents = await subscribe([right.agentId]);
      const sharedEvents = await subscribe([left.agentId, right.agentId]);
      await Promise.all([
        api.command({ agentId: left.agentId, type: 'prompt', message: 'Left branch' }),
        api.command({ agentId: right.agentId, type: 'prompt', message: 'Right branch' }),
      ]);
      const active = await Promise.all([api.info({ agentId: left.agentId }), api.info({ agentId: right.agentId })]);
      assert.ok(active.every(agent => agent.running));
      const [leftDone, rightDone] = await Promise.all([settled(left.agentId, 4), settled(right.agentId, 4)]);
      assert.equal(leftDone.entries[2].parentId, anchor);
      assert.equal(rightDone.entries[2].parentId, anchor);
      assert.equal(leftDone.entries[2].message.content, 'Left branch');
      assert.equal(rightDone.entries[2].message.content, 'Right branch');
      assert.equal((await api.info({})).leafId, null);
      assert.equal(await readFile(sourceFile, 'utf8'), sourceContent);
      assert.ok(sharedEvents.some(event => event.type === 'agent' && event.agentId === left.agentId));
      assert.ok(sharedEvents.some(event => event.type === 'agent' && event.agentId === right.agentId));
      assert.match(JSON.stringify(sharedEvents), /Left branch/);
      assert.match(JSON.stringify(sharedEvents), /Right branch/);
      assert.match(JSON.stringify(leftEvents), /Left branch/);
      assert.doesNotMatch(JSON.stringify(leftEvents), /Right branch/);
      assert.match(JSON.stringify(rightEvents), /Right branch/);
      assert.doesNotMatch(JSON.stringify(rightEvents), /Left branch/);
      await assert.rejects(api.start({ agentId: right.agentId, sessionId: Buffer.from(leftDone.state.sessionFile).toString('base64url') }), error => error.code === 'BAD_REQUEST');
      assert.equal((await api.info({ agentId: right.agentId })).leafId, rightDone.leafId);
      await api.command({ agentId: left.agentId, type: 'fork', entryId: leftDone.entries[2].id });
      assert.equal((await api.info({ agentId: left.agentId })).leafId, anchor);
      assert.equal((await api.info({ agentId: right.agentId })).leafId, rightDone.leafId);
      await Promise.all([
        api.command({ agentId: left.agentId, type: 'prompt', message: 'Abort only left' }),
        api.command({ agentId: right.agentId, type: 'prompt', message: 'Keep right running' }),
      ]);
      await api.command({ agentId: left.agentId, type: 'abort' });
      assert.equal((await api.info({ agentId: left.agentId })).running, false);
      assert.equal((await api.info({ agentId: right.agentId })).running, true);
      const liveFork = await api.agents.create({ sourceAgentId: right.agentId, entryId: anchor });
      assert.equal(liveFork.leafId, anchor);
      assert.deepEqual(liveFork.entries, state.entries);
      await api.stop({ agentId: liveFork.agentId });
      await settled(right.agentId, 6);
      await api.stop({ agentId: left.agentId });
      const stopped = await api.info({ agentId: left.agentId });
      assert.equal(stopped.connected, false);
      assert.equal((await api.info({ agentId: right.agentId })).connected, true);
      const resumed = await api.start({ agentId: left.agentId });
      assert.equal(resumed.state.sessionFile, stopped.state.sessionFile);
      assert.deepEqual(resumed.entries, stopped.entries);
      await api.stop({ agentId: left.agentId });
      const savedRight = await readFile(rightDone.state.sessionFile, 'utf8');
      assert.ok(savedRight.includes('Right branch'));
      assert.ok(!savedRight.includes('Left branch'));
      const project = path.join(temporary, 'different-project');
      await mkdir(project);
      const other = await api.agents.create({ cwd: project });
      assert.equal(other.cwd, project);
      assert.equal(other.entries.length, 0);
      await api.command({ agentId: other.agentId, type: 'prompt', message: 'Other project' });
      await settled(other.agentId, 2);
      assert.equal((await api.info({ agentId: right.agentId })).entries.length, 6);
      const listed = await api.agents.list({});
      assert.equal(listed.length, 5);
      assert.equal(listed.find(agent => agent.agentId === other.agentId).cwd, project);
      await assert.rejects(api.command({ agentId: 'missing-agent', type: 'abort' }), error => error.code === 'BAD_REQUEST');
    } finally {
      for (const controller of controllers) controller.abort();
      await Promise.all(streams);
    }
    assert.equal((await api.info({ agentId: right.agentId })).connected, true);
    await api.stop({});
    assert.equal((await api.info({})).connected, false);
  } finally {
    child.kill('SIGTERM');
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 10000);
    try {
      const [code, signal] = await exited;
      assert.equal(code, 0, `Test backend did not exit cleanly (${signal}): ${logs}`);
    } finally { clearTimeout(killTimer); }
    await rm(temporary, { recursive: true, force: true });
  }
});
