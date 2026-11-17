import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseFileReference } from '../src/file-reference.ts';

test('recognizes filenames and relative or absolute paths', () => {
  for (const path of ['App.tsx', 'README.md', 'frontend/src/App.tsx', './src/app.ts', '../app.ts', '/tmp/app.ts', '.alibi.json']) {
    assert.deepEqual(parseFileReference(path), { path });
  }
});

test('extracts line numbers without changing the target path', () => {
  for (const suffix of [':120', ':120:8', ':120-135', ':120–135', '#L120', '#L120-L135']) {
    assert.deepEqual(parseFileReference(`src/App.tsx${suffix}`), { path: 'src/App.tsx', line: 120 });
  }
});

test('rejects URLs, commands, expressions, directories, and invalid lines', () => {
  for (const text of ['https://example.com/app.ts', 'file:///tmp/app.ts', 'mailto:a@b.com', 'someFunction()', 'npm test', 'cat app.ts', 'backend', 'src/', 'foo.bar()', 'foo[0].bar', 'a=b.ts', 'app.ts:0', 'app.ts:-1', 'app.ts:9007199254740992', 'app.ts:']) {
    assert.equal(parseFileReference(text), undefined, text);
  }
});
