import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { os, ORPCError } from '@orpc/server';
import { createRpcFixture } from './rpc-fixture.mjs';
import { build } from 'vite';
import solid from 'vite-plugin-solid';
import { fileURLToPath } from 'node:url';
import { createSystemPromptCatalog } from '../src/system-prompts.js';
import { renderSystemPromptDocument, SAVED_SYSTEM_PROMPT_ENTRY } from '../../packages/coding-agent/src/core/system-prompt-document.ts';

const original = {
  id: 'system1', parentId: null, type: 'message',
  message: { role: 'system', content: 'Original instructions', sections: { tools: 'Tool rules' },
    toolsAdded: [{ name: 'read', description: 'Read files' }] },
};
const user = { id: 'user1', parentId: original.id, type: 'message', message: { role: 'user', content: 'Hello', timestamp: 1 } };
const delta = { id: 'system2', parentId: user.id, type: 'message', message: { role: 'system', sections: { tools: 'New tools' } } };
const next = { id: 'user2', parentId: delta.id, type: 'message', message: { role: 'user', content: 'Next message', timestamp: 2 } };
const entries = [original, user, delta, next];

// Compile the actual Solid components with the project's JSX plugin, not a substitute renderer.
const bundle = await build({
  configFile: false,
  plugins: [solid()],
  logLevel: 'silent',
  build: { write: false, minify: false, lib: {
    entry: fileURLToPath(new URL('./system-prompts.dom-fixture.tsx', import.meta.url)), formats: ['es'],
  } },
});
const code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(output => output.type === 'chunk').code;
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:5173/', pretendToBeVisual: true });
const { window } = dom;
for (const name of ['window', 'document', 'HTMLElement', 'HTMLTextAreaElement', 'HTMLDialogElement', 'HTMLHeadElement', 'Element', 'Node', 'NodeFilter', 'Event', 'KeyboardEvent', 'CustomEvent', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  globalThis[name] = name === 'window' ? window : window[name];
}
globalThis.location = window.location;
globalThis.history = window.history;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollTo = function (position) { this.scrollTop = position.top || 0; this.scrollLeft = position.left || 0; };
window.HTMLElement.prototype.scrollIntoView = function () {};
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () {
  if (!this.open) return;
  this.open = false;
  this.dispatchEvent(new window.Event('close'));
};
let rpc;
// RPCLink captures fetch at construction; keep one function and replace only the test server.
globalThis.fetch = request => {
  assert.ok(rpc, `Unexpected request outside an RPC fixture: ${request.url}`);
  return rpc.fetch(request);
};
const components = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
afterEach(async () => { rpc?.close(); await flush(); rpc = undefined; });
const root = window.document.getElementById('root');
const flush = async () => {
  await Promise.resolve();
  await new Promise(resolve => window.requestAnimationFrame(resolve));
  await Promise.resolve();
};
const button = (parent, text) => [...parent.querySelectorAll('button, a')].find(element => element.textContent.trim() === text);

test('streaming cards preserve historical DOM across fresh snapshots and update changed text', async () => {
  const initial = { entry: { type: 'message' }, parts: [
    { kind: 'thinking', entryId: 'stream-test', text: 'Historical thinking' },
    { kind: 'message', entryId: 'stream-test', text: 'Initial answer' },
  ] };
  const card = components.mountStreamingCard(root, initial);
  try {
    await flush();
    const thinking = root.querySelector('.thinking-text span');
    let mutations = 0;
    const observer = new window.MutationObserver(records => { mutations += records.length; });
    observer.observe(root, { childList: true, characterData: true, subtree: true });
    card.setNode(structuredClone(initial));
    await flush();
    observer.disconnect();
    assert.equal(mutations, 0, 'identical snapshots must not rebuild content');
    assert.equal(root.querySelector('.thinking-text span'), thinking);
    const changed = structuredClone(initial);
    changed.parts[1].text = 'Updated answer';
    card.setNode(changed);
    await flush();
    assert.equal(root.querySelector('.thinking-text span'), thinking);
    assert.match(root.textContent, /Updated answer/);
  } finally { card.dispose(); }
});

test('pasted images preview, survive failed sends, and clear after accepted sends', async () => {
  globalThis.FileReader = window.FileReader;
  let accepted = false;
  const sent = [];
  const dispose = components.mountComposer(root, async images => { sent.push(images); return accepted; });
  try {
    const input = root.querySelector('textarea');
    const event = new window.Event('paste', { bubbles: true, cancelable: true });
    const file = new window.File(['image bytes'], 'clipboard.png', { type: 'image/png' });
    Object.defineProperty(event, 'clipboardData', { value: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] } });
    input.dispatchEvent(event);
    await new Promise(resolve => setTimeout(resolve, 30));
    await flush();
    assert.equal(event.defaultPrevented, true);
    assert.match(root.querySelector('.composer-attachments img').src, /^data:image\/png;base64,/);
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    assert.equal(sent[0][0].data, Buffer.from('image bytes').toString('base64'));
    assert.ok(root.querySelector('.composer-attachments img'));
    accepted = true;
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    assert.equal(root.querySelector('.composer-attachments img'), null);
  } finally { dispose(); }
});

test('context window hint updates inside the input without changing the draft', async () => {
  const dispose = components.mountComposer(root);
  try {
    assert.equal(root.querySelector('.composer-context'), null);
    dispose.setContextUsage({ percent: 8.3, contextWindow: 500_000 });
    await flush();
    assert.equal(root.querySelector('.editor .composer-context').textContent, '8.3%/500k');
    const input = root.querySelector('textarea');
    input.value = 'Keep this draft';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    dispose.setContextUsage({ percent: 12.5, contextWindow: 500_000 });
    await flush();
    assert.equal(root.querySelector('.composer-context').textContent, '12.5%/500k');
    assert.equal(input.value, 'Keep this draft');
    dispose.setContextUsage({ percent: null, contextWindow: 500_000 });
    await flush();
    assert.equal(root.querySelector('.composer-context').textContent, '?/500k');
  } finally { dispose(); }
});

test('working status and Stop stay outside the input without replacing it or losing its draft', async () => {
  const dispose = components.mountComposer(root);
  try {
    const input = root.querySelector('textarea');
    input.value = 'Keep this draft';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    dispose.setRunning(true);
    await flush();
    const status = root.querySelector('.composer-status');
    assert.equal(status.nextElementSibling, root.querySelector('.editor'));
    assert.equal(status.querySelector('[role="status"]').textContent.trim(), 'Working');
    assert.ok(status.querySelector('.composer-stop'));
    assert.equal(root.querySelector('.editor .composer-working, .editor .composer-stop'), null);
    assert.equal(root.querySelector('.composer-working').dataset.status, 'ready');
    dispose.setHealth('socket-lost');
    await flush();
    assert.equal(root.querySelector('.composer-working').dataset.status, 'socket-lost');
    dispose.setRunning(false);
    await flush();
    assert.equal(root.querySelector('.composer-status'), null);
    assert.equal(root.querySelector('textarea'), input);
    assert.equal(input.value, 'Keep this draft');
  } finally { dispose(); }
});

