import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { call } from '@orpc/server';
import { openEditor } from '../open-editor.ts';
import { openEditorInput } from '../inputs.ts';
import { createRouter } from '../router.ts';

test('editor input validates line, path and working directory', () => {
  assert.equal(openEditorInput.parse({ cwd: '/tmp', path: 'file.ts' }).line, 1);
  for (const patch of [{ line: 0 }, { line: -1 }, { line: 1.5 }, { cwd: '.' }, { path: '' }, { path: 'bad\0path' }, { command: 'sh' }]) {
    assert.equal(openEditorInput.safeParse({ cwd: '/tmp', path: 'file.ts', ...patch }).success, false);
  }
});

test('opening an editor requires the mutation token', async () => {
  const router = createRouter({ agents: {} as never, login: {} as never, cwd: '/tmp', managed: '/tmp', token: 'secret' });
  await assert.rejects(call(router.openEditor, { cwd: '/tmp', path: 'file.ts', line: 1 }, { context: { headers: new Headers() } }), /Invalid token/);
});

test('launches with literal arguments and resolves relative and absolute files', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'spicy-editor-'));
  try {
    const file = 'source ; $(echo unsafe).ts';
    await writeFile(path.join(cwd, file), 'source');
    const launcher = path.join(cwd, 'fake-code');
    const log = path.join(cwd, 'args.json');
    await writeFile(launcher, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));\n`);
    await chmod(launcher, 0o755);
    for (const target of [file, path.join(cwd, file)]) {
      await rm(log, { force: true });
      assert.deepEqual(await openEditor(cwd, target, 42, launcher), { path: path.join(cwd, file), line: 42 });
      const args = JSON.parse(await readFile(log, 'utf8'));
      assert.deepEqual(args, ['--reuse-window', '--goto', `${path.join(cwd, file)}:42`]);
    }
    await assert.rejects(openEditor(cwd, file, 1, path.join(cwd, 'missing-launcher')), /SPICY_VSCODE/);
    await writeFile(launcher, `#!${process.execPath}\nprocess.stderr.write('launcher failed'); process.exit(1);\n`);
    await assert.rejects(openEditor(cwd, file, 1, launcher), /launcher failed/);
    await assert.rejects(openEditor(cwd, 'missing-file', 1, launcher), /ENOENT/);
    await assert.rejects(openEditor(cwd, '.', 1, launcher), /must be a file/);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
