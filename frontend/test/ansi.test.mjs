import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnsiTokenizer } from '../src/ansi.mjs';

test('grep output preserves bold red and strips erase-line controls', () => {
  const runs = createAnsiTokenizer()('before \x1b[01;31m\x1b[Kneedle\x1b[m\x1b[K after\n');
  assert.deepEqual(runs, [
    { text: 'before ', style: {} },
    { text: 'needle', style: { color: 'var(--ansi-red)', 'font-weight': '700' } },
    { text: ' after\n', style: {} },
  ]);
});

test('CLI logs preserve green, yellow and bold with resets', () => {
  const runs = createAnsiTokenizer()('\x1b[32m[INFO]\x1b[0m ready\n\x1b[1;33m[WARN]\x1b[0m warning');
  assert.deepEqual(runs, [
    { text: '[INFO]', style: { color: 'var(--ansi-green)' } },
    { text: ' ready\n', style: {} },
    { text: '[WARN]', style: { color: 'var(--ansi-yellow)', 'font-weight': '700' } },
    { text: ' warning', style: {} },
  ]);
});