test('creator selects parts and saves a named prompt without sending a chat message', async () => {
  const selections = [];
  const dispose = components.mountCreator(root, {
    current: { content: 'Accepted instructions.', sections: {} },
    document: { version: 1, parts: [
      { id: 'preamble', section: 'preamble', label: 'Instructions', source: 'core', text: 'Original instructions.' },
      { id: 'tools', section: 'tools', label: 'Descriptions', source: 'core', separator: '\n', children: [
        { id: 'tools/read', label: 'Read description', source: 'tool:read', text: '- read: Read files' },
        { id: 'tools/bash', label: 'Bash description', source: 'tool:bash', text: '- bash: Run commands' },
      ] },
    ] },
  }, value => selections.push(value));
  try {
    await flush();
    assert.match(root.querySelector('.creator-preview').textContent, /Original instructions/);
    assert.equal(root.querySelectorAll('.creator-switchboard input[type="checkbox"]').length, 4);
    const read = [...root.querySelectorAll('label')].find(label => label.textContent.includes('Read description')).querySelector('input');
    read.click();
    await flush();
    assert.doesNotMatch(root.querySelector('.creator-preview').textContent, /Read files/);
    assert.match(root.querySelector('.creator-preview').textContent, /Run commands/);
    assert.deepEqual(selections, []);
    button(root, 'Save as').click();
    const dialog = root.querySelector('dialog[open]');
    assert.ok(dialog);
    assert.deepEqual(selections, [], 'Opening Save as does not save');
    const name = dialog.querySelector('input');
    name.value = 'Selected instructions';
    name.dispatchEvent(new window.Event('input', { bubbles: true }));
    dialog.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    assert.equal(selections.length, 1);
    assert.equal(selections[0].document.parts[0].text, 'Original instructions.');
    assert.deepEqual(selections[0].excludedIds, ['tools/read']);
    assert.equal(selections[0].title, 'Selected instructions');
    assert.equal(selections[0].document.forced, undefined);
  } finally { dispose(); }
});

test('in-app login shows OAuth navigation, retains typed redirects while polling, and cancels on close', async () => {
  let state = { status: 'idle', events: [] };
  rpc = createRpcFixture({ auth: {
    providers: os.handler(() => [{ id: 'example', name: 'Example', methods: [{ type: 'oauth', name: 'Example OAuth' }] }]),
    state: os.handler(() => state),
    login: os.handler(() => state = { id: 'login1', status: 'pending',
      events: [{ type: 'auth_url', url: 'https://example.com/oauth' }],
      prompt: { id: 'prompt1', type: 'manual_code', message: 'Paste redirect URL' } }),
    reply: os.handler(() => state = { id: 'login1', status: 'success', events: [] }),
    cancel: os.handler(() => state = { id: 'login1', status: 'cancelled', events: [] }),
  } });
  const dispose = components.mountLogin(root);
  try {
    button(root, 'Login').click();
    await new Promise(resolve => setTimeout(resolve, 20));
    button(root, 'Example OAuth').click();
    await flush();
    const link = root.querySelector('a');
    assert.equal(link.href, 'https://example.com/oauth');
    assert.equal(link.target, '_blank');
    const input = root.querySelector('input');
    input.focus();
    input.value = 'redirect-code';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 600));
    assert.equal(root.querySelector('input'), input);
    assert.equal(input.value, 'redirect-code');
    assert.equal(document.activeElement, input);
    root.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    assert.equal(rpc.requests.find(request => request.path === 'auth/reply').input.value, 'redirect-code');
    assert.match(root.textContent, /Logged in\./);
    button(root, 'Example OAuth').click();
    await flush();
    root.querySelector('dialog').close();
    await flush();
    assert.equal(rpc.requests.at(-1).path, 'auth/cancel');
    assert.equal(root.querySelector('input'), null);
  } finally { dispose(); }
});

test('shared Input forwards native attributes, refs and events and updates without replacing the element', async () => {
  let referenced;
  let typed;
  const dispose = components.mountInput(root, { class: 'custom-input', required: true, maxlength: 32,
    'aria-label': 'Example input', ref: element => { referenced = element; },
    onInput: event => { typed = event.currentTarget.value; } });
  try {
    const input = root.querySelector('input');
    assert.equal(input, referenced);
    assert.equal(input.type, 'text');
    assert.equal(input.required, true);
    assert.equal(input.maxLength, 32);
    assert.equal(input.getAttribute('aria-label'), 'Example input');
    assert.ok(input.classList.contains('text-input'));
    assert.ok(input.classList.contains('custom-input'));
    input.value = 'typed';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(typed, 'typed');
    dispose.setValue('updated');
    await flush();
    assert.equal(root.querySelector('input'), input);
    assert.equal(input.value, 'updated');
  } finally { dispose(); }
});

test('shared custom scroll areas use their own viewport for both scrollbar axes', () => {
  const dispose = components.mountScrollArea(root);
  try {
    const viewport = root.querySelector('.scroll-area-viewport');
    for (const [name, value] of Object.entries({ clientWidth: 100, scrollWidth: 600, clientHeight: 80, scrollHeight: 400 })) {
      Object.defineProperty(viewport, name, { configurable: true, value });
    }
    viewport.dispatchEvent(new window.Event('scroll'));
    const horizontal = root.querySelector('[aria-orientation="horizontal"]');
    const vertical = root.querySelector('[aria-orientation="vertical"]');
    assert.equal(horizontal.getAttribute('aria-controls'), viewport.id);
    assert.equal(vertical.getAttribute('aria-controls'), viewport.id);
    horizontal.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(viewport.scrollLeft, 40);
    vertical.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    assert.equal(viewport.scrollTop, 320);
  } finally { dispose(); }
});

test('Solid original prompt: source preview, tools, individual expansion and reactive expansion', async () => {
  const mounted = components.mountContent(root, original);
  try {
    assert.match(root.textContent, /Original instructions/);
    assert.doesNotMatch(root.textContent, /Read files/);
    const toggles = root.querySelectorAll('.collapse-toggle');
    assert.equal(toggles.length, 2);
    toggles[0].click();
    assert.equal(toggles[0].getAttribute('aria-expanded'), 'true');
    assert.match(root.textContent, /Tool rules/);
    toggles[1].click();
    assert.match(root.textContent, /Read files/);
    mounted.setExpandAll(true);
    await flush();
    assert.ok([...root.querySelectorAll('.collapse-toggle')].every(control => control.getAttribute('aria-expanded') === 'true'));
    mounted.setExpandAll(false);
    await flush();
    assert.ok([...root.querySelectorAll('.collapse-toggle')].every(control => control.getAttribute('aria-expanded') === 'false'));
  } finally { mounted.dispose(); }
});

test('Solid content reacts to replacement, renders source fences and escapes prompt markup', async () => {
  const mounted = components.mountContent(root, original);
  try {
    const text = '<img src=x onerror="bad()">\n```js\nconst x = 1;\n```';
    mounted.setEntry({ ...original, message: { role: 'system', content: text } });
    await flush();
    assert.equal(root.querySelector('img'), null);
    assert.equal(root.querySelector('.trace-text').textContent, text);
    assert.ok(root.querySelectorAll('.trace-text span').length >= 3);
  } finally { mounted.dispose(); }
});

test('Solid diffs show colored changes without patch preambles or signs', async () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ kind: index % 2 ? 'add' : 'remove', text: `rule ${index}` }));
  const detail = { ...delta, prefixPreview: true, prefixDiff: [{ name: 'sections.tools', hunks: [
    { oldStart: 1, oldCount: 6, newStart: 1, newCount: 6, rows },
  ] }] };
  const mounted = components.mountContent(root, detail);
  try {
    assert.equal(root.querySelector('.diff-file'), null);
    assert.equal(root.querySelector('.diff-hunk'), null);
    assert.equal(root.querySelector('.prefix-diff').querySelectorAll('.diff-add').length, 6);
    assert.equal(root.querySelector('.diff-sign'), null);
    assert.equal(root.querySelector('.system-delta').classList.contains('prompt-expanded'), false);
    root.querySelector('.collapse-toggle').click();
    assert.equal(root.querySelector('.system-delta').classList.contains('prompt-expanded'), true);
    mounted.setExpandAll(true);
    mounted.setExpandAll(false);
    await flush();
    assert.equal(root.querySelector('.system-delta').classList.contains('prompt-expanded'), false);
  } finally { mounted.dispose(); }
});

