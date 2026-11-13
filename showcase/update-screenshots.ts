import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const shots = JSON.parse(await readFile(new URL('./screenshots.json', import.meta.url), 'utf8'));
const baseURL = process.env.SPICY_URL || 'http://localhost:5174';
const requested = new Set(process.argv.slice(2));
for (const name of requested) {
  if (!shots.some(shot => shot.name === name)) throw new Error(`Unknown screenshot: ${name}`);
}
const selected = shots.filter(shot => !requested.size || requested.has(shot.name));
if (!selected.length) {
  console.log('No screenshots configured in showcase/screenshots.json yet.');
} else {
  await mkdir(new URL('./images/', import.meta.url), { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    for (const shot of selected) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(shot.name)) throw new Error(`Invalid screenshot name: ${shot.name}`);
      const context = await browser.newContext({ viewport: shot.viewport, deviceScaleFactor: shot.deviceScaleFactor ?? 1 });
      try {
        // Each shot starts with clean browser preferences, optionally overridden here.
        await context.addInitScript(values => {
          for (const [key, value] of Object.entries(values)) localStorage.setItem(key, String(value));
        }, shot.localStorage || {});
        const page = await context.newPage();
        await page.goto(new URL(shot.path, baseURL).href);
        await page.locator(shot.readySelector || '.spicy-host').first().waitFor();
        await page.evaluate(async () => {
          await document.fonts.ready;
          // Earlier lazy images affect every scroll offset below them.
          await Promise.all([...document.images].map(async image => {
            image.loading = 'eager';
            try { await image.decode(); } catch { /* Broken images retain their rendered fallback. */ }
          }));
        });
        // Optional UI setup, such as expanding a particular tool result.
        for (const selector of shot.clicks || []) await page.locator(selector).click();
        for (const scroll of shot.scrolls || []) {
          await page.locator(scroll.selector).evaluate((element, position) => {
            element.scrollTo({ left: position.x ?? 0, top: position.y ?? 0, behavior: 'instant' });
          }, scroll);
        }
        if (shot.windowScroll) {
          await page.evaluate(position => window.scrollTo({ ...position, behavior: 'instant' }), shot.windowScroll);
        }
        await page.waitForTimeout(shot.settleMs ?? 500);
        const path = fileURLToPath(new URL(`./images/${shot.name}.png`, import.meta.url));
        await page.screenshot({ path, fullPage: false, animations: 'disabled', caret: 'hide' });
        console.log(path);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
