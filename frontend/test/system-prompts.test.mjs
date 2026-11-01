import test from 'node:test';
import assert from 'node:assert/strict';
import { createSystemPromptCatalog } from '../src/lilim/system-prompts.js';

const entries = [
  { id: 'original', parentId: null, type: 'message', message: { role: 'system', content: 'Original instructions', sections: { tools: 'Original tools' } } },
  { id: 'user', parentId: 'original', type: 'message', message: { role: 'user', content: 'Hello' } },
  { id: 'delta', parentId: 'user', type: 'message', message: { role: 'system', sections: { tools: 'New tools' } } },
  { id: 'same', parentId: 'delta', type: 'message', message: { role: 'system', sections: { tools: 'New tools' } } },
  { id: 'sibling', parentId: 'user', type: 'message', message: { role: 'system', sections: { tools: 'Other tools' } } },
];

test('prompt versions have stable numbers across branches and reuse identical states', () => {
  const catalog = createSystemPromptCatalog(entries);
  assert.deepEqual(catalog.versions.map(version => version.number), [1, 2, 3]);
  assert.deepEqual(catalog.versions.map(version => version.previousNumber), [undefined, 1, 1]);
  assert.equal(catalog.versions[0].detail.message.content, 'Original instructions');
  assert.equal(catalog.versions[1].detail.prefixPreview, true);
  assert.equal(catalog.versions[1].detail.prefixDiff[0].name, 'sections.tools');
  assert.deepEqual(createSystemPromptCatalog(entries).versions, catalog.versions);
});

test('compaction checkpoints are available as numbered prompt states', () => {
  const catalog = createSystemPromptCatalog([...entries, {
    id: 'checkpoint', parentId: 'delta', type: 'compaction',
    systemMessage: { role: 'system', content: 'Checkpoint instructions' },
  }]);
  assert.equal(catalog.versions.length, 4);
  assert.equal(catalog.versions[3].previousNumber, 2);
  assert.equal(catalog.versions[3].detail.message.role, 'system');
});
