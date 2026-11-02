#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const tui = args[0] === '--tui';
if (tui) args.shift();
if (!tui && args.some(arg => arg === '--help' || arg === '-h')) {
  console.log('Usage: spicy [--production]\n       spicy --tui [agent options]\n\nDefault: start the web app at http://localhost:5174.\n--tui: start the terminal interface in the current directory.');
} else {
  const resolver = new URL('./packages/coding-agent/src/experimental/source-resolver.ts', import.meta.url).href;
  const entry = fileURLToPath(new URL(tui ? './packages/coding-agent/src/cli.ts' : './backend/dev.mjs', import.meta.url));
  const child = spawn(process.execPath, [...(tui ? ['--import', resolver] : []), entry, ...args], {
    stdio: 'inherit',
    env: { ...process.env, PI_CWD: process.env.PI_CWD || process.cwd() },
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