test('Solid prompt view reuses canonical cards, focuses selected version and supports local disclosure controls', async () => {
  const dispose = components.mountPrompts(root, {
    versions: createSystemPromptCatalog(entries).versions, selected: createSystemPromptCatalog(entries).versions[1].key,
  });
  try {
    const dialog = root.querySelector('.system-prompts-view');
    assert.ok(dialog);
    assert.equal(dialog.querySelectorAll('.tree-card > .tree-card-body').length, 2);
    assert.equal(dialog.querySelector('.node-label'), null);
    assert.doesNotMatch(dialog.textContent, /System prompt \d|Changes from System prompt/);
    assert.equal(dialog.querySelector('[data-active-column="true"]').dataset.systemPromptVersion, '2');
    assert.equal(dialog.querySelector('.tree-card[tabindex]'), null);
    assert.doesNotMatch(dialog.textContent, /Changes from System prompt/);
    assert.match(dialog.textContent, /New tools/);
    const shortcut = new window.KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true, cancelable: true });
    dialog.dispatchEvent(shortcut);
    assert.equal(shortcut.defaultPrevented, false, 'Ctrl+O is left to the browser');
    assert.doesNotMatch(dialog.textContent, /ctrl\+o|more lines|total,|to expand/i);
    const disclosure = dialog.querySelector('.collapse-toggle');
    assert.equal(disclosure.textContent, 'Show less');
    disclosure.click();
    await flush();
    assert.equal(disclosure.textContent, 'Show more');
    assert.equal(disclosure.getAttribute('aria-expanded'), 'false');
    disclosure.click();
    await flush();
    assert.equal(disclosure.getAttribute('aria-expanded'), 'true');
    const cards = dialog.querySelectorAll('[data-system-prompt-version]');
    assert.equal(dialog.querySelectorAll('.diff-document-view').length, 2);
    assert.ok(dialog.querySelector('.diff-line-number'));
    assert.equal(dialog.querySelector('[role="main"] .collapse-toggle'), null);
    assert.equal(dialog.querySelectorAll('nav .collapse-toggle').length, 1);
    assert.equal(cards[0].querySelector('.diff-add'), null);
    assert.equal(cards[0].querySelector('.diff-remove'), null);
    assert.equal(cards[1].querySelector('.system-delta'), null);
    assert.match(cards[1].textContent, /Original instructions/);
    document.body.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'ArrowLeft', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await flush();
    assert.equal(cards[1].dataset.activeColumn, 'true', 'Removed shortcut does not change columns');
    assert.equal(cards[1].querySelector('.system-delta'), null);
    assert.match(cards[1].textContent, /Original instructions/);
    assert.match(cards[1].textContent, /New tools/);
    assert.ok(cards[1].querySelector('.system-unified'));
    assert.match(cards[1].querySelector('.diff-remove').textContent, /Tool rules/);
    assert.match(cards[1].querySelector('.diff-add').textContent, /New tools/);
    assert.match(cards[1].querySelector('.diff-context').textContent, /Original instructions/);
    assert.equal(cards[1].querySelector('.diff-condensed'), null);
    assert.equal(cards[1].querySelector('.diff-hunk'), null);
    assert.doesNotMatch(cards[1].textContent, /--- content|\+\+\+ content|@@/);
    document.body.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'ArrowRight', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await flush();
    assert.equal(cards[1].querySelector('.system-delta'), null);
    const toggleMode = () => {
      const event = new window.KeyboardEvent('keydown', {
        code: 'KeyF', key: 'F', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
      });
      document.body.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
    };
    toggleMode();
    await flush();
    assert.equal(cards[0].hidden, true);
    assert.equal(cards[1].hidden, false);
    button(dialog, 'Tree').click();
    await flush();
    assert.equal(cards[0].hidden, false);
    const hover = new window.MouseEvent('pointermove', { bubbles: true, clientX: 10 });
    Object.defineProperty(hover, 'pointerType', { value: 'mouse' });
    dialog.querySelector('[role="main"]').dispatchEvent(hover);
    await flush();
    assert.equal(cards[1].querySelector('.system-delta'), null);
    assert.match(cards[1].textContent, /Original instructions/);

  } finally { dispose(); }
});

test('saving adds a persistent prompt to the viewer and leaves chat requests and entries alone', async () => {
  globalThis.localStorage = window.localStorage;
  window.sessionStorage.setItem('pi-agent-view', JSON.stringify({ agents: ['default'], selected: 'default' }));
  const snapshot = { agentId: 'default', entries, leafId: 'user2', state: { sessionId: 'creator-test' }, live: [], dialogs: [], connected: true, running: false, cwd: '/test', token: 'test' };
  const before = JSON.stringify(snapshot.entries);
  const storageBefore = JSON.stringify(localStorage);
  const promptDocument = { version: 1, parts: [
    { id: 'preamble', section: 'preamble', label: 'Instructions', source: 'core', text: 'Original instructions' },
    { id: 'tools', section: 'tools', label: 'Tool rules', source: 'core', text: 'Optional tool rules' },
  ] };
  rpc = createRpcFixture({
    info: os.handler(() => snapshot),
    agents: { list: os.handler(() => [snapshot]) },
    command: os.handler(({ input }) => {
      if (input.type === 'get_system_prompt_document') return {
        document: promptDocument,
        current: { content: 'Original instructions', sections: {}, toolsAdded: [] },
      };
      assert.equal(input.type, 'save_system_prompt');
      const prompt = { ...input.prompt, id: 'saved-prompt', output: renderSystemPromptDocument(input.prompt.document, input.prompt.excludedIds) };
      snapshot.entries = [...snapshot.entries, { id: prompt.id, type: 'custom', customType: SAVED_SYSTEM_PROMPT_ENTRY, parentId: snapshot.leafId, data: prompt }];
      return prompt;
    }),
  });
  const requests = rpc.requests;
  let dispose = components.mountApp(root, '/system-prompt-creator');
  try {
    for (let i = 0; i < 6; i++) await flush();
    const tools = [...root.querySelectorAll('.creator-switchboard label')].find(label => label.textContent.includes('Tool rules'));
    assert.ok(tools);
    tools.querySelector('input').click();
    await flush();
    button(root, 'Save as').click();
    const dialog = root.querySelector('dialog[open]');
    const name = dialog.querySelector('input');
    name.value = 'Saved example';
    name.dispatchEvent(new window.Event('input', { bubbles: true }));
    dialog.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    for (let i = 0; i < 6; i++) await flush();
    assert.ok(root.querySelector('.system-prompts-view'));
    assert.match(root.textContent, /Original instructions/);
    assert.match(root.textContent, /Saved example/);
    const saved = snapshot.entries.find(entry => entry.customType === SAVED_SYSTEM_PROMPT_ENTRY);
    assert.ok(saved, 'Saved prompt is persisted as session metadata');
    assert.deepEqual(saved.data.excludedIds, ['tools']);
    assert.doesNotMatch(saved.data.output.content, /Optional tool rules/);
    assert.equal(JSON.stringify(snapshot.entries.filter(entry => entry !== saved)), before, 'Existing chat entries remain untouched');
    assert.deepEqual([...new Set(requests.filter(item => item.path === 'command').map(item => item.input.type))], ['get_system_prompt_document', 'save_system_prompt']);
    assert.equal(requests.filter(item => item.input?.type === 'save_system_prompt').length, 1);
    assert.equal(JSON.stringify(localStorage), storageBefore, 'Saving does not use local storage');
    dispose();
    dispose = components.mountApp(root, '/system-prompts');
    for (let i = 0; i < 4; i++) await flush();
    assert.match(root.textContent, /Saved example/);
    assert.match(root.textContent, /Original instructions/);
  } finally { dispose(); }
});

