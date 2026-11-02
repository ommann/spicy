import { For, Index, Show, createMemo, createSignal, onMount, useContext } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { renderSystemPromptDocument, type SystemPromptDocument, type SystemPromptPart } from '../../packages/coding-agent/src/core/system-prompt-document';
import { SystemPromptCreatorContext, type PromptDocumentSnapshot } from './SystemPromptCreatorContext';
import SystemPromptContent from './SystemPromptContent';
import ScrollArea from './ScrollArea';
import { createColumnInteraction } from './column-interaction';
import CollapseToggle from './CollapseToggle';
import Checkbox from './Checkbox';
import Select from './Select';
import type { Wire } from './types';
import { promptDocument } from './lilim/system-prompts.js';

function PartEditor(props: {
  part: SystemPromptPart;
  excluded: ReadonlySet<string>;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const children = () => props.part.children || [];
  return <li>
    <label title={props.part.source}>
      <Checkbox checked={!props.excluded.has(props.part.id)}
        onChange={event => props.onToggle(props.part.id, event.currentTarget.checked)} />
      {props.part.label}
    </label>
    <For each={children().filter(part => part.inline)}>{part => <label class="creator-inline-choice">
      <Checkbox checked={!props.excluded.has(part.id)}
        onChange={event => props.onToggle(part.id, event.currentTarget.checked)} />{part.label}
    </label>}</For>
    <Show when={children().some(part => !part.inline)}>
      <ul><Index each={children().filter(part => !part.inline)}>{part => <PartEditor part={part()} excluded={props.excluded}
        onToggle={props.onToggle} />}</Index></ul>
    </Show>
  </li>;
}

const promptState = (state: { content: string; sections?: Record<string, string>; toolsAdded?: Wire[] }) => ({
  content: state.content,
  sections: new Map(Object.entries(state.sections || {})),
  tools: new Map((state.toolsAdded || []).map(tool => [tool.name, tool])),
});

export default function SystemPromptCreator() {
  const api = useContext(SystemPromptCreatorContext);
  const navigate = useNavigate();
  let switchboardViewport!: HTMLDivElement;
  let previewViewport!: HTMLDivElement;
  const switchboardInteraction = createColumnInteraction({ viewport: () => switchboardViewport, enabled: () => true });
  const previewInteraction = createColumnInteraction({ viewport: () => previewViewport, enabled: () => true });
  const [snapshot, setSnapshot] = createSignal<PromptDocumentSnapshot>();
  const [document, setDocument] = createSignal<SystemPromptDocument>();
  const [excluded, setExcluded] = createSignal<ReadonlySet<string>>(new Set());
  const [tools, setTools] = createSignal<Wire[]>([]);
  const [toolChoices, setToolChoices] = createSignal<Wire[]>([]);
  const [expandedToolSources, setExpandedToolSources] = createSignal<ReadonlySet<string>>(new Set());
  const toolGroups = createMemo(() => {
    const groups = new Map<string, Wire[]>();
    for (const tool of toolChoices()) {
      const source = snapshot()?.toolSources?.[tool.name] || 'Recorded tools';
      const group = groups.get(source) || [];
      group.push(tool);
      groups.set(source, group);
    }
    return [...groups].map(([source, tools]) => ({ source, tools }));
  });
  function toggleToolSource(source: string) {
    setExpandedToolSources(previous => {
      const next = new Set(previous);
      if (next.has(source)) next.delete(source); else next.add(source);
      return next;
    });
  }
  function loadTools(selected: Wire[]) {
    const choices = new Map((snapshot()?.availableTools || []).map(tool => [tool.name, tool]));
    selected.forEach(tool => choices.set(tool.name, tool));
    setToolChoices([...choices.values()]);
    setTools(selected);
  }
  function toggleTool(name: string, included: boolean) {
    const names = new Set(tools().map(tool => tool.name));
    if (included) names.add(name); else names.delete(name);
    setTools(toolChoices().filter(tool => names.has(tool.name)));
  }
  let optionsDialog!: HTMLDialogElement;
  const [separateRules, setSeparateRules] = createSignal(false);
  const [error, setError] = createSignal('');
  const [showDiff, setShowDiff] = createSignal(false);
  const [comparison, setComparison] = createSignal('');
  const [startingSource, setStartingSource] = createSignal('');
  const promptOptions = createMemo(() => [
    { value: '', label: 'Current prompt' },
    ...(snapshot()?.sources || []).map(source => ({ value: source.id, label: source.label })),
  ]);
  const comparisonState = createMemo(() => {
    const source = snapshot()?.sources?.find(source => source.id === comparison());
    return source ? { ...renderSystemPromptDocument(source.document, source.excludedIds), toolsAdded: source.toolsAdded }
      : snapshot()?.current || { content: '' };
  });
  function loadDocument(value: SystemPromptDocument, excludedIds?: string[]) {
    setDocument({ ...value, forced: undefined });
    const defaults: string[] = [];
    const collect = (part: SystemPromptPart) => {
      if (part.defaultIncluded === false) defaults.push(part.id);
      part.children?.forEach(collect);
    };
    value.parts.forEach(collect);
    if (value.content) collect(value.content);
    setExcluded(new Set(excludedIds ?? defaults));
  }
  onMount(() => {
    void api?.load().then(value => {
      setSnapshot(value);
      loadDocument(value.document);
      loadTools(value.current.toolsAdded || []);
    }).catch(failure => setError(String(failure)));
  });
  function toggle(id: string, enabled: boolean) {
    setExcluded(previous => {
      const next = new Set(previous);
      if (enabled) next.delete(id); else next.add(id);
      return next;
    });
  }
  const composedDocument = createMemo(() => {
    const value = document();
    return value && { ...value, parts: value.parts.map(part => part.section === 'rules' && part.children
      ? { ...part, separator: separateRules() ? '\n\n' : '\n' } : part) };
  });
  const state = createMemo(() => {
    const value = composedDocument();
    return value ? renderSystemPromptDocument(value, [...excluded()]) : { content: '' };
  });
  const entry = createMemo(() => {
    const after = promptState({ ...state(), toolsAdded: tools() });
    const before = showDiff() ? promptState(comparisonState()) : after;
    return { message: { role: 'system' }, prefixPreview: true, unifiedDiff: true,
      prefixDiff: promptDocument(before, after) };
  });
  function save() {
    const value = composedDocument();
    if (!value) return;
    try { api?.save({ title: 'New prompt', document: value, excludedIds: [...excluded()], toolsAdded: tools() }); }
    catch (failure) { setError(String(failure)); }
  }
  return <section class="system-prompt-creator" aria-label="System Prompt Creator">
    <header class="creator-toolbar">
      <span>System Prompt Creator</span>
      <button onClick={() => optionsDialog.showModal()}>Options</button>
      <button onClick={() => navigate('/system-prompts')}>Cancel</button>
      <button disabled={!document()} onClick={save}>Save to System Prompts</button>
    </header>
    <dialog ref={optionsDialog} class="chat-dialog" aria-label="Options">
      <div class="chat-dialog-heading"><span>Options</span><button onClick={() => optionsDialog.close()}>Close</button></div>
      <label><span><Checkbox checked={separateRules()} onChange={event => setSeparateRules(event.currentTarget.checked)} /> Separate rules with empty lines</span></label>
    </dialog>
    <Show when={error()}><p role="alert">{error()}</p></Show>
    <Show when={document()} fallback={<Show when={!error()}><p>Loading prompt parts…</p></Show>}>{value => <div class="creator-columns">
      <ScrollArea class="system-prompts-scroll-area creator-switchboard" vertical
        viewportRef={element => { switchboardViewport = element; }}
        events={{ ...switchboardInteraction.handlers, onKeyDown: switchboardInteraction.keydown,
          onKeyUp: switchboardInteraction.keyup, onBlur: switchboardInteraction.blur }}
        contentClassList={{ 'pan-ready': switchboardInteraction.space(), panning: switchboardInteraction.dragging() }}>
        <Show when={snapshot()?.sources?.length}><div>Start from{' '}
          <Select label="Start from" value={startingSource()} options={promptOptions()} onChange={id => {
            setStartingSource(id);
            const source = snapshot()?.sources?.find(item => item.id === id);
            if (source) { loadDocument(source.document, source.excludedIds); loadTools(source.toolsAdded || []); }
            else if (snapshot()) { loadDocument(snapshot()!.document); loadTools(snapshot()!.current.toolsAdded || []); }
          }} />
        </div></Show>
        <ul><Show when={value().content}>{part => <PartEditor part={part()} excluded={excluded()} onToggle={toggle} />}</Show>
          <Index each={value().parts}>{part => <PartEditor part={part()} excluded={excluded()} onToggle={toggle} />}</Index>
        </ul>
        <Show when={toolChoices().length}><div>Tool definitions</div>
          <ul><For each={toolGroups()}>{group => <li>
            <CollapseToggle label={group.source} text={`${expandedToolSources().has(group.source) ? '[-]' : '[+]'} ${group.source} (${group.tools.filter(tool => tools().some(selected => selected.name === tool.name)).length}/${group.tools.length})`}
              expanded={expandedToolSources().has(group.source)} onToggle={() => toggleToolSource(group.source)} />
            <Show when={expandedToolSources().has(group.source)}><ul><For each={group.tools}>{tool => <li><label>
              <Checkbox checked={tools().some(selected => selected.name === tool.name)}
                onChange={event => toggleTool(tool.name, event.currentTarget.checked)} />{tool.name}
            </label></li>}</For></ul></Show>
          </li>}</For></ul>
        </Show>
      </ScrollArea>
      <ScrollArea class="system-prompts-scroll-area creator-preview" vertical
        viewportRef={element => { previewViewport = element; }}
        events={{ ...previewInteraction.handlers, onKeyDown: previewInteraction.keydown,
          onKeyUp: previewInteraction.keyup, onBlur: previewInteraction.blur }}
        contentClassList={{ 'pan-ready': previewInteraction.space(), panning: previewInteraction.dragging() }}>
        <div><label><Checkbox checked={showDiff()} onChange={event => setShowDiff(event.currentTarget.checked)} /> Compare with</label>{' '}
          <Select label="Compare with" value={comparison()} options={promptOptions()}
            onChange={id => { setComparison(id); setShowDiff(true); }} />
        </div>
        <SystemPromptContent entry={entry()} full expandAll />
      </ScrollArea>
    </div>}</Show>
  </section>;
}
