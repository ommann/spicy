import { For, Index, Show, batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from 'solid-js';
import { createStore } from 'solid-js/store';
import { Portal } from 'solid-js/web';
import Card from './Card';
import { createColumnInteraction } from './column-interaction';
import { ImageContext, SectionContext } from './conversation-dom';
import type { PreviewImage } from './ImagePreview';
import { modalOpen } from './modal-state';
import ChatToolbar from './ChatToolbar';
import { viewMode as mode, setViewMode as setMode } from './view-mode';
import { ChatEntryPart } from './ChatContent';
import MessageComposer from './MessageComposer';
import ScrollBar from './ScrollBar';
import SystemPromptReference from './SystemPromptReference';
import type { AgentHealthStatus } from './AgentHealth';
import SystemPromptPlaceholder from './SystemPromptPlaceholder';
import { createColumnShortcuts } from './column-shortcuts';
import { layoutConversation } from './conversation-model.mjs';
import type { Wire } from './types';
import type { PromptVersion } from './SystemPromptRoute';
import type { SelectOption } from './SelectWithDialog';
import { promptLabel } from './prompt-numbers';
import { systemPromptText } from './lilim/system-prompts.js';

export interface ViewOptions {
  widths: { focused: number; side: number };
  focusedFitsWindow: boolean;
  presets: number[];
}

export interface ConversationController {
  options: () => ViewOptions;
  setModeWidth: (mode: 'focused' | 'side', value: number | 'auto') => void;
  setDraft: (text: string) => void;
}

interface Props {
  graph: Wire;
  lanes: Wire[];
  drafts: Record<string, string>;
  onDraftChange: (key: string, text: string) => void;
  active: boolean;
  running: (leafId: string) => boolean;
  health: (leafId: string) => AgentHealthStatus;
  busy: (leafId: string) => boolean;
  onFocusLeaf: (leafId: string) => void;
  focusRequest?: { id: string; revision: number };
  notification: { message: string; isError: boolean };
  onReady: (controller: ConversationController) => void;
  onSubmit: (text: string, leafId: string) => Promise<boolean>;
  onBranch: (sourceId: string, anchorId?: string) => void;
  onDismissBranch: (id: string) => void;
  prompts: PromptVersion[];
  onSelectBranchPrompt: (id: string, key?: string) => void;
  onOpenSystemPrompt: (id: string) => void;
  onImage: (image: PreviewImage) => void;
  onAbort: (leafId: string) => void;
  onOptions: () => void;
}

function TreeCard(props: { id: string; node: Wire; position: Wire; gridStyle: JSX.CSSProperties; promptNumber?: number; promptTitle?: string; scrollTop: number; promptRowTop: number;
  selection?: { value: string; options: SelectOption[]; onChange: (value: string) => void };
  registerSection: (id: string, element: HTMLElement) => () => void;
  width: number; onBranch: (id: string) => void; onDismiss: (id: string) => void; measure: (id: string, element: Element) => void; unmeasure: (element: Element) => void }) {
  let element!: HTMLElement;

  onMount(() => props.measure(props.id, element));
  onCleanup(() => props.unmeasure(element));

  return <SectionContext.Provider value={element => { const dispose = props.registerSection(props.id, element); onCleanup(dispose); }}><article class="tree-node" classList={{ 'prefix-preview': props.node.isPrefixDelta }} data-entry-id={props.id}
    hidden={props.position.hidden} style={{ ...props.gridStyle, width: `${props.position.span}px` }}>
    <Card ref={element} anchors={props.node.anchors} style={{ left: `${props.position.cardLeft}px`, width: `${props.width}px` }}>
      <Show when={props.node.entry.type === 'branch_draft'}>
        <SystemPromptPlaceholder number={props.promptNumber} title={props.promptTitle} stickyOffset={props.scrollTop - props.promptRowTop}
          rowOffset={props.node.entry.draftSourceId ? props.promptRowTop - props.position.top : undefined} selection={props.selection} />
        <Show when={props.node.entry.draftSourceId}>
          <button class="text-action branch-dismiss" aria-label="Dismiss pending branch"
            style={{ top: `calc(${props.promptRowTop - props.position.top}px + 1lh)`,
              transform: `translateY(max(0px, calc(${props.scrollTop - props.promptRowTop}px + 1lh)))` }}
            onClick={() => props.onDismiss(props.id)}>Dismiss</button>
        </Show>
      </Show>
      <Index each={props.node.parts}>{part => <ChatEntryPart part={part()} onBranch={props.onBranch} />}</Index>
    </Card>
  </article></SectionContext.Provider>;
}

export default function Conversation(props: Props) {
  let spacingProbe!: HTMLSpanElement;
  const [spacing, setSpacing] = createSignal({ row: 20, column: 48, edge: 24 });
  onMount(() => {
    const measureSpacing = () => {
      const { width, height } = spacingProbe.getBoundingClientRect();
      const edge = parseFloat(getComputedStyle(spacingProbe).paddingLeft);
      if (width && height) setSpacing({ row: height, column: width, edge });
    };
    const observer = new ResizeObserver(measureSpacing);
    observer.observe(spacingProbe);
    measureSpacing();
    onCleanup(() => observer.disconnect());
  });
  const [widths, setWidths] = createStore({ focused: 720, side: 720 });
  const [focusedFitsWindow, setFocusedFitsWindow] = createSignal(true);
  const [selectedLane, setSelectedLane] = createSignal(0);
  const [dimensions, setDimensions] = createSignal({ width: window.innerWidth, height: Math.max(0, window.innerHeight - 42) });
  const [scroll, setScroll] = createSignal({ left: 0, top: 0, width: 0, height: 0 });
  const [heights, setHeights] = createStore<Record<string, number>>({});
  const [composerHeights, setComposerHeights] = createStore<Record<string, number>>({});
  const setDrafts = (key: string, text: string) => props.onDraftChange(key, text);
  const [jumpSizes, setJumpSizes] = createSignal({ branch: 0, latest: 0 });
  const [scrollRequest, setScrollRequest] = createSignal<{ id: string; bottom: boolean; smooth: boolean }>();
  const interaction = createColumnInteraction({
    viewport: () => viewport, enabled: () => props.active && mode() === 'side',
    columns: () => ({ inset: layout().inset, starts: layout().starts, width: workingWidth() }),
    onColumn: lane => {
      if (layout().starts[lane] !== layout().starts[focused()]) selectLane(lane);
    }, onScroll: updateScroll,
  });
  const lanes = () => props.lanes;
  function inheritedVersion(id: string) {
    const state = props.graph.prefix.get(id);
    const key = state.promptKey ?? systemPromptText(state);
    return props.prompts.find(prompt => prompt.key === key);
  }
  function versionFor(id: string) {
    const key = props.graph.nodes.get(id)?.entry.draftPromptKey;
    return (key ? props.prompts.find(prompt => prompt.key === key) : undefined) ?? inheritedVersion(id);
  }
  const nodeIds = () => (props.graph.ids as string[]).filter(id => props.graph.nodes.get(id).entry.message?.role !== 'system');
  const laneKeys = createMemo(() => lanes().map(lane => lane.key as string));
  const focused = () => Math.max(0, Math.min(selectedLane(), lanes().length - 1));
  createEffect(on(() => lanes()[focused()]?.leafId, id => { if (id) props.onFocusLeaf(id); }));
  const maxWidth = () => Math.max(480, dimensions().width - spacing().edge * 2);
  const workingWidth = () => mode() === 'focused' && focusedFitsWindow() ? maxWidth() : widths[mode()];
  const layout = createMemo(() => layoutConversation(props.graph, {
    mode: mode(), width: workingWidth(), viewportWidth: dimensions().width, viewportHeight: dimensions().height,
    lane: focused(), heights, rowGap: spacing().row, columnGap: spacing().column, edgeGap: spacing().edge, composerHeights: Object.fromEntries(lanes().map((lane, index) => [index, composerHeights[lane.key] || 40])),
  }));
  // Grid lines retain the measured branch geometry used by connectors and scrolling.
  const tracks = createMemo(() => {
    const value = layout();
    const positions = [...value.items.values()];
    const x = [...new Set<number>([0, value.width,
      ...positions.flatMap((position: Wire) => [position.left, position.left + position.span]),
      ...value.starts.flatMap((start: number) => [value.inset + start, value.inset + start + workingWidth()]),
    ].filter(Number.isFinite))].sort((a, b) => a - b);
    const y = [...new Set<number>([0, spacing().row, value.height,
      ...positions.map((position: Wire) => position.top),
    ].filter(Number.isFinite))].sort((a, b) => a - b);
    return {
      columns: x.slice(1).map((edge, index) => `${edge - x[index]}px`).join(' '),
      rows: y.slice(1).map((edge, index) => `${edge - y[index]}px`).join(' '),
      place: (left: number, top: number, width: number): JSX.CSSProperties => ({
        'grid-column': `${x.indexOf(left) + 1} / ${x.indexOf(left + width) + 1}`,
        'grid-row': y.indexOf(top) + 1,
      }),
    };
  });
  const sections = new Map<HTMLElement, string>();
  function registerSection(id: string, element: HTMLElement) {
    sections.set(element, id);
    return () => { sections.delete(element); };
  }
  const nodeElements = new Map<string, HTMLElement>();
  const inputElements = new Map<string, HTMLTextAreaElement>();
  const observed = new Map<Element, { kind: 'node' | 'composer'; id: string }>();
  let viewport!: HTMLElement;
  let stage!: HTMLDivElement;
  let composerRow!: HTMLDivElement;
  let jumpUp!: HTMLButtonElement;
  let jumpLatest!: HTMLButtonElement;
  let readingAnchor: { id: string; offset: number } | undefined;
  let centerAfterLayout = true;

  function measure(element: Element) {
    const record = observed.get(element);
    if (!record) return;
    const height = element.getBoundingClientRect().height;
    if (height <= 0) return;
    if (record.kind === 'node') setHeights(record.id, height);
    else setComposerHeights(record.id, height);
  }

  const observer = new ResizeObserver(records => batch(() => {
    for (const record of records) measure(record.target);
    updateViewport();
  }));

  function observe(id: string, element: Element, kind: 'node' | 'composer') {
    observed.set(element, { kind, id });
    if (kind === 'node') nodeElements.set(id, element as HTMLElement);
    observer.observe(element);
    measure(element);
  }

  function unobserve(element: Element) {
    const record = observed.get(element);
    if (record?.kind === 'node') nodeElements.delete(record.id);
    observed.delete(element);
    observer.unobserve(element);
  }

  function updateScroll() {
    const value = { left: viewport.scrollLeft, top: viewport.scrollTop, width: viewport.scrollWidth, height: viewport.scrollHeight };
    setScroll(previous => Object.keys(value).every(key => previous[key as keyof typeof value] === value[key as keyof typeof value]) ? previous : value);
  }

  function updateViewport() {
    if (!viewport) return;
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    if (width || height) setDimensions(previous => previous.width === width && previous.height === height ? previous : { width, height });
    const branch = jumpUp?.getBoundingClientRect().width || 0;
    const latest = jumpLatest?.getBoundingClientRect().width || 0;
    setJumpSizes(previous => {
      const next = { branch: branch || previous.branch, latest: latest || previous.latest };
      return next.branch === previous.branch && next.latest === previous.latest ? previous : next;
    });
    updateScroll();
  }

  function captureAnchor(lane = focused()) {
    const candidates = [...props.graph.nodes.values()].filter((node: Wire) => !node.isPrefixDelta && node.first <= lane && node.last >= lane)
      .sort((a: Wire, b: Wire) => layout().items.get(a.id).top - layout().items.get(b.id).top);
    const node = candidates.find((item: Wire) => {
      const position = layout().items.get(item.id);
      return position.top + position.height >= viewport.scrollTop + 40;
    }) || candidates.at(-1);
    return node ? { id: node.id, offset: layout().items.get(node.id).top - viewport.scrollTop } : undefined;
  }

  function selectLane(lane: number, preserveReading = true) {
    const next = Math.max(0, Math.min(lanes().length - 1, lane));
    if (next === focused()) return;
    if (preserveReading) readingAnchor = captureAnchor(next);
    setSelectedLane(next);
  }

  function changeMode(value: 'focused' | 'side') {
    if (value === mode()) return;
    readingAnchor = captureAnchor();
    interaction.resetPointer();
    centerAfterLayout = true;
    setMode(value);
  }

  function focus(id: string, bottom = false, smooth = true) {
    const node = props.graph.nodes.get(id);
    if (!node) return;
    interaction.resetPointer();
    selectLane(Math.max(node.first, Math.min(node.last, focused())), false);
    setScrollRequest({ id, bottom, smooth });
  }

  function adjacentFork(direction: number) {
    const next = Math.max(0, Math.min(lanes().length - 1, focused() + direction));
    if (next === focused()) return;
    interaction.resetPointer();
    centerAfterLayout = true;
    selectLane(next);
  }

  function dismissBranch(id: string) {
    const lane = lanes().find(item => item.leafId === id);
    if (lane) setDrafts(lane.key, '');
    interaction.resetPointer();
    props.onDismissBranch(id);
  }

  async function submit(key: string, leafId: string) {
    const drafts = props.drafts;
    const update = props.onDraftChange;
    const text = drafts[key] || '';
    if (!text.trim() || props.busy(leafId)) return;
    if (await props.onSubmit(text, leafId) && drafts[key] === text) update(key, '');
  }

  const options = (): ViewOptions => ({ widths: { focused: focusedFitsWindow() ? maxWidth() : widths.focused, side: widths.side },
    focusedFitsWindow: focusedFitsWindow(), presets: [720, 1040, 1280, 1600, 1920, 2240, 2560, 3200] });

  onMount(() => {
    observer.observe(viewport);
    observer.observe(stage);
    observer.observe(jumpUp);
    observer.observe(jumpLatest);
    updateViewport();
    props.onReady({ options,
      setDraft: text => setDrafts(lanes()[focused()].key, text),
      setModeWidth: (target, value) => {
        readingAnchor = captureAnchor();
        batch(() => {
          setWidths(target, value === 'auto' ? maxWidth() : Math.max(480, Math.round(value)));
          if (target === 'focused') setFocusedFitsWindow(value === 'auto');
        });
      },
    });

  });

    function keydown(event: KeyboardEvent) {
      if (!props.active || modalOpen() || event.defaultPrevented || event.isComposing) return;
      interaction.keydown(event);
    }

    createColumnShortcuts({
      enabled: () => props.active,
      codes: ['KeyF', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'],
      onKey: event => {
      interaction.resetPointer();
      if (event.code === 'KeyF') { changeMode(mode() === 'focused' ? 'side' : 'focused'); return; }
      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        centerAfterLayout = true;
        selectLane(focused() + (event.code === 'ArrowRight' ? 1 : -1));
        return;
      }
      const tops = [...sections].filter(([, id]) => !layout().items.get(id)?.hidden)
        .map(([section]) => section.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop).sort((a, b) => a - b);
      const target = event.code === 'ArrowDown' ? tops.find(top => top > viewport.scrollTop + 16) : tops.reverse().find(top => top < viewport.scrollTop + 8);
      viewport.scrollTo({ top: Math.max(0, (target ?? (event.code === 'ArrowUp' ? 12 : viewport.scrollTop + 12)) - 12), left: viewport.scrollLeft, behavior: 'instant' });
    }

    });

    const release = interaction.keyup;
    const blur = interaction.blur;
  onMount(() => {
    updateViewport();
    window.addEventListener('resize', updateViewport);
    onCleanup(() => {
      window.removeEventListener('resize', updateViewport);
    });
  });

  onCleanup(() => observer.disconnect());

  createEffect(on(() => props.focusRequest, request => {
    if (!request || !props.graph.nodes.has(request.id)) return;
    focus(request.id, false, false);
    const lane = lanes().find(item => item.leafId === request.id);
    if (lane) inputElements.get(lane.key)?.focus({ preventScroll: true });
  }));

  createEffect(() => {
    const position = layout();
    updateScroll();
    if (readingAnchor) {
      const node = position.items.get(readingAnchor.id);
      if (node) viewport.scrollTop = node.top - readingAnchor.offset;
      readingAnchor = undefined;
    }
    if (centerAfterLayout) {
      viewport.scrollLeft = Math.max(0, position.inset + (position.starts[focused()] || 0) + workingWidth() / 2 - dimensions().width / 2);
      centerAfterLayout = false;
      updateScroll();
    }
  });

  createEffect(() => {
    const request = scrollRequest();
    if (!request || !viewport) return;
    const position = layout().items.get(request.id);
    if (!position) return;
    const composer = layout().composers[focused()];
    const targetBottom = request.bottom && mode() === 'side' ? composer.top + composer.height : position.top + position.height;
    const top = Math.max(0, Math.min(request.bottom ? targetBottom - dimensions().height + 48 : position.top - 150,
      Math.max(0, layout().height - dimensions().height)));
    const left = Math.max(0, layout().inset + layout().starts[focused()] + workingWidth() / 2 - dimensions().width / 2);
    interaction.setJumping(request.smooth && (Math.abs(viewport.scrollLeft - left) > 1 || Math.abs(viewport.scrollTop - top) > 1));
    viewport.scrollTo({ left, top, behavior: request.smooth ? 'smooth' : 'instant' });
    setScrollRequest(undefined);
    updateScroll();
  });

  const jumps = createMemo(() => {
    const branchHidden = mode() === 'side' && focused() === lanes().length - 1;
    const origin = layout().inset - scroll().left;
    const latestLane = props.graph.leaves.findIndex((leaf: Wire) => leaf.id === props.graph.activeLeaf?.id);
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
    const latest = clamp(origin + (layout().starts[Math.max(0, latestLane)] || 0) + workingWidth() / 2 - jumpSizes().latest / 2,
      branchHidden ? 8 : jumpSizes().branch + 16, window.innerWidth - jumpSizes().latest - 8);
    const right = mode() === 'focused' ? window.innerWidth - jumpSizes().branch - 8 : latest - jumpSizes().branch - 8;

    return { branchHidden, latestHidden: mode() === 'focused', latest,
      branch: clamp(origin + (layout().starts[focused()] || 0) + workingWidth() / 2 - jumpSizes().branch / 2, 8, right) };
  });

  const canvas = <ImageContext.Provider value={props.onImage}><div class="canvas-scroll-shell" classList={{ 'no-horizontal': !layout().hasHorizontal }}>
    <main ref={viewport} id="trace-viewport" class="transcript" aria-label="Conversation tree — scroll vertically through time, horizontally between branches"
      classList={{ 'pan-ready': interaction.space(), panning: interaction.dragging() }}
      {...interaction.handlers}>
      <div ref={stage} class="tree-stage" style={{ width: `${layout().width}px`, height: `${layout().height}px`,
        'grid-template-columns': tracks().columns, 'grid-template-rows': tracks().rows }}>
        <svg class="tree-connections" aria-hidden="true" width={layout().width} height={layout().height}>
          <For each={layout().paths}>{path => <path d={path.d} classList={{ 'fork-connection': path.fork }} />}</For>
        </svg>
        <For each={props.graph.leaves}>{(leaf: Wire, index) => <Show when={leaf.entry.type !== 'branch_draft' && props.graph.prefix.get(leaf.id).captured}>
          <article class="tree-node" hidden={mode() === 'focused' && index() !== focused()}
            style={{ ...tracks().place(layout().inset + layout().starts[index()], spacing().row, workingWidth()), width: `${workingWidth()}px` }}>
            <Card><SystemPromptReference entryId={leaf.id} promptId={versionFor(leaf.id)?.full?.id || ''}
              title={versionFor(leaf.id)?.title} number={versionFor(leaf.id)?.number || 1}
              health={props.health(leaf.id)} onOpen={props.onOpenSystemPrompt} /></Card>
          </article>
        </Show>}</For>
        <For each={nodeIds()}>{id => {
          const node = () => props.graph.nodes.get(id);
          const inheritedKey = () => inheritedVersion(id)?.key;
          const number = () => versionFor(id)?.number;
          const selection = () => node().entry.type === 'branch_draft' && node().entry.draftSourceId ? {
            value: node().entry.draftPromptKey ?? inheritedKey() ?? '',
            options: props.prompts.map(prompt => ({ value: prompt.key,
              label: `${promptLabel(prompt.number, prompt.title)}${prompt.key === inheritedKey() ? ' (inherited)' : ''}` })),
            onChange: (key: string) => props.onSelectBranchPrompt(id, key === inheritedKey() ? undefined : key),
          } : undefined;

          const promptRoot = () => props.graph.prefix.get(id).rootId;
          return <TreeCard id={id} node={node()} position={layout().items.get(id)}
            gridStyle={tracks().place(layout().items.get(id).left, layout().items.get(id).top, layout().items.get(id).span)}
            promptNumber={number()} promptTitle={versionFor(id)?.title} scrollTop={scroll().top}
            promptRowTop={layout().items.get(promptRoot())?.top ?? spacing().row} selection={selection()}
            registerSection={registerSection} width={workingWidth()}
            onBranch={sourceId => props.onBranch(sourceId, props.graph.leaves[layout().items.get(id).column]?.id)} onDismiss={dismissBranch}
            measure={(key, element) => observe(key, element, 'node')} unmeasure={unobserve} />;
        }}</For>
      </div>
    </main>
      <ScrollBar vertical position={scroll().top} client={dimensions().height} extent={Math.max(scroll().height, layout().height)}
        onChange={top => { viewport.scrollTop = top; updateScroll(); }} />
      <ScrollBar position={scroll().left} client={dimensions().width} extent={Math.max(scroll().width, layout().width)}
        onChange={left => { viewport.scrollLeft = left; updateScroll(); }} />
      <div class="canvas-scroll-corner" />
  </div></ImageContext.Provider>;

  const bottom = <div class="bottom">
    <div class="jump-row"><div class="jump-actions" classList={{ 'has-jump-up': !jumps().branchHidden }}>
      <button ref={jumpUp} class="jump-up" hidden={jumps().branchHidden} style={{ left: `${jumps().branch}px` }}
        onClick={() => { const leaf = props.graph.leaves[focused()]; if (leaf) focus(leaf.id, true); }}>Jump to branch’s last message</button>
      <button ref={jumpLatest} id="jump" hidden={jumps().latestHidden} style={{ left: `${jumps().latest}px` }}
        onClick={() => { if (props.graph.activeLeaf) focus(props.graph.activeLeaf.id, true); }}>Jump to last message</button>
    </div></div>
    <div ref={composerRow} class="composer-row" style={{ height: layout().inlineComposers ? '0px' : `${composerHeights[lanes()[focused()].key] || 40}px` }} />
  </div>;

  return <div class="lilim-host" classList={{ 'route-hidden': !props.active, 'tree-mode': true, 'has-horizontal-scrollbar': layout().hasHorizontal }}
    aria-hidden={!props.active} inert={!props.active} tabIndex={-1}
    onKeyDown={keydown} onKeyUp={release} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) blur();
    }}>
    <span class="layout-spacing" ref={spacingProbe} aria-hidden="true" />
    <ChatToolbar active={props.active} mode={mode()} notification={props.notification}
      onOptions={props.onOptions} onMode={changeMode} onFork={adjacentFork} />
    {canvas}
    {bottom}
    <For each={laneKeys()}>{key => {
      let element!: HTMLDivElement;
      let input!: HTMLTextAreaElement;
      const index = () => lanes().findIndex(lane => lane.key === key);
      const lane = () => lanes()[index()];
      const inline = () => layout().inlineComposers;
      onMount(() => { observe(key, element, 'composer'); inputElements.set(key, input); });
      onCleanup(() => { unobserve(element); inputElements.delete(key); });

      return <Portal mount={inline() ? stage : composerRow}>
        <MessageComposer ref={value => { element = value; }} inputRef={value => { input = value; }}
          value={props.drafts[key] || ''} onChange={value => setDrafts(key, value)} leafId={lane()?.leafId}
          label={index() ? `Message draft (not sent), branch ${index() + 1}` : 'Message draft (not sent)'}
          class={inline() ? 'inline-composer' : undefined} hidden={mode() === 'focused' && index() !== focused()}
          style={{ width: `${workingWidth()}px`, 'margin-left': '0',
            left: `${inline() ? layout().composers[index()]?.left || 0 : layout().inset - scroll().left}px`,
            top: inline() ? `${layout().composers[index()]?.top || 0}px` : '0px' }}
          onFocus={() => selectLane(index(), false)} onSubmit={() => submit(key, lane().leafId)}
          running={props.running(lane()?.leafId)} busy={props.busy(lane()?.leafId)}
          onAbort={() => { if (props.running(lane()?.leafId)) props.onAbort(lane().leafId); }} />
      </Portal>;
    }}</For>
  </div>;
}