test('chat references open the Solid view without creating a model request or modifying session entries', async () => {
  const before = JSON.stringify(entries);
  const imageSource = 'data:image/png;base64,aGVsbG8=';
  const imageEntries = entries.map(entry => entry.id === delta.id
    ? { ...entry, message: { ...entry.message, toolsAdded: [{ name: 'read', description: 'Read files' }] } }
    : entry.id === user.id ? { ...entry, message: { ...entry.message,
    content: [{ type: 'text', text: 'Hello' }, { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }],
  } } : entry);
  window.sessionStorage.setItem('pi-agent-view', JSON.stringify({ agents: ['default'], selected: 'default' }));
  const snapshot = { agentId: 'default', entries: [...imageEntries, {
    id: 'sibling-user', parentId: original.id, type: 'message',
    message: { role: 'user', content: 'Other branch', timestamp: 0 },
  }], leafId: 'user2', state: { sessionId: 'test', sessionUrlId: 'k7m3xqa9' }, live: [], dialogs: [],
    connected: true, running: false, cwd: '/test/project', token: 'test' };
  rpc = createRpcFixture({
    info: os.handler(() => snapshot),
    agents: { list: os.handler(() => [snapshot]) },
  });
  const requests = rpc.requests;
  const dispose = components.mountApp(root, '/tree');
  try {
    await flush();
    await flush();
    button(root, 'Options').click();
    await flush();
    const options = root.querySelector('[aria-label="Options"]');
    const wrap = options.querySelector('input[type="checkbox"]');
    assert.equal(wrap.checked, false);
    wrap.checked = false;
    wrap.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(root.querySelector('.app-settings').style.getPropertyValue('--code-white-space'), 'pre');
    wrap.checked = true;
    wrap.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(root.querySelector('.app-settings').style.getPropertyValue('--code-white-space'), 'pre-wrap');
    button(options, 'Close').click();
    const viewport = root.querySelector('#trace-viewport');
    const left = viewport.scrollLeft;
    assert.equal(root.querySelector('.fork-nav'), null);
    document.body.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'ArrowRight', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await flush();
    assert.equal(viewport.scrollLeft, left, 'Removed shortcut does not move columns');
    document.body.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'ArrowLeft', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await flush();
    assert.equal(viewport.scrollLeft, left, 'Removed shortcut does not move columns');
    const image = root.querySelector('.trace-image');
    assert.ok(image);
    image.click();
    await flush();
    let preview = root.querySelector('#image-preview');
    assert.ok(preview?.open, 'Chat image click opens the lightbox');
    assert.equal(preview.querySelector('img').src, imageSource);
    button(preview, 'Close').click();
    await flush();
    assert.equal(root.querySelector('#image-preview'), null);
    assert.equal(document.activeElement, image);
    image.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    preview = root.querySelector('#image-preview');
    assert.ok(preview?.open, 'Keyboard activation opens the same lightbox');
    preview.close();
    await flush();
    assert.equal(root.querySelector('#image-preview'), null);
    const reference = root.querySelector('[data-system-prompt="2"]');
    assert.ok(reference, `Chat contains numbered prompt references: ${root.textContent}`);
    assert.equal(reference.tagName, 'A');
    assert.equal(reference.getAttribute('href'), '/k7m3xqa9/system-prompts/system2');
    for (const label of ['Sessions', 'Chat', 'System prompts', 'Editor', 'Single', 'Tree']) {
      const link = button(root, label);
      assert.equal(link?.tagName, 'A', `${label} is a native navigation link`);
      assert.ok(link.getAttribute('href'));
    }
    assert.doesNotMatch(root.querySelector('.spicy-host').textContent, /Original instructions|New tools/);
    const input = root.querySelector('.editor textarea');
    input.value = 'Keep this draft';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(input.value, 'Keep this draft');
    rpc.streams.get('default').emit('record', { type: 'agent_start' });
    rpc.streams.get('default').emit('record', { type: 'agent_settled' });
    await flush();
    assert.equal(root.querySelector('.editor textarea'), input, 'Run status does not rebuild the conversation');
    rpc.streams.get('default').emit('record', { type: 'extension_ui_request', method: 'set_editor_text', text: 'Keep this draft' });
    await flush();
    assert.equal(input.value, 'Keep this draft');
    root.querySelector('[data-system-prompt="2"]').click();
    await flush();
    const dialog = root.querySelector('.system-prompts-view');
    assert.ok(dialog);
    assert.equal(dispose.history.get(), '/k7m3xqa9/system-prompts/system2');
    assert.match(dialog.textContent, /Original instructions/);
    button(root, 'Chat').click();
    await flush();
    assert.equal(root.querySelector('.system-prompts-view'), null);
    assert.equal(root.querySelector('.editor textarea').value, 'Keep this draft', 'Returning to Chat preserves the unsent draft');
    assert.equal(dispose.history.get(), '/k7m3xqa9/tree');
    dispose.history.back();
    await flush();
    assert.ok(root.querySelector('.system-prompts-view'), 'History back restores the prompt route');
    dispose.history.forward();
    await flush();
    assert.equal(root.querySelector('.system-prompts-view'), null);
    assert.equal(root.querySelector('.editor textarea').value, 'Keep this draft');
    assert.equal(JSON.stringify(entries), before);
    assert.ok(requests.every(request => ['info', 'agents/list', 'events'].includes(request.path)), 'Viewing prompts does not mutate the session');
  } finally { dispose(); }
});

test('session URLs override tab selection, preserve deep links and restore on browser navigation', async () => {
  const makeSnapshot = urlId => ({ agentId: urlId, entries, leafId: 'user2',
    state: { sessionId: `uuid-${urlId}`, sessionUrlId: urlId }, live: [], dialogs: [],
    connected: true, running: false, cwd: '/test/project', token: 'test' });
  const stale = makeSnapshot('stale');
  window.sessionStorage.setItem('pi-agent-view', JSON.stringify({ agents: ['stale'], selected: 'stale' }));
  rpc = createRpcFixture({
    info: os.handler(() => stale),
    agents: {
      list: os.handler(() => [stale]),
      create: os.handler(({ input }) => makeSnapshot(input.sessionUrlId)),
    },
  });
  const requests = rpc.requests;
  const dispose = components.mountApp(root, '/k7m3xqa9/system-prompts/system2');
  try {
    for (let i = 0; i < 8; i++) await flush();
    assert.equal(dispose.history.get(), '/k7m3xqa9/system-prompts/system2');
    assert.ok(root.querySelector('.system-prompts-view'));
    assert.deepEqual(requests.filter(item => item.path === 'agents/create').map(item => item.input.sessionUrlId), ['k7m3xqa9']);
    assert.ok(!requests.some(item => item.path === 'info' && item.input.agentId === 'stale'));
    button(root, 'Chat').click();
    await flush();
    assert.equal(dispose.history.get(), '/k7m3xqa9/tree');
    dispose.history.set({ value: '/v8n4zrc2' });
    for (let i = 0; i < 6; i++) await flush();
    assert.equal(dispose.history.get(), '/v8n4zrc2/tree');
    dispose.history.back();
    for (let i = 0; i < 6; i++) await flush();
    assert.equal(dispose.history.get(), '/k7m3xqa9/tree');
    assert.deepEqual(requests.filter(item => item.path === 'agents/create').map(item => item.input.sessionUrlId), ['k7m3xqa9', 'v8n4zrc2', 'k7m3xqa9']);
    assert.ok(requests.every(item => ['info', 'agents/list', 'agents/create', 'events'].includes(item.path)));
  } finally { dispose(); window.sessionStorage.removeItem('pi-agent-view'); }
});

