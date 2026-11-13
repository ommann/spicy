import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationGraph } from '../src/conversation-model.ts';
import { layoutSingleConversation, singleConversationNodes } from '../src/single-conversation-model.ts';

const options = { width: 720, viewportWidth: 1200, viewportHeight: 800, lane: 0 };
const message = (id, parentId, text) => ({ id, parentId, type: 'message', message: { role: 'user', content: text } });

test('Single aligns cards and composer with equal small side gutters and still centers custom widths', () => {
  const graph = createConversationGraph([message('user', null, 'Hello')]);
  const fit = layoutSingleConversation(graph, { ...options, width: options.viewportWidth - 48 });
  assert.equal(fit.inset, 24);
  assert.equal(fit.width, options.viewportWidth);
  assert.equal(fit.items.get('user').left, 24);
  assert.equal(fit.items.get('user').top, 0);
  assert.equal(fit.promptTop, 0);
  assert.equal(fit.composers[0].left, 24);
  assert.equal(fit.width - fit.items.get('user').left - fit.items.get('user').span, 24);
  assert.equal(fit.hasHorizontal, false);
  const custom = layoutSingleConversation(graph, options);
  assert.equal(custom.inset, (options.viewportWidth - options.width) / 2);
  const wide = layoutSingleConversation(graph, { ...options, width: 1600 });
  assert.equal(wide.inset, 24);
  assert.equal(wide.width, 1648);
  assert.equal(wide.hasHorizontal, true);
});

test('Single lays out only selected ancestors, regardless of sibling measurements', () => {
  const graph = createConversationGraph([
    message('shared', null, 'Shared'), message('left', 'shared', 'Left'), message('right', 'shared', 'Right'),
  ]);
  // No full-graph node enumeration is needed for Single's geometry.
  graph.nodes.values = () => { throw new Error('Enumerated other branches'); };
  assert.deepEqual(singleConversationNodes(graph, 0).map(node => node.id), ['shared', 'left']);
  const left = layoutSingleConversation(graph, { ...options, heights: { shared: 100, left: 200, right: 10000 } });
  assert.deepEqual([...left.items.keys()], ['shared', 'left']);
  assert.equal(left.height, left.items.get('left').top + 200);
  assert.deepEqual(left.paths, []);
  const right = layoutSingleConversation(graph, { ...options, lane: 1, heights: { shared: 100, right: 300 } });
  assert.deepEqual([...right.items.keys()], ['shared', 'right']);
  assert.equal(right.items.get('shared').top, left.items.get('shared').top);
  assert.equal(right.items.get('right').column, 1);
});

test('Single keeps pending branches on their source ancestry without siblings', () => {
  const graph = createConversationGraph([
    message('shared', null, 'Shared'), message('left', 'shared', 'Left'), message('right', 'shared', 'Right'),
    { id: 'draft', parentId: 'shared', type: 'branch_draft', draftSourceId: 'left', draftAnchorId: 'right' },
  ]);
  const lane = graph.leaves.findIndex(node => node.id === 'draft');
  const layout = layoutSingleConversation(graph, { ...options, lane });
  assert.deepEqual([...layout.items.keys()], ['shared', 'draft']);
  assert.equal(layout.items.get('draft').height, 60);
  assert.equal(graph.raw.get('draft').parentId, 'shared');
});

test('Single respects independent compaction roots and their prompt row', () => {
  const graph = createConversationGraph([
    message('old', null, 'Old branch'),
    { id: 'summary', parentId: null, type: 'compaction', summary: 'Summary', sourceStartId: 'old', sourceEndId: 'old' },
    { id: 'prompt', parentId: 'summary', type: 'message', message: { role: 'system', content: 'Instructions', systemPromptSnapshot: true } },
  ]);
  const layout = layoutSingleConversation(graph, { ...options, lane: 1 });
  assert.deepEqual([...layout.items.keys()], ['summary', 'prompt']);
  assert.equal(layout.items.get('summary').top, 80);
  assert.equal(layout.items.get('prompt').hidden, true);
  assert.equal(graph.raw.get('summary').parentId, null);
  assert.deepEqual(graph.ancestors('prompt'), ['prompt', 'summary']);
});
