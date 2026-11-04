import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Exercise the real launcher against an inert backend: no agents or model requests.
test('unified launcher restarts the recorded server and preserves runtime settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spicy-startup-'));
  const children = [];

  try {
    await mkdir(join(root, 'backend'));
    await mkdir(join(root, 'packages/coding-agent/src/experimental'), { recursive: true });
    await copyFile(new URL('../../spicy.mjs', import.meta.url), join(root, 'spicy.mjs'));
    await writeFile(join(root, 'packages/coding-agent/src/experimental/source-resolver.ts'), '');
    await writeFile(join(root, 'backend/index.mjs'), `
      import { writeFileSync } from 'node:fs';
      process.on('SIGTERM', () => process.exit(0));
      setInterval(() => {}, 1000);
      writeFileSync(new URL('../state.json', import.meta.url), JSON.stringify({
        pid: process.pid,
        settings: process.env.PI_CODING_AGENT_DIR,
        project: process.env.PI_CWD,
        port: process.env.PORT,
        nodeOptions: process.env.NODE_OPTIONS,
      }));
    `);

    function launch(args, environment) {
      const child = spawn(process.execPath, [join(root, 'spicy.mjs'), ...args], {
        cwd: root,
        env: { ...process.env, ...environment },
        stdio: 'ignore',
      });
      children.push(child);
      return child;
    }

    async function waitForServer(pid) {
      for (let attempt = 0; attempt < 200; attempt++) {
        try {
          const state = JSON.parse(await readFile(join(root, 'state.json'), 'utf8'));
          if (state.pid === pid) return state;
        } catch (error) {
          if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
        }
        await delay(25);
      }
      assert.fail('Server did not start');
    }

    const original = launch([], {
      PI_CODING_AGENT_DIR: join(root, 'settings'),
      PI_CWD: root,
      PORT: '15174',
      NODE_OPTIONS: '--no-warnings',
    });
    const originalState = await waitForServer(original.pid);
    const originalExit = once(original, 'exit');

    const replacement = launch(['--restart'], { PORT: '15175', NODE_OPTIONS: '' });
    const replacementState = await waitForServer(replacement.pid);
    assert.deepEqual(replacementState, { ...originalState, pid: replacement.pid });
    assert.equal((await readFile(join(root, '.pid'), 'utf8')).trim(), String(replacement.pid));
    await originalExit;

    const replacementExit = once(replacement, 'exit');
    replacement.kill('SIGTERM');
    await replacementExit;
    await assert.rejects(readFile(join(root, '.pid')), { code: 'ENOENT' });
  } finally {
    for (const child of children) child.kill('SIGKILL');
    await rm(root, { recursive: true, force: true });
  }
});