test('Sessions shows history cards, filters projects and links to saved chats without branching', async () => {
  window.sessionStorage.removeItem('pi-agent-view');
  const empty = { entries: [], leafId: null, state: null, live: [], dialogs: [], connected: false, running: false, cwd: '/work/spicy', token: 'test' };
  const saved = [
    { id: 'first-file', urlId: 'k7m3xqa9', cwd: '/work/spicy', name: 'Prompt history', modified: Date.now() },
    { id: 'second-file', urlId: 'v8n4zrc2', cwd: '/work/spicy', name: 'Branch tests', modified: Date.now() },
    { id: 'third-file', urlId: 'zhhupqw3', cwd: '/work/extensions', name: 'Prompt loading', modified: Date.now() },
  ];
  rpc = createRpcFixture({
    info: os.handler(() => empty),
    sessions: os.handler(() => saved),
    agents: {
      list: os.handler(() => []),
      create: os.handler(({ input }) => {
        const session = saved.find(session => session.id === input.openSessionId || session.urlId === input.sessionUrlId) || saved[0];
        return { ...empty, agentId: session.id, treeId: session.urlId, entries, leafId: 'user2', cwd: session.cwd,
          state: { sessionId: session.id, sessionUrlId: session.urlId, cwd: session.cwd } };
      }),
    },
  });
  const requests = rpc.requests;
  const dispose = components.mountApp(root, '/');
  try {
    for (let i = 0; i < 8; i++) await flush();
    assert.equal(dispose.history.get(), '/');
    assert.equal(root.querySelectorAll('.history-card').length, 3);
    assert.equal(root.querySelectorAll('.history-latest-message:not(.history-latest-title)').length, 3);
    assert.equal(root.querySelectorAll('.history-tree-id').length, 3);
    assert.equal(root.querySelectorAll('.startup-empty-chat .branch-draft').length, 2);
    assert.ok(root.querySelector('.startup-empty-chat .editor textarea'));
    assert.deepEqual(requests.filter(request => request.path === 'agents/create').map(request => request.input),
      saved.map(session => ({ openSessionId: session.id })));
    assert.ok(!requests.some(request => request.path === 'command' || request.path === 'start'), 'Listing does not send prompts');
    const path = root.querySelector('[aria-label="Search project paths"]');
    path.value = 'spicy';
    path.dispatchEvent(new window.Event('input', { bubbles: true }));
    const name = root.querySelector('[aria-label="Search session names"]');
    assert.equal(name.disabled, true);
    await flush();
    assert.equal(root.querySelectorAll('.history-card').length, 2);
    const card = root.querySelector('.history-card');
    assert.equal(card.querySelector('.history-tree-id').getAttribute('href'), '/t/k7m3xqa9');
    assert.equal(card.querySelector('.history-latest-message:not(.history-latest-title) a').getAttribute('href'), '/b/k7m3xqa9');
    card.querySelector('.history-latest-message:not(.history-latest-title) a').click();
    for (let i = 0; i < 6; i++) await flush();
    assert.equal(dispose.history.get(), '/b/k7m3xqa9');
    assert.ok(root.querySelector('.spicy-host'));
    assert.ok(!requests.some(request => request.path === 'command' || request.path === 'start'));
  } finally { dispose(); window.sessionStorage.removeItem('pi-agent-view'); }
});

test('Sessions composer keeps failed drafts, opens focused chat on success and opens the prompt editor', async () => {
  window.sessionStorage.removeItem('pi-agent-view');
  let fail = true;
  let created = 0;
  const empty = { entries: [], leafId: null, state: null, live: [], dialogs: [], connected: false, running: false, cwd: '/work/spicy', token: 'test' };
  rpc = createRpcFixture({
    info: os.handler(() => empty),
    sessions: os.handler(() => []),
    agents: {
      list: os.handler(() => []),
      create: os.handler(() => {
        created++;
        return { ...empty, agentId: `new-${created}`, connected: true,
          state: { sessionId: `uuid-${created}`, sessionUrlId: created === 1 ? 'k7m3xqa9' : 'v8n4zrc2' } };
      }),
    },
    command: os.handler(({ input }) => {
      if (input.type === 'get_system_prompt_document') return {
        document: { version: 1, parts: [{ id: 'preamble', section: 'preamble', label: 'Instructions', source: 'core', text: 'Instructions' }] },
        current: { content: 'Instructions', sections: {}, toolsAdded: [] },
      };
      assert.equal(input.type, 'prompt');
      if (fail) throw new ORPCError('BAD_REQUEST', { message: 'Send failed' });
      return { disposition: 'started' };
    }),
  });
  const requests = rpc.requests;
  const dispose = components.mountApp(root, '/');
  try {
    for (let i = 0; i < 6; i++) await flush();
    let input = root.querySelector('.startup-empty-chat textarea');
    input.value = 'Start this conversation';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    for (let i = 0; i < 6; i++) await flush();
    assert.equal(dispose.history.get(), '/');
    assert.equal(input.value, 'Start this conversation');
    assert.match(root.querySelector('[role="alert"]').textContent, /Send failed/);
    fail = false;
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    for (let i = 0; i < 6; i++) await flush();
    assert.equal(created, 1, 'Retry uses the same new session');
    assert.equal(dispose.history.get(), '/b/k7m3xqa9');
    assert.equal(button(root, 'Single').tagName, 'A');
    assert.equal(button(root, 'Single').getAttribute('aria-current'), 'page');
    button(root, 'Sessions').click();
    for (let i = 0; i < 6; i++) await flush();
    assert.equal(dispose.history.get(), '/');
    input = root.querySelector('.startup-empty-chat textarea');
    assert.equal(input.value, '');
    input.value = 'Keep while editing';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    root.querySelector('[aria-label="Edit system prompt"]').click();
    for (let i = 0; i < 8; i++) await flush();
    assert.equal(dispose.history.get(), '/b/v8n4zrc2/system-prompt-creator');
    assert.ok(root.querySelector('.system-prompt-creator'));
    assert.equal(requests.filter(request => request.input?.type === 'prompt').length, 2);
    button(root, 'Sessions').click();
    for (let i = 0; i < 6; i++) await flush();
    assert.equal(root.querySelector('.startup-empty-chat textarea').value, 'Keep while editing');
  } finally { dispose(); window.sessionStorage.removeItem('pi-agent-view'); }
});

