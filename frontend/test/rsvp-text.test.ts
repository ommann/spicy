import { test } from 'vitest';
import assert from 'node:assert/strict';
import { TextTokenizer } from '@rsvp-engine/core';
import { rsvpText, rsvpTokens } from '../src/rsvp-text.ts';
import { rsvpConfig } from '../src/rsvp-config.ts';

test('emphasis survives tokenization without changing words or rhythm', () => {
  const source = 'Read**able**, ***both*** and ~~gone~~. `**literal**`';
  const tokens = rsvpTokens(source);
  assert.deepEqual(tokens.map(({ meta, ...token }) => token), new TextTokenizer().tokenize(rsvpText(source)));
  assert.deepEqual(tokens[0].meta.emphasis, [
    { text: 'Read', bold: undefined, italic: undefined, strike: undefined },
    { text: 'able', bold: true, italic: undefined, strike: undefined },
    { text: ',', bold: undefined, italic: undefined, strike: undefined },
  ]);
  assert.ok(tokens.some(token => token.meta.emphasis.some(run => run.bold && run.italic)));
  assert.ok(tokens.some(token => token.meta.emphasis.some(run => run.strike)));
  assert.equal(tokens.map(token => token.meta.emphasis.map(run => run.text).join('')).join(' '), tokens.map(token => token.value).join(' '));
  assert.ok(tokens.filter(token => token.value.includes('literal')).every(token => token.meta.emphasis.every(run => !run.bold)));
});

test('pacing configuration changes duration, not words or emphasis', () => {
  const source = '**Hello**, world! Wait— next';
  const natural = rsvpTokens(source);
  const steady = rsvpTokens(source, { ...rsvpConfig, pacing: 'steady' });
  assert.ok(natural.some(token => token.durationMultiplier > 1));
  assert.ok(steady.every(token => token.durationMultiplier === 1));
  assert.deepEqual(steady.map(({ durationMultiplier, ...token }) => token), natural.map(({ durationMultiplier, ...token }) => token));
  const tuned = rsvpTokens(source, { ...rsvpConfig, sentenceMultiplier: 3, clauseMultiplier: 2, dashMultiplier: 1.7 });
  assert.equal(tuned.find(token => token.value === 'Hello,')?.durationMultiplier, 2);
  assert.equal(tuned.find(token => token.value === 'world!')?.durationMultiplier, 3);
});

const words = (source: string) => new TextTokenizer().tokenize(rsvpText(source)).map(token => token.value);

test('inline code retains the chat code emphasis', () => {
  const tokens = rsvpTokens('Done—two direct `bash` tool calls: A simple `printf`.');
  for (const value of ['bash', 'printf']) {
    const token = tokens.find(token => token.value.startsWith(value));
    assert.ok(token);
    assert.equal(token.meta.emphasis.find(run => run.text === value)?.code, true);
  }
  const plain = tokens.find(token => token.value === 'simple');
  assert.ok(plain?.meta.emphasis.every(run => !run.code));
  const punctuation = tokens.find(token => token.value === 'printf.');
  assert.equal(punctuation?.meta.emphasis.at(-1)?.code, undefined);
});

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
