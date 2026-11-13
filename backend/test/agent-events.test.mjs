import test from 'node:test';
import assert from 'node:assert/strict';
import { agentEvents } from '../agent-events.ts';

test('multiplexed subscriptions send fresh snapshots and clean up on disconnect', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let version = 2;
  const a = { id: 'a', clients: new Set(), payload: () => ({ agentId: 'a', version }) };
  const b = { id: 'b', clients: new Set(), payload: () => ({ agentId: 'b' }) };
  const controller = new AbortController();
  const stream = agentEvents([a, b], controller.signal);
  assert.deepEqual((await stream.next()).value, { type: 'agent', agentId: 'a', event: 'snapshot', data: { agentId: 'a', version: 2 } });
  assert.deepEqual((await stream.next()).value, { type: 'agent', agentId: 'b', event: 'snapshot', data: { agentId: 'b' } });
  assert.equal(a.clients.size, 1);
  assert.equal(b.clients.size, 1);
  [...b.clients][0].send('record', { type: 'agent_start' });
  assert.deepEqual((await stream.next()).value, { type: 'agent', agentId: 'b', event: 'record', data: { type: 'agent_start' } });
  t.mock.timers.tick(15000);
  assert.deepEqual((await stream.next()).value, { type: 'heartbeat' });
  const pending = stream.next();
  controller.abort();
  await assert.rejects(pending, error => error === controller.signal.reason);
  assert.equal(a.clients.size, 0);
  assert.equal(b.clients.size, 0);
  t.mock.timers.tick(30000);
  assert.equal((await stream.next()).done, true);
  version = 3;
  const reconnected = agentEvents([a]);
  try { assert.equal((await reconnected.next()).value.data.version, 3); }
  finally { await reconnected.return(); }
  assert.equal(a.clients.size, 0);
});
