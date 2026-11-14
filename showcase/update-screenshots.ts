import { chromium, type Page } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

interface Screenshot {
  name: string;
  path: string;
  ready: string;
  localStorage?: Record<string, string>;
  prepare?: (page: Page) => Promise<void>;
}

// Screenshot settings. Adjust the views and individual shots here.
const viewport = { width: 1440, height: 1000 };
const settleMs = 500;
const shots: Screenshot[] = [
  { name: 'sessions', path: '/', ready: '.history-card' },
  { name: 'single', path: '/b/showcase', ready: '.single-mode .tree-node' },
  { name: 'tree', path: '/t/showcase', ready: '.tree-node' },
  { name: 'system-prompts', path: '/b/showcase/system-prompts', ready: '.system-prompts-view .system-prompt-version' },
  { name: 'system-prompt-creator', path: '/b/showcase/system-prompt-creator', ready: '.system-prompt-creator .creator-columns' },
  {
    name: 'edit-diffs',
    path: '/b/showcase',
    ready: '#trace-viewport .tool-diff-preview',
    // Retained from the original diff screenshot settings.
    localStorage: {
      'spicy.code-linewrap': 'false',
      'spicy.chat-arrow-cursor': 'true',
    },
    prepare: async page => {
      await page.locator('#trace-viewport').evaluate(element => {
        element.scrollTo({ left: 0, top: 12463, behavior: 'instant' });
      });
    },
  },
];

const baseURL = process.env.SPICY_URL || 'http://localhost:5174';
const outputDirectory = process.env.SPICY_SCREENSHOT_DIR || fileURLToPath(new URL('./images/', import.meta.url));

if (process.argv.includes('--list')) {
  for (const shot of shots) console.log(`${shot.name}\t${shot.path}`);
  process.exit(0);
}
const requested = new Set(process.argv.slice(2));
for (const name of requested) {
  if (!shots.some(shot => shot.name === name)) throw new Error(`Unknown screenshot: ${name}`);
}
const selected = shots.filter(shot => !requested.size || requested.has(shot.name));
await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
try {
  for (const shot of selected) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    try {
      // Each view starts with clean preferences, except explicit settings above.
      await context.addInitScript(values => {
        for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
      }, shot.localStorage || {});
      const page = await context.newPage();
      const response = await page.goto(new URL(shot.path, baseURL).href);
      if (!response?.ok()) throw new Error(`${shot.name}: navigation failed (${response?.status() ?? 'no response'})`);
      await page.locator(shot.ready).first().waitFor();
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map(async image => {
          image.loading = 'eager';
          try { await image.decode(); } catch { /* Keep broken-image fallbacks. */ }
        }));
      });
      await shot.prepare?.(page);
      await page.waitForTimeout(settleMs);
      const outputPath = path.join(outputDirectory, `${shot.name}.png`);
      await page.screenshot({ path: outputPath, fullPage: false, animations: 'disabled', caret: 'hide' });
      console.log(outputPath);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