test('side-by-side chats send and stop independently while both agents stream', async () => {
  const common = [original, user, { id: 'base-answer', parentId: user.id, type: 'message',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Shared answer' }] } }];
  const makeAgent = id => ({ agentId: id, entries: [...common,
    { id: `${id}-user`, parentId: 'base-answer', type: 'message', message: { role: 'user', content: `${id} request` } },
    { id: `${id}-answer`, parentId: `${id}-user`, type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: `${id} answer` }] } },
  ], leafId: `${id}-answer`, state: { sessionId: id, sessionUrlId: 'testchat' }, live: [], dialogs: [], connected: true, running: false, cwd: '/test/project' });
  const snapshots = { left: makeAgent('left'), right: makeAgent('right') };
  window.sessionStorage.setItem('pi-agent-view', JSON.stringify({ agents: ['left', 'right'], selected: 'left' }));
  const requests = [];
  rpc = createRpcFixture({
    info: os.handler(({ input }) => ({ ...snapshots[input.agentId || 'left'], token: 'test' })),
    agents: {
      list: os.handler(() => Object.values(snapshots)),
      create: os.handler(({ input }) => {
        requests.push(input);
        const source = snapshots[input.sourceAgentId];
        const index = source.entries.findIndex(entry => entry.id === input.entryId);
        snapshots.fork = { ...makeAgent('fork'), entries: source.entries.slice(0, index), leafId: source.entries[index].parentId };
        return snapshots.fork;
      }),
    },
    command: os.handler(({ input }) => {
      requests.push(input);
      return input.type === 'clear_queue' ? { steering: [], followUp: [] } : { disposition: 'started' };
    }),
  });
  const streams = rpc.streams;
  const dispose = components.mountApp(root, '/tree');
  try {
    for (let i = 0; i < 8; i++) await flush();
    button(root, 'Options').click();
    const options = root.querySelector('[aria-label="Options"]');
    const streaming = [...options.querySelectorAll('label')].find(label => label.textContent.includes('Show streaming content')).querySelector('input');
    assert.equal(streaming.checked, true, 'Streaming is enabled by default');
    button(options, 'Close').click();
    await flush();
    const send = (id, text) => {
      const input = root.querySelector(`.editor[data-leaf-id="${id}-answer"] textarea`);
      assert.ok(input, `Composer for ${id} exists`);
      input.value = text;
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    };
    send('left', 'Continue left');
    await flush();
    streams.get('left').emit('record', { type: 'agent_start' });
    send('right', 'Continue right');
    await flush();
    streams.get('right').emit('record', { type: 'agent_start' });
    await flush();
    assert.deepEqual(requests.filter(request => request.type === 'prompt').map(request => [request.agentId, request.message]),
      [['left', 'Continue left'], ['right', 'Continue right']]);
    for (const id of ['left', 'right']) {
      streams.get(id).emit('record', { type: 'message_start', message: { role: 'user', content: `${id} live`, timestamp: 100 } });
      streams.get(id).emit('record', { type: 'message_start', message: { role: 'assistant', content: [{ type: 'text', text: `${id} streaming` }], timestamp: 101, stopReason: 'pending' } });
    }
    await flush();
    assert.match(root.textContent, /left streaming/);
    assert.match(root.textContent, /right streaming/);
    const responseText = root.querySelector('[data-entry-id="stream-right-1"] .trace-text');
    const firstSpan = responseText.querySelector('span');
    streams.get('right').emit('record', { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: ' more' } });
    await flush();
    assert.match(root.textContent, /right streaming more/);
    assert.equal(root.querySelector('[data-entry-id="stream-right-1"] .trace-text'), responseText);
    assert.equal(responseText.querySelector('span'), firstSpan, 'Streaming preserves existing text elements');
    const stops = root.querySelectorAll('.composer-stop');
    assert.equal(stops.length, 2);
    root.querySelector('.message-composer:has(.editor[data-leaf-id="stream-left-1"]) .composer-stop').click();
    await flush();
    assert.deepEqual(requests.filter(request => request.type === 'abort').map(request => request.agentId), ['left']);
    streams.get('left').emit('record', { type: 'agent_settled' });
    await flush();
    assert.equal(root.querySelectorAll('.composer-stop').length, 1);
    assert.ok(root.querySelector('.message-composer:has(.editor[data-leaf-id="stream-right-1"]) .composer-stop'));
    assert.match(root.textContent, /right streaming/);
    let rightInput = root.querySelector('.editor[data-leaf-id="stream-right-1"] textarea');
    rightInput.value = 'Keep right draft';
    rightInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    root.querySelector('[data-entry-id="left-user"] [aria-label="New branch"]').click();
    await flush();
    const forkInput = root.querySelector('.editor[data-leaf-id^="draft-"] textarea');
    assert.ok(forkInput);
    forkInput.value = 'Independent fork';
    forkInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    forkInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    for (let i = 0; i < 4; i++) await flush();
    assert.equal(requests.find(request => request.sourceAgentId)?.sourceAgentId, 'left');
    assert.equal(requests.filter(request => request.type === 'prompt').at(-1).agentId, 'fork');
    streams.get('fork').emit('record', { type: 'agent_start' });
    streams.get('fork').emit('record', { type: 'message_start', message: { role: 'user', content: 'Independent fork', timestamp: Date.now() + 1 } });
    streams.get('fork').emit('record', { type: 'message_start', message: { role: 'assistant', content: [{ type: 'text', text: 'Fork streaming' }], timestamp: Date.now() + 2, stopReason: 'pending' } });
    await flush();
    assert.match(root.textContent, /Fork streaming/);
    assert.equal(root.querySelector('.editor[data-leaf-id="stream-right-1"] textarea'), rightInput);
    assert.equal(rightInput.value, 'Keep right draft');
    assert.equal(root.querySelectorAll('.tree-node[data-entry-id="user1"]').length, 1);
    const forkDraft = root.querySelector('.editor[data-leaf-id="stream-fork-1"] textarea');
    forkDraft.value = 'Keep fork draft';
    forkDraft.dispatchEvent(new window.Event('input', { bubbles: true }));
    button(root, 'System prompts').click();
    await flush();
    button(root, 'Chat').click();
    await flush();
    rightInput = root.querySelector('.editor[data-leaf-id="stream-right-1"] textarea');
    assert.equal(rightInput.value, 'Keep right draft', 'Streaming agent keeps its draft across routes');
    assert.equal(root.querySelector('.editor[data-leaf-id="stream-fork-1"] textarea').value, 'Keep fork draft', 'Fork keeps a separate draft across routes');
    rightInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    const steering = requests.filter(request => request.type === 'prompt').at(-1);
    assert.equal(steering.agentId, 'right');
    assert.equal(steering.streamingBehavior, 'steer');
  } finally {
    const streaming = [...root.querySelectorAll('[aria-label="Options"] label')].find(label => label.textContent.includes('Show streaming content'))?.querySelector('input');
    if (streaming?.checked) streaming.click();
    dispose();
    await flush();
    assert.ok([...streams.values()].every(stream => stream.closed));
    assert.equal(requests.filter(request => request.type === 'stop').length, 0);
    window.sessionStorage.removeItem('pi-agent-view');
  }
});

