import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { build } from 'vite';
import solid from 'vite-plugin-solid';
import { fileURLToPath } from 'node:url';
import { createSystemPromptCatalog } from '../src/lilim/system-prompts.js';
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
for (const name of ['window', 'document', 'HTMLElement', 'HTMLTextAreaElement', 'HTMLDialogElement', 'HTMLHeadElement', 'Element', 'Node', 'NodeFilter', 'Event', 'KeyboardEvent', 'CustomEvent', 'AbortController', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame']) {
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
const components = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const root = window.document.getElementById('root');
const flush = async () => {
  await Promise.resolve();
  await new Promise(resolve => window.requestAnimationFrame(resolve));
  await Promise.resolve();
};
const button = (parent, text) => [...parent.querySelectorAll('button')].find(element => element.textContent.trim() === text);

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
  const previousFetch = globalThis.fetch;
  const requests = [];
  let state = { status: 'idle', events: [] };
  globalThis.fetch = async url => new Response(JSON.stringify(String(url).endsWith('/providers')
    ? [{ id: 'example', name: 'Example', methods: [{ type: 'oauth', name: 'Example OAuth' }] }]
    : state), { status: 200 });
  const dispose = components.mountLogin(root, async (endpoint, data) => {
    requests.push({ endpoint, data });
    if (endpoint === 'auth/login') state = { id: 'login1', status: 'pending',
      events: [{ type: 'auth_url', url: 'https://example.com/oauth' }],
      prompt: { id: 'prompt1', type: 'manual_code', message: 'Paste redirect URL' } };
    if (endpoint === 'auth/reply') state = { id: 'login1', status: 'success', events: [] };
    if (endpoint === 'auth/cancel') state = { id: 'login1', status: 'cancelled', events: [] };
    return state;
  });
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
    assert.equal(requests[1].data.value, 'redirect-code');
    assert.match(root.textContent, /Logged in\./);
    button(root, 'Example OAuth').click();
    await flush();
    root.querySelector('dialog').close();
    assert.equal(requests.at(-1).endpoint, 'auth/cancel');
    assert.equal(root.querySelector('input'), null);
  } finally {
    dispose();
    globalThis.fetch = previousFetch;
  }
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
    dialog.querySelector('[aria-label="Previous system prompt"]').click();
    await flush();
    assert.equal(cards[0].dataset.activeColumn, 'true');
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
    dialog.querySelector('[aria-label="Next system prompt"]').click();
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
  const requests = [];
  window.sessionStorage.setItem('pi-agent-view', JSON.stringify({ agents: ['default'], selected: 'default' }));
  const snapshot = { agentId: 'default', entries, leafId: 'user2', state: { sessionId: 'creator-test' }, live: [], dialogs: [], connected: true, running: false, cwd: '/test', token: 'test' };
  const before = JSON.stringify(snapshot.entries);
  const storageBefore = JSON.stringify(localStorage);
  const promptDocument = { version: 1, parts: [
    { id: 'preamble', section: 'preamble', label: 'Instructions', source: 'core', text: 'Original instructions' },
    { id: 'tools', section: 'tools', label: 'Tool rules', source: 'core', text: 'Optional tool rules' },
  ] };
  globalThis.fetch = async (url, options) => {
    const body = options?.body && JSON.parse(options.body);
    requests.push({ url, body });
    if (body?.type === 'save_system_prompt') {
      const prompt = { ...body.prompt, id: 'saved-prompt', output: renderSystemPromptDocument(body.prompt.document, body.prompt.excludedIds) };
      snapshot.entries = [...snapshot.entries, { id: prompt.id, type: 'custom', customType: SAVED_SYSTEM_PROMPT_ENTRY, parentId: snapshot.leafId, data: prompt }];
      return { ok: true, json: async () => prompt };
    }
    return { ok: true, json: async () => url.startsWith('/api/info') ? snapshot : url === '/api/agents' ? [snapshot] : {
      document: promptDocument,
      current: { content: 'Original instructions', sections: {}, toolsAdded: [] },
    } };
  };
  globalThis.EventSource = class { addEventListener() {} close() {} };
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
    assert.deepEqual([...new Set(requests.filter(item => item.body).map(item => item.body.type))], ['get_system_prompt_document', 'save_system_prompt']);
    assert.equal(requests.filter(item => item.body?.type === 'save_system_prompt').length, 1);
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
  const requests = [];
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
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => url.startsWith('/api/info') ? snapshot : url === '/api/agents' ? [snapshot] : [] };
  };
  let eventSource;
  globalThis.EventSource = class {
    listeners = new Map();
    // Expose the fake transport so the test can emit server events.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    constructor() { eventSource = this; }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    emit(type, data) { this.listeners.get(type)?.({ data: JSON.stringify(data) }); }
    close() {}
  };
  const dispose = components.mountApp(root);
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
    root.querySelector('[aria-label="Next column"]').click();
    await flush();
    assert.ok(viewport.scrollLeft > left, 'Next arrow centers the next column');
    const nextLeft = viewport.scrollLeft;
    root.querySelector('[aria-label="Previous column"]').click();
    await flush();
    assert.equal(nextLeft - viewport.scrollLeft, 1088, 'Previous arrow moves back exactly one column (1040px + 48px gap)');
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
    assert.doesNotMatch(root.querySelector('.lilim-host').textContent, /Original instructions|New tools/);
    const input = root.querySelector('.editor textarea');
    input.value = 'Keep this draft';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(input.value, 'Keep this draft');
    eventSource.emit('record', { type: 'agent_start' });
    eventSource.emit('record', { type: 'agent_settled' });
    assert.equal(root.querySelector('.editor textarea'), input, 'Run status does not rebuild the conversation');
    eventSource.emit('record', { type: 'extension_ui_request', method: 'set_editor_text', text: 'Keep this draft' });
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
    assert.equal(dispose.history.get(), '/k7m3xqa9');
    dispose.history.back();
    await flush();
    assert.ok(root.querySelector('.system-prompts-view'), 'History back restores the prompt route');
    dispose.history.forward();
    await flush();
    assert.equal(root.querySelector('.system-prompts-view'), null);
    assert.equal(root.querySelector('.editor textarea').value, 'Keep this draft');
    assert.equal(JSON.stringify(entries), before);
    assert.ok(requests.every(request => !request.options?.method || request.options.method === 'GET'));
  } finally { dispose(); }
});

