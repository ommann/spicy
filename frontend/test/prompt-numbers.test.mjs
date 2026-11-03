import test from 'node:test';
import assert from 'node:assert/strict';
import { promptLabel } from '../src/prompt-numbers.ts';
import { createSystemPromptCatalog } from '../src/lilim/system-prompts.js';

test('prompt labels use compact numbers and optional names', () => {
  assert.equal(promptLabel(1), '#1');
  assert.equal(promptLabel(2, 'My prompt'), '#2 - My prompt');
  assert.equal(promptLabel(3, ''), '#3');
});

test('legacy saved numbers do not affect derived labels or prompt identities', () => {
  const entries = [
    { id: 'first', systemPromptKey: 'first', parentId: null, number: 1,
      message: { role: 'system', content: 'First prompt' } },
    { id: 'named', systemPromptKey: 'named', parentId: null, number: 4,
      message: { role: 'system', content: 'Saved prompt' } },
  ];
  const catalog = createSystemPromptCatalog(entries);
  assert.deepEqual(catalog.versions.map(version => [version.key, version.number, version.full.id]),
    [['first', 1, 'first'], ['named', 2, 'named']]);
  assert.equal(entries[1].number, 4);
  const updated = createSystemPromptCatalog([
    entries[0],
    { id: 'recorded', parentId: 'first', message: { role: 'system', content: 'New recorded prompt' } },
    entries[1],
  ]);
  const saved = updated.versions.find(version => version.key === 'named');
  assert.equal(saved.number, 3);
  assert.equal(saved.full.id, 'named');
  assert.deepEqual(saved.full, catalog.versions[1].full);
});

test('separately saved prompts retain distinct identities even with identical content', () => {
  const catalog = createSystemPromptCatalog(['one', 'two'].map(id => ({
    id, systemPromptKey: id, parentId: null, message: { role: 'system', content: 'Same instructions' },
  })));
  assert.deepEqual(catalog.versions.map(version => [version.key, version.number]), [['one', 1], ['two', 2]]);
});
