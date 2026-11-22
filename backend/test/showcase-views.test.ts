import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { call } from '@orpc/server';
import { createRouter } from '../router.ts';
import { showcaseViewSchema } from '../../shared/showcase-view.ts';

const view = {
  name: 'edit-diffs', path: '/t/5qqbesva/a8mb6692', width: 1571, height: 1277, dpr: 1,
  top: 0, left: 760, pointer: { x: 50.125, y: 558.125 },
};

test('showcase names cannot escape the output folder and paths stay on the app', () => {
  for (const patch of [{ name: '../escape' }, { path: '//example.com' }, { width: 0 }, { pointer: { x: -1, y: 0 } }]) {
    assert.equal(showcaseViewSchema.safeParse({ ...view, ...patch }).success, false);
  }
});

test('authenticated showcase saves persist by name and are listed by the screenshot CLI', async t => {
  const managed = mkdtempSync(join(tmpdir(), 'spicy-showcase-'));
  const file = join(managed, 'showcase.sqlite');
  t.onTestFinished(() => {
    vi.unstubAllEnvs();
    rmSync(managed, { recursive: true, force: true });
  });
  vi.stubEnv('SPICY_HISTORY_DB', file);
  vi.stubEnv('SPICY_SHOWCASE', '0');
  const router = createRouter({ agents: {} as never, login: {} as never, cwd: managed, managed, token: 'secret' });
  const context = { headers: new Headers({ 'x-spicy-token': 'secret' }) };
  await assert.rejects(call(router.showcaseViews.save, view, { context }), /Showcase mode is not enabled/);
  vi.stubEnv('SPICY_SHOWCASE', '1');
  await assert.rejects(call(router.showcaseViews.save, view, { context: { headers: new Headers() } }), /Invalid token/);
  await call(router.showcaseViews.save, view, { context });
  const updated = { ...view, left: 42 };
  await call(router.showcaseViews.save, updated, { context });
  await call(router.showcaseViews.save, { ...view, name: 'tree', pointer: null }, { context });

  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare('SELECT name, payload FROM showcase_views ORDER BY name').all();
    assert.deepEqual(rows.map(row => row.name), ['edit-diffs', 'tree']);
    assert.deepEqual(JSON.parse(String(rows[0].payload)), updated);
  } finally { db.close(); }

  const script = fileURLToPath(new URL('../../showcase/update-screenshots.ts', import.meta.url));
  assert.equal(execFileSync(process.execPath, [script, '--list'], {
    encoding: 'utf8', env: { ...process.env, SPICY_SHOWCASE_DB: file },
  }),
    `edit-diffs\t${view.path}\ntree\t${view.path}\n`);
});
