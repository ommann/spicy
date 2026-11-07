import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup, onMount, useContext, type JSX } from 'solid-js';
import { ImageContext, SectionContext } from './conversation-dom';
import CollapseToggle from './CollapseToggle';
import DiffView from './DiffView';
import { recordedEditDiff } from './diff-model.mjs';
import { Dynamic } from 'solid-js/web';
import SourceText, { AnsiText, TerminalText } from './SourceText';
import { createAnsiTokenizer } from './ansi.mjs';
import { projectChatParts } from './conversation-model.mjs';
import type { Wire } from './types';
import { selectSource } from './source-selection';
import { partialCommand } from './partial-command.mjs';

function Images(props: { blocks: Wire[]; caption?: string }) {
  const open = useContext(ImageContext);
  const images = () => (props.blocks || []).filter(block => block.type === 'image' && block.data && /^image\/(png|jpeg|jpg|gif|webp)$/.test(block.mimeType));

  return <For each={images()}>{image => <img class="trace-image" src={`data:${image.mimeType};base64,${image.data}`}
    alt={props.caption || 'Image from Pi session'} loading="lazy" tabIndex={0} role="button" aria-label="Open image preview"
    onClick={event => open?.({ src: `data:${image.mimeType};base64,${image.data}`, alt: props.caption || 'Image from Pi session', caption: props.caption || '', opener: event.currentTarget })}
    onKeyDown={event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      open?.({ src: `data:${image.mimeType};base64,${image.data}`, alt: props.caption || 'Image from Pi session', caption: props.caption || '', opener: event.currentTarget });
    }} />}</For>;
}

function MessageBody(props: { content: string | Wire[] }) {
  return <Show when={typeof props.content === 'string'} fallback={
    <For each={Array.isArray(props.content) ? props.content : []}>{block => <>
      <Show when={block.type === 'text'}><SourceText text={block.text || ''} language="markdown" /></Show>
      <Show when={block.type === 'image'}><Images blocks={[block]} /></Show>
    </>}</For>
  }><SourceText text={props.content as string} language="markdown" /></Show>;
}

function Thinking(props: { text: string }) {
  const parts = createMemo(() => {
    const tokenize = createAnsiTokenizer();

    return props.text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|^#{1,6} [^\n]+)/gm).map(part => {
      let tag = 'span';
      let value = part;

      if (part.startsWith('`') && part.endsWith('`')) { tag = 'code'; value = part.slice(1, -1); }
      else if (part.startsWith('**') && part.endsWith('**')) { tag = 'strong'; value = part.slice(2, -2); }
      else if (/^#{1,6} /.test(part)) { tag = 'strong'; value = part.replace(/^#{1,6} /, ''); }

      return { tag, runs: tokenize(value) };
    });
  });

  return <div class="thinking-text"><For each={parts()}>{part => <Dynamic component={part.tag}>
    <For each={part.runs}>{run => <span style={run.style as JSX.CSSProperties}>{run.text}</span>}</For>
  </Dynamic>}</For></div>;
}

function CodePreview(props: { text: string; language?: string; part: string; limit: number; expanded: boolean; onToggle: () => void }) {
  let pre!: HTMLPreElement;
  const [visualLines, setVisualLines] = createSignal(0);
  const lines = () => Math.max(props.text.split('\n').length, visualLines());

  function measure() {
    if (!pre.isConnected) return;

    const lineHeight = parseFloat(getComputedStyle(pre).lineHeight) || 20;
    setVisualLines(Math.ceil(pre.scrollHeight / lineHeight));
  }

  createEffect(on(() => props.text, measure));

  onMount(() => {
    const observer = new ResizeObserver(measure);
    observer.observe(pre);
    onCleanup(() => observer.disconnect());
  });

  return <>
    <TerminalText ref={element => { pre = element; }} text={props.text} language={props.language}
      class={`codemode-preview ${props.part === 'code' ? 'codemode-code' : ''}`} part={props.part} />
    <Show when={lines() > props.limit}>
      <CollapseToggle label={`Expand or collapse codemode ${props.part}`} expanded={props.expanded} onToggle={props.onToggle} />
    </Show>
  </>;
}

