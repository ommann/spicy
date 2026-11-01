import { Readable } from 'node:stream';
import { taskIdSegment } from '../frontend/src/utw/task-id.mjs';

const taskPath = new RegExp(`^/utw(/tasks/${taskIdSegment})(\\?[^#]*)?$`);

export function utwBase(value = process.env.UTW_URL || 'http://127.0.0.1:4317') {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('UTW_URL must be a loopback HTTP origin');
  }
  return url.origin;
}

// Read-only task metadata. All task UI and actions are served by UTW.
export async function proxyUtw(req, res, base) {
  if (!req.url.startsWith('/utw/')) {return false;}
  const match = req.method === 'GET' ? taskPath.exec(req.url) : null;
  if (!match) { res.writeHead(404).end(); return true; }
  try {
    const upstream = await fetch(base + match[1] + (match[2] || ''), {
      signal: AbortSignal.timeout(15000), redirect: 'error',
      method: req.method,
    });
    const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
    for (const name of ['content-type', 'content-security-policy']) {
      const value = upstream.headers.get(name);
      if (value) {headers[name] = value;}
    }
    res.writeHead(upstream.status, headers);
    if (upstream.body) {
      const stream = Readable.fromWeb(upstream.body);
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } else {res.end();}
  } catch (error) {
    if (!res.headersSent) {res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: `UTW: ${error.message}` }));}
    else {res.destroy();}
  }
  return true;
}
