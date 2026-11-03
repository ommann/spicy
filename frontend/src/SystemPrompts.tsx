import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, on, untrack } from 'solid-js';
import type { PromptVersion } from './SystemPromptRoute';
import SystemPromptContent from './SystemPromptContent';
import SystemPromptPlaceholder from './SystemPromptPlaceholder';
import Card from './Card';
import ColumnToolbar from './ColumnToolbar';
import { viewMode as mode, setViewMode as setMode } from './view-mode';
import CollapseToggle from './CollapseToggle';
import Checkbox from './Checkbox';
import Dialog from './Dialog';
import CodeLinewrapOption from './CodeLinewrapOption';
import ScrollArea from './ScrollArea';
import { createColumnInteraction } from './column-interaction';
import { createColumnShortcuts } from './column-shortcuts';

interface Props {
  versions: PromptVersion[];
  selected: number;
  onSelect?: (number: number) => void;
  ignored?: (key: string) => boolean;
  onIgnore?: (key: string, ignored: boolean) => void;
}

export default function SystemPrompts(props: Props) {
  const [expanded, setExpanded] = createSignal(true);
  const [selection, setSelection] = createSignal(untrack(() => props.selected));
  const sections = new Map<number, HTMLElement>();
  let viewport!: HTMLElement;
  let optionsDialog!: HTMLDialogElement;
  const interaction = createColumnInteraction({
    viewport: () => viewport, enabled: () => mode() === 'side',
    columns: () => {
      const content = viewport.firstElementChild!;
      const gap = parseFloat(getComputedStyle(content).columnGap) || 0;
      return { inset: viewport.clientWidth / 2, starts: props.versions.map((_, index) => index * (720 + gap)), width: 720 };
    },
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

  createEffect(on([navigation, mode, () => props.versions], ([number]) => {
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
        actions={<CollapseToggle expanded={expanded()} onToggle={() => setExpanded(value => !value)} />}
        onOptions={() => optionsDialog.showModal()}>
        {null}
      </ColumnToolbar>
      <Dialog ref={optionsDialog} title="Options">
        <CodeLinewrapOption />
      </Dialog>
      <ScrollArea class="system-prompts-scroll-area" vertical viewportRef={element => { viewport = element; }}
        events={{ ...interaction.handlers, role: 'main' }} contentClass="system-prompts-content"
        contentStyle={{ 'grid-template-columns': mode() === 'focused' ? 'minmax(0, 1fr)' : `repeat(${Math.max(1, props.versions.length)}, 720px)` }}
        contentClassList={{ 'focused-columns': mode() === 'focused', 'pan-ready': interaction.space(), panning: interaction.dragging(),
          'has-headings': props.versions.some(version => (mode() !== 'focused' || selected()?.number === version.number)
            && (version.title || version.priorityReason || version.candidateKey)) }}>
        <Show when={props.versions.length} fallback={<Card class="system-prompt-version" ref={element => sections.set(1, element)}><SystemPromptPlaceholder /></Card>}>
          <For each={props.versions}>{(version, index) => {
            const focused = () => selected()?.number === version.number;
            onCleanup(() => sections.delete(version.number));
            const column = () => mode() === 'focused' ? 1 : index() + 1;
            return <>
              <div class="system-prompt-heading" hidden={mode() === 'focused' && !focused()}
                ref={element => sections.set(version.number, element)}
                style={{ 'grid-column': column(), 'grid-row': 1 }}>
                <div><Show when={version.title}><span>{version.title}</span></Show><Show when={version.priorityReason}><span>{version.priorityReason}</span></Show></div>
                <div><Show when={version.candidateKey}>{key => <label>
                  <Checkbox checked={props.ignored?.(key()) ?? false}
                    onChange={event => props.onIgnore?.(key(), event.currentTarget.checked)} />
                  Ignore this system prompt
                </label>}</Show></div>
              </div>
              <Card class="system-prompt-version" data-active-column={focused()}
                hidden={mode() === 'focused' && !focused()} data-system-prompt-version={version.number}
                style={{ 'grid-column': column(), 'grid-row': 2 }}>
                <SystemPromptContent entry={version.unified || version.full || version.detail}
                  full expandAll={expanded()} onExpandChange={setExpanded} />
              </Card>
            </>;
          }}</For>
        </Show>
      </ScrollArea>
    </section>
  );
}
