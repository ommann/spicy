import { expect, test } from 'vitest';
import { sentenceLines } from '../src/sentence-lines';

test('puts prose sentences on separate lines, with one blank line between paragraphs', () => {
  expect(sentenceLines('The first\nsentence wraps. The second follows.\n\n\nThe next paragraph. It continues.'))
    .toBe('The first sentence wraps.\nThe second follows.\n\nThe next paragraph.\nIt continues.');
});

test('keeps inline Markdown, including sentence-final emphasis and punctuation inside code', () => {
  expect(sentenceLines('**The first ends here.** The next uses `a. B` and [a link](https://example.org). *The last one.*'))
    .toBe('**The first ends here.**\nThe next uses `a. B` and [a link](https://example.org).\n*The last one.*');
});

test('retains structural Markdown and explicit hard breaks', () => {
  const structure = '# A heading. Not prose.\n\n- One item. Still the same item.\n\n```txt\nKeep this. On one line.\n```';
  expect(sentenceLines(`${structure}\n\nKeep this hard break.  \nThen split. And finish.`))
    .toBe(`${structure}\n\nKeep this hard break.  \nThen split.\nAnd finish.`);
});