const formatCost = (cost: number) => `$${cost >= .01 ? cost.toFixed(2) : cost.toPrecision(2)}`;
const icons: Record<string, string> = { running: '…', pending: '…', ok: '✓', error: '✗', cancelled: '⊘' };

export interface ExpansionRequest { revision: number; open: boolean }

function CodemodeTool(props: { call: Wire; result?: Wire; entryId: string; expandRequest?: ExpansionRequest }) {
  const [expanded, setExpanded] = createSignal(false);

  createEffect(on(() => props.expandRequest, value => { if (value) setExpanded(value.open); }));
  const toggle = () => setExpanded(value => !value);
  const code = () => typeof props.call.arguments === 'string' ? props.call.arguments : props.call.arguments?.code || '';
  const calls = () => props.result?.details?.calls || props.result?.nestedCalls?.calls || [];
  const blocks = () => props.result?.content || [];
  const priced = () => calls().filter((call: Wire) => call.cost);
  const output = createMemo(() => {
    const first = blocks()[0];
    const header = first?.type === 'text' && /^Script (completed|failed)\nWall time [\d.]+ seconds\nOutput:\n$/.test(first.text);

    return (header ? blocks().slice(1) : blocks()).filter((block: Wire) => block.type === 'text').map((block: Wire) => block.text).join('\n');
  });

  return <section ref={useContext(SectionContext)} class="tool codemode-tool" classList={{ 'tool-error': !!props.result?.isError, 'codemode-expanded': expanded() }} data-entry-id={props.entryId}>
    <div class="tool-title"><strong>codemode</strong></div>
    <Show when={code()}>
      <CodePreview text={code().replace(/\r/g, '').trimEnd()} language="javascript" part="code" limit={10} expanded={expanded()} onToggle={toggle} />
    </Show>
    <Show when={calls().length}>
      <div class="codemode-calls">
        <Show when={calls().length > 8}>
          <CollapseToggle label="Expand or collapse codemode calls" expanded={expanded()} onToggle={toggle} />
        </Show>
        <For each={calls()}>{(call, index) => {
          const args = () => typeof call.args === 'string' ? call.args : JSON.stringify(call.arguments || {});
          const statusClass = () => call.status === 'error' ? 'nested-error' : call.status === 'running' ? 'nested-running'
            : call.status === 'cancelled' ? 'nested-duration' : 'nested-success';

          return <>
            <div class="codemode-call" hidden={!expanded() && index() < calls().length - 8}>
              <span class={statusClass()}>{(icons[call.status] || '✓') + ' '}</span>
              <span class="nested-name">{call.name}</span>
              <span class="nested-args">{args() ? ' ' + (!expanded() && args().length > 80 ? args().slice(0, 77) + '...' : args()) : ''}</span>
              <Show when={typeof call.durationMs === 'number'}>
                <span class="nested-duration">{` ${call.durationMs < 1000 ? Math.round(call.durationMs) + 'ms' : (call.durationMs / 1000).toFixed(1) + 's'}`}</span>
              </Show>
              <Show when={call.cost}><span class="nested-duration">{` ${formatCost(call.cost)}`}</span></Show>
            </div>
            <pre class="nested-error nested-error-detail" hidden={!expanded() || !call.error}>{call.error ? '    ' + call.error.split('\n').join('\n    ') : ''}</pre>
          </>;
        }}</For>
        <Show when={priced().length > 1}>
          <div class="nested-duration">{`Model calls: ${formatCost(priced().reduce((sum: number, call: Wire) => sum + call.cost, 0))}`}</div>
        </Show>
      </div>
    </Show>
    <Show when={output() || !props.result}>
      <div class="codemode-output">
        <CodePreview text={props.result ? output() : 'No result recorded in this branch.'} part="output" limit={5} expanded={expanded()} onToggle={toggle} />
        <Show when={props.result?.details?.fullOutputPath && !expanded()}>
          <div class="nested-duration">{`Full output: ${props.result?.details?.fullOutputPath}`}</div>
        </Show>
      </div>
    </Show>
    <Images blocks={blocks()} />
  </section>;
}