test('session URLs override tab selection, preserve deep links and restore on browser navigation', async () => {
  const requests = [];
  const makeSnapshot = urlId => ({ agentId: urlId, entries, leafId: 'user2',
    state: { sessionId: `uuid-${urlId}`, sessionUrlId: urlId }, live: [], dialogs: [],
    connected: true, running: false, cwd: '/test/project', token: 'test' });
  const stale = makeSnapshot('stale');
  window.sessionStorage.setItem('pi-agent-view', JSON.stringify({ agents: ['stale'], selected: 'stale' }));
  globalThis.fetch = async (url, options) => {
    const body = options?.body && JSON.parse(options.body);
    requests.push({ url, body });
    return { ok: true, json: async () => body?.sessionUrlId ? makeSnapshot(body.sessionUrlId)
      : url === '/api/agents' ? [stale] : stale };
  };
  globalThis.EventSource = class { addEventListener() {} close() {} };
  const dispose = components.mountApp(root, '/k7m3xqa9/system-prompts/system2');
  try {
    for (let i = 0; i < 8; i++) await flush();
    assert.equal(dispose.history.get(), '/k7m3xqa9/system-prompts/system2');
    assert.ok(root.querySelector('.system-prompts-view'));
    assert.deepEqual(requests.filter(item => item.body).map(item => item.body.sessionUrlId), ['k7m3xqa9']);
    assert.ok(!requests.some(item => item.url.includes('agentId=stale')));
    button(root, 'Chat').click();
    await flush();
    assert.equal(dispose.history.get(), '/k7m3xqa9');
    dispose.history.set({ value: '/v8n4zrc2' });
    for (let i = 0; i < 6; i++) await flush();
    assert.equal(dispose.history.get(), '/v8n4zrc2');
    dispose.history.back();
    for (let i = 0; i < 6; i++) await flush();
    assert.equal(dispose.history.get(), '/k7m3xqa9');
    assert.deepEqual(requests.filter(item => item.body).map(item => item.body.sessionUrlId), ['k7m3xqa9', 'v8n4zrc2', 'k7m3xqa9']);
    assert.ok(requests.filter(item => item.body).every(item => item.url === '/api/agents'));
  } finally { dispose(); window.sessionStorage.removeItem('pi-agent-view'); }
});

