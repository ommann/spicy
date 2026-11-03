// No HTTP or model requests. Compare local-host lookup with and without
// four concurrent DNS lookups, as made by the RPC catalog refresh.
import { lookup } from 'node:dns';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

if (!process.argv.includes('--child')) {
  for (const [workers, catalogLookups] of [[4, 0], [4, 4], [8, 4]]) {
    const child = spawnSync(process.execPath, [import.meta.filename, '--child', String(catalogLookups)], {
      env: { ...process.env, UV_THREADPOOL_SIZE: String(workers) }, encoding: 'utf8', timeout: 25000,
    });
    console.log(JSON.stringify({ workers, catalogLookups, output: child.stdout.trim(), error: child.error?.message, status: child.status }));
  }
} else {
  const count = Number(process.argv.at(-1));
  const started = performance.now();
  const measure = hostname => new Promise(resolve => {
    lookup(hostname, { all: true }, (error, addresses) => resolve({
      hostname, elapsedMs: Math.round(performance.now() - started), error: error?.code, addresses: addresses?.length,
    }));
  });
  const background = Array.from({ length: count }, () => measure('pi.dev'));
  const local = await measure('localhost');
  console.log(JSON.stringify({ local }));
  console.log(JSON.stringify({ background: await Promise.all(background) }));
}
