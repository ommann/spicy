#!/usr/bin/env node
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, readlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { parseEnv } from 'node:util';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const launcher = fileURLToPath(import.meta.url);
const pidFile = new URL('./.pid', import.meta.url);
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: spicy [--restart] [--global-user-dir]

Serve current source at http://localhost:5174.
Settings: .pi-user/ by default; --global-user-dir uses ~/.pi/agent.
SPICY_CODING_AGENT_DIR overrides the local default.
Configuration is loaded from the checkout's .env (overrides shell values).
--restart stops the recorded instance and reloads .env.`);
  process.exit(0);
}

if (args.includes('--tui')) {
  console.error('The terminal interface has been removed. Run spicy to open the web app.');
  process.exit(1);
}

const configuration = parseEnv(readFileSync(new URL('./.env', import.meta.url), 'utf8'));
Object.assign(process.env, configuration);
const required = ['PORT', 'SPICY_CWD', 'SPICY_HISTORY_DB', 'SPICY_SESSION_DIR', 'SPICY_CODING_AGENT_DIR'];
const missing = required.filter(name => !process.env[name]?.trim());
if (missing.length) throw new Error(`Missing required configuration: ${missing.join(', ')}`);

// Restart only the instance recorded in .pid. No process scanning.
if (args.includes('--restart')) {
  await restartRecordedInstance();
}

// Choose settings before loading any backend modules.
let agentDirectory = process.env.SPICY_CODING_AGENT_DIR ?? process.env.PI_CODING_AGENT_DIR; // Legacy fallback.

if (args.includes('--global-user-dir')) {
  agentDirectory = join(homedir(), '.pi', 'agent');
} else if (!agentDirectory) {
  agentDirectory = fileURLToPath(new URL('./.pi-user/', import.meta.url));
}

await mkdir(agentDirectory, { recursive: true });
process.env.SPICY_CODING_AGENT_DIR = agentDirectory;


// Record this server for restart; remove only our own PID on exit.
writeFileSync(pidFile, `${process.pid}\n`);
process.on('exit', () => {
  try {
    if (readFileSync(pidFile, 'utf8').trim() === String(process.pid)) {
      unlinkSync(pidFile);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(error.message);
    }
  }
});

// Load workspace source, then serve the API and frontend in this process.
await import('./packages/coding-agent/src/experimental/source-resolver.ts');
await import('./backend/index.ts');

async function restartRecordedInstance() {
  let pid;
  let command;
  let cwd;

  try {
    pid = (await readFile(pidFile, 'utf8')).trim();
    if (!/^\d+$/.test(pid)) {
      throw new Error('Invalid .pid file');
    }
    command = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
    cwd = await readlink(`/proc/${pid}/cwd`);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') {
      return; // Nothing running: continue with normal startup.
    }
    throw error;
  }

  const entry = command.findIndex((arg, index) => index > 0 && resolve(cwd, arg) === launcher);
  if (entry < 0) {
    throw new Error('.pid does not identify this Spicy launcher; refusing to stop it.');
  }

  // Restart using the current checkout configuration, not the old process environment.
  const executable = await readlink(`/proc/${pid}/exe`);
  const environment = { ...process.env };

  process.kill(Number(pid), 'SIGTERM');
  const deadline = Date.now() + 10_000;

  while (true) {
    try {
      process.kill(Number(pid), 0);
    } catch (error) {
      if (error.code === 'ESRCH') break;
      throw error;
    }
    if (Date.now() >= deadline) {
      throw new Error('Spicy did not stop within 10 seconds.');
    }
    await delay(50);
  }

  // Replace this process: no extra launcher or signal-forwarding wrapper.
  const startupArgs = [...command.slice(entry + 1), ...args].filter(arg => arg !== '--restart');
  process.execve(executable, [executable, launcher, ...startupArgs], environment);
