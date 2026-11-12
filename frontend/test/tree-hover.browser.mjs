// Read-only regression against a running app with a two-branch conversation.
// Usage: SPICY_TREE_URL=http://localhost:5174/<session>/tree node test/tree-hover.browser.mjs
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

assert.ok(process.env.SPICY_TREE_URL, 'Set SPICY_TREE_URL to a two-branch tree');
const executablePath = process.env.CHROMIUM_EXECUTABLE || process.env.PATH.split(path.delimiter)
  .map(directory => path.join(directory, 'chromium')).find(existsSync);
// A separate browser: never attach to or close the user's inspection tab.
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1256, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.SPICY_TREE_URL);
  await page.locator('.editor').nth(1).waitFor();
  await page.waitForTimeout(500);
  const viewport = page.locator('#trace-viewport');
  // Put both committed lanes on screen, with long shared history above us.
  await viewport.evaluate(v => {
    const editors = [...v.querySelectorAll('.editor')];
    const left = editors[0].getBoundingClientRect().left + v.scrollLeft;
    const right = editors[1].getBoundingClientRect().left + v.scrollLeft;
    v.scrollLeft = (left + right) / 2 + editors[0].getBoundingClientRect().width / 2 - v.clientWidth / 2;
    v.scrollTop = Math.min(1400, v.scrollHeight - v.clientHeight);
  });
  await page.mouse.move(200, 500);
  await page.mouse.wheel(0, -1); // End any initial jump's pointer suppression.
  await page.waitForTimeout(200);
  const read = () => page.evaluate(() => {
    const v = document.querySelector('#trace-viewport');
    return {
      url: location.href, history: history.length, top: v.scrollTop, left: v.scrollLeft,
      cards: [...v.querySelectorAll('article .tree-card')].map(card => card.getBoundingClientRect().left),
    };
  });
  const states = [];
  for (const x of [200, 1100, 200, 1100, 200, 1100]) {
    await page.mouse.move(x, 500);
    await page.waitForTimeout(150);
    states.push(await read());
  }
  const first = states[0];
  assert.ok(states.some(state => state.cards.some((x, i) => x !== first.cards[i])),
    'Hover must still reconstruct shared history between columns');
  for (const state of states) {
    assert.equal(state.url, first.url, 'Hover must not navigate');
    assert.equal(state.history, first.history, 'Hover must not add browser history');
    assert.equal(state.top, first.top, 'Hover must not change vertical reading position');
    assert.equal(state.left, first.left, 'Hover must not change horizontal reading position');
  }
  const inspectedLeaf = await page.locator('.editor').nth(1).getAttribute('data-leaf-id');
  await page.keyboard.press('Control+Shift+F');
  await page.waitForTimeout(500);
  assert.ok(new URL(page.url()).pathname.endsWith('/single'), `Explicit focus URL: ${page.url()}`);
  await page.getByRole('main', { name: 'Conversation — selected branch', exact: true }).waitFor();
  assert.equal(await page.locator('.editor').count(), 1, 'Explicit focus still opens single view');
  assert.equal(await page.locator('.editor').getAttribute('data-leaf-id'), inspectedLeaf,
    'Explicit focus opens the inspected branch, not the original URL branch');
  assert.deepEqual(errors, []);
  console.log('Tree hover reconstructs without navigation or scroll jumps; Ctrl+Shift+F opens single view.');
} finally {
  await browser.close();
}
