import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { PiRpc } from './rpc.mjs';
import { proxyUtw, utwBase } from './utw.mjs';
import { applyRecord } from '../frontend/src/stream.mjs';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../frontend', import.meta.url));
const repository = fileURLToPath(new URL('..', import.meta.url));
const cli = path.join(repository, 'packages/coding-agent/src/cli.ts');
const resolver = new URL('../packages/coding-agent/src/experimental/source-resolver.ts', import.meta.url).href;
const cwd = path.resolve(process.env.PI_CWD || repository);
const port = Number(process.env.PORT || 5174);
const managed = fileURLToPath(new URL('./.sessions', import.meta.url));
const token = randomUUID();
const utw = utwBase();
const rpc = new PiRpc();
const clients = new Set();
let snapshot = { entries: [], leafId: null, state: null };
let live = [];
let dialogs = new Map();
let mutating = false;
let diagnostic = '';
const payload = () => ({ ...snapshot, live, dialogs: [...dialogs.values()], connected: !!rpc.child, running: rpc.running, cwd, diagnostic });
function broadcast(type, data) {
  const wire = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  // A false return means backpressure, not failure. Node queues the snapshot;
  // destroying the response here disconnects clients when switching large sessions.
  for (const client of clients) client.write(wire);
}
async function refresh() {
  const [entries, state] = await Promise.all([rpc.command({ type: 'get_entries' }), rpc.command({ type: 'get_state' })]);
  snapshot = { ...entries, state };
  live = [];
  broadcast('snapshot', payload());
}
rpc.on('record', record => {
  if (record.type === 'agent_start' && !rpc.running) live = [];
  live = applyRecord(live, record);
  if (record.type === 'extension_ui_request' && ['select', 'confirm', 'input', 'editor'].includes(record.method)) {
    dialogs.set(record.id, record);
  }
  broadcast('record', record);
  if (record.type === 'agent_settled') refresh().catch(error => broadcast('error', error.message));
});
rpc.on('diagnostic', text => { diagnostic = (diagnostic + text).slice(-4000); });
rpc.on('exit', message => { dialogs.clear(); broadcast('disconnected', message); });

