// Browser regression: npm run dev must be serving LILIM_URL.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || '/run/current-system/sw/bin/chromium', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const entries = [
    { id: 'system', parentId: null, type: 'message', message: { role: 'system', content: '<rules>\n' + 'Long prompt content '.repeat(60) + '\n</rules>' } },
    { id: 'user', parentId: 'system', type: 'message', message: { role: 'user', content: 'Hello' } },
  ];
  await page.route('**/api/info', route => route.fulfill({ json: { entries, leafId: 'user', state: { sessionId: 'scroll-test' }, connected: true, live: [], dialogs: [], token: 'test', cwd: '/test' } }));
  await page.route('**/api/events', route => route.fulfill({ contentType: 'text/event-stream', body: '' }));
  await page.goto(`${process.env.LILIM_URL || 'http://127.0.0.1:5173'}/system-prompts/1`);
  const area = page.locator('.system-prompt-version .diff-scroll-area').first();
  const track = area.locator(':scope > [aria-orientation="horizontal"]');
  await track.waitFor({ state: 'visible' });
  assert.deepEqual(await area.locator('.diff-view').evaluate(element => {
    const style = getComputedStyle(element);
    return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft];
  }), ['20px', '8px', '20px', '8px']);
  assert.equal(await track.evaluate(element => getComputedStyle(element).position), 'absolute');
  const box = await area.boundingBox();
  const bar = await track.boundingBox();
  assert.ok(box && bar);
  assert.ok(bar.y >= box.y && bar.y + bar.height <= box.y + box.height + 1, 'Nested track stays inside its prompt element');
  const outer = page.locator('.system-prompts-scroll-area > .scroll-area-viewport');
  const outerLeft = await outer.evaluate(element => element.scrollLeft);
  const thumb = track.locator('.canvas-scroll-thumb');
  const thumbBox = await thumb.boundingBox();
  await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + thumbBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(thumbBox.x + thumbBox.width / 2 + 100, thumbBox.y + thumbBox.height / 2, { steps: 8 });
  await page.mouse.up();
  assert.ok(await area.locator(':scope > .scroll-area-viewport').evaluate(element => element.scrollLeft) > 0, 'Dragging scrolls the prompt element');
  assert.equal(await outer.evaluate(element => element.scrollLeft), outerLeft, 'Nested drag does not scroll the whole view');
  console.log('Nested prompt scrollbar positioning and drag passed');
} finally {
  await browser.close();
}
