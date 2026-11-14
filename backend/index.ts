import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { getRequestListener } from '@hono/node-server';
import { RPCHandler, BodyLimitPlugin } from '@orpc/server/fetch';
import { createServer } from 'vite';
import { AgentRegistry } from './agents.ts';
import { LoginBridge } from './auth.ts';
import { createRouter } from './router.ts';
import { importLegacyHistories } from '../packages/coding-agent/src/core/history-migration.ts';

const root = fileURLToPath(new URL('../frontend', import.meta.url));
const repository = fileURLToPath(new URL('..', import.meta.url));
const cwd = path.resolve(process.env.PI_CWD || repository);
const port = Number(process.env.PORT || 5174);
const rpcFixture = process.env.SPICY_RPC_FIXTURE ?? process.env.PI_RPC_FIXTURE; // Legacy fallback.
const sessionDirectory = process.env.SPICY_SESSION_DIR ?? process.env.PI_SESSION_DIR; // Legacy fallback.
const managed = sessionDirectory ? path.resolve(sessionDirectory) : fileURLToPath(new URL('./.sessions', import.meta.url));
// The web server and every child agent share one history database.
process.env.SPICY_HISTORY_DB ||= path.join(managed, 'history.sqlite');
await importLegacyHistories([managed]);
const token = randomUUID();
const login = new LoginBridge();
const agents = new AgentRegistry({
  cwd, managed,
  cli: path.join(repository, 'packages/coding-agent/src/cli.ts'),
  resolver: new URL('../packages/coding-agent/src/experimental/source-resolver.ts', import.meta.url).href,
  extension: fileURLToPath(new URL('./tree-navigation.ts', import.meta.url)),
  fixture: rpcFixture && path.resolve(rpcFixture),
});
const app = new Hono();
const lifetime = new AbortController();
const handler = new RPCHandler(createRouter({ agents, login, cwd, managed, token, signal: lifetime.signal }), {
  plugins: [new BodyLimitPlugin({ maxBodySize: 32 * 1024 * 1024 })],
});
app.use('/rpc/*', async (c, next) => {
  if (lifetime.signal.aborted) return c.json({ error: 'Server is shutting down' }, 503);
  // Loopback-only capability bridge: reject DNS rebinding and cross-origin calls.
  const host = c.req.header('host');
  if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) return c.json({ error: 'Invalid host' }, 403);
  const origin = c.req.header('origin');
  if (origin && origin !== `http://${host}`) return c.json({ error: 'Invalid origin' }, 403);
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  const { matched, response } = await handler.handle(c.req.raw, {
    prefix: '/rpc', context: { headers: c.req.raw.headers },
  });
  if (matched) return c.newResponse(response.body, response);
  await next();
});
app.notFound(c => c.json({ error: 'Not found' }, 404));
const listener = getRequestListener(app.fetch);
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url!, `http://127.0.0.1:${port}`).pathname;
  if (/^\/(rpc|api|utw)(\/|$)/.test(pathname)) return listener(req, res);
  return vite.middlewares(req, res, () => { res.writeHead(404); res.end(); });
});
const vite = await createServer({ root, server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
server.listen(port, '127.0.0.1', () => console.log(`Spicy: http://localhost:${port}\nWorking directory: ${cwd}\nAgent starts only when requested in the UI.`));
let shutdownTask: Promise<void> | undefined;
function shutdown() {
  return shutdownTask ??= (async () => {
    lifetime.abort();
    const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    const results = await Promise.allSettled([login.cancel(), agents.shutdown(), vite.close(), closed]);
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('Spicy shutdown failed:', result.reason);
        process.exitCode = 1;
      }
    }
  })();
}
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