test('Single routes mount only one branch and composer while preserving shared state across views', async () => {
  const common = [original, user];
  const makeAgent = (id, timestamp) => ({ agentId: id, entries: [...common,
    { id: `${id}-answer`, parentId: user.id, type: 'message', message: { role: 'assistant',
      content: [{ type: 'text', text: `${id} answer` }], timestamp } },
  ], leafId: `${id}-answer`, state: { sessionId: id, sessionUrlId: 'testchat' }, live: [], dialogs: [], connected: true, running: false, cwd: '/test/project' });
  const snapshots = { left: makeAgent('left', 10), right: makeAgent('right', 20) };
  window.sessionStorage.setItem('pi-agent-view', JSON.stringify({ agents: ['left', 'right'], selected: 'left' }));
  rpc = createRpcFixture({
    info: os.handler(({ input }) => ({ ...snapshots[input.agentId || 'left'], token: 'test' })),
    agents: { list: os.handler(() => Object.values(snapshots)) },
  });
  const dispose = components.mountApp(root, '/single');
  try {
    for (let i = 0; i < 8; i++) await flush();
    assert.equal(dispose.history.get(), '/testchat/single');
    assert.equal(root.querySelectorAll('.message-composer').length, 1);
    assert.ok(root.querySelector('.tree-node[data-entry-id="right-answer"]'));
    assert.equal(root.querySelector('.tree-node[data-entry-id="left-answer"]'), null);
    assert.equal(root.querySelector('.tree-connections'), null);
    button(root, 'Options').click();
    const options = root.querySelector('[aria-label="Options"]');
    const streaming = [...options.querySelectorAll('label')].find(label => label.textContent.includes('Show streaming content')).querySelector('input');
    if (!streaming.checked) streaming.click();
    button(options, 'Close').click();
    let input = root.querySelector('.editor textarea');
    input.value = 'Keep right draft';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    globalThis.FileReader = window.FileReader;
    const paste = new window.Event('paste', { bubbles: true, cancelable: true });
    const file = new window.File(['image bytes'], 'clipboard.png', { type: 'image/png' });
    Object.defineProperty(paste, 'clipboardData', { value: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] } });
    input.dispatchEvent(paste);
    await new Promise(resolve => setTimeout(resolve, 30));
    await flush();
    assert.ok(root.querySelector('.composer-attachments img'));
    button(root, 'Tree').click();
    await flush();
    root.querySelector('.editor[data-leaf-id="left-answer"] textarea').focus();
    await flush();
    button(root, 'Single').click();
    await flush();
    assert.ok(root.querySelector('.tree-node[data-entry-id="left-answer"]'));
    assert.equal(root.querySelector('.tree-node[data-entry-id="right-answer"]'), null);
    assert.ok(root.querySelector('.tree-node[data-entry-id="user1"]'), 'Shared ancestor remains visible after switching views');
    assert.equal(root.querySelectorAll('.message-composer').length, 1);
    input = root.querySelector('.editor textarea');
    assert.equal(input.value, '');
    assert.equal(root.querySelector('.composer-attachments img'), null);
    input.value = 'Keep left draft';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    rpc.streams.get('right').emit('record', { type: 'message_start', message: { role: 'assistant',
      content: [{ type: 'text', text: 'Right background streaming' }], timestamp: 30, stopReason: 'pending' } });
    await flush();
    assert.doesNotMatch(root.querySelector('#trace-viewport').textContent, /Right background streaming/);
    assert.equal(root.querySelectorAll('.message-composer').length, 1);
    button(root, 'Tree').click();
    await flush();
    assert.equal(dispose.history.get(), '/testchat/tree');
    assert.ok(root.querySelector('.tree-connections'));
    assert.equal(root.querySelectorAll('.message-composer').length, 2);
    assert.match(root.querySelector('#trace-viewport').textContent, /Right background streaming/);
    assert.equal(root.querySelector('.editor[data-leaf-id="stream-right-0"] textarea').value, 'Keep right draft');
    assert.ok(root.querySelector('.message-composer:has(.editor[data-leaf-id="stream-right-0"]) .composer-attachments img'));
    button(root, 'Single').click();
    await flush();
    assert.equal(dispose.history.get(), '/testchat/single');
    assert.equal(root.querySelectorAll('.message-composer').length, 1);
    assert.equal(root.querySelector('.editor textarea').value, 'Keep left draft');
    assert.equal(root.querySelector('.tree-node[data-entry-id="stream-right-0"]'), null);
    dispose.history.back();
    await flush();
    assert.equal(dispose.history.get(), '/testchat/tree');
    assert.equal(root.querySelectorAll('.message-composer').length, 2);
    dispose.history.forward();
    await flush();
    assert.equal(dispose.history.get(), '/testchat/single');
    assert.equal(root.querySelectorAll('.message-composer').length, 1);
    button(root, 'Tree').click();
    await flush();
    root.querySelector('.editor[data-leaf-id="stream-right-0"] textarea').focus();
    await flush();
    button(root, 'Single').click();
    await flush();
    assert.match(root.querySelector('#trace-viewport').textContent, /Right background streaming/);
    assert.equal(root.querySelector('.editor textarea').value, 'Keep right draft');
    assert.ok(root.querySelector('.composer-attachments img'));
    assert.ok(rpc.requests.every(request => ['info', 'agents/list', 'events'].includes(request.path)), 'View navigation sends no commands or prompts');
  } finally { dispose(); window.sessionStorage.removeItem('pi-agent-view'); }
});

