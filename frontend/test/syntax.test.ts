import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightTokens, highlightHeredocTokens } from '../src/syntax.ts';

test('highlighting preserves source characters and indentation without generating HTML', () => {
  const text = '  const value = "<img src=x onerror=alert(1)>";\n\t// & < >\n';
  const tokens = highlightTokens(text, 'javascript');
  assert.equal(tokens.map(token => token.text).join(''), text);
  assert.ok(tokens.some(token => token.className.includes('hljs-keyword')));
});

test('heredoc bodies use interpreter highlighting and preserve the full command', () => {
  for (const text of [
    "node <<'JS'\nconst value = /hello/;\nJS\n",
    'python3 <<PY\nfrom pathlib import Path\nPY\n',
    'node --input-type=module <<-"JS"\n\tconst value = 1;\n\tJS\n',
    "echo before; node <<'JS'\nconst value = 1;\nJS\necho after\n",
  ]) {
    const tokens = highlightHeredocTokens(text);
    assert.equal(tokens.map(token => token.text).join(''), text);
    assert.ok(tokens.some(token => token.className.includes('hljs-keyword')));
  }
});

test('incomplete and ambiguous heredocs retain shell highlighting', () => {
  for (const text of ["node <<'JS'\nconst x = 1;\n", 'cat <<EOF\nhello\nEOF\n', 'node <<A <<B\nhello\nA\nB\n']) {
    assert.deepEqual(highlightHeredocTokens(text), highlightTokens(text, 'bash'));
  }
});

test('unknown and unspecified languages remain plain text', () => {
  for (const language of [undefined, 'not-a-language']) {
    assert.deepEqual(highlightTokens('<script>alert(1)</script>', language), [
      { text: '<script>alert(1)</script>', className: '' },
    ]);
  }
});
