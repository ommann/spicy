import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionPath, sessionUrlIdFromPath, sessionViewPath, treeUrlIdFromPath } from '../src/session-urls.ts';

test('branch and tree URLs round-trip, omitting duplicate focus IDs', () => {
  for (const [view, focus, expected] of [
    ['/single', 'k7m3xqa9', '/b/k7m3xqa9'],
    ['/tree', 'k7m3xqa9', '/t/k7m3xqa9'],
    ['/tree', 'v8n4zrc2', '/t/k7m3xqa9/v8n4zrc2'],
  ]) {
    const path = sessionPath(view, focus, 'k7m3xqa9');
    assert.equal(path, expected);
    assert.equal(sessionUrlIdFromPath(path), focus);
    assert.equal(sessionViewPath(path), view);
    if (view === '/tree') assert.equal(treeUrlIdFromPath(path), 'k7m3xqa9');
  }
  assert.equal(sessionPath('/t/k7m3xqa9/k7m3xqa9', 'k7m3xqa9'), '/t/k7m3xqa9');
  assert.equal(sessionPath('/system-prompts/entry', 'k7m3xqa9'), '/b/k7m3xqa9/system-prompts/entry');
  assert.equal(sessionPath('/b/k7m3xqa9/system-prompts/entry', 'v8n4zrc2'), '/b/v8n4zrc2/system-prompts/entry');
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
