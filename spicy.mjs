#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.includes('--tui')) {
  console.error('The terminal interface has been removed. Run spicy to open the web app.');
  process.exitCode = 1;
} else if (args.some(arg => arg === '--help' || arg === '-h')) {
  console.log('Usage: spicy [--production] [--global-user-dir]\n\nStart the web app at http://localhost:5174.\nUser directory: .pi-user/ in this project by default.\n--global-user-dir uses ~/.pi/agent instead.\nPI_CODING_AGENT_DIR overrides the local default.');
} else {
  const entry = fileURLToPath(new URL('./backend/dev.mjs', import.meta.url));
  const agentDir = args.includes('--global-user-dir')
    ? join(homedir(), '.pi', 'agent')
    : process.env.PI_CODING_AGENT_DIR || fileURLToPath(new URL('./.pi-user/', import.meta.url));
  await mkdir(agentDir, { recursive: true });
  const child = spawn(process.execPath, [entry, ...args.filter(arg => arg !== '--global-user-dir')], {
    stdio: 'inherit',
    env: { ...process.env, PI_CWD: process.env.PI_CWD || process.cwd(), PI_CODING_AGENT_DIR: agentDir },
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.once('error', error => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
  });
}
