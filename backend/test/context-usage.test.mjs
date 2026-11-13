import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentConnection } from '../agents.ts';

test('live context usage is broadcast and retained for reconnect snapshots', () => {
  const agent = new AgentConnection('context-test', process.cwd());
  agent.snapshot.state = { sessionId: 'session-test' };
  const sent = [];
  agent.clients.add({ send: (type, data) => sent.push({ type, data }) });
  const usage = { tokens: 41_500, percent: 8.3, contextWindow: 500_000 };
  agent.rpc.emit('record', { type: 'context_usage', usage });
  assert.deepEqual(agent.payload().state.contextUsage, usage);
  assert.equal(agent.payload().state.sessionId, 'session-test');
  assert.equal(sent[0].type, 'record');
  assert.deepEqual(sent[0].data.usage, usage);
  agent.rpc.emit('record', { type: 'context_usage', usage: { tokens: null, percent: null, contextWindow: 500_000 } });
  assert.equal(agent.payload().state.contextUsage.percent, null);
});
