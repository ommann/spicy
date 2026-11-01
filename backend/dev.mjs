import { spawn } from 'node:child_process';
import { readFile, readdir, readlink } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const backend = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
const repository = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const workingDirectories = new Set([backend, repository, `${repository}/frontend`]);
const server = fileURLToPath(new URL('./index.mjs', import.meta.url));
const resolver = new URL('../packages/coding-agent/src/experimental/source-resolver.ts', import.meta.url).href;
const marker = `SPICY_SERVER_ROOT=${repository}`;
const processes = [];
for (const entry of await readdir('/proc')) {
  if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
  try {
    const [stat, command, environment, cwd] = await Promise.all([
      readFile(`/proc/${entry}/stat`, 'utf8'),
      readFile(`/proc/${entry}/cmdline`, 'utf8'),
      readFile(`/proc/${entry}/environ`, 'utf8'),
      readlink(`/proc/${entry}/cwd`),
    ]);
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const args = command.split('\0');
    const legacyServer = workingDirectories.has(cwd) &&
      (args.includes(server) || args.includes('server/index.mjs'));
    const legacyAgent = args.includes(`${repository}/packages/coding-agent/src/cli.ts`) && args.includes('rpc');
    processes.push({ pid: Number(entry), parent: Number(fields[1]), owned: environment.split('\0').includes(marker) || legacyServer || legacyAgent });
  } catch (error) {
    if (!['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) throw error;
  }
}
const stale = new Set(processes.filter(entry => entry.owned).map(entry => entry.pid));
let previousSize;
do {
  previousSize = stale.size;
  for (const entry of processes) if (stale.has(entry.parent)) stale.add(entry.pid);
} while (stale.size !== previousSize);
for (const pid of stale) {
  try { process.kill(pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
const deadline = Date.now() + 5000;
while (stale.size) {
  for (const pid of stale) {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      if (stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z ')) stale.delete(pid);
      else if (Date.now() >= deadline) process.kill(pid, 'SIGKILL');
    } catch (error) {
      if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error;
      stale.delete(pid);
    }
  }
  if (stale.size) await delay(50);
}

const child = spawn(process.execPath, ['--import', resolver, server, ...process.argv.slice(2)], {
  cwd: backend,
  env: { ...process.env, PORT: process.env.PORT || '5174', SPICY_SERVER_ROOT: repository },
  stdio: 'inherit',
  detached: true,
});
function signalGroup(signal) {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  signalGroup(signal);
  setTimeout(() => signalGroup('SIGKILL'), 5000).unref();
});
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', code => {
  signalGroup('SIGKILL');
  process.exitCode = code ?? 1;
});