test('/hide cuts columns from the DOM, keeps needed shared cards, and reverses through hidden-only mode', async () => {
  const scope = 'visibility-poc-session';
  const makeAgent = (id, timestamp) => ({ agentId: id, entries: [original, user,
    { id: `${id}-answer`, parentId: user.id, type: 'message', message: { role: 'assistant',
      content: [{ type: 'text', text: `${id} answer` }], timestamp } },
  ], leafId: `${id}-answer`, state: { sessionId: scope, sessionUrlId: 'testchat' }, live: [], dialogs: [], connected: true, running: false, cwd: '/test/project' });
  const snapshots = { left: makeAgent('left', 10), right: makeAgent('right', 20) };
  window.sessionStorage.setItem('pi-agent-view', JSON.stringify({ agents: ['left', 'right'], selected: 'left' }));
  rpc = createRpcFixture({
    info: os.handler(({ input }) => ({ ...snapshots[input.agentId || 'left'], token: 'test' })),
    agents: { list: os.handler(() => Object.values(snapshots)) },
  });
  const dispose = components.mountApp(root, '/tree');
  const stored = () => JSON.parse(window.localStorage.getItem('spicy.hidden-branches'));
  const hide = async id => {
    const input = root.querySelector(`.editor[data-leaf-id="${id}"] textarea`);
    assert.ok(input, `Shown composer for ${id}`);
    input.value = '/hide';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    await flush();
  };
  const onlyHidden = async value => {
    button(root, 'Options').click();
    await flush();
    const dialog = root.querySelector('[aria-label="Options"]');
    const checkbox = [...dialog.querySelectorAll('label')].find(label => label.textContent.includes('Show only hidden branches')).querySelector('input');
    if (checkbox.checked !== value) checkbox.click();
    await flush();
    button(dialog, 'Close').click();
    await flush();
  };
  try {
    for (let i = 0; i < 8; i++) await flush();
    button(root, 'Options').click();
    const options = root.querySelector('[aria-label="Options"]');
    const streaming = [...options.querySelectorAll('label')].find(label => label.textContent.includes('Show streaming content')).querySelector('input');
    if (!streaming.checked) streaming.click();
    button(options, 'Close').click();
    await flush();
    const shared = root.querySelector('.tree-node[data-entry-id="user1"]');
    const initialWidth = parseFloat(root.querySelector('.tree-stage').style.width);
    assert.equal(root.querySelectorAll('.message-composer').length, 2);
    await hide('right-answer');
    assert.equal(root.querySelector('.tree-node[data-entry-id="right-answer"]'), null);
    assert.equal(root.querySelector('.editor[data-leaf-id="right-answer"]'), null);
    assert.equal(root.querySelector('.tree-node[data-entry-id="user1"]'), shared);
    assert.ok(root.querySelector('.tree-node[data-entry-id="left-answer"]'));
    assert.equal(root.querySelectorAll('.message-composer').length, 1);
    assert.ok(parseFloat(root.querySelector('.tree-stage').style.width) < initialWidth);
    assert.deepEqual(stored(), ['right-answer']);
    rpc.streams.get('right').emit('record', { type: 'message_start', message: { role: 'assistant',
      content: [{ type: 'text', text: 'Hidden right update' }], timestamp: 30, stopReason: 'pending' } });
    await flush();
    assert.doesNotMatch(root.querySelector('#trace-viewport').textContent, /Hidden right update/);
    assert.equal(root.querySelector('.tree-node[data-entry-id="user1"]'), shared);
    assert.deepEqual(stored(), ['stream-right-0'], 'Stored leaf follows the growing hidden column');
    await onlyHidden(true);
    assert.equal(root.querySelector('.tree-node[data-entry-id="left-answer"]'), null);
    assert.match(root.querySelector('#trace-viewport').textContent, /Hidden right update/);
    assert.equal(root.querySelector('.tree-node[data-entry-id="user1"]'), shared, 'Shared card stays mounted when switching sets');
    assert.deepEqual(stored(), ['stream-right-0'], 'Switching sets does not rewrite hidden marks');
    await hide('stream-right-0');
    assert.equal(root.querySelectorAll('.tree-node').length, 0);
    assert.equal(root.querySelectorAll('.message-composer').length, 0);
    assert.deepEqual(stored(), []);
    await onlyHidden(false);
    assert.equal(root.querySelectorAll('.message-composer').length, 2);
    await hide('left-answer');
    await hide('stream-right-0');
    assert.equal(root.querySelectorAll('.tree-node').length, 0);
    assert.equal(root.querySelectorAll('.message-composer').length, 0);
    await onlyHidden(true);
    assert.equal(root.querySelectorAll('.message-composer').length, 2);
    assert.ok(root.querySelector('.tree-node[data-entry-id="left-answer"]'));
    assert.ok(root.querySelector('.tree-node[data-entry-id="stream-right-0"]'));
    assert.ok(rpc.requests.every(request => ['info', 'agents/list', 'events'].includes(request.path)), '/hide never reaches the backend');
  } finally {
    try { await onlyHidden(false); }
    finally {
      dispose();
      window.sessionStorage.removeItem('pi-agent-view');
      window.localStorage.removeItem('spicy.hidden-branches');
    }
  }
});

test('edit results render the recorded patch with syntax, line numbers and word emphasis', () => {
  const patch = '--- demo.ts\n+++ demo.ts\n@@ -1,2 +1,2 @@\n const unchanged = true;\n-const value = 1;\n+const value = 2;\n';
  const dispose = components.mountChatContent(root, [
    { id: 'a', type: 'message', message: { role: 'assistant', content: [
      { type: 'toolCall', id: 'edit-call', name: 'edit', arguments: { path: 'demo.ts' } },
    ] } },
    { id: 'r', type: 'message', message: { role: 'toolResult', toolCallId: 'edit-call',
      content: [{ type: 'text', text: 'Successfully replaced 1 block.' }], details: { patch },
    } },
  ]);
  try {
    assert.ok(root.querySelector('.tool .diff-view'));
    assert.equal(root.querySelector('.diff-remove .diff-source').textContent, 'const value = 1;');
    assert.equal(root.querySelector('.diff-add .diff-source').textContent, 'const value = 2;');
    assert.equal(root.querySelector('.diff-remove .diff-word').textContent, '1');
    assert.equal(root.querySelector('.diff-add .diff-word').textContent, '2');
    assert.ok(root.querySelector('.diff-source .hljs-keyword'));
    assert.deepEqual([...root.querySelectorAll('.diff-add .diff-line-number')].map(element => element.textContent), ['2']);
    assert.doesNotMatch(root.textContent, /Successfully replaced/);
  } finally { dispose(); }
});

test('Solid chat content preserves tool, codemode, ANSI, image and branch presentations', () => {
  const toolEntries = [
    { id: 'user', type: 'message', message: { role: 'user', content: 'User prompt' } },
    { id: 'assistant', type: 'message', message: { role: 'assistant', content: [
      { type: 'thinking', thinking: '**Plan** with `code`' },
      { type: 'thinking', thinking: 'opaque-payload', redacted: true, thinkingSignature: 'secret-signature' },
      { type: 'thinking', thinking: '', thinkingSignature: 'encrypted-payload' },
      { type: 'text', text: 'Assistant reply' },
      { type: 'toolCall', id: 'read', name: 'read', arguments: { path: 'image.png' } },
      { type: 'toolCall', id: 'bash', name: 'bash', arguments: { command: 'echo result' } },
      { type: 'toolCall', id: 'code', name: 'codemode', arguments: { code: Array.from({ length: 12 }, (_, i) => `const line${i} = ${i};`).join('\n') } },
    ] } },
    { id: 'read-result', type: 'message', message: { role: 'toolResult', toolCallId: 'read', content: [
      { type: 'text', text: 'Successful read output is intentionally compact' },
      { type: 'image', mimeType: 'image/png', data: 'AAAA' },
    ] } },
    { id: 'bash-result', type: 'message', message: { role: 'toolResult', toolCallId: 'bash', content: [
      { type: 'text', text: '\u001b[31mred result\u001b[0m' },
    ] } },
    { id: 'code-result', type: 'message', message: { role: 'toolResult', toolCallId: 'code', content: [
      { type: 'text', text: Array.from({ length: 7 }, (_, i) => `output ${i}`).join('\n') },
    ], details: { calls: Array.from({ length: 9 }, (_, i) => ({ name: `tool${i}`, status: 'ok', arguments: { index: i } })) } } },
  ];
  const dispose = components.mountChatContent(root, toolEntries);
  try {
    assert.equal(root.querySelector('.branch-trigger').dataset.branchSource, 'user');
    assert.match(root.textContent, /Assistant reply/);
    assert.equal(root.querySelector('.thinking-text strong').textContent, 'Plan');
    assert.equal(root.querySelector('.thinking-text code').textContent, 'code');
    assert.equal([...root.querySelectorAll('.thinking-text')].filter(element => element.textContent === 'Encrypted thinking').length, 1);
    assert.doesNotMatch(root.textContent, /opaque-payload|secret-signature|encrypted-payload/);
    assert.doesNotMatch(root.textContent, /Successful read output is intentionally compact/);
    assert.equal(root.querySelectorAll('.trace-image').length, 1);
    assert.equal(root.querySelector('.compact-read .image-read-link').getAttribute('role'), 'button');
    assert.equal([...root.querySelectorAll('span')].find(element => element.textContent === 'red result').style.color, 'var(--ansi-red)');
    const codemode = root.querySelector('.codemode-tool');
    assert.equal(codemode.querySelector('.codemode-call').hidden, true);
    codemode.querySelector('[aria-label="Expand or collapse codemode code"]').click();
    assert.equal(codemode.classList.contains('codemode-expanded'), true);
    assert.equal(codemode.querySelector('.codemode-call').hidden, false);
    assert.ok([...codemode.querySelectorAll('.collapse-toggle')].every(control => control.getAttribute('aria-expanded') === 'true'));
  } finally { dispose(); }
});
