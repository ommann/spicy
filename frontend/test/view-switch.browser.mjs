// SPICY_TREE_URL=http://localhost:5174/<session>/tree node frontend/test/view-switch.browser.mjs
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

assert.ok(process.env.SPICY_TREE_URL, 'Set SPICY_TREE_URL to a chat');
const executablePath = process.env.CHROMIUM_EXECUTABLE || process.env.PATH.split(path.delimiter)
  .map(directory => path.join(directory, 'chromium')).find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1256, height: 1000 } });
  await page.goto(process.env.SPICY_TREE_URL);
  await page.locator('.editor').first().waitFor();
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+Shift+F');
  await page.waitForTimeout(500);
  assert.ok(new URL(page.url()).pathname.endsWith('/single'));
  const cards = page.locator('article.tree-node[data-entry-id]');
  const card = cards.nth(Math.floor(await cards.count() / 2));
  const text = card.locator('p, pre').first();
  const target = await text.count() ? text : card;
  await target.scrollIntoViewIfNeeded();
  await target.hover();
  const anchor = await target.evaluate(target => {
    const box = target.getBoundingClientRect();
    const e = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    const article = e.closest('article[data-entry-id]');
    const path = [];
    for (let child = e; child !== article; child = child.parentElement)
      path.unshift([...child.parentElement.children].indexOf(child));
    return { id: article.dataset.entryId, path, top: e.getBoundingClientRect().top };
  });
  for (const mode of ['tree', 'single']) {
    await page.keyboard.press('Control+Shift+F');
    await page.waitForTimeout(500);
    assert.ok(new URL(page.url()).pathname.endsWith(`/${mode}`));
    const top = await page.evaluate(anchor => {
      let e = [...document.querySelectorAll('article[data-entry-id]')].find(e => e.dataset.entryId === anchor.id);
      for (const index of anchor.path) e = e?.children[index];
      return e?.getBoundingClientRect().top;
    }, anchor);
    assert.ok(Math.abs(top - anchor.top) <= 1, `${mode}: hovered element moved from ${anchor.top} to ${top}`);
  }
  console.log('Single → Tree → Single keeps the hovered element still.');
} finally {
  await browser.close();
}
