import assert from 'node:assert/strict';
import test from 'node:test';
import { call } from '@orpc/server';
import * as inputs from '../inputs.ts';
import { createRouter } from '../router.ts';

const image = { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' };
const document = { version: 1, parts: [{ id: 'root', label: 'Root', source: 'test', children: [{ id: 'child', label: 'Child', source: 'test', text: 'hello' }] }] };
const saved = { title: 'Test', document, excludedIds: [], toolsAdded: [{ name: 'test', description: 'Test tool', parameters: { type: 'object', properties: { flag: { type: 'boolean' } } } }] };

test('each procedure accepts its own payload and rejects unknown or incorrectly typed fields', () => {
  const cases = [
    ['agentInput', {}, { agentId: 1 }, { extra: true }],
    ['emptyInput', {}, { agentId: 'a' }, { extra: true }],
    ['sessionsInput', { scope: 'all', agentId: 'a' }, { scope: 'other' }, { sessionId: 's' }],
    ['sessionInput', { id: 's' }, {}, { id: 's', file: '/tmp/s' }],
    ['eventsInput', { agentIds: ['a', 'b'] }, { agentIds: [] }, { agentIds: [1] }],
    ['createAgentInput', { cwd: '/tmp' }, { cwd: 'relative' }, { sourceAgentId: 'a', sessionId: 's' }],
    ['startInput', { agentId: 'a', sessionId: 's' }, { sessionId: 2 }, { file: '/tmp/s' }],
    ['loginInput', { providerId: 'p', type: 'oauth' }, { providerId: 'p', type: 'other' }, { providerId: 'p' }],
    ['loginReplyInput', { id: 'flow', promptId: 'prompt', value: 'answer' }, { id: 'flow', value: 'answer' }, { id: 'flow', promptId: 'prompt', value: false }],
    ['loginCancelInput', {}, { id: false }, { value: 'answer' }],
    ['uiInput', { id: 'dialog', confirmed: false }, { id: 'dialog' }, { id: 'dialog', value: 'x', confirmed: true }],
    ['attachmentsInput', { images: [image] }, { images: [] }, { images: [{ ...image, mimeType: 'text/plain' }] }],
    ['branchInput', { entryId: 'entry', message: 'hello' }, { entryId: 'entry', message: ' ' }, { message: 'hello' }],
  ];
  for (const [name, valid, ...invalid] of cases) {
    assert.deepEqual(inputs[name].parse(valid), valid, name);
    for (const value of invalid) assert.equal(inputs[name].safeParse(value).success, false, `${name}: ${JSON.stringify(value)}`);
  }
});

test('command discriminator validates required fields and preserves supported payloads', () => {
  const valid = [
    { type: 'prompt', message: 'hello', streamingBehavior: 'steer' },
    { type: 'prompt', message: '', images: [image], systemPrompt: { choice: 'current', ignored: [], selected: { key: 'prompt', content: 'hello', sections: {}, promptBuilder: { document, excludedIds: [] } } } },
    ...['abort', 'clear_queue', 'get_available_models', 'get_available_thinking_levels', 'get_system_prompt_document'].map(type => ({ type })),
    { type: 'fork', entryId: 'entry' }, { type: 'new_session', parentSession: '/tmp/session' },
    { type: 'set_model', provider: 'provider', modelId: 'model' },
    { type: 'set_thinking_level', level: 'max' },
    { type: 'save_system_prompt', prompt: saved },
    { type: 'compact', customInstructions: 'Keep the details' },
    { type: 'compact', method: 1 }, { type: 'compact', method: 2, customInstructions: 'Keep paths' },
  ];
  for (const value of valid) assert.deepEqual(inputs.commandInput.parse(value), value);
  const invalid = [
    {}, { type: 'bash', command: 'echo no' }, { type: 'set_model', provider: 'p' },
    { type: 'set_thinking_level', level: 'unknown' }, { type: 'fork' },
    { type: 'prompt', message: ' ' }, { type: 'prompt', message: 'hi', streamingBehavior: 'other' },
    { type: 'prompt', message: 'hi', systemPrompt: { selected: { key: 'x', content: 'x' } } },
    { type: 'prompt', message: 'hi', images: [{ ...image, data: 'invalid!' }] },
    { type: 'compact', customInstructions: 4 }, { type: 'abort', message: 'unexpected' },
    { type: 'compact', method: 3 }, { type: 'compact', method: '2' },
    { type: 'save_system_prompt', prompt: { ...saved, document: { ...document, version: 2 } } },
    { type: 'save_system_prompt', prompt: { ...saved, toolsAdded: [{ name: 'missing-fields' }] } },
    { type: 'save_system_prompt', prompt: { ...saved, toolsAdded: [{ ...saved.toolsAdded[0], constrainedSampling: { type: 'json_schema', strict: 'other' } }] } },
  ];
  for (const value of invalid) assert.equal(inputs.commandInput.safeParse(value).success, false, JSON.stringify(value));
});

test('creation selectors and dialog response variants are mutually exclusive', () => {
  for (const value of [{ openSessionId: 'session' }, { sessionUrlId: 'zhhupqw3' }, { sourceAgentId: 'a', entryId: 'entry' }, { sessionId: 's', entryId: 'entry' }]) assert.deepEqual(inputs.createAgentInput.parse(value), value);
  for (const value of [{ entryId: 'orphan' }, { openSessionId: 's', cwd: '/tmp' }, { openSessionId: 's', sessionUrlId: 'zhhupqw3' }]) assert.equal(inputs.createAgentInput.safeParse(value).success, false);
  for (const value of [{ id: 'd', value: '' }, { id: 'd', cancelled: true }]) assert.deepEqual(inputs.uiInput.parse(value), value);
  assert.equal(inputs.uiInput.safeParse({ id: 'd', cancelled: false }).success, false);
});

test('oRPC rejects invalid payloads before agent operations, while valid requests reach handlers', async () => {
  let lookups = 0;
  const agent = { payload: () => ({ agentId: 'test' }), rpc: { command: async () => ({ models: [] }) } };
  const agents = { get: () => { lookups++; return agent; } };
  const router = createRouter({ agents, login: {}, token: 'test-token', cwd: '/tmp', managed: '/tmp' });
  const options = { context: { headers: new Headers({ 'X-Spicy-Token': 'test-token' }) } };
  for (const value of [{ type: 'set_model' }, { type: 'bash', command: 'no' }, { type: 'prompt', message: false }]) {
    await assert.rejects(call(router.command, value, options), error => error.code === 'BAD_REQUEST');
  }
  await assert.rejects(call(router.agents.create, { entryId: 'orphan' }, options), error => error.code === 'BAD_REQUEST');
  assert.equal(lookups, 0);
  assert.deepEqual(await call(router.command, { type: 'get_available_models' }, options), { models: [] });
  assert.equal(lookups, 1);
});