test('default Sessions view groups and filters real sessions and opens without branching', async () => {
  window.sessionStorage.removeItem('pi-agent-view');
  const requests = [];
  const empty = { entries: [], leafId: null, state: null, live: [], dialogs: [], connected: false, running: false, cwd: '/work/spicy', token: 'test' };
  const saved = [
    { id: 'first-file', urlId: 'k7m3xqa9', cwd: '/work/spicy', name: 'Prompt history', modified: Date.now() },
    { id: 'second-file', cwd: '/work/spicy', name: 'Branch tests', modified: Date.now() },
    { id: 'third-file', cwd: '/work/extensions', name: 'Prompt loading', modified: Date.now() },
  ];
  globalThis.fetch = async (url, options) => {
    const body = options?.body && JSON.parse(options.body);
    requests.push({ url, body });
    return { ok: true, json: async () => body?.openSessionId ? { ...empty, agentId: 'opened', connected: true, entries, leafId: 'user2', state: { sessionId: 'uuid', sessionUrlId: 'k7m3xqa9' } }
      : url.startsWith('/api/sessions') ? saved : url === '/api/agents' ? [] : empty };
  };
  globalThis.EventSource = class { addEventListener() {} close() {} };
  const dispose = components.mountApp(root, '/');
  try {
    for (let i = 0; i < 8; i++) await flush();
    assert.equal(dispose.history.get(), '/');
    assert.equal(root.querySelectorAll('.startup-project').length, 2);
    assert.equal(root.querySelectorAll('.startup-session').length, 3);
    assert.equal(root.querySelectorAll('.startup-empty-chat .branch-draft').length, 2);
    assert.ok(root.querySelector('.startup-empty-chat .editor textarea'));
    assert.equal(requests.filter(request => request.body).length, 0, 'Listing does not start agents or send prompts');
    const path = root.querySelector('[aria-label="Search project paths"]');
    path.value = 'spicy';
    path.dispatchEvent(new window.Event('input', { bubbles: true }));
    const name = root.querySelector('[aria-label="Search session names"]');
    name.value = 'prompt';
    name.dispatchEvent(new window.Event('input', { bubbles: true }));
    await flush();
    assert.equal(root.querySelectorAll('.startup-project').length, 1);
    assert.equal(root.querySelectorAll('.startup-session').length, 1);
    root.querySelector('.startup-session').click();
    for (let i = 0; i < 6; i++) await flush();
    assert.equal(dispose.history.get(), '/k7m3xqa9');
    assert.ok(root.querySelector('.lilim-host'));
    assert.deepEqual(requests.filter(request => request.body).map(request => request.body), [{ openSessionId: 'first-file' }]);
  } finally { dispose(); window.sessionStorage.removeItem('pi-agent-view'); }
});

