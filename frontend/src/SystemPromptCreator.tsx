import { For, Index, Show, createMemo, createSignal, onMount, useContext } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { renderSystemPromptDocument, type SystemPromptDocument, type SystemPromptPart } from '../../packages/coding-agent/src/core/system-prompt-document';
import { SystemPromptCreatorContext, type PromptDocumentSnapshot } from './SystemPromptCreatorContext';
import SystemPromptContent from './SystemPromptContent';
import ScrollArea from './ScrollArea';
import type { Wire } from './types';
import { diffLines } from './lilim/prefix-diff.js';

function PartEditor(props: {
  part: SystemPromptPart;
  excluded: ReadonlySet<string>;
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (id: string, text: string) => void;
}) {
  return <li>
    <label title={props.part.source}>
      <input type="checkbox" checked={!props.excluded.has(props.part.id)}
        onChange={event => props.onToggle(props.part.id, event.currentTarget.checked)} />
      {props.part.label}
    </label>
    <Show when={props.part.children} fallback={<textarea aria-label={`Edit ${props.part.label}`} rows={4}
      value={props.part.text || ''} onInput={event => props.onEdit(props.part.id, event.currentTarget.value)} />}>
      {children => <ul><Index each={children()}>{part => <PartEditor part={part()} excluded={props.excluded}
        onToggle={props.onToggle} onEdit={props.onEdit} />}</Index></ul>}
    </Show>
  </li>;
}

const textOf = (state: { content: string; sections?: Record<string, string> }) =>
  [state.content, ...Object.values(state.sections || {})].filter(Boolean).join('\n\n');

export default function SystemPromptCreator() {
  const api = useContext(SystemPromptCreatorContext);
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = createSignal<PromptDocumentSnapshot>();
  const [document, setDocument] = createSignal<SystemPromptDocument>();
  const [excluded, setExcluded] = createSignal<ReadonlySet<string>>(new Set());
  const [tools, setTools] = createSignal<Wire[]>([]);
  const [title, setTitle] = createSignal('New prompt');
  const [error, setError] = createSignal('');
  const [showDiff, setShowDiff] = createSignal(false);
  const [wholeText, setWholeText] = createSignal('');
  function loadDocument(value: SystemPromptDocument, excludedIds: string[] = []) {
    // An unchanged full-text return is not a separate editable part.
    const structured = { ...value, forced: undefined };
    const identical = value.forced?.text === textOf(renderSystemPromptDocument(structured));
    setWholeText(value.forced?.text || '');
    setDocument(identical ? structured : value);
    setExcluded(new Set(excludedIds));
  }
  onMount(() => {
    void api?.load().then(value => {
      setSnapshot(value);
      loadDocument(value.document);
      setTools(value.current.toolsAdded || []);
    }).catch(failure => setError(String(failure)));
  });
  function edit(id: string, text: string) {
    const update = (part: SystemPromptPart): SystemPromptPart => part.id === id ? { ...part, text }
      : part.children ? { ...part, children: part.children.map(update) } : part;
    setDocument(previous => previous && ({ ...previous, forced: undefined, parts: previous.parts.map(update),
      ...(previous.content ? { content: update(previous.content) } : {}) }));
  }
  function toggle(id: string, enabled: boolean) {
    setDocument(previous => previous && ({ ...previous, forced: undefined }));
    setExcluded(previous => {
      const next = new Set(previous);
      if (enabled) next.delete(id); else next.add(id);
      return next;
    });
  }
  const state = createMemo(() => {
    const value = document();
    return value ? renderSystemPromptDocument(value, [...excluded()]) : { content: '' };
  });
  const entry = createMemo(() => {
    if (!showDiff()) return { message: { role: 'system', ...state() } };
    return { message: { role: 'system' }, prefixPreview: true, unifiedDiff: true,
      prefixDiff: [{ name: 'content', hunks: [{ rows: diffLines(textOf(snapshot()?.current || { content: '' }), textOf(state())) }] }] };
  });
  function save() {
    const value = document();
    if (!value || !title().trim()) return;
    try { api?.save({ title: title().trim(), document: value, excludedIds: [...excluded()], toolsAdded: tools() }); }
    catch (failure) { setError(String(failure)); }
  }
  return <section class="system-prompt-creator" aria-label="System Prompt Creator">
    <header class="creator-toolbar">
      <span>System Prompt Creator</span>
      <button onClick={() => navigate('/system-prompts')}>Cancel</button>
      <input aria-label="Prompt name" value={title()} onInput={event => setTitle(event.currentTarget.value)} />
      <button disabled={!document() || !title().trim()} onClick={save}>Save to System Prompts</button>
    </header>
    <p class="creator-notice">Edit text and choose parts. Saving adds a prompt to System Prompts. It does not change the chat.</p>
    <Show when={error()}><p role="alert">{error()}</p></Show>
    <Show when={document()} fallback={<Show when={!error()}><p>Loading prompt parts…</p></Show>}>{value => <div class="creator-columns">
      <ScrollArea class="creator-switchboard" vertical>
        <Show when={snapshot()?.sources?.length}><label>Start from
          <select aria-label="Start from" onChange={event => {
            const source = snapshot()?.sources?.find(item => item.id === event.currentTarget.value);
            if (source) { loadDocument(source.document, source.excludedIds); setTools(source.toolsAdded || []); }
            else if (snapshot()) { loadDocument(snapshot()!.document); setTools(snapshot()!.current.toolsAdded || []); }
          }}><option value="">Current prompt</option><For each={snapshot()?.sources}>{source => <option value={source.id}>{source.label}</option>}</For></select>
        </label></Show>
        <label><input type="checkbox" checked={!!value().forced} onChange={event => {
          const enabled = event.currentTarget.checked;
          setDocument(previous => previous && ({ ...previous, forced: enabled ? { id: 'forced', label: 'Whole text', source: 'editor', text: wholeText() || textOf(state()) } : undefined }));
        }} /> Use whole text instead of parts</label>
        <Show when={value().forced}>{part => <textarea aria-label="Edit whole prompt" rows={12} value={part().text || ''}
          onInput={event => { const text = event.currentTarget.value; setWholeText(text); setDocument(previous => previous && ({ ...previous, forced: { ...part(), text } })); }} />}</Show>
        <ul><Show when={value().content}>{part => <PartEditor part={part()} excluded={excluded()} onToggle={toggle} onEdit={edit} />}</Show>
          <Index each={value().parts}>{part => <PartEditor part={part()} excluded={excluded()} onToggle={toggle} onEdit={edit} />}</Index>
        </ul>
      </ScrollArea>
      <ScrollArea class="creator-preview" vertical>
        <label><input type="checkbox" checked={showDiff()} onChange={event => setShowDiff(event.currentTarget.checked)} /> Show text diff</label>
        <SystemPromptContent entry={entry()} full expandAll />
      </ScrollArea>
    </div>}</Show>
  </section>;
}
