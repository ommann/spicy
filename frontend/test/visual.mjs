// Opt-in visual comparison with the running original, not a model/test loop.
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const referenceURL = process.env.LILIM_REFERENCE_URL || 'http://localhost:8080';
const targetURL = process.env.LILIM_URL || 'http://localhost:5173';
const executablePath = process.env.CHROMIUM_EXECUTABLE || process.env.PATH.split(path.delimiter)
  .map(directory => path.join(directory, 'chromium')).find(filename => existsSync(filename));
if (!executablePath) throw new Error('Set CHROMIUM_EXECUTABLE to Chromium');
const referenceCatalog = await (await fetch(`${referenceURL}/api/sessions`)).json();
const targetCatalog = await (await fetch(`${targetURL}/api/sessions`)).json();
const referenceId = referenceCatalog.defaultId;
const filename = referenceId.split('/').at(-1);
const targetSession = targetCatalog.find(session => Buffer.from(session.id, 'base64url').toString('utf8').endsWith(filename));
assert.ok(targetSession, 'Both views must load the same real session');
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const original = await context.newPage();
  const solid = await context.newPage();
  const errors = [];
  for (const page of [original, solid]) page.on('pageerror', error => errors.push(error.message));
  await original.goto(`${referenceURL}/?session=${encodeURIComponent(referenceId)}`);
  await solid.goto(`${targetURL}/?session=${encodeURIComponent(targetSession.id)}`);
  for (const page of [original, solid]) {
    await page.waitForSelector('.tree-stage');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
  }
  const geometry = page => page.evaluate(() => Object.fromEntries(
    ['.tree-toolbar', '.canvas-scroll-shell', '.transcript', '.bottom', 'footer', '.tree-node'].map(selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return [selector, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }];
    })
  ));
  for (const mode of ['side', 'focused']) {
    if (mode === 'focused') {
      await original.getByRole('button', { name: 'Focused', exact: true }).click();
      await solid.getByRole('button', { name: 'Focused', exact: true }).click();
      await solid.waitForTimeout(250);
    }
    assert.equal(await solid.getByRole('button', { name: 'Focused', exact: true }).getAttribute('aria-pressed'), String(mode === 'focused'));
    assert.equal(await solid.getByRole('button', { name: 'Side by side', exact: true }).getAttribute('aria-pressed'), String(mode === 'side'));
    const reference = await original.screenshot({ path: `/tmp/spicy-original-${mode}.png`, animations: 'disabled', style: '.tree-toolbar { visibility: hidden; }' });
    const target = await solid.screenshot({ path: `/tmp/spicy-solid-${mode}.png`, animations: 'disabled', style: '.tree-toolbar { visibility: hidden; }' });
    const pixels = await solid.evaluate(async ([left, right]) => {
      const images = await Promise.all([left, right].map(async data => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height);
      }));
      let different = 0;
      let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
      for (let i = 0; i < images[0].data.length; i += 4) {
        if ([0, 1, 2].some(channel => images[0].data[i + channel] !== images[1].data[i + channel])) {
          different++;
          const pixel = i / 4, x = pixel % images[0].width, y = Math.floor(pixel / images[0].width);
          minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
      return { different, total: images[0].width * images[0].height, bounds: different ? { minX, minY, maxX, maxY } : null };
    }, [reference.toString('base64'), target.toString('base64')]);
    console.log(JSON.stringify({ mode, pixels, reference: await geometry(original), solid: await geometry(solid) }, null, 2));
    assert.equal(pixels.different, 0, `${mode}: screenshots must match exactly`);
  }
  await solid.getByRole('button', { name: 'Options', exact: true }).click();
  const options = solid.getByRole('dialog', { name: 'Options', exact: true });
  await options.getByRole('combobox', { name: 'Side by side width', exact: true }).selectOption('1040');
  assert.equal(await solid.getByRole('button', { name: 'Focused', exact: true }).getAttribute('aria-pressed'), 'true', 'Changing inactive width must not switch modes');
  await options.getByRole('combobox', { name: 'Focused width', exact: true }).selectOption('720');
  await options.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await solid.locator('.tree-card').first().evaluate(element => element.getBoundingClientRect().width), 720);
  await solid.getByRole('button', { name: 'Side by side', exact: true }).click();
  assert.equal(await solid.locator('.tree-card').first().evaluate(element => element.getBoundingClientRect().width), 1040);
  await solid.getByRole('button', { name: 'Sessions', exact: true }).click();
  const resume = solid.getByRole('dialog', { name: 'Sessions', exact: true });
  await resume.waitFor();
  assert.ok(await resume.isVisible());
  const titles = await resume.locator('.resume-title').allTextContents();
  assert.ok(titles.every(title => !title.includes('.jsonl')), 'Resume uses chat titles, not filenames');
  await resume.getByRole('button', { name: 'Close', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log('Transcript appearance preserved; view toggle, per-mode Options widths, and Sessions picker work.');
} finally {
  await browser.close();
}