test('Sessions composer keeps failed drafts, opens focused chat on success and opens the prompt editor', async () => {
  window.sessionStorage.removeItem('pi-agent-view');
  const requests = [];
  let fail = true;
  let created = 0;
  const empty = { entries: [], leafId: null, state: null, live: [], dialogs: [], connected: false, running: false, cwd: '/work/spicy', token: 'test' };
  globalThis.fetch = async (url, options) => {
    const body = options?.body && JSON.parse(options.body);
    requests.push({ url, body });
    if (body?.type === 'prompt') return { ok: !fail, json: async () => fail ? { error: 'Send failed' } : { disposition: 'started' } };
    if (body?.type === 'get_system_prompt_document') return { ok: true, json: async () => ({
      document: { version: 1, parts: [{ id: 'preamble', section: 'preamble', label: 'Instructions', source: 'core', text: 'Instructions' }] },
      current: { content: 'Instructions', sections: {}, toolsAdded: [] },
    }) };
    if (url === '/api/agents' && body) {
      created++;
      return { ok: true, json: async () => ({ ...empty, agentId: `new-${created}`, connected: true,
        state: { sessionId: `uuid-${created}`, sessionUrlId: created === 1 ? 'k7m3xqa9' : 'v8n4zrc2' } }) };
    }
    return { ok: true, json: async () => url.startsWith('/api/sessions') || url === '/api/agents' ? [] : empty };
  };
  globalThis.EventSource = class { addEventListener() {} close() {} };
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
    assert.equal(dispose.history.get(), '/k7m3xqa9');
    assert.equal(button(root, 'Single').getAttribute('aria-pressed'), 'true');
    button(root, 'Sessions').click();
    for (let i = 0; i < 6; i++) await flush();
    assert.equal(dispose.history.get(), '/');
    input = root.querySelector('.startup-empty-chat textarea');
    assert.equal(input.value, '');
    input.value = 'Keep while editing';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    root.querySelector('[aria-label="Edit system prompt"]').click();
    for (let i = 0; i < 8; i++) await flush();
    assert.equal(dispose.history.get(), '/v8n4zrc2/system-prompt-creator');
    assert.ok(root.querySelector('.system-prompt-creator'));
    assert.equal(requests.filter(request => request.body?.type === 'prompt').length, 2);
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
  ], leafId: `${id}-answer`, state: { sessionId: id }, live: [], dialogs: [], connected: true, running: false, cwd: '/test/project' });
  const snapshots = { left: makeAgent('left'), right: makeAgent('right') };
  window.sessionStorage.setItem('pi-agent-view', JSON.stringify({ agents: ['left', 'right'], selected: 'left' }));
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const body = options?.body && JSON.parse(options.body);
    if (body) requests.push(body);
    if (url === '/api/agents' && body) {
      const source = snapshots[body.sourceAgentId];
      const index = source.entries.findIndex(entry => entry.id === body.entryId);
      snapshots.fork = { ...makeAgent('fork'), entries: source.entries.slice(0, index), leafId: source.entries[index].parentId };
      return { ok: true, json: async () => snapshots.fork };
    }
    const value = url === '/api/agents' ? Object.values(snapshots)
      : url.startsWith('/api/info') ? { ...snapshots[new URL(url, window.location.href).searchParams.get('agentId') || 'left'], token: 'test' }
      : body?.type === 'clear_queue' ? { steering: [], followUp: [] } : { disposition: 'started' };
    return { ok: true, json: async () => value };
  };
  const streams = new Map();
  globalThis.EventSource = class {
    listeners = new Map();
    constructor(url) { streams.set(new URL(url, window.location.href).searchParams.get('agentId'), this); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    emit(type, value) { this.listeners.get(type)?.({ data: JSON.stringify(value) }); }
    close() { this.closed = true; }
  };
  const dispose = components.mountApp(root);
  try {
    for (let i = 0; i < 8; i++) await flush();
    button(root, 'Options').click();
    const options = root.querySelector('[aria-label="Options"]');
    const streaming = [...options.querySelectorAll('label')].find(label => label.textContent.includes('Show streaming content')).querySelector('input');
    streaming.click();
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
    assert.deepEqual(requests.filter(request => request.type === 'prompt').map(request => [request.agentId, request.message]),
      [['left', 'Continue left'], ['right', 'Continue right']]);
    for (const id of ['left', 'right']) {
      streams.get(id).emit('record', { type: 'message_start', message: { role: 'user', content: `${id} live`, timestamp: 100 } });
      streams.get(id).emit('record', { type: 'message_start', message: { role: 'assistant', content: [{ type: 'text', text: `${id} streaming` }], timestamp: 101, stopReason: 'pending' } });
    }
    await flush();
    assert.match(root.textContent, /left streaming/);
    assert.match(root.textContent, /right streaming/);
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
    assert.ok([...streams.values()].every(stream => stream.closed));
    assert.equal(requests.filter(request => request.type === 'stop').length, 0);
    window.sessionStorage.removeItem('pi-agent-view');
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