async function catalog() {
  const projects = [cwd];
  const directories = [...new Set(projects)].map(project => ({
    directory: path.join(os.homedir(), '.pi/agent/sessions', `--${project.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`), project, managed: false,
  }));
  directories.push({ directory: managed, project: cwd, managed: true });
  const found = [];
  for (const location of directories) {
    const sessions = await SessionManager.list(location.project, location.directory);
    for (const session of sessions) {
      const sessionCwd = session.cwd || location.project;
      if (path.resolve(sessionCwd) !== cwd) continue;
      const project = path.relative(path.join(os.homedir(), 'Development'), sessionCwd);
      const title = (session.name || session.firstMessage || 'Empty chat').replace(/\s+/g, ' ').trim();
      found.push({
        id: Buffer.from(session.path).toString('base64url'), file: session.path,
        cwd: sessionCwd, project, label: title, name: title,
        messageCount: session.messageCount, modified: session.modified.getTime(),
        managed: location.managed,
      });
    }
  }
  return found.sort((a, b) => b.modified - a.modified);
}
const json = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
async function body(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 1024 * 1024) throw new Error('Request exceeds 1 MB'); }
  return JSON.parse(text || '{}');
}
function authorized(req) {
  const value = req.headers['x-lilim-token'];
  return typeof value === 'string' && value.length === token.length && timingSafeEqual(Buffer.from(value), Buffer.from(token));
}
const allowed = new Set(['prompt', 'abort', 'clear_queue', 'fork', 'new_session', 'set_model', 'set_thinking_level', 'get_available_models', 'get_available_thinking_levels']);
const production = process.argv.includes('--production');
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  try {
    if (url.pathname.startsWith('/utw/')) {
      const host = req.headers.host;
      if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) return json(res, { error: 'Invalid host' }, 403);
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(res, { error: 'Invalid origin' }, 403);
      if (await proxyUtw(req, res, utw)) return;
    }
    if (url.pathname.startsWith('/api/')) {
      // The desktop bridge is loopback-only. Reject DNS rebinding, require a
      // capability token for mutations, and do not grant cross-origin reads.
      const host = req.headers.host;
      if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) return json(res, { error: 'Invalid host' }, 403);
      if (req.method === 'GET') {
        if (url.pathname === '/api/info') return json(res, { token, ...payload() });
        if (url.pathname === '/api/sessions') {
          const available = await catalog();
          return json(res, available.filter(entry => url.searchParams.get('scope') !== 'cwd' || entry.cwd === cwd).map(({ file: _file, ...entry }) => entry));
        }
        if (url.pathname === '/api/session') {
          const entry = (await catalog()).find(entry => entry.id === url.searchParams.get('id'));
          if (!entry) return json(res, { error: 'Session not found' }, 404);
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
          return res.end(await readFile(entry.file));
        }
        if (url.pathname === '/api/events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
          res.write(`event: snapshot\ndata: ${JSON.stringify(payload())}\n\n`);
          clients.add(res);
          req.on('close', () => { clients.delete(res); });
          return;
        }
      }
      if (req.method !== 'POST') return json(res, { error: 'Not found' }, 404);
      if (!authorized(req)) return json(res, { error: 'Invalid token' }, 403);
      const command = await body(req);
      if (url.pathname === '/api/ui') {
        if (!dialogs.has(command.id)) throw new Error('Dialog expired');
        await rpc.write({ type: 'extension_ui_response', id: command.id, value: command.value, confirmed: command.confirmed, cancelled: command.cancelled });
        dialogs.delete(command.id);
        return json(res, {});
      }
      if (url.pathname === '/api/stop') { await rpc.stop(); return json(res, {}); }
      if (url.pathname === '/api/start') {
        if (mutating) throw new Error('Pi is already starting');
        mutating = true;
        let starting = false;
        try {
          const selected = command.sessionId ? (await catalog()).find(entry => entry.id === command.sessionId) : null;
          if (command.sessionId && !selected) throw new Error('Session not found');
          if (rpc.child) {
            if (!selected) throw new Error('Pi is already connected');
            const result = await rpc.command({ type: 'switch_session', sessionPath: selected.file });
            if (result?.cancelled) throw new Error('Pi cancelled the session switch');
            await refresh();
            return json(res, payload());
          }
          await mkdir(managed, { recursive: true });
          const args = ['--mode', 'rpc', '--session-dir', managed, '--extension', fileURLToPath(new URL('./tree-navigation.mjs', import.meta.url))];
          if (process.env.UTW_EXTENSION) args.push('--extension', path.resolve(process.env.UTW_EXTENSION));
          if (selected) args.push('--session', selected.file);
          starting = true;
          // Both the bridge and its agent use this checkout's source aliases.
          const fixture = process.env.PI_RPC_FIXTURE;
          await rpc.start(process.execPath, fixture ? [path.resolve(fixture)] : ['--import', resolver, cli, ...args], cwd);
          await refresh();
          return json(res, payload());
        } catch (error) { if (starting) await rpc.stop(); throw error; }
        finally { mutating = false; }
      }
      if (url.pathname === '/api/branch' || url.pathname === '/api/continue') {
        if (mutating) throw new Error('Another command is in progress');
        mutating = true;
        try {
          const before = await rpc.command({ type: 'get_entries' });
          const source = before.entries.find(entry => entry.id === command.entryId
            && (url.pathname === '/api/continue' || entry.message?.role === 'user'));
          if (!source) throw new Error('Branch entry not found');
          if (typeof command.message !== 'string' || !command.message.trim()) throw new Error('Message is empty');
          const commands = await rpc.command({ type: 'get_commands' });
          if (!commands.commands.some(entry => entry.name === 'lilim-tree')) throw new Error('Reconnect Pi to enable tree navigation');
          let navigationError;
          const observe = record => {
            if (record.type === 'extension_error' && record.extensionPath === 'command:lilim-tree') navigationError = record.error;
          };
          rpc.on('record', observe);
          try {
            await rpc.command({ type: 'prompt', message: `/lilim-tree ${source.id}` });
          } finally { rpc.off('record', observe); }
          if (navigationError) throw new Error(navigationError);
          const navigated = await rpc.command({ type: 'get_entries' });
          const target = source.message?.role === 'user' ? source.parentId : source.id;
          if (navigated.leafId !== target) throw new Error('Tree navigation did not reach the selected branch');
          await refresh();
          return json(res, await rpc.command({ type: 'prompt', message: command.message }));
        } finally { mutating = false; }
      }
      if (url.pathname === '/api/command') {
        if (!allowed.has(command.type)) throw new Error('Unsupported command');
        const reload = command.type === 'prompt' && command.message?.trim() === '/reload';
        if (reload && rpc.running) throw new Error('Stop the agent before reloading');
        const changesBranch = reload || ['fork', 'new_session', 'set_model', 'set_thinking_level'].includes(command.type);
        if ((changesBranch || command.type === 'prompt') && mutating) throw new Error('Another command is in progress');
        if (changesBranch && rpc.running) throw new Error('Stop the agent before changing the session');
        if (changesBranch || command.type === 'prompt') mutating = true;
        try {
          if (reload) {
            const available = await rpc.command({ type: 'get_commands' });
            if (!available.commands.some(entry => entry.name === 'lilim-reload')) throw new Error('Reconnect Pi to enable /reload');
            command.message = '/lilim-reload';
          }
          const result = await rpc.command(command);
          if (changesBranch) await refresh();
          return json(res, result || {});
        } finally { if (changesBranch || command.type === 'prompt') mutating = false; }
      }
      return json(res, { error: 'Not found' }, 404);
    }
    if (vite) return vite.middlewares(req, res, () => { res.writeHead(404); res.end(); });
    const appRoute = url.pathname === '/' || /^\/system-prompts(?:\/[1-9]\d*)?\/?$/.test(url.pathname);
    const relative = appRoute ? '/index.html' : decodeURIComponent(url.pathname);
    const filename = path.resolve(root, 'dist', `.${relative}`);
    if (!filename.startsWith(path.join(root, 'dist') + path.sep)) { res.writeHead(403); return res.end(); }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
    const content = await readFile(filename);
    res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' }); res.end(content);
  } catch (error) { json(res, { error: error.message }, 400); }
});
const vite = production ? null : await createServer({ root, server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
server.listen(port, '127.0.0.1', () => console.log(`Spicy: http://localhost:${port}\nWorking directory: ${cwd}\nAgent starts only when requested in the UI.`));
async function shutdown() { for (const client of clients) client.end(); await rpc.stop(); await vite?.close(); server.close(); }
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
