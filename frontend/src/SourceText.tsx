import { For, Show, createMemo, type JSX } from 'solid-js';
import { highlightTokens } from './syntax.mjs';
import ScrollArea from './ScrollArea';
import { createAnsiTokenizer } from './lilim/ansi.mjs';

export function AnsiText(props: { text: string }) {
  const runs = createMemo(() => createAnsiTokenizer()(props.text));

  return <For each={runs()}>{run => <span style={run.style as JSX.CSSProperties}>{run.text}</span>}</For>;
}

function HighlightedText(props: { text: string; language?: string }) {
  const tokens = createMemo(() => highlightTokens(props.text, props.language));

  return <Show when={!props.text.includes('\x1b')} fallback={<AnsiText text={props.text} />}>
    <For each={tokens()}>{token => <span class={token.className}>{token.text}</span>}</For>
  </Show>;
}

export default function SourceText(props: { text: string; language?: string }) {
  const chunks = createMemo(() => {
    if (props.language !== 'markdown') return [{ text: props.text, language: props.language }];

    const parts: { text: string; language?: string }[] = [];
    const fences = /(^[ \t]*)(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)(^[ \t]*\2[ \t]*(?:\n|$))/gm;
    let offset = 0;

    for (const match of props.text.matchAll(fences)) {
      parts.push({ text: props.text.slice(offset, match.index), language: 'markdown' });
      parts.push({ text: match[1] + match[2] + match[3] + '\n', language: 'markdown' });
      parts.push({ text: match[4], language: match[3].trim().split(/\s+/)[0] || undefined });
      parts.push({ text: match[5], language: 'markdown' });
      offset = match.index! + match[0].length;
    }
    parts.push({ text: props.text.slice(offset), language: 'markdown' });

    return parts;
  });

  return <div class={`trace-text syntax-highlighted ${props.language === 'markdown' ? 'markdown-source' : props.language ? 'source-code' : ''}`}>
    <Show when={!props.text.includes('\x1b')} fallback={<AnsiText text={props.text} />}>
      <For each={chunks()}>{chunk => <Show when={props.language === 'markdown' && chunk.language !== 'markdown'}
        fallback={<HighlightedText text={chunk.text} language={chunk.language} />}>
        <ScrollArea contentClass="source-code"><HighlightedText text={chunk.text} language={chunk.language} /></ScrollArea>
      </Show>}</For>
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
