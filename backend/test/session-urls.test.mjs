import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('short session URLs follow live sessions and reopen the same file after backend restart', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'spicy-session-url-'));
  const managed = path.join(temporary, 'sessions');
  const project = path.join(temporary, 'another-project');
  await mkdir(project);
  let child;
  let base;
  let token;
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
    token = (await (await fetch(`${base}/api/info`)).json()).token;
  };
  const post = async (endpoint, body, status = 200) => {
    const response = await fetch(`${base}/api/${endpoint}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lilim-Token': token }, body: JSON.stringify(body) });
    const value = await response.json();
    assert.equal(response.status, status, JSON.stringify(value));
    return value;
  };
  try {
    await start();
    const created = await post('agents', { cwd: project }, 201);
    const urlId = created.state.sessionUrlId;
    assert.match(urlId, /^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);
    assert.notEqual(urlId, created.state.sessionId);
    const followed = await post('agents', { sessionUrlId: urlId });
    assert.equal(followed.agentId, created.agentId, 'Following does not create another agent or branch');
    await post('command', { agentId: created.agentId, type: 'prompt', message: 'Keep this session' });
    let saved;
    for (let i = 0; i < 100; i++) {
      saved = await (await fetch(`${base}/api/info?agentId=${created.agentId}`)).json();
      if (!saved.running && saved.entries.length === 2) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(saved.entries.length, 2);
    const contents = await readFile(saved.state.sessionFile, 'utf8');
    assert.equal(JSON.parse(contents.split('\n')[0]).urlId, urlId);
    assert.equal((await fetch(`${base}/${urlId}`)).status, 200);
    await stop();
    await start();
    const reopened = await post('agents', { sessionUrlId: urlId }, 201);
    assert.equal(reopened.cwd, project, 'URL restoration is not restricted to the default working directory');
    assert.equal(reopened.state.sessionId, saved.state.sessionId);
    assert.equal(reopened.state.sessionUrlId, urlId);
    assert.equal(reopened.state.sessionFile, saved.state.sessionFile);
    assert.deepEqual(reopened.entries, saved.entries);
    assert.equal(await readFile(saved.state.sessionFile, 'utf8'), contents);
    assert.equal((await post('agents', { sessionUrlId: urlId })).agentId, reopened.agentId);
    await post('agents', { sessionUrlId: urlId === 'aaaaaaaa' ? 'bbbbbbbb' : 'aaaaaaaa' }, 404);
    await post('agents', { sessionUrlId: 'bad' }, 400);
    const newline = contents.indexOf('\n');
    const header = { ...JSON.parse(contents.slice(0, newline)), id: 'duplicate-session' };
    await writeFile(path.join(managed, 'duplicate.jsonl'), JSON.stringify(header) + contents.slice(newline));
    await post('agents', { sessionUrlId: urlId }, 409);
    assert.equal(await readFile(saved.state.sessionFile, 'utf8'), contents);
  } finally {
    await stop();
    await rm(temporary, { recursive: true, force: true });
  }
});
