import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationGraph, layoutConversation, matchConversationLanes } from '../src/conversation-model.ts';
import { filterConversationBranches, followHiddenLeaves } from '../src/branch-visibility-model.ts';

const message = (id, parentId) => ({ id, parentId, type: 'message', message: { role: 'user', content: id } });
const entries = [message('shared', null), message('left', 'shared'), message('right', 'shared')];

test('cutting a column keeps shared cards and repacks only shown columns without changing recorded ancestry', () => {
  const graph = createConversationGraph(entries);
  const original = [...graph.nodes.values()].map(node => [node.id, node.first, node.last, node.parent?.id]);
  const shown = filterConversationBranches(graph, ['right']);
  assert.deepEqual(shown.ids, ['shared', 'right']);
  assert.deepEqual(shown.leaves.map(node => node.id), ['right']);
  assert.equal(shown.nodes.get('shared').parts, graph.nodes.get('shared').parts);
  assert.equal(shown.nodes.get('right').entry, graph.nodes.get('right').entry);
  assert.equal(shown.nodes.get('right').parent, shown.nodes.get('shared'));
  assert.deepEqual(shown.nodes.get('shared').children.map(node => node.id), ['right']);
  const layout = layoutConversation(shown, { width: 720, viewportWidth: 1200, viewportHeight: 800, lane: 0 });
  assert.deepEqual(layout.starts, [0]);
  assert.equal(layout.items.get('shared').span, 720);
  assert.equal(layout.items.has('left'), false);
  assert.deepEqual([...graph.nodes.values()].map(node => [node.id, node.first, node.last, node.parent?.id]), original);
  assert.equal(filterConversationBranches(graph, ['left', 'right']), graph);
});

test('either set can be empty without creating a fake chat or changing compaction parents', () => {
  const graph = createConversationGraph([...entries,
    { id: 'summary', parentId: null, type: 'compaction', summary: 'Independent root' },
  ]);
  const empty = filterConversationBranches(graph, []);
  assert.equal(empty.nodes.size, 0);
  assert.deepEqual(empty.leaves, []);
  const compacted = filterConversationBranches(graph, ['summary']);
  assert.deepEqual(compacted.ids, ['summary']);
  assert.equal(compacted.roots[0].entry.parentId, null);
  assert.equal(compacted.nodes.get('summary').parent, undefined);
});

test('hidden leaf IDs follow an existing column as it grows, not every branch sharing its old leaf', () => {
  const before = createConversationGraph(entries);
  const previous = matchConversationLanes(before);
  const after = createConversationGraph([...entries, message('continuation', 'right')]);
  const next = matchConversationLanes(after, previous);
  assert.deepEqual(followHiddenLeaves(['right'], previous, next), ['continuation']);
  const forked = createConversationGraph([...entries, message('fork-a', 'right'), message('fork-b', 'right')]);
  const forks = matchConversationLanes(forked, previous);
  const hidden = followHiddenLeaves(['right'], previous, forks);
  assert.equal(hidden.length, 1);
  assert.ok(['fork-a', 'fork-b'].includes(hidden[0]));
  const shown = filterConversationBranches(forked, forked.leaves.filter(leaf => !hidden.includes(leaf.id)).map(leaf => leaf.id));
  assert.equal(shown.nodes.has('right'), true, 'Shared old leaf remains needed by the shown fork');
});
