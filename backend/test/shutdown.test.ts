import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { call } from '@orpc/server';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { AgentRegistry } from '../agents.ts';
import { createRouter } from '../router.ts';

const deadline = () => AbortSignal.timeout(10000);

test('server cancellation releases all oRPC subscriptions without legacy client methods', { timeout: 10000 }, async () => {
  const lifetime = new AbortController();
  const registry = new AgentRegistry({ cwd: '/tmp', managed: '/tmp' });
  const first = registry.get();
  const second = { id: 'second', clients: new Set(), payload: () => ({ agentId: 'second' }), rpc: { stop: async () => {} } };
  registry.agents.set(second.id, second);
  const router = createRouter({ agents: registry, login: {}, token: 'test', signal: lifetime.signal });
  const options = { context: { headers: new Headers() } };
  const a = await call(router.events, { agentIds: ['default', 'second'] }, options);
  const b = await call(router.events, { agentIds: ['default'] }, options);
  assert.equal((await a.next()).value.event, 'snapshot');
  assert.equal((await a.next()).value.event, 'snapshot');
  assert.equal((await b.next()).value.event, 'snapshot');
  assert.equal(first.clients.size, 2);
  assert.equal(second.clients.size, 1);
  const pending = [a.next(), b.next()];
  lifetime.abort();
  assert.deepEqual(await Promise.all(pending), [{ done: true, value: undefined }, { done: true, value: undefined }]);
  assert.equal(first.clients.size, 0);
  assert.equal(second.clients.size, 0);
  await registry.shutdown();
  const late = await call(router.events, { agentIds: ['default'] }, options);
  assert.equal((await late.next()).done, true);
  assert.equal(first.clients.size, 0);
});

test('request cancellation only removes its own subscription', { timeout: 10000 }, async () => {
  const lifetime = new AbortController();
  const request = new AbortController();
  const registry = new AgentRegistry({ cwd: '/tmp', managed: '/tmp' });
  const agent = registry.get();
  const router = createRouter({ agents: registry, login: {}, token: 'test', signal: lifetime.signal });
  const context = { headers: new Headers() };
  const a = await call(router.events, { agentIds: ['default'] }, { context, signal: request.signal });
  const b = await call(router.events, { agentIds: ['default'] }, { context });
  await a.next();
  await b.next();
  const pending = a.next();
  request.abort();
  await assert.rejects(pending, error => error === request.signal.reason);
  assert.equal(agent.clients.size, 1);
  for (const client of agent.clients) client.send('delta', { text: 'still connected' });
  assert.equal((await b.next()).value.data.text, 'still connected');
  const ended = b.next();
  lifetime.abort();
  assert.equal((await ended).done, true);
  assert.equal(agent.clients.size, 0);
});

test('shutdown does not hide an earlier stream failure', { timeout: 10000 }, async () => {
  const lifetime = new AbortController();
  const registry = new AgentRegistry({ cwd: '/tmp', managed: '/tmp' });
  const agent = registry.get();
  const router = createRouter({ agents: registry, login: {}, token: 'test', signal: lifetime.signal });
  const stream = await call(router.events, { agentIds: ['default'] }, { context: { headers: new Headers() } });
  await stream.next();
  const [client] = agent.clients;
  for (let i = 0; i < 2049; i++) client.send('delta', { index: i });
  lifetime.abort();
  await assert.rejects(stream.next(), /Event consumer fell behind/);
  assert.equal(agent.clients.size, 0);
});

test('agent registry stops processes without owning transport subscriptions', async () => {
  const registry = new AgentRegistry({ cwd: '/tmp', managed: '/tmp' });
  const agent = registry.get();
  const subscriber = { send() {} };
  agent.clients.add(subscriber);
  let stops = 0;
  agent.rpc.stop = async () => { stops++; };
  await registry.shutdown();
  assert.equal(stops, 1);
  assert.equal(agent.clients.has(subscriber), true);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`${signal} closes live oRPC streams and exits cleanly`, { timeout: 20000 }, async () => {
    const reserve = net.createServer().listen(0, '127.0.0.1');
    await once(reserve, 'listening');
    const port = reserve.address().port;
    await new Promise(resolve => reserve.close(resolve));
    const temporary = await mkdtemp(path.join(tmpdir(), 'spicy-shutdown-'));
    const resolver = new URL('../../packages/coding-agent/src/experimental/source-resolver.ts', import.meta.url).href;
    const child = spawn(process.execPath, ['--import', resolver, 'index.ts'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, PORT: String(port), PI_SESSION_DIR: path.join(temporary, 'sessions'), PI_RPC_FIXTURE: fileURLToPath(new URL('./fake-pi.ts', import.meta.url)), SPICY_STREAM_TIMING: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(child, 'exit');
    let logs = '';
    child.stdout.on('data', chunk => { logs += chunk; });
    child.stderr.on('data', chunk => { logs += chunk; });
    const controller = new AbortController();
    try {
      await Promise.race([
        once(child.stdout, 'data', { signal: deadline() }),
        exited.then(([code]) => { throw new Error(`Backend exited ${code}: ${logs}`); }),
      ]);
      let token;
      const api = createORPCClient(new RPCLink({ url: `http://127.0.0.1:${port}/rpc`, headers: () => token ? { 'x-spicy-token': token } : {} }));
      ({ token } = await api.info({}, { signal: deadline() }));
      await api.start({}, { signal: deadline() });
      const streams = await Promise.all([0, 1].map(() => api.events({ agentIds: ['default'] }, { signal: controller.signal })));
      for (const stream of streams) assert.equal((await stream.next()).value.event, 'snapshot');
      const drained = Promise.allSettled(streams.map(async stream => { for await (const _ of stream) {} }));
      child.kill(signal);
      const [code, exitSignal] = await Promise.race([exited, new Promise((_, reject) => deadline().addEventListener('abort', () => reject(new Error(`Shutdown timed out: ${logs}`)), { once: true }))]);
      assert.equal(code, 0, logs);
      assert.equal(exitSignal, null, logs);
      for (const result of await drained) assert.equal(result.status, 'fulfilled', result.reason?.stack);
      assert.doesNotMatch(logs, /TypeError|shutdown failed|client\.end/);
    } finally {
      controller.abort();
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
      await rm(temporary, { recursive: true, force: true });
    }
  });
}
