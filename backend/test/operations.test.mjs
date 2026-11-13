import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { call } from '@orpc/server';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { createOperations, OperationError } from '../operations.ts';
import { createRouter } from '../router.ts';

function setup(command = async () => ({})) {
  const calls = [];
  const agent = {
    id: 'selected', cwd: '/tmp', mutating: false,
    snapshot: { state: { sessionFile: '/tmp/session' } },
    rpc: { running: false, command },
    payload: () => ({ agentId: 'selected', state: agent.snapshot.state }),
    refresh: async () => { calls.push('refresh'); },
  };
  const agents = {
    agents: new Map([[agent.id, agent]]),
    get: id => { assert.equal(id, agent.id); return agent; },
    release: value => { assert.equal(value, agent); calls.push('release'); },
    claim: (value, file) => { assert.equal(value, agent); assert.equal(file, '/tmp/session'); calls.push('claim'); },
    navigate: async (value, entryId) => { assert.equal(value, agent); calls.push(['navigate', entryId]); },
  };
  return { agent, agents, calls, operations: createOperations({ agents, cwd: '/tmp', managed: '/tmp' }) };
}

test('commands keep agent selection, locking and session ownership updates', async () => {
  const state = setup(async command => {
    assert.equal(state.agent.mutating, true);
    assert.deepEqual(command, { type: 'set_model', provider: 'provider', modelId: 'model' });
    state.calls.push('command');
    return { changed: true };
  });
  assert.deepEqual(await state.operations.command({ agentId: 'selected', type: 'set_model', provider: 'provider', modelId: 'model' }), { changed: true });
  assert.deepEqual(state.calls, ['command', 'refresh', 'release', 'claim']);
  assert.equal(state.agent.mutating, false);
});

test('busy checks and failed commands preserve the mutation lock', async () => {
  const failure = new Error('command failed');
  const { operations, agent, calls } = setup(async () => { throw failure; });
  agent.mutating = true;
  await assert.rejects(operations.command({ agentId: 'selected', type: 'prompt', message: 'hello' }), error => error instanceof OperationError && error.message === 'Another command is in progress');
  assert.equal(agent.mutating, true);
  agent.mutating = false;
  await assert.rejects(operations.command({ agentId: 'selected', type: 'set_model', provider: 'p', modelId: 'm' }), error => error === failure);
  assert.equal(agent.mutating, false);
  assert.deepEqual(calls, []);
});

test('branch and continuation keep their entry rules and release locks on navigation failure', async () => {
  const state = setup(async command => {
    if (command.type === 'get_entries') return { entries: [{ id: 'user', message: { role: 'user' } }, { id: 'assistant', message: { role: 'assistant' } }] };
    assert.deepEqual(command, { type: 'prompt', message: 'hello', images: undefined, systemPrompt: undefined });
    return { accepted: true };
  });
  const input = { agentId: 'selected', entryId: 'assistant', message: 'hello' };
  await assert.rejects(state.operations.branch(input), /Branch entry not found/);
  assert.equal(state.agent.mutating, false);
  assert.deepEqual(await state.operations.continue(input), { accepted: true });
  assert.deepEqual(state.calls, [['navigate', 'assistant']]);
  state.agents.navigate = async () => { throw new Error('navigation failed'); };
  await assert.rejects(state.operations.branch({ ...input, entryId: 'user' }), /navigation failed/);
  assert.equal(state.agent.mutating, false);
});

test('reload translation and running compaction keep their existing behavior', async () => {
  const commands = [];
  const state = setup(async command => {
    commands.push(command);
    if (command.type === 'get_commands') return { commands: [{ name: 'spicy-reload' }] };
    return { ok: true };
  });
  const input = { agentId: 'selected', type: 'prompt', message: '/reload' };
  await state.operations.command(input);
  assert.deepEqual(commands, [{ type: 'get_commands' }, { type: 'prompt', message: '/spicy-reload' }]);
  assert.equal(input.message, '/reload');
  state.agent.rpc.running = true;
  await assert.rejects(state.operations.command(input), /Stop the agent before reloading/);
  assert.deepEqual(await state.operations.command({ agentId: 'selected', type: 'compact' }), { ok: true, snapshot: state.agent.payload() });
  assert.equal(state.agent.mutating, false);
});

