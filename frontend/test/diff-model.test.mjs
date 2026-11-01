import test from 'node:test';
import assert from 'node:assert/strict';
import { recordedEditDiff, emphasizeRows } from '../src/diff-model.mjs';

const patch = '--- src/demo.ts\n+++ src/demo.ts\n@@ -8,3 +8,3 @@\n const keep = true;\n-const value = 1;\n+const value = 2;\n done();\n';

test('recorded edit patches preserve actual old/new line numbers and context', () => {
  const [file] = recordedEditDiff({ patch }, 'ignored');
  assert.equal(file.name, 'src/demo.ts');
  const rows = file.hunks[0].rows;
  assert.deepEqual(rows.map(row => [row.kind, row.oldLine, row.newLine]), [
    ['context', 8, 8], ['remove', 9, undefined], ['add', undefined, 9], ['context', 10, 10],
  ]);
  const emphasized = emphasizeRows(rows);
  assert.deepEqual(emphasized[1].emphasis, [[14, 15]]);
  assert.deepEqual(emphasized[2].emphasis, [[14, 15]]);
});

test('legacy recorded edit display diffs remain readable without fabricating omitted lines', () => {
  const [file] = recordedEditDiff({ diff: '  8 keep\n- 9 before\n+ 9 after\n    ...' }, 'demo.ts');
  assert.equal(file.hunks[0].rows[1].text, 'before');
  assert.equal(file.hunks[0].rows[2].newLine, 9);
  assert.equal(file.hunks[0].rows[3].kind, 'meta');
  assert.deepEqual(recordedEditDiff({}, 'demo.ts'), []);
});

test('recordings without patch details show replacement fragments without invented file line numbers', () => {
  const [file] = recordedEditDiff({}, 'demo.ts', [{ oldText: 'before', newText: 'after' }]);
  assert.equal(file.hunks[0].label, 'Replacement 1');
  assert.deepEqual(file.hunks[0].rows.map(row => [row.kind, row.text]), [['remove', 'before'], ['add', 'after']]);
  assert.ok(file.hunks[0].rows.every(row => row.oldLine === undefined && row.newLine === undefined));
});

test('one-sided changes and literal markup stay intact', () => {
  const rows = [{ kind: 'add', text: '<script>alert(1)</script>', newLine: 1 }];
  assert.deepEqual(emphasizeRows(rows), [{ ...rows[0], emphasis: [] }]);
});
