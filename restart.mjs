#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, readdir, readlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const launcher = fileURLToPath(new URL('./spicy.mjs', import.meta.url));
const pidFile = new URL('./.pid', import.meta.url);

async function running(pid) {
  try {
    const cwd = await readlink(`/proc/${pid}/cwd`);
    const args = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
    const index = args.findIndex((arg, index) => index > 0 && resolve(cwd, arg) === launcher);
    if (index < 0) return;
    const environment = Object.fromEntries((await readFile(`/proc/${pid}/environ`, 'utf8')).split('\0')
      .filter(Boolean).map(entry => { const index = entry.indexOf('='); return [entry.slice(0, index), entry.slice(index + 1)]; }));
    return { pid: Number(pid), cwd, args: args.slice(index + 1), environment, executable: await readlink(`/proc/${pid}/exe`) };
  } catch (error) {
    if (!['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) throw error;
  }
}

let previous;
try {
  const pid = (await readFile(pidFile, 'utf8')).trim();
  if (!/^\d+$/.test(pid)) throw new Error('Invalid .pid file');
  previous = await running(pid);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
// Adopt an instance started before PID tracking was introduced.
if (!previous) {
  const matches = [];
  for (const pid of await readdir('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    const instance = await running(pid);
    if (instance) matches.push(instance);
  }
  if (matches.length > 1) throw new Error('Multiple Spicy launchers found; refusing to choose one');
  previous = matches[0];
}
if (previous) {
  process.kill(previous.pid, 'SIGTERM');
  const deadline = Date.now() + 10000;
  while (await running(previous.pid)) {
    if (Date.now() >= deadline) throw new Error('Spicy did not stop within 10 seconds');
    await delay(50);
  }
}
const env = { ...process.env };
if (previous) {
  for (const key of Object.keys(env)) {
    if (key.startsWith('PI_') || ['NODE_OPTIONS', 'PORT', 'UTW_EXTENSION'].includes(key)) delete env[key];
  }
  for (const [key, value] of Object.entries(previous.environment)) {
    if (key.startsWith('PI_') || ['NODE_OPTIONS', 'PORT', 'UTW_EXTENSION'].includes(key)) env[key] = value;
  }
}
if (previous) env.PI_CWD = previous.environment.PI_CWD || previous.cwd;
const args = [...new Set([...(previous?.args || []), ...process.argv.slice(2)])];
const child = spawn(previous?.executable || process.execPath, [launcher, ...args], { cwd: root, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
});
