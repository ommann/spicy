import { chromium, type Page } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { showcaseViewSchema, type ShowcaseView } from '../shared/showcase-view.ts';

interface Screenshot {
  name: string;
  path: string;
  ready: string;
  view?: ShowcaseView;
  localStorage?: Record<string, string>;
  prepare?: (page: Page) => Promise<void>;
}

const viewport = { width: 1440, height: 1000 };
const settleMs = 500;
const legacyShots: Screenshot[] = [
  { name: 'sessions', path: '/', ready: '.history-card' },
  { name: 'single', path: '/b/showcase', ready: '.single-mode .tree-node' },
  { name: 'tree', path: '/t/showcase', ready: '.tree-node' },
  { name: 'system-prompts', path: '/b/showcase/system-prompts', ready: '.system-prompts-view .system-prompt-version' },
  { name: 'system-prompt-creator', path: '/b/showcase/system-prompt-creator', ready: '.system-prompt-creator .creator-columns' },
  {
    name: 'edit-diffs', path: '/b/showcase', ready: '#trace-viewport .tool-diff-preview',
    localStorage: { 'spicy.code-linewrap': 'false', 'spicy.chat-arrow-cursor': 'true' },
    prepare: page => page.locator('#trace-viewport').evaluate(element => {
      element.scrollTo({ left: 0, top: 12463, behavior: 'instant' });
    }),
  },
];

const args = process.argv.slice(2);
const legacy = args.includes('--legacy');
const env = legacy ? {} : parseEnv(await readFile(new URL('../.env.showcase', import.meta.url), 'utf8').catch(error => {
  if (error.code === 'ENOENT') return '';
  throw error;
}));
const baseURL = process.env.SPICY_URL || `http://localhost:${legacy ? 5174 : env.PORT || 5175}`;
const databasePath = process.env.SPICY_SHOWCASE_DB || env.SPICY_HISTORY_DB || fileURLToPath(new URL('../.artifacts/showcase/history.sqlite', import.meta.url));
const outputDirectory = process.env.SPICY_SCREENSHOT_DIR || fileURLToPath(new URL('./images/', import.meta.url));

function savedShots(): Screenshot[] {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'showcase_views'").get()) return [];
    return db.prepare('SELECT payload FROM showcase_views ORDER BY name').all().map(row => {
      const view = showcaseViewSchema.parse(JSON.parse(String(row.payload)));
      return { name: view.name, path: view.path, ready: '#trace-viewport .tree-node', view };
    });
  } finally {
    db.close();
  }
}

const shots = legacy ? legacyShots : savedShots();
if (args.includes('--list')) {
  for (const shot of shots) console.log(`${shot.name}\t${shot.path}`);
  process.exit(0);
}
if (!shots.length) throw new Error('No showcase views saved. Save a view in Spicy first.');
const requested = new Set(args.filter(arg => arg !== '--legacy'));
for (const name of requested) {
  if (!shots.some(shot => shot.name === name)) throw new Error(`Unknown screenshot: ${name}`);
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
try {
  for (const shot of shots.filter(shot => !requested.size || requested.has(shot.name))) {
    const { view } = shot;
    const context = await browser.newContext({
      viewport: view ? { width: view.width, height: view.height } : viewport,
      deviceScaleFactor: view?.dpr ?? 1,
    });
    try {
      if (shot.localStorage) await context.addInitScript(values => {
        for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
      }, shot.localStorage);
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
      if (view) {
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
          throw new Error(`${shot.name}: could not restore scroll position (${view.left}, ${view.top})`, { cause });
        });
        if (view.pointer) await page.mouse.move(view.pointer.x, view.pointer.y);
        else await page.mouse.move(-1, -1);
      }
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
