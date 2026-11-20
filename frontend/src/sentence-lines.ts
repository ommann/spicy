import { Lexer, type Token, type Tokens } from 'marked';

const sentences = new Intl.Segmenter(undefined, { granularity: 'sentence' });

// Preserve source offsets while hiding punctuation that isn't prose. Represent
// closing emphasis markers as closing quotes so they stay with their sentence.
function sentenceInput(tokens: Token[]): string {
  return tokens.map(token => {
    switch (token.type) {
      case 'strong':
      case 'em':
      case 'del': {
        const { raw, text, tokens } = token as Tokens.Strong | Tokens.Em | Tokens.Del;
        const width = (raw.length - text.length) / 2;
        return '('.repeat(width) + sentenceInput(tokens) + ')'.repeat(width);
      }
      case 'codespan':
      case 'link':
      case 'image':
      case 'html':
        return 'x'.repeat(token.raw.length);
      default:
        return token.raw;
    }
  }).join('');
}

function formatParagraph({ raw, text, tokens }: Tokens.Paragraph) {
  const input = sentenceInput(tokens);
  if (input.length !== text.length) return raw;

  const breaks = new Set<number>();
  for (const { index, segment } of sentences.segment(input.replace(/\n/g, ' '))) {
    if (index + segment.length < input.length) {
      breaks.add(index + segment.trimEnd().length);
    }
  }
  // Keep explicit Markdown hard breaks and whitespace inside atomic inlines.
  return text.replace(/[ \t]*\n[ \t]*|[ \t]+/g, (space, offset: number) => {
    if (!/^\s+$/.test(input.slice(offset, offset + space.length))) return space;
    if (/ {2,}\n/.test(space) || (space.includes('\n') && text[offset - 1] === '\\')) return space;
    if (breaks.has(offset)) return '\n';
    return space.includes('\n') ? ' ' : space;
  }) + raw.slice(text.length);
}

export function sentenceLines(source: string): string {
  const blocks = Lexer.lex(source, { gfm: true });
  return blocks.map((block, index) => {
    if (block.type === 'paragraph') return formatParagraph(block as Tokens.Paragraph);
    if (block.type === 'space' && blocks[index - 1]?.type === 'paragraph' && blocks[index + 1]?.type === 'paragraph') return '\n\n';
    return block.raw;
  }).join('');
}
