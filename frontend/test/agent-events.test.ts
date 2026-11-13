import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpcFixture } from './rpc-fixture.ts';

const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };

test('agents share one oRPC stream, remove subscriptions, and recover stalled connections', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fixture = createRpcFixture({});
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  globalThis.window = { location: { origin: 'http://localhost:5174' } };
  globalThis.fetch = fixture.fetch;
  const { createAgentEvents } = await import('../src/agent-events.ts');
  let errors = 0;
  let resets = 0;
  const manager = createAgentEvents({ onError: () => errors++, onOpen: () => {}, onReset: () => resets++, timeoutMs: 100 });
  try {
    const a = manager.watch('a');
    const b = manager.watch('b');
    let snapshot;
    a.addEventListener('snapshot', event => { snapshot = JSON.parse(event.data); });
    await flush();
    assert.equal(fixture.connections.length, 1);
    assert.deepEqual(fixture.connections[0].agentIds, ['a', 'b']);
    fixture.streams.get('a').emit('snapshot', { version: 1 });
    await flush();
    assert.deepEqual(snapshot, { version: 1 });
    t.mock.timers.tick(80);
    fixture.connections[0].emit({ type: 'heartbeat' });
    await flush();
    t.mock.timers.tick(80);
    assert.equal(fixture.connections.length, 1, 'heartbeats keep the stream alive');
    t.mock.timers.tick(21);
    await flush();
    assert.equal(errors, 1);
    assert.equal(fixture.connections[0].closed, true);
    assert.equal(fixture.connections.length, 1, 'retry respects the reconnect delay');
    t.mock.timers.tick(500);
    await flush();
    assert.equal(fixture.connections.length, 2);
    fixture.connections[0].emit({ type: 'agent', agentId: 'a', event: 'snapshot', data: { version: 0 } });
    await flush();
    assert.equal(snapshot.version, 1, 'late events from obsolete streams are ignored');
    fixture.streams.get('a').emit('snapshot', { version: 2 });
    await flush();
    assert.equal(snapshot.version, 2, 'reconnection replaces stale state');
    b.close();
    await flush();
    assert.equal(fixture.connections[1].closed, true);
    assert.deepEqual(fixture.connections[2].agentIds, ['a']);
    fixture.connections[2].emit({ type: 'reset' });
    await flush();
    assert.equal(resets, 1, 'backend restart requests session restoration');
    assert.equal(fixture.connections[2].closed, true);
    t.mock.timers.tick(2000);
    await flush();
    assert.equal(fixture.connections.length, 3, 'obsolete agent IDs are not endlessly reconnected');
    a.close();
    await flush();
  } finally {
    manager.close();
    fixture.close();
    await flush();
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
