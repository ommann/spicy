import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentEvents } from '../src/agent-events.mjs';

test('agents share one socket, remove subscriptions, and recover stalled connections', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sockets = [];
  const previous = globalThis.EventSource;
  globalThis.EventSource = class {
    listeners = new Map();
    constructor(url) { this.url = url; sockets.push(this); }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    emit(type, data) { this.listeners.get(type)?.({ data: JSON.stringify(data) }); }
    close() { this.closed = true; }
  };
  let errors = 0;
  let resets = 0;
  const manager = createAgentEvents({ onError: () => errors++, onOpen: () => {}, onReset: () => resets++, timeoutMs: 100 });
  try {
    const a = manager.watch('a');
    const b = manager.watch('b');
    let snapshot;
    a.addEventListener('snapshot', event => { snapshot = JSON.parse(event.data); });
    await Promise.resolve();
    assert.equal(sockets.length, 1);
    assert.match(sockets[0].url, /agentIds=a%2Cb/);
    sockets[0].emit('agent', { agentId: 'a', event: 'snapshot', data: { version: 1 } });
    assert.deepEqual(snapshot, { version: 1 });
    t.mock.timers.tick(80);
    sockets[0].emit('heartbeat', {});
    t.mock.timers.tick(80);
    assert.equal(sockets.length, 1, 'heartbeats keep the socket alive');
    t.mock.timers.tick(21);
    assert.equal(errors, 1);
    assert.equal(sockets[0].closed, true);
    assert.equal(sockets.length, 2);
    sockets[0].emit('agent', { agentId: 'a', event: 'snapshot', data: { version: 0 } });
    assert.equal(snapshot.version, 1, 'late events from obsolete sockets are ignored');
    sockets[1].emit('agent', { agentId: 'a', event: 'snapshot', data: { version: 2 } });
    assert.equal(snapshot.version, 2, 'reconnection replaces stale state');
    b.close();
    await Promise.resolve();
    assert.equal(sockets[1].closed, true);
    assert.match(sockets[2].url, /agentIds=a$/);
    sockets[2].emit('reset', {});
    assert.equal(resets, 1, 'backend restart requests session restoration');
    assert.equal(sockets[2].closed, true);
    t.mock.timers.tick(200);
    assert.equal(sockets.length, 3, 'obsolete agent IDs are not endlessly reconnected');
    a.close();
    await Promise.resolve();
    assert.equal(sockets[2].closed, true);
  } finally { manager.close(); globalThis.EventSource = previous; }
});
