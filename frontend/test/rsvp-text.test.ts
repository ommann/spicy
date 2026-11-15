import test from 'node:test';
import assert from 'node:assert/strict';
import { TextTokenizer } from '@rsvp-engine/core';
import { rsvpText } from '../src/rsvp-text.ts';

const words = (source: string) => new TextTokenizer().tokenize(rsvpText(source)).map(token => token.value);

test('inline Markdown preserves words and attached punctuation', () => {
  assert.equal(rsvpText('An **important** word, read**able**, *really*!'), 'An important word, readable, really!');
  assert.deepEqual(words('An **important** word, read**able**, *really*!'), ['An', 'important', 'word,', 'readable,', 'really!']);
});

test('links and images retain labels, not URLs or formatting', () => {
  assert.equal(rsvpText('See [the **guide**](https://example.com "Title"), ![a diagram](image.png).'), 'See the guide, a diagram.');
  assert.equal(rsvpText('[reference][id].\n\n[id]: https://example.com'), 'reference.');
});

test('block structure separates prose without Markdown markers', () => {
  assert.deepEqual(words('# Heading\n\n> Some **quoted** text.\n\n- First item\n- Second item\n\n---\n\nEnd.'), ['Heading', 'Some', 'quoted', 'text.', 'First', 'item', 'Second', 'item', 'End.']);
  assert.deepEqual(words('| Name | Value |\n| --- | --- |\n| **Hello** | World |'), ['Name', 'Value', 'Hello', 'World']);
});

test('code retains literal content without fences or inline backticks', () => {
  assert.equal(rsvpText('Use `**literal**` here.'), 'Use **literal** here.');
  assert.equal(rsvpText('```ts\nconst value = 1;\n```'), 'const value = 1;');
});

test('inline HTML does not split words or leak tags', () => {
  assert.equal(rsvpText('read<em>able</em>, next<br>line'), 'readable, next\nline');
  assert.deepEqual(words(' \n\n---\n'), []);
});
