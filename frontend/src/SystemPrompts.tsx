import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, on, untrack } from 'solid-js';
import type { PromptVersion } from './SystemPromptRoute';
import SystemPromptContent from './SystemPromptContent';
import Card from './Card';
import ColumnToolbar from './ColumnToolbar';
import CollapseToggle from './CollapseToggle';
import ScrollArea from './ScrollArea';
import { createColumnInteraction } from './column-interaction';
import { createColumnShortcuts } from './column-shortcuts';

interface Props {
  versions: PromptVersion[];
  selected: number;
  onSelect?: (number: number) => void;
  onClose: () => void;
  ignored?: (key: string) => boolean;
  onIgnore?: (key: string, ignored: boolean) => void;
}

export default function SystemPrompts(props: Props) {
  const [expanded, setExpanded] = createSignal(true);
  const [mode, setMode] = createSignal<'focused' | 'side'>('side');
  const [selection, setSelection] = createSignal(untrack(() => props.selected));
  const sections = new Map<number, HTMLElement>();
  let viewport!: HTMLElement;
  const interaction = createColumnInteraction({
    viewport: () => viewport, enabled: () => mode() === 'side',
    columns: () => ({ inset: viewport.clientWidth / 2, starts: props.versions.map((_, index) => index * 768), width: 720 }),
    onColumn: index => { const version = props.versions[index]; if (version) setSelection(version.number); },
    onScroll: () => {},
  });
  const selected = createMemo(() => props.versions.find(version => version.number === selection()) || props.versions[0]);

  const [navigation, setNavigation] = createSignal(untrack(() => props.selected));
  createEffect(() => { setSelection(props.selected); setNavigation(props.selected); });

  function select(number: number) {
    interaction.resetPointer();
    setSelection(number);
    setNavigation(number);
    props.onSelect?.(number);
  }

  function adjacent(direction: number) {
    const index = props.versions.findIndex(version => version.number === selected()?.number);
    const version = props.versions[index + direction];
    if (version) select(version.number);
  }

  createEffect(on([navigation, mode], ([number]) => {
    const section = sections.get(number);
    section?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }));
  onMount(() => {
    const section = sections.get(props.selected);
    section?.scrollIntoView({ block: 'nearest', inline: 'center' });
  });

  function changeMode(value: 'focused' | 'side') {
    interaction.resetPointer();
    setNavigation(selected()?.number || props.selected);
    setMode(value);
  }

  createColumnShortcuts({
    codes: ['KeyF', 'ArrowLeft', 'ArrowRight'],
    onKey: event => {
      if (event.code === 'KeyF') changeMode(mode() === 'focused' ? 'side' : 'focused');
      else adjacent(event.code === 'ArrowLeft' ? -1 : 1);
    },
  });

  return (
    <section class="system-prompts-view" aria-label="System prompts"
      onKeyUp={interaction.keyup} onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) interaction.blur();
      }}
      onKeyDown={interaction.keydown}>
      <ColumnToolbar label="System prompt navigation" hasContent={props.versions.length > 0} mode={mode()}
        onMode={changeMode} onNavigate={adjacent} previousLabel="Previous system prompt" nextLabel="Next system prompt"
        previousDisabled={selected() === props.versions[0]} nextDisabled={selected() === props.versions.at(-1)}
        actions={<CollapseToggle expanded={expanded()} onToggle={() => setExpanded(value => !value)} />}>
        <span class="tree-title">System prompts</span>
        <button onClick={() => props.onClose()}>Back to chat</button>
      </ColumnToolbar>
      <ScrollArea class="system-prompts-scroll-area" vertical viewportRef={element => { viewport = element; }}
        events={{ ...interaction.handlers, role: 'main' }} contentClass="system-prompts-content"
        contentClassList={{ 'focused-columns': mode() === 'focused', 'pan-ready': interaction.space(), panning: interaction.dragging() }}>
        <Show when={props.versions.length} fallback={<p class="message">No captured system prompts in this session.</p>}>
          <For each={props.versions}>{version => {
            const focused = () => selected()?.number === version.number;
            onCleanup(() => sections.delete(version.number));
            return <Card class="system-prompt-version" data-active-column={focused()}
              hidden={mode() === 'focused' && !focused()} data-system-prompt-version={version.number}
              ref={element => sections.set(version.number, element)}>
              <div class="system-prompt-heading">
                <div><Show when={version.priorityReason}><span>{version.priorityReason}</span></Show></div>
                <div><Show when={version.candidateKey}>{key => <label>
                  <input type="checkbox" checked={props.ignored?.(key()) ?? false}
                    onChange={event => props.onIgnore?.(key(), event.currentTarget.checked)} />
                  Ignore this system prompt
                </label>}</Show></div>
              </div>
              <SystemPromptContent entry={version.unified || version.full || version.detail}
                full expandAll={expanded()} onExpandChange={setExpanded} />
            </Card>;
          }}</For>
        </Show>
      </ScrollArea>
    </section>
  );
}
