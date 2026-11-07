import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';

test('short session URLs follow live sessions and reopen the same file after backend restart', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'spicy-session-url-'));
  const managed = path.join(temporary, 'sessions');
  const project = path.join(temporary, 'another-project');
  await mkdir(project);
  let child;
  let base;
  let api;
  const stop = async () => {
    if (!child) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
    child = undefined;
  };
  const start = async () => {
    const reserve = net.createServer().listen(0, '127.0.0.1');
    await once(reserve, 'listening');
    const port = reserve.address().port;
    await new Promise(resolve => reserve.close(resolve));
    const resolver = new URL('../../packages/coding-agent/src/experimental/source-resolver.ts', import.meta.url).href;
    child = spawn(process.execPath, ['--import', resolver, 'index.mjs'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, PORT: String(port), PI_SESSION_DIR: managed,
        PI_CODING_AGENT_DIR: path.join(temporary, 'agent'),
        PI_RPC_FIXTURE: fileURLToPath(new URL('./fake-pi.mjs', import.meta.url)) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '';
    child.stderr.on('data', chunk => { logs += chunk; });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Backend startup timed out: ${logs}`)), 10000);
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Backend exited ${code}: ${logs}`)); });
      child.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
    });
    base = `http://127.0.0.1:${port}`;
    let token;
    api = createORPCClient(new RPCLink({ url: `${base}/rpc`, headers: () => token ? { 'X-Spicy-Token': token } : {} }));
    token = (await api.info({})).token;
  };
  try {
    await start();
    const created = await api.agents.create({ cwd: project });
    const urlId = created.state.sessionUrlId;
    assert.match(urlId, /^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);
    assert.notEqual(urlId, created.state.sessionId);
    const followed = await api.agents.create({ sessionUrlId: urlId });
    assert.equal(followed.agentId, created.agentId, 'Following does not create another agent or branch');
    await api.command({ agentId: created.agentId, type: 'prompt', message: 'Keep this session' });
    let saved;
    for (let i = 0; i < 100; i++) {
      saved = await api.info({ agentId: created.agentId });
      if (!saved.running && saved.entries.length === 2) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(saved.entries.length, 2);
    const contents = await readFile(saved.state.sessionFile, 'utf8');
    assert.equal(JSON.parse(contents.split('\n')[0]).urlId, urlId);
    assert.equal((await fetch(`${base}/${urlId}`)).status, 200);
    await stop();
    await start();
    const reopened = await api.agents.create({ sessionUrlId: urlId });
    assert.equal(reopened.cwd, project, 'URL restoration is not restricted to the default working directory');
    assert.equal(reopened.state.sessionId, saved.state.sessionId);
    assert.equal(reopened.state.sessionUrlId, urlId);
    assert.equal(reopened.state.sessionFile, saved.state.sessionFile);
    assert.deepEqual(reopened.entries, saved.entries);
    assert.equal(reopened.connected, false, 'Viewing a saved session does not start an agent');
    assert.ok((await api.agents.list({})).every(agent => !agent.connected));
    const started = await api.start({ agentId: reopened.agentId });
    assert.equal(started.connected, true);
    assert.equal(started.state.sessionFile, saved.state.sessionFile);
    assert.deepEqual(started.entries, saved.entries);
    await api.stop({ agentId: reopened.agentId });
    const stopped = await api.info({ agentId: reopened.agentId });
    assert.equal(stopped.connected, false);
    assert.equal(stopped.connectionError, '', 'An intentional stop is not a connection failure');
    const fork = await api.agents.create({ sourceAgentId: reopened.agentId, entryId: saved.leafId });
    assert.deepEqual(fork.entries, saved.entries, 'Forking can capture history without starting the source agent');
    await api.stop({ agentId: fork.agentId });
    const family = await api.agents.create({ sessionUrlId: urlId });
    assert.ok(family.relatedAgents.some(agent => agent.state.sessionFile === fork.state.sessionFile));
    assert.equal(family.connected, false);
    assert.ok(family.relatedAgents.every(agent => !agent.connected), 'Viewing related branches does not start their agents');
    assert.equal(await readFile(saved.state.sessionFile, 'utf8'), contents);
    assert.equal((await api.agents.create({ sessionUrlId: urlId })).agentId, reopened.agentId);
    const listing = await api.sessions({ scope: 'all' });
    const listed = listing.find(session => session.urlId === urlId);
    assert.equal(listed.cwd, project);
    assert.equal((await api.agents.create({ openSessionId: listed.id })).agentId, reopened.agentId);
    const legacyFile = path.join(managed, 'legacy.jsonl');
    const legacyHeader = { ...JSON.parse(contents.split('\n')[0]), id: 'legacy-session' };
    delete legacyHeader.urlId;
    await writeFile(legacyFile, JSON.stringify(legacyHeader) + contents.slice(contents.indexOf('\n')));
    const legacyListing = await api.sessions({ scope: 'all' });
    const legacy = legacyListing.find(session => !session.urlId);
    const openedLegacy = await api.agents.create({ openSessionId: legacy.id });
    assert.equal(openedLegacy.state.sessionId, 'legacy-session');
    assert.equal(openedLegacy.state.sessionFile, legacyFile);
    assert.match(openedLegacy.state.sessionUrlId, /^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);
    assert.deepEqual(openedLegacy.entries, saved.entries);
    await assert.rejects(api.agents.create({ sessionUrlId: urlId === 'aaaaaaaa' ? 'bbbbbbbb' : 'aaaaaaaa' }), error => error.code === 'NOT_FOUND');
    await assert.rejects(api.agents.create({ sessionUrlId: 'bad' }), error => error.code === 'BAD_REQUEST');
    const newline = contents.indexOf('\n');
    const header = { ...JSON.parse(contents.slice(0, newline)), id: 'duplicate-session' };
    await writeFile(path.join(managed, 'duplicate.jsonl'), JSON.stringify(header) + contents.slice(newline));
    await assert.rejects(api.agents.create({ sessionUrlId: urlId }), error => error.code === 'CONFLICT');
    assert.equal(await readFile(saved.state.sessionFile, 'utf8'), contents);
  } finally {
    await stop();
    await rm(temporary, { recursive: true, force: true });
  }
});
