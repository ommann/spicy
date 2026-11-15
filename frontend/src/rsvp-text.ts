import { Lexer, type Token } from 'marked';
import { TextTokenizer } from '@rsvp-engine/core';
import { rsvpConfig, type RsvpConfig } from './rsvp-config.ts';

export type Emphasis = { bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean };
export type StyledRun = Emphasis & { text: string };

// Walk Markdown as data; inline formatting never introduces word boundaries.
function proseRuns(source: string): StyledRun[] {
  function walk(tokens: Token[], separator = '', style: Emphasis = {}): StyledRun[] {
    return tokens.flatMap((token, index): StyledRun[] => {
      const prefix = index && separator ? [{ text: separator }] : [];
      let runs: StyledRun[] = [];
      if (token.type === 'space' || token.type === 'hr' || token.type === 'br') runs = [{ text: '\n' }];
      else if (token.type === 'list') runs = token.items.flatMap((item: { tokens: Token[] }, i: number) => [...(i ? [{ text: '\n' }] : []), ...walk(item.tokens, '\n', style)]);
      else if (token.type === 'table') runs = [token.header, ...token.rows].flatMap((row, i) => [...(i ? [{ text: '\n' }] : []), ...row.flatMap((cell: { tokens: Token[] }, j: number) => [...(j ? [{ text: ' ' }] : []), ...walk(cell.tokens, '', style)])]);
      else if (token.type === 'html') runs = [{ text: token.block || /^<\/?(?:br|p|div|li|h[1-6])\b/i.test(token.raw) ? '\n' : '' }];
      else if ('tokens' in token && Array.isArray(token.tokens)) {
        const emphasis = { ...style };
        if (token.type === 'strong') emphasis.bold = true;
        if (token.type === 'em') emphasis.italic = true;
        if (token.type === 'del') emphasis.strike = true;
        runs = walk(token.tokens, token.type === 'blockquote' ? '\n' : '', emphasis);
      } else if ('text' in token && typeof token.text === 'string') runs = [{ ...style, ...(token.type === 'codespan' ? { code: true } : {}), text: token.text }];
      return [...prefix, ...runs];
    });
  }
  return walk(Lexer.lex(source), '\n');
}

export function rsvpText(source: string): string {
  return proseRuns(source).map(run => run.text).join('').trim();
}

export function rsvpTokens(source: string, config: Readonly<RsvpConfig> = rsvpConfig) {
  const runs = proseRuns(source);
  const text = runs.map(run => run.text).join('');
  let end = 0;
  const ranges = runs.map(run => {
    const start = end;
    end += run.text.length;
    return { ...run, start, end };
  });
  let cursor = 0;
  let rangeIndex = 0;
  const tokenizer = new TextTokenizer({
    sentenceDurationMultiplier: config.pacing === 'steady' ? 1 : config.sentenceMultiplier,
    clauseDurationMultiplier: config.pacing === 'steady' ? 1 : config.clauseMultiplier,
    dashDurationMultiplier: config.pacing === 'steady' ? 1 : config.dashMultiplier,
  });
  return tokenizer.tokenize(text).map(token => {
    const start = text.indexOf(token.value, cursor);
    cursor = start + token.value.length;
    while (rangeIndex < ranges.length && ranges[rangeIndex].end <= start) rangeIndex++;
    const emphasis: StyledRun[] = [];
    for (let i = rangeIndex; i < ranges.length && ranges[i].start < cursor; i++) {
      const run = ranges[i];
      const value = text.slice(Math.max(start, run.start), Math.min(cursor, run.end));
      if (value) emphasis.push({ text: value, bold: run.bold, italic: run.italic, strike: run.strike, ...(run.code ? { code: true } : {}) });
    }
    return { ...token, meta: { emphasis } };
  });
}