test('attachment operations write private files and reject invalid images without networking', async () => {
  const managed = await mkdtemp(path.join(tmpdir(), 'spicy-operations-'));
  try {
    const operations = createOperations({ agents: {}, cwd: managed, managed });
    const result = await operations.attachments({ images: [{ type: 'image', mimeType: 'image/png', data: Buffer.from('image').toString('base64') }] });
    assert.equal(result.paths.length, 1);
    assert.equal(path.dirname(result.paths[0]), path.join(managed, 'attachments'));
    assert.equal(await readFile(result.paths[0], 'utf8'), 'image');
    assert.equal((await stat(result.paths[0])).mode & 0o777, 0o600);
    await assert.rejects(operations.attachments({ images: [{ type: 'image', mimeType: 'text/plain', data: 'aGVsbG8=' }] }), OperationError);
    assert.equal((await readdir(path.join(managed, 'attachments'))).length, 1);
  } finally { await rm(managed, { recursive: true, force: true }); }
});

test('opening a session keeps its related family and rejects ambiguous URLs', async t => {
  const sessions = [
    { path: '/tmp/root.jsonl', cwd: '/tmp', urlId: 'zhhupqw3' },
    { path: '/tmp/child.jsonl', cwd: '/tmp', parentSessionPath: '/tmp/root.jsonl' },
    { path: '/tmp/grandchild.jsonl', cwd: '/tmp', parentSessionPath: '/tmp/child.jsonl' },
    { path: '/tmp/unrelated.jsonl', cwd: '/tmp' },
  ];
  t.mock.method(SessionManager, 'listAll', async () => sessions);
  const opened = [];
  const agents = {
    agents: new Map(),
    openSession: async ({ file }) => { opened.push(file); return { payload: () => ({ file }) }; },
  };
  const operations = createOperations({ agents, cwd: '/tmp', managed: '/tmp' });
  const result = await operations.createAgent({ openSessionId: Buffer.from('/tmp/child.jsonl').toString('base64url') });
  assert.deepEqual(opened, ['/tmp/child.jsonl', '/tmp/root.jsonl', '/tmp/grandchild.jsonl']);
  assert.deepEqual(result.relatedAgents, [{ file: '/tmp/root.jsonl' }, { file: '/tmp/grandchild.jsonl' }]);
  await assert.rejects(operations.createAgent({ openSessionId: 'missing' }), error => error instanceof OperationError && error.reason === 'not-found');
  agents.agents.set('active', { snapshot: { state: { sessionUrlId: 'zhhupqw3', sessionFile: '/tmp/other.jsonl' } } });
  await assert.rejects(operations.createAgent({ sessionUrlId: 'zhhupqw3' }), error => error instanceof OperationError && error.reason === 'conflict');
  assert.equal(opened.length, 3);
  // Neither the selected branch nor catalog enumeration owns the tree order.
  const expectedOrder = ['/tmp/root.jsonl', '/tmp/child.jsonl', '/tmp/grandchild.jsonl'];
  sessions.reverse();
  for (const file of expectedOrder) {
    const view = await operations.createAgent({ openSessionId: Buffer.from(file).toString('base64url') });
    assert.equal(view.treeId, 'zhhupqw3');
    assert.deepEqual(view.familyOrder, expectedOrder);
  }
});

test('router translates operation errors into the existing response codes', async () => {
  for (const [reason, code] of [['invalid', 'BAD_REQUEST'], ['not-found', 'NOT_FOUND'], ['conflict', 'CONFLICT']]) {
    const agents = { get: () => { throw new OperationError('operation failed', reason); } };
    const router = createRouter({ agents, login: {}, token: 'test' });
    await assert.rejects(call(router.info, {}, { context: { headers: new Headers() } }), error => error.code === code && error.message === 'operation failed');
  }
});
