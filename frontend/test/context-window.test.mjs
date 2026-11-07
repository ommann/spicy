import test from 'node:test';
import assert from 'node:assert/strict';
import { formatContextWindow } from '../src/context-window.ts';

test('context window uses percentage and compact capacity', () => {
  assert.equal(formatContextWindow({ percent: 8.3, contextWindow: 500_000 }), '8.3%/500k');
  assert.equal(formatContextWindow({ percent: 0, contextWindow: 1_000_000 }), '0.0%/1m');
  assert.equal(formatContextWindow({ percent: 12.345, contextWindow: 128_000 }), '12.3%/128k');
});

test('unknown usage is not shown as zero; missing capacity hides the hint', () => {
  assert.equal(formatContextWindow({ percent: null, contextWindow: 500_000 }), '?/500k');
  assert.equal(formatContextWindow(), '');
  assert.equal(formatContextWindow({ percent: 0, contextWindow: 0 }), '');
});
