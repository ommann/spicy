import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionPath, sessionUrlIdFromPath, sessionViewPath } from '../src/session-urls.ts';

test('session URLs use the short ID directly without grouping prefixes', () => {
  assert.equal(sessionPath('/', 'k7m3xqa9'), '/k7m3xqa9');
  assert.equal(sessionPath('/system-prompts/entry', 'k7m3xqa9'), '/k7m3xqa9/system-prompts/entry');
  assert.equal(sessionPath('/system-prompt-creator', 'k7m3xqa9'), '/k7m3xqa9/system-prompt-creator');
  assert.equal(sessionPath('/k7m3xqa9/system-prompts/entry', 'v8n4zrc2'), '/v8n4zrc2/system-prompts/entry');
});

test('session URL parsing keeps legacy routes and rejects other ID alphabets', () => {
  assert.equal(sessionUrlIdFromPath('/k7m3xqa9'), 'k7m3xqa9');
  assert.equal(sessionViewPath('/k7m3xqa9'), '/');
  assert.equal(sessionViewPath('/k7m3xqa9/system-prompts/entry'), '/system-prompts/entry');
  for (const path of ['/', '/system-prompts/entry', '/system-prompt-creator', '/abcdefghj', '/abcd0fgh', '/ABCDefgh']) {
    assert.equal(sessionUrlIdFromPath(path), undefined);
    assert.equal(sessionViewPath(path), path);
  }
});