const languages: Record<string, string> = { kt: 'kotlin', kts: 'kotlin', js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript', py: 'python', rs: 'rust', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', json: 'json', sh: 'bash', nix: 'nix', css: 'css', html: 'xml', xml: 'xml', yaml: 'yaml', yml: 'yaml', md: 'markdown', toml: 'ini', cmake: 'cmake' };

function Tool(props: { call: Wire; result?: Wire; entryId: string; expandRequest?: ExpansionRequest }) {
  const [expanded, setExpanded] = createSignal(false);

  createEffect(on(() => props.expandRequest, value => { if (value) setExpanded(value.open); }));
  const args = () => props.call.arguments || {};
  const isBash = () => /(^|[._])bash$/.test(props.call.name);
  const label = () => {
    if (isBash() && typeof args().command !== 'string') return partialCommand(props.call.partial);
    const value = args().path || args().command || args().url || args();
    return typeof value === 'string' ? value : JSON.stringify(value);
  };
  const compactRead = () => props.call.name === 'read' && props.result && !props.result.isError;
  const imageRead = () => props.call.name === 'read' && (props.result?.content || []).some((block: Wire) => block.type === 'image');
  const output = () => props.call.name === 'write' && typeof args().content === 'string'
    ? [{ type: 'text', text: args().content }] : props.result?.content || [{ type: 'text', text: 'No result recorded in this branch.' }];
  const text = () => output().filter((block: Wire) => block.type === 'text').map((block: Wire) => block.text).join('');
  const editDiff = createMemo(() => props.call.name === 'edit' && props.result && !props.result.isError
    ? recordedEditDiff(props.result.details, args().path, args().edits || (typeof args().oldText === 'string' ? [args()] : [])) : []);
  const lines = () => editDiff().length
    ? editDiff().reduce((count: number, file: Wire) => count + file.hunks.reduce((sum: number, hunk: Wire) => sum + hunk.rows.length, 0), 0)
    : text().split('\n').length;
  const language = () => languages[args().path?.split('.').at(-1)?.toLowerCase()];
  const openImage = useContext(ImageContext);
  function preview(opener: HTMLElement) {
    const image = output().find((block: Wire) => block.type === 'image' && block.data && /^image\/(png|jpeg|jpg|gif|webp)$/.test(block.mimeType));
    if (image) openImage?.({ src: `data:${image.mimeType};base64,${image.data}`, alt: label(), caption: args().path || '', opener });
  }

  return <section ref={useContext(SectionContext)} class="tool" classList={{ 'tool-error': !!props.result?.isError, 'compact-read': !!compactRead(), 'bash-tool': isBash() }} data-entry-id={props.entryId}>
    <div class="tool-title" classList={{ 'image-read-link': imageRead() }} tabIndex={imageRead() ? 0 : undefined}
      onClick={event => { if (imageRead()) preview(event.currentTarget); }}
      onKeyDown={event => {
        if (imageRead() && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); preview(event.currentTarget); }
      }}
      role={imageRead() ? 'button' : undefined} aria-label={imageRead() ? `Open image: ${props.call.name} ${label()}` : undefined}>
      <Show when={!isBash()}><strong>{props.call.name}</strong></Show><span class={args().path ? 'path' : 'tool-arguments'}
        onDblClick={event => { if (isBash()) { event.preventDefault(); selectSource(event.currentTarget); } }}><AnsiText text={label()} /></span>
      <Show when={args().offset}><span class="range">{`:${args().offset}${args().limit ? `-${args().offset + args().limit - 1}` : ''}`}</span></Show>
    </div>
    <Show when={!compactRead()}>
      <div class="tool-body" classList={{ 'output-collapsed': lines() > 10 && !expanded() }}>
        <Show when={editDiff().length} fallback={
          <For each={output().filter((block: Wire) => block.type === 'text')}>{block =>
            <TerminalText text={block.text} language={props.call.name === 'read' || props.call.name === 'write' ? language() : undefined} />
          }</For>
        }><DiffView files={editDiff()} /></Show>
      </div>
      <Show when={lines() > 10}>
        <CollapseToggle expanded={expanded()} onToggle={() => setExpanded(value => !value)} />
      </Show>
    </Show>
    <Images blocks={props.result?.content || []} caption={args().path || ''} />
  </section>;
}

