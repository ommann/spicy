import assert from 'node:assert/strict';
import test from 'node:test';
import { webReference } from '../src/web-reference.ts';

test('opens explicit web URLs and common bare domains', () => {
  assert.equal(webReference('https://example.com/a?q=1#b'), 'https://example.com/a?q=1#b');
  assert.equal(webReference('http://localhost:5174'), 'http://localhost:5174/');
  assert.equal(webReference('example.com'), 'https://example.com/');
  assert.equal(webReference('docs.example.org/path'), 'https://docs.example.org/path');
});

test('does not turn source paths or arbitrary code into web URLs', () => {
  for (const text of ['src/App.tsx:12', 'README.md', 'object.property', 'javascript:alert(1)', 'https://', 'some text']) {
    assert.equal(webReference(text), undefined, text);
  }
});
