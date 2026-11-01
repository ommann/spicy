// Optional real-browser check of the app + bridge + separate-origin tool flow.
// All agent/task data is synthetic; no model calls or UTW checkout writes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright-core';

const id = 'joke-7k3m9p';
let status = 'incomplete';
const utw = http.createServer((req, res) => {
  if (req.url === `/tasks/${id}`) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ task_id: id, tool: 'joke', status, ui: { url: `http://127.0.0.1:${utw.address().port}/tasks/${id}/view`, embeddable: true } }));
  } else if (req.url === '/finish') {
    status = 'completed'; res.end('Done');
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end(status === 'completed' ? '<h1>Completed preview</h1>' : '<label>Draft <input aria-label="Draft"></label><button onclick="fetch(\'/finish\').then(() => location.reload())">Finish task</button>');
  }
}).listen(0, '127.0.0.1');
await once(utw, 'listening');
const reserve = net.createServer().listen(0, '127.0.0.1');
await once(reserve, 'listening');
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
const server = spawn(process.execPath, ['server/index.mjs', '--production'], {
  env: { ...process.env, PORT: String(port), UTW_URL: `http://127.0.0.1:${utw.address().port}` }, stdio: ['ignore', 'pipe', 'inherit'],
});
let browser;
try {
  await once(server.stdout, 'data');
  const executablePath = process.env.CHROMIUM_EXECUTABLE || process.env.PATH.split(path.delimiter).map(directory => path.join(directory, 'chromium')).find(existsSync);
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const snapshot = { connected: true, running: false, cwd: '/fixture/ollim', state: { sessionId: 'fixture' }, live: [], dialogs: [], leafId: 'r', diagnostic: '', entries: [
    { type: 'message', id: 'u', parentId: null, message: { role: 'user', content: 'Help me choose a joke' } },
    { type: 'message', id: 'a', parentId: 'u', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'c', name: 'handoff_task_to_user', arguments: { tool: 'joke', instructions: 'Choose your favorite joke.', inputs: {} } }] } },
    { type: 'message', id: 'r', parentId: 'a', message: { role: 'toolResult', toolCallId: 'c', details: { task_id: id }, content: [{ type: 'text', text: JSON.stringify({ task_id: id }) }] } },
  ] };
  await page.route('**/api/info', route => route.fulfill({ json: snapshot }));
  await page.route('**/api/events', route => route.fulfill({ contentType: 'text/event-stream', body: `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n` }));
  await page.goto(`http://127.0.0.1:${port}`);
  const control = page.getByRole('button', { name: 'handoff_task_to_user · joke · open handoff', exact: true });
  await control.click({ timeout: 5000 }).catch(async error => {
    console.error('Page errors:', errors, 'Body:', await page.locator('body').innerText());
    await page.screenshot({ path: '/tmp/ollim-handoff-failure.png' });
    throw error;
  });
  const dialog = page.getByRole('dialog', { name: 'Tool UI', exact: true });
  const frame = page.frameLocator('iframe[title="Tool UI"]');
  await frame.getByRole('textbox', { name: 'Draft' }).fill('Keep this draft');
  await dialog.getByRole('button', { name: 'Maximize', exact: true }).click();
  await dialog.getByRole('button', { name: 'Restore', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await control.click();
  assert.equal(await frame.getByRole('textbox', { name: 'Draft' }).inputValue(), 'Keep this draft');
  const frameBox = await page.locator('iframe').boundingBox();
  assert.ok(frameBox.height > 300, 'Embedded tool has usable height');
  assert.equal(await frame.getByRole('textbox', { name: 'Draft' }).isVisible(), true);
  await page.screenshot({ path: '/tmp/ollim-handoff.png' });
  await frame.getByRole('button', { name: 'Finish task' }).click();
  await frame.getByRole('heading', { name: 'Completed preview' }).waitFor();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await control.click();
  await page.getByRole('button', { name: 'handoff_task_to_user · joke · preview handoff', exact: true }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Reject', exact: true }).count(), 0);
  await frame.getByRole('heading', { name: 'Completed preview' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Handoff browser check passed; screenshot: /tmp/ollim-handoff.png');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await once(server, 'exit');
  await new Promise(resolve => utw.close(resolve));
}
