import { Show, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from 'solid-js';
import CollapseToggle from './CollapseToggle';
import SourceText from './SourceText';
import ScrollArea from './ScrollArea';
import DiffView from './DiffView';
import type { Wire } from './types';

interface ExpansionProps {
  expandAll: boolean;
  onExpandChange?: (expanded: boolean) => void;
}

function createExpansion(props: ExpansionProps) {
  const [local, setLocal] = createSignal(untrack(() => props.expandAll));
  createEffect(() => setLocal(props.expandAll));
  const expanded = () => props.onExpandChange ? props.expandAll : local();
  const toggle = () => {
    if (props.onExpandChange) props.onExpandChange(!expanded());
    else setLocal(!expanded());
  };
  return { expanded, toggle };
}

function PromptText(props: { text: string; language: string }) {
  return <ScrollArea contentClass="prompt-source"><SourceText text={props.text} language={props.language} /></ScrollArea>;
}

function Disclosure(props: { text: string; preview: string; description: string; language: string } & ExpansionProps) {
  const { expanded, toggle } = createExpansion(props);

  return <div class="system-region">
    <Show when={!expanded() && props.preview}><PromptText text={props.preview} language={props.language} /></Show>
    <Show when={expanded()}><PromptText text={props.text} language={props.language} /></Show>
    <CollapseToggle label={props.description} expanded={expanded()} onToggle={toggle} />
  </div>;
}

function DiffLines(props: { files: Wire[]; fullPrompt?: boolean }) {
  return <DiffView files={props.files} fullDocument={props.fullPrompt} language="markdown" />;
}

function PromptDelta(props: { entry: Wire } & ExpansionProps) {
  const { expanded, toggle } = createExpansion(props);
  const [measuredClipping, setMeasuredClipping] = createSignal<boolean>();
  let fullDiff!: HTMLDivElement;
  const files = () => props.entry.prefixDiff || [];
  const lines = createMemo(() => files().reduce((count: number, file: Wire) =>
    count + 2 + file.hunks.reduce((total: number, hunk: Wire) => total + 1 + hunk.rows.length, 0), 0));
  const limit = () => props.entry.unifiedDiff ? 22 : 8;
  const clipped = () => !props.entry.unifiedDiff && (measuredClipping() ?? lines() > limit());

  function measure() {
    if (!fullDiff?.isConnected || !fullDiff.getClientRects().length) return;

    const lineHeight = parseFloat(getComputedStyle(fullDiff).lineHeight) || 20;
    setMeasuredClipping(fullDiff.scrollHeight > limit() * lineHeight);
  }

  createEffect(() => { files(); measure(); });

  onMount(() => {
    if (!fullDiff) return;
    const observer = new ResizeObserver(measure);
    observer.observe(fullDiff);
    onCleanup(() => observer.disconnect());
  });

  return <section class="message real-message system-message" classList={{
    'system-delta': !props.entry.unifiedDiff, 'system-unified': !!props.entry.unifiedDiff, 'prompt-expanded': expanded(),
  }}>
    <div class="prompt-diff-container">
      <div class="prefix-diff" classList={{
        'diff-condensed': !props.entry.unifiedDiff && !expanded() && clipped(),
        'chat-part-body': !!props.entry.unifiedDiff,
        'part-open': expanded(),
      }}><DiffLines files={files()} fullPrompt={props.entry.unifiedDiff} /></div>
      <Show when={!props.entry.unifiedDiff}>
        <div ref={fullDiff} class="prefix-diff prompt-diff-measure" aria-hidden="true" inert><DiffLines files={files()} /></div>
      </Show>
    </div>
    <Show when={clipped()}>
      <CollapseToggle label="System prompt changes" expanded={expanded()} onToggle={toggle} />
    </Show>
  </section>;
}

export default function SystemPromptContent(props: { entry: Wire; full?: boolean } & ExpansionProps) {
  const parts = createMemo(() => {
    const message = props.entry.message;
    const content = typeof message.content === 'string' ? message.content
      : (message.content || []).filter((block: Wire) => block.type === 'text').map((block: Wire) => block.text).join('\n');
    return [content, ...Object.values(message.sections || {}).filter(value => typeof value === 'string')].filter(Boolean) as string[];
  });
  const text = createMemo(() => parts().join('\n\n'));
  const preview = createMemo(() => parts().length > 1 ? parts()[0] : text().split(/\n[ \t]*\n/)[0]);
  const tools = createMemo(() => {
    const message = props.entry.message;
    const data: Wire = {};
    if (message.toolsAdded?.length) data.toolsAdded = message.toolsAdded;
    if (message.toolsRemoved?.length) data.toolsRemoved = message.toolsRemoved;
    return { data, count: (message.toolsAdded?.length || 0) + (message.toolsRemoved?.length || 0) };
  });

  return <div class="system-prompt-detail">
    <Show when={props.entry.prefixPreview} fallback={
      <section class="message real-message system-message">
        <Show when={text()}>
          <Show when={!props.full && preview() !== text()} fallback={<PromptText text={text()} language="markdown" />}>
            <Disclosure text={text()} preview={preview()} description="system prompt" language="markdown" expandAll={props.expandAll} onExpandChange={props.onExpandChange} />
          </Show>
        </Show>
        <Show when={tools().count}>
          <Disclosure text={JSON.stringify(tools().data, null, 2)} preview="" description={`${tools().count} tool definitions`}
            language="json" expandAll={props.onExpandChange ? props.expandAll : !!props.full || props.expandAll} onExpandChange={props.onExpandChange} />
        </Show>
      </section>
    }>
      <PromptDelta entry={props.entry} expandAll={props.expandAll} onExpandChange={props.onExpandChange} />
    </Show>
  </div>;
}
