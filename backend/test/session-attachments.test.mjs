import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '../../packages/coding-agent/src/core/session-manager.ts';
import { hydrateSessionEntry, serializeSessionEntry } from '../../packages/coding-agent/src/core/session-attachments.ts';

test('persisted sessions reload image attachments as model-ready content', () => {
  const directory = mkdtempSync(join(tmpdir(), 'spicy-session-images-'));
  try {
    const session = SessionManager.create(directory, directory);
    const message = { role: 'user', timestamp: Date.now(), content: [
      { type: 'text', text: 'Describe this' },
      { type: 'image', mimeType: 'image/png', data: Buffer.from('pixels').toString('base64') },
    ] };
    session.appendMessage(message);
    const file = session.getSessionFile();
    const rows = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const stored = rows.find(row => row.type === 'message').message.content[1];
    assert.ok(stored.file);
    assert.equal(stored.data, undefined);
    const reloaded = SessionManager.open(file);
    assert.deepEqual(reloaded.getEntries().find(row => row.type === 'message').message, message);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('image bytes live beside the session, while text and image references survive reload', () => {
  const directory = mkdtempSync(join(tmpdir(), 'spicy-images-'));
  try {
    const path = join(directory, 'session.jsonl');
    const image = { type: 'image', mimeType: 'image/png', data: Buffer.from('image bytes').toString('base64') };
    const entry = { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'Look at this' }, image] } };
    const json = serializeSessionEntry(entry, path);
    const stored = JSON.parse(json);
    assert.equal(stored.message.content[1].data, undefined);
    assert.match(stored.message.content[1].file, /^attachments\/.+\.png$/);
    assert.equal(readFileSync(join(directory, stored.message.content[1].file), 'utf8'), 'image bytes');
    assert.equal(entry.message.content[1].data, image.data, 'serialization must not mutate agent messages');
    assert.deepEqual(hydrateSessionEntry(stored, path), entry);
    serializeSessionEntry(entry, path);
    assert.equal(readdirSync(join(directory, 'attachments')).length, 1, 'rewriting a row retains its attachment');
    assert.throws(() => hydrateSessionEntry({ type: 'image', file: '../private.png' }, path), /Invalid session attachment/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
