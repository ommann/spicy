import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

import { chromium } from 'playwright';

import { showcaseViewSchema, type ShowcaseView } from '../shared/showcase-view.ts';

const settleMs = 500;
const args = process.argv.slice(2);
const env = parseEnv(await readFile(new URL('../.env.showcase', import.meta.url), 'utf8').catch(error => {
  if (error.code === 'ENOENT') return '';
  throw error;
}));
const baseURL = process.env.SPICY_URL || `http://localhost:${env.PORT || 5175}`;
const databasePath = process.env.SPICY_SHOWCASE_DB || env.SPICY_HISTORY_DB || fileURLToPath(new URL('../.artifacts/showcase/history.sqlite', import.meta.url));
const outputDirectory = process.env.SPICY_SCREENSHOT_DIR || fileURLToPath(new URL('./images/', import.meta.url));

function savedViews(): ShowcaseView[] {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'showcase_views'").get()) return [];
    return db.prepare('SELECT payload FROM showcase_views ORDER BY name').all().map(row =>
      showcaseViewSchema.parse(JSON.parse(String(row.payload))),
    );
  } finally {
    db.close();
  }
}

const views = savedViews();
if (args.includes('--list')) {
  for (const view of views) console.log(`${view.name}\t${view.path}`);
  process.exit(0);
}
if (!views.length) throw new Error('No showcase views saved. Save a view in Spicy first.');
const requested = new Set(args);
for (const name of requested) {
  if (!views.some(view => view.name === name)) throw new Error(`Unknown screenshot: ${name}`);
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
try {
  for (const view of views.filter(view => !requested.size || requested.has(view.name))) {
    const context = await browser.newContext({
      viewport: { width: view.width, height: view.height },
      deviceScaleFactor: view.dpr,
    });
    try {
      const page = await context.newPage();
      const response = await page.goto(new URL(view.path, baseURL).href);
      if (!response?.ok()) throw new Error(`${view.name}: navigation failed (${response?.status() ?? 'no response'})`);
      await page.locator('#trace-viewport .tree-node').first().waitFor();
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map(async image => {
          image.loading = 'eager';
          try { await image.decode(); } catch { /* Keep broken-image fallbacks. */ }
        }));
      });
      const placement = { top: view.top, left: view.left };
      // Layout can still change when card sizes are measured after the chat first renders.
      await page.waitForFunction(async position => {
        const trace = document.querySelector('#trace-viewport');
        if (!trace) return false;
        trace.scrollTo({ ...position, behavior: 'instant' });
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        return Math.abs(trace.scrollTop - position.top) <= 1 && Math.abs(trace.scrollLeft - position.left) <= 1;
      }, placement, { timeout: 5000 }).catch(cause => {
        throw new Error(`${view.name}: could not restore scroll position (${view.left}, ${view.top})`, { cause });
      });
      if (view.pointer) await page.mouse.move(view.pointer.x, view.pointer.y);
      else await page.mouse.move(-1, -1);
      await page.waitForTimeout(settleMs);
      const outputPath = path.join(outputDirectory, `${view.name}.png`);
      await page.screenshot({ path: outputPath, fullPage: false, animations: 'disabled', caret: 'hide' });
      console.log(outputPath);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
