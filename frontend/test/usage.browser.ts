// SPICY_URL=http://localhost:5174 node frontend/test/usage.browser.ts
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { usageWindowNames, usageWindows } from '../../shared/usage.ts';

const executablePath = process.env.CHROMIUM_EXECUTABLE || process.env.PATH!.split(path.delimiter)
  .map(directory => path.join(directory, 'chromium')).find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const now = Date.now();
  const samples = usageWindowNames.map(usageWindow => ({
    window: usageWindow, observedAt: now, usedPercent: 40,
    resetAt: now + usageWindows[usageWindow].duration / 2,
  }));
  let refreshes = 0;
  await page.route('**/rpc/auth/codexUsage', async route => {
    refreshes++;
    await route.fulfill({ json: { json: {} } });
  });
  await page.route('**/rpc/auth/usageHistory', async route => {
    assert.ok(refreshes > 0, 'Opening refreshes limits before reading history');
    await route.fulfill({ json: { json: samples } });
  });
  await page.goto(process.env.SPICY_URL || 'http://localhost:5174');
  await page.getByRole('button', { name: 'Usage', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Usage', exact: true });
  await dialog.locator('.usage-start').last().waitFor();
  assert.equal(refreshes, 1);
  for (const sample of samples) {
    const chart = dialog.getByRole('img', { name: `${sample.window} remaining usage: solid history, dashed projection`, exact: true });
    const marker = chart.locator('.usage-start');
    assert.equal(await marker.getAttribute('cy'), '25', 'Starting point is at 100%');
    const connector = chart.locator('.usage-start-connection');
    assert.equal(await connector.getAttribute('y1'), '25');
    assert.ok(Number(await connector.getAttribute('x2')) > Number(await connector.getAttribute('x1')));
    assert.ok((await connector.evaluate(element => getComputedStyle(element).strokeDasharray)) !== 'none');
    if (sample.window === '5-hour') assert.equal(await marker.getAttribute('cx'), '40');
    else {
      const reset = chart.locator('.usage-reset');
      assert.ok(Number(await marker.getAttribute('cx')) >= 40);
      assert.ok(Number(await reset.getAttribute('x1')) > Number(await marker.getAttribute('cx')));
    }
  }
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Usage', exact: true }).click();
  await dialog.locator('.usage-start').last().waitFor();
  assert.equal(refreshes, 2, 'Each opening refreshes once');
  console.log('Usage renders both starting points with dashed connections and refreshes on opening.');
} finally {
  await browser.close();
}
