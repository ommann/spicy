import { For, Index, Match, Show, Switch, createMemo, useContext, type JSX } from 'solid-js';
import { highlightTokens, highlightHeredocTokens } from './syntax.mjs';
import ScrollArea from './ScrollArea';
import { createAnsiTokenizer } from './ansi.mjs';
import { Lexer, type Tokens } from 'marked';
import './markdown-table.css';
import { FileLinkCwdContext, fileLink } from './file-link';
import { showBoldSyntax, showItalicSyntax, showInlineCodeSyntax } from './formatting-syntax';

type SourceChunk = { text: string; language?: string; code?: boolean; table?: Tokens.Table };

function MarkdownTable(props: { table: Tokens.Table }) {
  return <ScrollArea><table class="markdown-table">
    <thead><tr><For each={props.table.header}>{cell => <th scope="col" style={{ 'text-align': cell.align || undefined }}>
      <MarkdownText text={cell.text} />
    </th>}</For></tr></thead>
    <tbody><For each={props.table.rows}>{row => <tr><For each={row}>{cell => <td style={{ 'text-align': cell.align || undefined }}>
      <MarkdownText text={cell.text} />
    </td>}</For></tr>}</For></tbody>
  </table></ScrollArea>;
}

export function AnsiText(props: { text: string }) {
  const runs = createMemo(() => createAnsiTokenizer()(props.text));

  return <For each={runs()}>{run => <span style={run.style as JSX.CSSProperties}>{run.text}</span>}</For>;
}

export function ShellCommand(props: { text: string }) {
  const tokens = createMemo(() => highlightHeredocTokens(props.text));
  return <span class="syntax-highlighted"><Show when={!props.text.includes('\x1b')} fallback={<AnsiText text={props.text} />}>
    <Index each={tokens()}>{token => <span class={token().className}>{token().text}</span>}</Index>
  </Show></span>;
}

function MarkdownText(props: { text: string }) {
  const cwd = useContext(FileLinkCwdContext);
  const tokens = createMemo(() => Lexer.lexInline(props.text));
  return <Index each={tokens()}>{token => <Switch fallback={<HighlightedText text={token().raw} language="markdown" />}>
    <Match when={token().type === 'link'}>
      <Show when={/^(https?:\/\/|mailto:|file:)/i.test((token() as Tokens.Link).href) || !/^[a-z][a-z\d+.-]*:/i.test((token() as Tokens.Link).href.trim())}
        fallback={<HighlightedText text={token().raw} language="markdown" />}>
        <a href={fileLink((token() as Tokens.Link).href, cwd())} target="_blank" rel="noopener noreferrer"
          title={(token() as Tokens.Link).title || undefined}>
          {(token() as Tokens.Link).text}
        </a>
      </Show>
    </Match>
    <Match when={token().type === 'strong'}>
      <strong><Show when={showBoldSyntax()}>{token().raw.slice(0, 2)}</Show>
        <MarkdownText text={(token() as Tokens.Strong).text} />
        <Show when={showBoldSyntax()}>{token().raw.slice(-2)}</Show>
      </strong>
    </Match>
    <Match when={token().type === 'em'}><em>
      <Show when={showItalicSyntax()}>{token().raw.slice(0, 1)}</Show>
      <MarkdownText text={(token() as Tokens.Em).text} />
      <Show when={showItalicSyntax()}>{token().raw.slice(-1)}</Show>
    </em></Match>
    <Match when={token().type === 'codespan'}><code style={{ color: 'var(--purple)', font: 'inherit' }}>
      <Show when={showInlineCodeSyntax()}>{token().raw.match(/^`+/)?.[0]}</Show>
      {(token() as Tokens.Codespan).text}
      <Show when={showInlineCodeSyntax()}>{token().raw.match(/^`+/)?.[0]}</Show>
    </code></Match>
  </Switch>}</Index>;
}

function HighlightedText(props: { text: string; language?: string }) {
  const tokens = createMemo(() => highlightTokens(props.text, props.language));

  return <Show when={!props.text.includes('\x1b')} fallback={<AnsiText text={props.text} />}>
    <Index each={tokens()}>{token => <span class={token().className}>{token().text}</span>}</Index>
  </Show>;
}

export default function SourceText(props: { text: string; language?: string }) {
  const chunks = createMemo(() => {
    if (props.language !== 'markdown') return [{ text: props.text, language: props.language }];

    const parts: SourceChunk[] = [];
    const fences = /(^[ \t]*)(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)(^[ \t]*\2[ \t]*(?:\n|$))/gm;
    let offset = 0;

    for (const match of props.text.matchAll(fences)) {
      parts.push({ text: props.text.slice(offset, match.index), language: 'markdown' });
      parts.push({ text: match[1] + match[2] + match[3] + '\n', language: 'markdown' });
      parts.push({ text: match[4], language: match[3].trim().split(/\s+/)[0] || undefined, code: true });
      parts.push({ text: match[5], language: 'markdown' });
      offset = match.index! + match[0].length;
    }
    parts.push({ text: props.text.slice(offset), language: 'markdown' });

    return parts.flatMap(part => {
      if (part.code || part.language !== 'markdown') return [part];
      const chunks: SourceChunk[] = [];
      let text = '';
      const flushText = () => {
        if (!text) return;
        // A block table already supplies the line break after its last row.
        chunks.push({ text: chunks.at(-1)?.table ? text.replace(/^\n/, '') : text, language: 'markdown' });
        text = '';
      };
      for (const token of Lexer.lex(part.text, { gfm: true })) {
        if (token.type === 'table') {
          flushText();
          chunks.push({ text: token.raw, table: token as Tokens.Table, language: 'markdown' });
        } else text += token.raw;
      }
      flushText();
      return chunks.some(chunk => chunk.table) ? chunks : [part];
    });
  });

  return <div class={`trace-text syntax-highlighted ${props.language === 'markdown' ? 'markdown-source' : props.language ? 'source-code' : ''}`}>
    <Show when={!props.text.includes('\x1b')} fallback={<AnsiText text={props.text} />}>
      <Index each={chunks()}>{chunk => <Show when={chunk().table} fallback={<Show when={props.language === 'markdown' && chunk().language !== 'markdown'}
        fallback={<Show when={props.language === 'markdown' && !chunk().code}
          fallback={<HighlightedText text={chunk().text} language={chunk().language} />}>
          <MarkdownText text={chunk().text} />
        </Show>}>
        <ScrollArea contentClass="source-code"><HighlightedText text={chunk().text} language={chunk().language} /></ScrollArea>
      </Show>}>
        {table => <MarkdownTable table={table()} />}
      </Show>}</Index>
    </Show>
  </div>;
}

export function TerminalText(props: {
  text: string;
  language?: string;
  class?: string;
  part?: string;
  ref?: (element: HTMLPreElement) => void;
}) {
  return <ScrollArea class="terminal-scroll-area" vertical><pre class={props.class} classList={{ 'syntax-highlighted': !!props.language && !props.text.includes('\x1b') }}
    data-language={props.language} data-codemode-part={props.part} ref={props.ref}>
    <Show when={props.language} fallback={<AnsiText text={props.text} />}>
      <HighlightedText text={props.text} language={props.language} />
    </Show>
  </pre></ScrollArea>;
}
