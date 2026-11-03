// Passive, opt-in tracing. Does not send requests or record headers/bodies.
// Usage: NODE_OPTIONS="--import=/absolute/path/lag-experiment/trace-preload.mjs" <command>
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
import { channel } from 'node:diagnostics_channel';
import { appendFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const started = performance.now();
const output = new URL('./connection-trace.jsonl', import.meta.url);
const record = (event, fields = {}) => {
  try {
    appendFileSync(output, JSON.stringify({
      timestamp: new Date().toISOString(), pid: process.pid,
      elapsedMs: Math.round(performance.now() - started), event, ...fields,
    }) + '\n');
  } catch { /* Tracing must never interrupt the agent. */ }
};
record('process-start', { node: process.version, threadpool: process.env.UV_THREADPOOL_SIZE || 'default (4)' });
const originalLookup = dns.lookup;
let lookupId = 0;
dns.lookup = function (...args) {
  const callbackIndex = args.length - 1;
  const callback = args[callbackIndex];
  if (typeof callback !== 'function') return Reflect.apply(originalLookup, this, args);
  const id = ++lookupId;
  const hostname = args[0];
  const begin = performance.now();
  record('lookup-start', { id, hostname });
  args[callbackIndex] = function (error, address, family) {
    record('lookup-end', {
      id, hostname, durationMs: Math.round(performance.now() - begin), error: error?.code,
      families: Array.isArray(address) ? address.map(item => item.family) : family,
    });
    return Reflect.apply(callback, this, arguments);
  };
  return Reflect.apply(originalLookup, this, args);
};
syncBuiltinESMExports();
for (const name of ['beforeConnect', 'connected', 'connectError']) {
  channel(`undici:client:${name}`).subscribe(({ connectParams, error, socket }) => {
    record(name, { hostname: connectParams?.hostname, family: socket?.remoteFamily, error: error?.code });
  });
}
channel('undici:request:create').subscribe(({ request }) => {
  let hostname;
  try { hostname = new URL(request.origin).hostname; } catch { return; }
  record('request-create', { hostname, websocket: request.upgrade === 'websocket' });
});
