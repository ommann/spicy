import { For, Index, Show, createMemo, createSignal, onMount, useContext } from 'solid-js';
import { renderSystemPromptDocument, type SystemPromptDocument, type SystemPromptPart } from '../../packages/coding-agent/src/core/system-prompt-document';
import { SystemPromptCreatorContext, type PromptDocumentSnapshot } from './SystemPromptCreatorContext';
import SystemPromptContent from './SystemPromptContent';
import ScrollArea from './ScrollArea';
import { createColumnInteraction } from './column-interaction';
import TreeDisclosure from './TreeDisclosure';
import Checkbox from './Checkbox';
import Dialog from './Dialog';
import CodeLinewrapOption from './CodeLinewrapOption';
import SelectWithDialog from './SelectWithDialog';
import Navigation from './Navigation';
import type { Wire } from './types';
import { promptDocument } from './lilim/system-prompts.js';

function PartEditor(props: {
  part: SystemPromptPart;
  excluded: ReadonlySet<string>;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const children = () => props.part.children || [];
  const [expanded, setExpanded] = createSignal(true);
  function counts(part: SystemPromptPart, enabled = true): { selected: number; total: number } {
    enabled = enabled && !props.excluded.has(part.id);
    if (!part.children?.length) return { selected: enabled ? 1 : 0, total: 1 };
    return part.children.map(child => counts(child, enabled)).reduce((sum, child) => ({
      selected: sum.selected + child.selected, total: sum.total + child.total,
    }), { selected: 0, total: 0 });
  }
  const state = createMemo(() => counts(props.part));
  function toggleSubtree(part: SystemPromptPart, enabled: boolean) {
    props.onToggle(part.id, enabled);
    part.children?.forEach(child => toggleSubtree(child, enabled));
  }
  return <li>
    <div class="creator-tree-group">
      <Show when={children().length} fallback={<span />}>
        <TreeDisclosure label={props.part.label} expanded={expanded()} onToggle={() => setExpanded(value => !value)} />
      </Show>
      <label title={props.part.source}>
        <Checkbox checked={state().selected === state().total}
          indeterminate={state().selected > 0 && state().selected < state().total}
          onChange={event => toggleSubtree(props.part, event.currentTarget.checked)} />
        {props.part.label}
      </label>
    </div>
    <Show when={expanded() && children().length}>
      <ul><Index each={children()}>{part => <PartEditor part={part()} excluded={props.excluded}
        onToggle={(id, enabled) => {
          if (enabled) props.onToggle(props.part.id, true);
          props.onToggle(id, enabled);
        }} />}</Index></ul>
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
  let switchboardViewport!: HTMLDivElement;
  let previewViewport!: HTMLDivElement;
  const switchboardInteraction = createColumnInteraction({ viewport: () => switchboardViewport, enabled: () => true });
  const previewInteraction = createColumnInteraction({ viewport: () => previewViewport, enabled: () => true });
  const [snapshot, setSnapshot] = createSignal<PromptDocumentSnapshot>();
  const [document, setDocument] = createSignal<SystemPromptDocument>();
  const [excluded, setExcluded] = createSignal<ReadonlySet<string>>(new Set());
  const [tools, setTools] = createSignal<Wire[]>([]);
  const [toolChoices, setToolChoices] = createSignal<Wire[]>([]);
  const [expandedTools, setExpandedTools] = createSignal(true);
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
  let saveDialog!: HTMLDialogElement;
  const [promptName, setPromptName] = createSignal('');
  const [saveError, setSaveError] = createSignal('');
  const [separateRules, setSeparateRules] = createSignal(false);
  const [error, setError] = createSignal('');
  const [showDiff, setShowDiff] = createSignal(false);
  const [comparison, setComparison] = createSignal('');
  const [startingSource, setStartingSource] = createSignal('');
  const promptOptions = createMemo(() => (snapshot()?.sources || []).map(source => ({ value: source.id, label: source.label })));
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
    const next = new Set(excludedIds ?? defaults);
    const inheritExclusion = (part: SystemPromptPart, parentExcluded = false) => {
      const disabled = parentExcluded || next.has(part.id);
      if (disabled) next.add(part.id);
      part.children?.forEach(child => inheritExclusion(child, disabled));
    };
    value.parts.forEach(part => inheritExclusion(part));
    if (value.content) inheritExclusion(value.content);
    setExcluded(next);
  }
  onMount(() => {
    void api?.load().then(value => {
      setSnapshot(value);
      setStartingSource(value.currentSourceId || '');
      setComparison(value.currentSourceId || '');
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
  function openSave() {
    if (!api) return;
    try {
      setPromptName('');
      setSaveError('');
      saveDialog.showModal();
    } catch (failure) { setError(String(failure)); }
  }
  function save(event: SubmitEvent) {
    event.preventDefault();
    const value = composedDocument();
    if (!value || !api) return;
    if (!promptName().trim()) { setSaveError('Enter a name.'); return; }
    try {
      api.save({ title: promptName().trim(), document: value, excludedIds: [...excluded()], toolsAdded: tools() });
      saveDialog.close();
    } catch (failure) { setSaveError(String(failure)); }
  }
  return <section class="system-prompt-creator" aria-label="System Prompt Creator">
    <Navigation options={<button onClick={() => optionsDialog.showModal()}>Options</button>} />
    <Dialog ref={saveDialog} title="Save as" closeLabel="Cancel">
      <form onSubmit={save}>
        <label>Name<input autofocus required value={promptName()} onInput={event => setPromptName(event.currentTarget.value)} /></label>
        <Show when={saveError()}><div role="alert">{saveError()}</div></Show>
        <button type="submit">Save</button>
      </form>
    </Dialog>
    <Dialog ref={optionsDialog} title="Options">
      <CodeLinewrapOption />
      <label><span><Checkbox checked={separateRules()} onChange={event => setSeparateRules(event.currentTarget.checked)} /> Separate rules with empty lines</span></label>
    </Dialog>
    <Show when={error()}><p role="alert">{error()}</p></Show>
    <Show when={document()} fallback={<Show when={!error()}><p>Loading prompt parts…</p></Show>}>{value => <div class="creator-columns">
      <ScrollArea class="system-prompts-scroll-area creator-switchboard" vertical
        viewportRef={element => { switchboardViewport = element; }}
        events={{ ...switchboardInteraction.handlers, onKeyDown: switchboardInteraction.keydown,
          onKeyUp: switchboardInteraction.keyup, onBlur: switchboardInteraction.blur }}
        contentClassList={{ 'pan-ready': switchboardInteraction.space(), panning: switchboardInteraction.dragging() }}>
        <div class="creator-toolbar">
          <Show when={snapshot()?.sources?.length}>
            <SelectWithDialog class="text-action" label="Load" value={startingSource()} options={promptOptions()} onChange={id => {
              setStartingSource(id);
              const source = snapshot()?.sources?.find(item => item.id === id);
              if (source) { loadDocument(source.document, source.excludedIds); loadTools(source.toolsAdded || []); }
              else if (snapshot()) { loadDocument(snapshot()!.document); loadTools(snapshot()!.current.toolsAdded || []); }
            }}>Load</SelectWithDialog>
          </Show>
          <button class="text-action" disabled={!document()} onClick={openSave}>Save as</button>
        </div>
        <ul><Show when={value().content}>{part => <PartEditor part={part()} excluded={excluded()} onToggle={toggle} />}</Show>
          <Index each={value().parts}>{part => <PartEditor part={part()} excluded={excluded()} onToggle={toggle} />}</Index>
        </ul>
        <Show when={toolChoices().length}>
          <div class="creator-tree-group">
            <TreeDisclosure label="Tool definitions" expanded={expandedTools()} onToggle={() => setExpandedTools(value => !value)} />
            <label><Checkbox checked={tools().length === toolChoices().length}
              indeterminate={tools().length > 0 && tools().length < toolChoices().length}
              onChange={event => setTools(event.currentTarget.checked ? [...toolChoices()] : [])} />Tool definitions</label>
          </div>
          <Show when={expandedTools()}><ul><For each={toolGroups()}>{group => <li>
            <div class="creator-tree-group">
              <TreeDisclosure label={group.source} expanded={expandedToolSources().has(group.source)}
                onToggle={() => toggleToolSource(group.source)} />
              <label><Checkbox
                checked={group.tools.every(tool => tools().some(selected => selected.name === tool.name))}
                indeterminate={group.tools.some(tool => tools().some(selected => selected.name === tool.name))
                  && !group.tools.every(tool => tools().some(selected => selected.name === tool.name))}
                onChange={event => {
                  const enabled = event.currentTarget.checked;
                  const names = new Set(group.tools.map(tool => tool.name));
                  setTools(previous => enabled
                    ? [...previous.filter(tool => !names.has(tool.name)), ...group.tools]
                    : previous.filter(tool => !names.has(tool.name)));
                }} />{group.source}</label>
            </div>
            <Show when={expandedToolSources().has(group.source)}><ul><For each={group.tools}>{tool => <li><div class="creator-tree-group"><span /><label>
              <Checkbox checked={tools().some(selected => selected.name === tool.name)}
                onChange={event => toggleTool(tool.name, event.currentTarget.checked)} />{tool.name}
            </label></div></li>}</For></ul></Show>
          </li>}</For></ul></Show>
        </Show>
      </ScrollArea>
      <ScrollArea class="system-prompts-scroll-area creator-preview" vertical
        viewportRef={element => { previewViewport = element; }}
        events={{ ...previewInteraction.handlers, onKeyDown: previewInteraction.keydown,
          onKeyUp: previewInteraction.keyup, onBlur: previewInteraction.blur }}
        contentClassList={{ 'pan-ready': previewInteraction.space(), panning: previewInteraction.dragging() }}>
        <div><label><Checkbox checked={showDiff()} onChange={event => setShowDiff(event.currentTarget.checked)} /> Compare with</label>{' '}
          <SelectWithDialog label="Compare with" value={comparison()} options={promptOptions()}
            onChange={id => { setComparison(id); setShowDiff(true); }} />
        </div>
        <SystemPromptContent entry={entry()} full expandAll />
      </ScrollArea>
    </div>}</Show>
  </section>;
}
