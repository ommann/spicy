import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDiscussionTitle } from '../../packages/coding-agent/src/core/discussion-title.ts';
import register from '../tree-navigation.ts';

const title = (value, isError = false) => ({ type: 'message', message: {
  role: 'toolResult', toolName: 'set_title', isError, details: { title: value },
} });
test('latest successful title wins; compaction carries it forward', () => {
  assert.equal(getDiscussionTitle([]), undefined);
  assert.equal(getDiscussionTitle([title('one'), title('bad', true)]), 'one');
  const compact = { type: 'compaction', details: { inheritedTitle: 'one' } };
  assert.equal(getDiscussionTitle([compact]), 'one');
  assert.equal(getDiscussionTitle([compact, title('two')]), 'two');
  assert.equal(getDiscussionTitle([compact, title('other branch')].slice(0, 1)), 'one');
});
test('tools validate titles and read only current ancestry', async () => {
  const tools = {};
  register({ on() {}, registerCommand() {}, registerTool(tool) { tools[tool.name] = tool; } });
  await assert.rejects(() => tools.set_title.execute('id', { title: '  ' }));
  const result = await tools.set_title.execute('id', { title: ' topic ' });
  assert.equal(result.details.title, 'topic');
  const read = await tools.get_title.execute('id', {}, null, null, {
    sessionManager: { getBranch: () => [title('branch')] },
  });
  assert.equal(read.details.title, 'branch');
});
