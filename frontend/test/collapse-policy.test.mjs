import test from 'node:test';
import assert from 'node:assert/strict';
import { previewHeight, collapseDiffRows } from '../src/collapse-policy.mjs';

const row = (kind, n) => ({ kind, text: String(n) });

test('preview grows with content and respects viewport space', () => {
  assert.ok(previewHeight(1000, 20, 1000) > previewHeight(400, 20, 1000));
  assert.ok(previewHeight(100000, 20, 1000) <= 600);
  assert.ok(previewHeight(100000, 20, 600) <= 360);
});

test('sparse changes remain visible across a long diff', () => {
  const rows = Array.from({ length: 240 }, (_, i) => row([5, 60, 150, 230].includes(i) ? 'add' : 'context', i));
  const result = collapseDiffRows(rows, 30);
  for (const r of rows.filter(r => r.kind === 'add')) assert.ok(result.includes(r));
  assert.ok(result.some(r => r.kind === 'omitted'));
  assert.ok(result.length < rows.length);
});

test('large change regions share the preview with later changes', () => {
  const rows = Array.from({ length: 240 }, (_, i) => row((i >= 20 && i < 80) || i === 200 ? 'add' : 'context', i));
  const result = collapseDiffRows(rows, 30);
  assert.ok(result.includes(rows[20]));
  assert.ok(result.includes(rows[79]));
  assert.ok(result.includes(rows[200]));
  assert.ok(result.some(r => r.kind === 'omitted' && r.omittedKind === 'add'));
});

test('hidden additions and removals have separate markers', () => {
  const rows = [...Array.from({ length: 40 }, (_, i) => row('remove', i)), ...Array.from({ length: 40 }, (_, i) => row('add', i))];
  const result = collapseDiffRows(rows, 20);
  assert.ok(result.some(r => r.kind === 'omitted' && r.omittedKind === 'remove'));
  assert.ok(result.some(r => r.kind === 'omitted' && r.omittedKind === 'add'));
});

test('each omitted section must provide worthwhile savings on its own', () => {
  const rows = [...Array.from({ length: 4 }, (_, i) => row('remove', i)), ...Array.from({ length: 40 }, (_, i) => row('add', i))];
  const result = collapseDiffRows(rows, 10);
  for (const r of rows.slice(0, 4)) assert.ok(result.includes(r));
  for (const marker of result.filter(r => r.kind === 'omitted')) {
    assert.ok(Number.parseInt(marker.text, 10) - 1 >= 4);
  }
  assert.ok(result.some(r => r.kind === 'omitted' && r.omittedKind === 'add'));
});

test('small savings do not warrant a collapse control', () => {
  const rows = Array.from({ length: 11 }, (_, i) => row(i === 5 ? 'add' : 'context', i));
  assert.equal(collapseDiffRows(rows, 10), rows);
});
