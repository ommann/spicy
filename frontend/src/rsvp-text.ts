import { Lexer, type Token } from 'marked';

// Walk Markdown as data: inline formatting must not introduce word boundaries.
export function rsvpText(source: string): string {
  function text(tokens: Token[], separator = ''): string {
    return tokens.map(token => {
      if (token.type === 'space' || token.type === 'hr' || token.type === 'br') return '\n';
      if (token.type === 'list') return token.items.map((item: { tokens: Token[] }) => text(item.tokens, '\n')).join('\n');
      if (token.type === 'table') return [token.header, ...token.rows].map(row => row.map((cell: { tokens: Token[] }) => text(cell.tokens)).join(' ')).join('\n');
      // HTML is markup, not prose. Keep a boundary for block elements only.
      if (token.type === 'html') return token.block || /^<\/?(?:br|p|div|li|h[1-6])\b/i.test(token.raw) ? '\n' : '';
      if ('tokens' in token && Array.isArray(token.tokens)) {
        return text(token.tokens, token.type === 'blockquote' ? '\n' : '');
      }
      if ('text' in token && typeof token.text === 'string') return token.text;
      return '';
    }).join(separator);
  }
  return text(Lexer.lex(source), '\n').trim();
}
