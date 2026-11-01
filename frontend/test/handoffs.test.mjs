import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { handoffId, handoffUrl, handoffResultData } from '../src/handoffs.mjs';
import { proxyUtw, utwBase } from '../../backend/utw.mjs';

const id = 'joke-7k3m9p';
const task = status => ({ task_id: id, tool: 'joke', status, ui: { url: `http://127.0.0.1:4317/tasks/${id}/view`, embeddable: true } });

test('PoC handle lookup, structured result fallback and loopback presentation rules', () => {
  const call = { name: 'handoff_task_to_user' };
  assert.equal(handoffId(call, { details: { task_id: id } }), id);
  assert.equal(handoffId(call, { content: [{ type: 'text', text: JSON.stringify({ task_id: id }) }] }), id);
  assert.equal(handoffId({ name: 'get_handoff_result', arguments: { task_id: id } }), id);
  for (const value of ['../secrets', 'joke-invalid', {}, null]) assert.equal(handoffId(call, { details: { task_id: value } }), undefined);
  assert.equal(handoffId({ name: 'read' }, { details: { task_id: id } }), undefined);
  for (const url of ['javascript:alert(1)', 'https://evil.example/', 'http://user@localhost:4317/', 'http://localhost.evil/']) {
    assert.equal(handoffUrl({ ...task('incomplete'), ui: { url } }), undefined);
    assert.throws(() => utwBase(url));
  }
  assert.equal(handoffUrl(task('completed')), task('completed').ui.url);
  assert.equal(handoffUrl(task('rejected')), task('rejected').ui.url);
  const details = { output: { joke: 'hello' }, files: ['joke.png'] };
  assert.deepEqual(handoffResultData({ content: [{ type: 'text', text: JSON.stringify(details) }] }), details);
});

test('handoff port uses Solid rendering rather than imperative DOM rendering', async () => {
  const source = await readFile(new URL('../src/Handoffs.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /querySelector|createElement|replaceChildren|innerHTML|removeAttribute|frame\.src\s*=/);
  assert.doesNotMatch(source, /setInterval|setTimeout|addEventListener|untrack|nextPoll|failures|new Map/);
  assert.match(source, /createResource\(requested,/);
  assert.match(source, /<section/);
  assert.match(source, /<iframe/);
});

test('PoC metadata proxy forwards only task metadata, never writes, UI or files', async () => {
  let calls = 0, redirect = false;
  const upstream = http.createServer((_req, res) => {
    calls++;
    if (redirect) { res.writeHead(302, { Location: 'http://example.com/' }).end(); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(task('incomplete')));
  }).listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const base = `http://127.0.0.1:${upstream.address().port}`;
  const proxy = http.createServer(async (req, res) => {
    if (!await proxyUtw(req, res, base)) res.writeHead(404).end();
  }).listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const url = `http://127.0.0.1:${proxy.address().port}/utw/tasks/${id}`;
  try {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), task('incomplete'));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    for (const path of ['/reject', '/complete', '/files/foo', '/tool/']) assert.equal((await fetch(url + path)).status, 404);
    assert.equal((await fetch(url, { method: 'POST' })).status, 404);
    assert.equal(calls, 1);
    redirect = true;
    assert.equal((await fetch(url)).status, 502);
    assert.equal(calls, 2);
  } finally {
    await Promise.all([new Promise(resolve => proxy.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
  }
});
