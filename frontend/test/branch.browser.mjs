// One isolated branch check. The fixture makes no model calls or project edits.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const reservation = net.createServer().listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const root = fileURLToPath(new URL('..', import.meta.url));
const server = spawn(process.execPath, ['server/index.mjs', '--production'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), PI_RPC_FIXTURE: fileURLToPath(new URL('./fake-pi.mjs', import.meta.url)) },
  stdio: ['ignore', 'pipe', 'inherit'],
});
let browser;
let page;
const errors = [];
try {
  await once(server.stdout, 'data');
  const executablePath = process.env.CHROMIUM_EXECUTABLE || process.env.PATH.split(path.delimiter)
    .map(directory => path.join(directory, 'chromium')).find(filename => existsSync(filename));
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  const base = `http://127.0.0.1:${port}`;
  await page.goto(base);
  await page.waitForSelector('.tree-stage');
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/api/sessions')),
    page.getByRole('button', { name: 'New session', exact: true }).click(),
  ]);
  const originalInput = page.locator('.editor textarea').first();
  await originalInput.fill('Original prompt');
  await originalInput.press('Enter');
  await page.locator('.tree-node[data-entry-id="entry-2"]').waitFor();
  const before = await (await fetch(`${base}/api/info`)).json();
  const inputs = await page.locator('.editor textarea').count();
  const original = page.locator('.user').first();
  await original.hover();
  await original.getByRole('button', { name: 'New branch', exact: true }).click();
  const outline = page.locator('.branch-draft');
  await outline.waitFor();
  assert.equal(await outline.locator('textarea').count(), 0, 'Outline is not a second input');
  assert.equal(await outline.evaluate(element => getComputedStyle(element).borderTopStyle), 'dashed');
  assert.equal(await page.locator('.editor textarea').count(), inputs + 1, 'One composer per branch');
  const { sourceBox, draftBox } = await page.evaluate(() => {
    const source = document.querySelector('.user').getBoundingClientRect();
    const draft = document.querySelector('.branch-draft').getBoundingClientRect();
    return { sourceBox: { x: source.x, y: source.y }, draftBox: { x: draft.x, y: draft.y } };
  });
  assert.ok(draftBox.x > sourceBox.x, 'New branch is beside the original');
  assert.equal(draftBox.y, sourceBox.y, 'Outline aligns with the selected prompt');
  const draftInput = page.locator('.editor[data-leaf-id^="draft-"] textarea');
  assert.equal(await draftInput.inputValue(), '');
  await page.screenshot({ path: '/tmp/spicy-branch-preview.png' });
  await draftInput.fill('Different prompt');
  await draftInput.press('Enter');
  await page.locator('.tree-node[data-entry-id="entry-4"]').waitFor();
  const after = await (await fetch(`${base}/api/info`)).json();
  assert.equal(after.state.sessionId, before.state.sessionId, 'Session is unchanged');
  assert.deepEqual(after.entries.slice(0, 2), before.entries, 'Existing continuation is retained');
  assert.equal(after.entries[2].parentId, before.entries[0].parentId, 'New user prompt is a sibling');
  assert.equal(after.entries[2].message.content, 'Different prompt');
  await page.waitForFunction(() => !document.querySelector('.branch-draft'));
  assert.equal(await page.locator('.user').count(), 2);
  const otherBranch = page.locator('.editor[data-leaf-id="entry-2"] textarea');
  await otherBranch.fill('Continue the original branch');
  await otherBranch.press('Enter');
  await page.locator('.tree-node[data-entry-id="entry-6"]').waitFor();
  const continued = await (await fetch(`${base}/api/info`)).json();
  assert.equal(continued.state.sessionId, before.state.sessionId);
  assert.equal(continued.entries[4].parentId, 'entry-2', 'Inactive branch continues at its own endpoint');
  assert.deepEqual(continued.entries.slice(0, 4), after.entries, 'Both previous continuations remain');
  assert.deepEqual(errors, []);
  console.log('Dashed preview, empty composer, and same-session branch submission passed.');
} catch (error) {
  console.error('Browser errors:', errors);
  await page?.screenshot({ path: '/tmp/spicy-branch-failure.png' });
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await once(server, 'exit');
}
