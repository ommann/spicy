import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrefixResolver } from '../src/lilim/prefix-state.js';
import { createSystemPromptCatalog, systemPromptText } from '../src/system-prompts.js';

test('tool-schema changes create a displayed prompt version and reference number', () => {
  const entries = [
    { id: 'a', parentId: null, type: 'message', message: { role: 'system', content: 'Same prompt', toolsAdded: [{ name: 'read', description: 'Old' }] } },
    { id: 'b', parentId: 'a', type: 'message', message: { role: 'system', toolsAdded: [{ name: 'read', description: 'New' }] } },
    { id: 'c', parentId: 'b', type: 'message', message: { role: 'system', content: 'Changed prompt' } },
  ];
  const catalog = createSystemPromptCatalog(entries);
  const prefix = createPrefixResolver(entries);
  assert.equal(catalog.versions.length, 3);
  assert.equal(catalog.numberFor(prefix.get('a')), 1);
  assert.equal(catalog.numberFor(prefix.get('b')), 2);
  assert.equal(catalog.numberFor(prefix.get('c')), 3);
  assert.equal(catalog.versions[1].previousNumber, 1);
  assert.equal(catalog.versions[2].previousNumber, 2);
  const rows = catalog.versions[1].unified.prefixDiff[0].hunks[0].rows;
  assert.ok(rows.some(row => row.kind === 'remove' && row.text.includes('Old')));
  assert.ok(rows.some(row => row.kind === 'add' && row.text.includes('New')));
});

test('prompt text includes ordered instructions and complete tool schemas', () => {
  assert.equal(systemPromptText({ content: '', sections: new Map([
    ['preamble', 'Instructions'], ['rules', '<rules>\nDo this\n</rules>'],
  ]), tools: new Map([['secret', { name: 'secret' }]]) }), 'Instructions\n\n<rules>\nDo this\n</rules>\n\n## Tool definitions\n\n[\n  {\n    "name": "secret"\n  }\n]');
});

test('prompt versions diff one complete document with continuous numbered blank lines', () => {
  const catalog = createSystemPromptCatalog([
    { id: 'a', parentId: null, type: 'message', message: { role: 'system', content: '', sections: {
      preamble: 'Instructions', rules: '<rules>\nBefore\n</rules>',
    }, toolsAdded: [{ name: 'not-prompt-text', description: 'API schema' }] } },
    { id: 'b', parentId: 'a', type: 'message', message: { role: 'system', sections: { rules: '<rules>\nAfter\n</rules>' } } },
  ]);
  const files = catalog.versions[1].unified.prefixDiff;
  assert.equal(files.length, 1);
  const rows = files[0].hunks[0].rows;
  assert.deepEqual(rows.slice(0, 6).map(row => [row.kind, row.text]), [
    ['context', 'Instructions'], ['context', ''], ['context', '<rules>'],
    ['remove', 'Before'], ['add', 'After'], ['context', '</rules>'],
  ]);
  assert.equal(rows[1].newLine, 2);
  assert.equal(rows[5].newLine, 5);
  assert.match(JSON.stringify(rows), /not-prompt-text/);
  assert.match(JSON.stringify(rows), /API schema/);
});