function ExpandableContent(props: { children: JSX.Element; measureKey: unknown; initialOpen?: boolean; expandRequest?: ExpansionRequest }) {
  const [expanded, setExpanded] = createSignal(!!props.initialOpen);
  const [height, setHeight] = createSignal(0);
  let body!: HTMLDivElement;

  function measure() {
    if (!body.isConnected) return;
    setHeight(body.scrollHeight);
  }

  createEffect(on(() => props.expandRequest, value => { if (value) setExpanded(value.open); }));
  createEffect(on(() => props.measureKey, measure));

  onMount(() => {
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    onCleanup(() => observer.disconnect());
  });


  return <>
    <div ref={body} class="chat-part-body" classList={{ 'part-open': expanded() }}
      onDblClick={event => {
        if ((event.target as Element).closest('button, input, textarea, a, img')) return;
        if (height() > 440) { event.preventDefault(); setExpanded(value => !value); }
      }}>{props.children}</div>
    <Show when={height() > 440}>
      <CollapseToggle class="part-expand" expanded={expanded()} onToggle={() => setExpanded(value => !value)} />
    </Show>
  </>;
}

export function ChatEntryPart(props: { part: Wire; expandRequest?: ExpansionRequest; onBranch?: (id: string) => void }) {
  const textBlocks = () => typeof props.part.content === 'string' ? props.part.content
    : (props.part.content || []).filter((block: Wire) => block.type === 'text');
  const responseBody = () => <Show when={props.part.kind === 'thinking'} fallback={props.part.eos ? props.part.text : <SourceText text={props.part.text} language="markdown" />}>
    <Thinking text={props.part.text} />
  </Show>;

  return <Switch>
    <Match when={props.part.kind === 'error'}>
      <section ref={useContext(SectionContext)} class="message real-message notification-error" role="alert" data-entry-id={props.part.entryId}>{props.part.text}</section>
    </Match>
    <Match when={props.part.kind === 'draft'}><section ref={useContext(SectionContext)} class="branch-draft" data-entry-id={props.part.entryId} /></Match>
    <Match when={props.part.kind === 'tool'}>
      <Show when={props.part.call.name === 'codemode' || props.part.call.name.endsWith('.codemode')}
        fallback={<Tool call={props.part.call} result={props.part.result} entryId={props.part.entryId} expandRequest={props.expandRequest} />}>
        <CodemodeTool call={props.part.call} result={props.part.result} entryId={props.part.entryId} expandRequest={props.expandRequest} />
      </Show>
    </Match>
    <Match when={props.part.kind === 'user' || props.part.kind === 'custom'}>
      <section ref={useContext(SectionContext)} class={props.part.kind === 'user' ? 'user' : 'message'} data-entry-id={props.part.entryId}>
        <MessageBody content={textBlocks()} />
        <Images blocks={Array.isArray(props.part.content) ? props.part.content : []} />
        <Show when={props.part.canBranch}>
          <button type="button" class="branch-trigger" data-branch-source={props.part.entryId} aria-label="New branch"
            onClick={() => props.onBranch?.(props.part.entryId)} />
        </Show>
      </section>
    </Match>
    <Match when={['message', 'summary', 'thinking'].includes(props.part.kind)}>
      <section ref={useContext(SectionContext)} class={props.part.kind === 'thinking' ? 'thinking real-thinking' : 'message real-message'}
        classList={{ 'summary-content': props.part.kind === 'summary' || props.part.summary }}
        style={props.part.eos ? { color: 'var(--muted)' } : undefined} data-entry-id={props.part.entryId}>
        <Show when={props.part.kind === 'message'} fallback={
          <ExpandableContent measureKey={props.part.text} initialOpen={props.part.kind === 'summary' || props.part.summary} expandRequest={props.expandRequest}>
            {responseBody()}
          </ExpandableContent>
        }>{responseBody()}</Show>
      </section>
    </Match>
  </Switch>;
}

export default function ChatContent(props: { entries: Wire[] }) {
  const parts = createMemo(() => [...projectChatParts(props.entries).values()].flat());

  return <For each={parts()}>{part => <ChatEntryPart part={part} />}</For>;
}
