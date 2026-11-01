import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightTokens } from '../src/syntax.mjs';

test('highlighting preserves source characters and indentation without generating HTML', () => {
  const text = '  const value = "<img src=x onerror=alert(1)>";\n\t// & < >\n';
  const tokens = highlightTokens(text, 'javascript');
  assert.equal(tokens.map(token => token.text).join(''), text);
  assert.ok(tokens.some(token => token.className.includes('hljs-keyword')));
});

test('unknown and unspecified languages remain plain text', () => {
  for (const language of [undefined, 'not-a-language']) {
    assert.deepEqual(highlightTokens('<script>alert(1)</script>', language), [
      { text: '<script>alert(1)</script>', className: '' },
    ]);
  }
});
