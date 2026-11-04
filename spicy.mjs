#!/usr/bin/env node
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, readlink } from 'node:fs/promises';
import { homedir } from 'node:os';
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
PI_CODING_AGENT_DIR overrides the local default.
--restart stops the recorded instance and preserves its runtime settings.`);
  process.exit(0);
}

if (args.includes('--tui')) {
  console.error('The terminal interface has been removed. Run spicy to open the web app.');
  process.exit(1);
}

// Restart only the instance recorded in .pid. No process scanning.
if (args.includes('--restart')) {
  await restartRecordedInstance();
}

// Choose settings before loading any backend modules.
let agentDirectory = process.env.PI_CODING_AGENT_DIR;

if (args.includes('--global-user-dir')) {
  agentDirectory = join(homedir(), '.pi', 'agent');
} else if (!agentDirectory) {
  agentDirectory = fileURLToPath(new URL('./.pi-user/', import.meta.url));
}

await mkdir(agentDirectory, { recursive: true });
process.env.PI_CODING_AGENT_DIR = agentDirectory;
process.env.PI_CWD = process.env.PI_CWD || process.cwd();

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
await import('./backend/index.mjs');

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

  // Preserve settings and passive tracing, without writing environment secrets to disk.
  const executable = await readlink(`/proc/${pid}/exe`);
  const environment = { ...process.env };
  const previousEnvironment = (await readFile(`/proc/${pid}/environ`, 'utf8')).split('\0');

  for (const name of Object.keys(environment)) {
    if (isRuntimeSetting(name)) {
      delete environment[name];
    }
  }
  for (const variable of previousEnvironment) {
    const separator = variable.indexOf('=');
    const name = variable.slice(0, separator);
    if (separator > 0 && isRuntimeSetting(name)) {
      environment[name] = variable.slice(separator + 1);
    }
  }
  environment.PI_CWD = environment.PI_CWD || cwd;

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
}

function isRuntimeSetting(name) {
  return name.startsWith('PI_') || ['NODE_OPTIONS', 'PORT', 'UTW_EXTENSION'].includes(name);
}
