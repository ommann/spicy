import path from 'node:path';
import { stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/** Launch a configured executable directly; never interpret paths as shell syntax. */
export async function openEditor(cwd: string, file: string, line: number, executable = process.env.SPICY_VSCODE || 'code') {
  const target = path.resolve(cwd, file);
  if (!(await stat(target)).isFile()) throw new Error('Editor target must be a file');
  try {
    await execute(executable, ['--reuse-window', '--goto', `${target}:${line}`], { cwd, timeout: 15_000 });
  } catch (error) {
    throw new Error(`Unable to open VS Code. Install its code launcher or set SPICY_VSCODE. ${error instanceof Error ? error.message : String(error)}`);
  }
  return { path: target, line };
}
