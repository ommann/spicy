import { For, Index, Show, batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { Portal } from 'solid-js/web';
import Card from './Card';
import RsvpReader, { RsvpTarget } from './RsvpReader';
import type { ImageAttachment } from './image-attachments';
import { createColumnInteraction } from './column-interaction';
import { ImageContext, SectionContext } from './conversation-dom';
import type { PreviewImage } from './ImagePreview';
import { modalOpen } from './modal-state';
import ChatToolbar from './ChatToolbar';
import { setViewMode } from './view-mode';
import type { ConversationMode, ConversationViewState } from './conversation-view-state';
import { ChatEntryPart } from './ChatContent';
import MessageComposer from './MessageComposer';
import { branchLabel, setBranchLabel } from './branch-labels';
import BranchLabel from './BranchLabel';
import './branch-labels.css';
import type { ContextWindowUsage } from './context-window';
import ScrollBar from './ScrollBar';
import type { AgentHealthStatus } from './AgentHealth';
import SystemPromptPlaceholder from './SystemPromptPlaceholder';
import { createKeyboardShortcuts } from './keyboard-shortcuts';
import type { Wire } from './types';
import type { PromptVersion } from './SystemPromptRoute';
import type { SelectOption } from './SelectWithDialog';
import { systemPromptText } from './system-prompts.js';

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
  mode: ConversationMode;
  onMode: (mode: ConversationMode) => void;
  modeHref: (mode: ConversationMode) => string;
  viewState: ConversationViewState;
  layout: (graph: Wire, options: {
    mode: ConversationMode; width: number; viewportWidth: number; viewportHeight: number; lane: number;
    heights: Record<string, number>; composerHeights: Record<string, number>; rowGap: number; columnGap: number; edgeGap: number;
  }) => Wire;
  children: (view: ConversationView) => JSX.Element;
  graph: Wire;
  lanes: Wire[];
  drafts: Record<string, string>;
  onDraftChange: (key: string, text: string) => void;
  active: boolean;
  running: (leafId: string) => boolean;
  health: (leafId: string) => AgentHealthStatus;
  contextUsage?: (leafId: string) => ContextWindowUsage | null | undefined;
  busy: (leafId: string) => boolean;
  onFocusLeaf: (leafId: string) => void;
  focusRequest?: { id: string; revision: number };
  notification: { message: string; isError: boolean };
  onReady: (controller: ConversationController | undefined) => void;
  onSubmit: (text: string, leafId: string, images?: ImageAttachment[]) => Promise<boolean>;
  onBranch: (sourceId: string, anchorId?: string) => void;
  onDismissBranch: (id: string) => void;
  prompts: PromptVersion[];
  onSelectBranchPrompt: (id: string, key?: string) => void;
  pendingPromptKey?: (id: string) => string | undefined;
  systemPromptHref: (id: string) => string;
  onImage: (image: PreviewImage) => void;
  onAbort: (leafId: string) => void;
  onOptions: () => void;
}

export type ConversationRouteProps = Omit<Props, 'mode' | 'layout' | 'children'>;

export interface ConversationView {
  props: Props;
  nodeIds: () => string[];
  focused: () => number;
  layout: () => Wire;
  spacing: () => { row: number; column: number; edge: number };
  gridPlacement: (left: number, top: number, width: number) => JSX.CSSProperties;
  workingWidth: () => number;
  scroll: () => { top: number; left: number; width: number; height: number };
  inheritedVersion: (id: string) => PromptVersion | undefined;
  versionFor: (id: string) => PromptVersion | undefined;
  registerSection: (id: string, element: HTMLElement) => () => void;
  observe: (id: string, element: Element, kind: 'node' | 'composer') => void;
  unobserve: (element: Element) => void;
  dismissBranch: (id: string) => void;
}

export function ConversationCard(props: { id: string; node: Wire; position: Wire; gridStyle: JSX.CSSProperties; promptNumber?: number; promptTitle?: string; scrollTop: number; promptRowTop: number;
  selection?: { value: string; options: SelectOption[]; onChange: (value: string) => void };
  registerSection: (id: string, element: HTMLElement) => () => void;
  width: number; onBranch: (id: string) => void; onDismiss: (id: string) => void; measure: (id: string, element: Element) => void; unmeasure: (element: Element) => void }) {
  let element!: HTMLElement;
  // Graph projections are immutable snapshots. Reconcile them into a persistent
  // store so unchanged historical blocks retain identity across streaming updates.
  const [content, setContent] = createStore<{ parts: Wire[] }>({ parts: [] });
  const projected = createMemo(() => props.node.parts);
  createEffect(() => setContent('parts', reconcile(projected(), { key: null, merge: true })));

  onMount(() => props.measure(props.id, element));
  onCleanup(() => props.unmeasure(element));

  return <SectionContext.Provider value={element => {
    createEffect(() => {
      const dispose = props.registerSection(props.id, element);
      onCleanup(dispose);
    });
  }}><article class="tree-node" classList={{ 'prefix-preview': props.node.isPrefixDelta }} data-entry-id={props.id}
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
      <Index each={content.parts}>{part => <ChatEntryPart part={part()} onBranch={props.onBranch} />}</Index>
    </Card>
  </article></SectionContext.Provider>;
}

export default function Conversation(props: Props) {
  const mode = () => props.mode;
  const [labelMuted, setLabelMuted] = createSignal(false);
  const [labelArea, setLabelArea] = createSignal({ left: 0, top: 0, width: 0, height: 0 });
  onMount(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const activity = () => {
      if (!props.active) return;
      setLabelMuted(true);
      clearTimeout(timer);
      timer = setTimeout(() => setLabelMuted(false), 60_000);
    };
    const events = ['keydown', 'pointerdown', 'scroll'] as const;
    for (const event of events) document.addEventListener(event, activity, { capture: true, passive: true });
    onCleanup(() => {
      clearTimeout(timer);
      for (const event of events) document.removeEventListener(event, activity, true);
    });
  });
  const [viewState, setViewState] = props.viewState;
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
  const widths = viewState.widths;
  const focusedFitsWindow = () => viewState.focusedFitsWindow;
  const selectedLane = () => lanes().findIndex(lane => lane.key === viewState.selectedKey);
  const setSelectedLane = (index: number) => setViewState('selectedKey', lanes()[index]?.key || '');
  const [dimensions, setDimensions] = createSignal({ width: window.innerWidth, height: Math.max(0, window.innerHeight - 42) });
  const [scroll, setScroll] = createSignal({ left: 0, top: 0, width: 0, height: 0 });
  const [heights, setHeights] = createStore<Record<string, number>>({});
  const [composerHeights, setComposerHeights] = createStore<Record<string, number>>({});
  const setDrafts = (key: string, text: string) => props.onDraftChange(key, text);
  const [jumpSizes, setJumpSizes] = createSignal({ branch: 0, latest: 0 });
  const [scrollRequest, setScrollRequest] = createSignal<{ id: string; bottom: boolean; smooth: boolean }>();
  // An explicit view switch carries the current reading location across routes.
  // Destination-specific history is only a fallback for ordinary navigation.
  const transition = viewState.modeTransition?.mode === props.mode ? viewState.modeTransition : undefined;
  const savedPosition = transition?.position ?? viewState.positions[props.mode] ?? viewState.lastPosition;
  if (transition) setViewState('modeTransition', undefined);
  const [restoringTransition, setRestoringTransition] = createSignal(!!transition?.position.anchor);
  let followLatest = savedPosition?.followLatest ?? true;
  // Layout-model coordinates start inside the viewport's content padding.
  const contentInset = () => viewport ? Number.parseFloat(getComputedStyle(viewport).paddingTop) || 0 : 0;
  function focusedFollowTop() {
    return Math.max(0, layout().height + contentInset() * 2 - dimensions().height);
  }
  function handleViewportScroll() {
    if (viewport && mode() === 'focused') {
      const nearBottom = focusedFollowTop() - viewport.scrollTop <= 48;
      if (nearBottom) followLatest = true;
      else if (viewport.scrollTop < scroll().top - 1) followLatest = false;
    }
    updateScroll();
  }
  const interaction = createColumnInteraction({
    viewport: () => viewport, enabled: () => props.active && mode() === 'side',
    columns: () => ({ inset: layout().inset, starts: layout().starts, width: workingWidth() }),
    onColumn: lane => {
      if (layout().starts[lane] !== layout().starts[focused()]) selectLane(lane);
    }, onScroll: handleViewportScroll,
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
  const focused = () => Math.max(0, Math.min(selectedLane(), lanes().length - 1));
  // Tree hover only chooses where shared history is drawn. Selecting its agent
  // also changes the session URL, so only the explicit single view commits it.
  createEffect(on(() => props.active && mode() === 'focused' ? lanes()[focused()]?.leafId : undefined,
    id => { if (id) props.onFocusLeaf(id); }));
  const maxWidth = () => Math.max(480, dimensions().width - spacing().edge * 2);
  const workingWidth = () => mode() === 'focused' && focusedFitsWindow() ? maxWidth() : widths[mode()];
  const layout = createMemo(() => props.layout(props.graph, {
    mode: mode(), width: workingWidth(), viewportWidth: dimensions().width, viewportHeight: dimensions().height,
    lane: focused(), heights, rowGap: spacing().row, columnGap: spacing().column, edgeGap: spacing().edge, composerHeights: Object.fromEntries(lanes().map((lane, index) => [index, composerHeights[lane.key] || 40])),
  }));
  const nodeIds = createMemo<string[]>(() => {
    const ids: string[] = mode() === 'focused' ? [...layout().items.keys()] : props.graph.ids;
    return ids.filter(id => props.graph.nodes.get(id).entry.message?.role !== 'system');
  }, [], { equals: (previous, next) => previous.length === next.length && previous.every((id, index) => id === next[index]) });
  const laneKeys = createMemo(() => mode() === 'focused' ? [lanes()[focused()].key as string] : lanes().map(lane => lane.key as string));
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
      x, y,
    };
  });
  function gridPlacement(left: number, top: number, width: number): JSX.CSSProperties {
    const { x, y } = tracks();
    return {
      'grid-column': `${x.indexOf(left) + 1} / ${x.indexOf(left + width) + 1}`,
      'grid-row': y.indexOf(top) + 1,
    };
  }
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
  let pointer = viewState.pointer;
  let readingAnchor = savedPosition?.anchor;
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
    const rect = viewport.getBoundingClientRect();
    setLabelArea(previous => previous.left === rect.left && previous.top === rect.top
      && previous.width === width && previous.height === height ? previous
      : { left: rect.left, top: rect.top, width, height });
    if (width || height) setDimensions(previous => previous.width === width && previous.height === height ? previous : { width, height });
    const branch = jumpUp?.getBoundingClientRect().width || 0;
    const latest = jumpLatest?.getBoundingClientRect().width || 0;
    setJumpSizes(previous => {
      const next = { branch: branch || previous.branch, latest: latest || previous.latest };
      return next.branch === previous.branch && next.latest === previous.latest ? previous : next;
    });
    updateScroll();
  }

  function captureAnchor(lane = focused(), underCursor = false): NonNullable<typeof savedPosition>['anchor'] {
    if (underCursor && pointer) {
      if (viewState.cursorAnchor) return viewState.cursorAnchor;
      const element = document.elementFromPoint(pointer.x, pointer.y);
      const article = element?.closest<HTMLElement>('article.tree-node[data-entry-id]');
      if (element && article && viewport.contains(article)) {
        const elementPath: number[] = [];
        let child: Element = element;
        while (child !== article && child.parentElement) {
          elementPath.unshift(Array.from(child.parentElement.children).indexOf(child));
          child = child.parentElement;
        }
        const anchor = { id: article.dataset.entryId!, elementPath,
          offset: element.getBoundingClientRect().top - viewport.getBoundingClientRect().top };
        setViewState('cursorAnchor', anchor);
        return anchor;
      }
    }
    const positions = layout().items;
    const candidates = [...props.graph.nodes.values()].filter((node: Wire) => positions.has(node.id) && !node.isPrefixDelta && node.first <= lane && node.last >= lane)
      .sort((a: Wire, b: Wire) => positions.get(a.id).top - positions.get(b.id).top);
    const node = candidates.find((item: Wire) => {
      const position = positions.get(item.id);
      return contentInset() + position.top + position.height >= viewport.scrollTop + 40;
    }) || candidates.at(-1);
    return node ? { id: node.id, offset: contentInset() + positions.get(node.id).top - viewport.scrollTop } : undefined;
  }

  function selectLane(lane: number, preserveReading = true) {
    const next = Math.max(0, Math.min(lanes().length - 1, lane));
    if (next === focused()) return;
    // Tree lanes share vertical geometry; hover must not restore a reading
    // anchor (and feed a programmatic scroll back into pointer selection).
    if (preserveReading && mode() === 'focused') readingAnchor = captureAnchor();
    setSelectedLane(next);
  }

  function changeMode(value: 'focused' | 'side', navigate = true) {
    if (value === mode()) return;
    const anchor = captureAnchor(focused(), true);
    setViewState('modeTransition', { mode: value, position: { anchor, followLatest: false } });
    interaction.resetPointer();
    centerAfterLayout = true;
    setViewMode(value);
    if (navigate) props.onMode(value);
  }

  function focus(id: string, bottom = false, smooth = true) {
    const node = props.graph.nodes.get(id);
    if (!node) return;
    interaction.resetPointer();
    followLatest = bottom;
    selectLane(Math.max(node.first, Math.min(node.last, focused())), false);
    setScrollRequest({ id, bottom, smooth });
  }

  function dismissBranch(id: string) {
    const lane = lanes().find(item => item.leafId === id);
    if (lane) setDrafts(lane.key, '');
    interaction.resetPointer();
    props.onDismissBranch(id);
  }

  async function submit(key: string, leafId: string, images: ImageAttachment[] = []) {
    const drafts = props.drafts;
    const update = props.onDraftChange;
    const text = drafts[key] || '';
    if (/^\/label(?:\s|$)/i.test(text.trim())) {
      const args = text.trim().split(/\s+/).slice(1);
      const clear = args.length === 1 && args[0].toLowerCase() === 'clear';
      const label = args[0]?.toUpperCase();
      const color = args[1]?.toLowerCase();
      if (images.length || (!clear && (args.length !== 2
        || !/^[a-z]+$/.test(color) || !CSS.supports('color', color)))) {
        window.alert('Use /label TEXT blue (text and a color name), or /label clear. No attachments.');
        return false;
      }
      try { setBranchLabel(key, clear ? undefined : { text: label, color }); }
      catch { window.alert('Could not save the branch label to LocalStorage.'); return false; }
      update(key, '');
      return true;
    }
    if ((!text.trim() && !images.length) || props.busy(leafId)) return false;
    const accepted = await props.onSubmit(text, leafId, images);
    if (accepted && drafts[key] === text) update(key, '');
    return accepted;
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
          setViewState('widths', target, value === 'auto' ? maxWidth() : Math.max(480, Math.round(value)));
          if (target === 'focused') setViewState('focusedFitsWindow', value === 'auto');
        });
      },
    });

  });

    function keydown(event: KeyboardEvent) {
      if (!props.active || modalOpen() || event.defaultPrevented || event.isComposing) return;
      interaction.keydown(event);
    }

    createKeyboardShortcuts({
      enabled: () => props.active,
      codes: ['KeyF', 'ArrowUp', 'ArrowDown'],
      onKey: event => {
      interaction.resetPointer();
      if (event.code === 'KeyF') { changeMode(mode() === 'focused' ? 'side' : 'focused'); return; }
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
    const trackPointer = (event: PointerEvent) => {
      if (pointer?.x !== event.clientX || pointer?.y !== event.clientY) setViewState('cursorAnchor', undefined);
      pointer = { x: event.clientX, y: event.clientY };
      setViewState('pointer', pointer);
    };
    const clearCursorAnchor = () => setViewState('cursorAnchor', undefined);
    viewport.addEventListener('wheel', clearCursorAnchor, { passive: true });
    viewport.addEventListener('pointerdown', clearCursorAnchor);
    window.addEventListener('pointermove', trackPointer);
    window.addEventListener('resize', updateViewport);
    onCleanup(() => {
      viewport.removeEventListener('wheel', clearCursorAnchor);
      viewport.removeEventListener('pointerdown', clearCursorAnchor);
      window.removeEventListener('pointermove', trackPointer);
      window.removeEventListener('resize', updateViewport);
    });
  });

  onCleanup(() => {
    props.onReady(undefined);
    const position = { anchor: captureAnchor(), followLatest };
    setViewState('positions', props.mode, position);
    setViewState('lastPosition', position);
    observer.disconnect();
  });

  createEffect(on(() => props.focusRequest, request => {
    if (!request || request.revision === viewState.appliedFocusRevision || !props.graph.nodes.has(request.id)) return;
    setViewState('appliedFocusRevision', request.revision);
    focus(request.id, false, false);
    const lane = lanes().find(item => item.leafId === request.id);
    if (lane) inputElements.get(lane.key)?.focus({ preventScroll: true });
  }));

  createEffect(() => {
    const position = layout();
    updateScroll();
    if (readingAnchor) {
      followLatest = false;
      const node = position.items.get(readingAnchor.id);
      if (node) {
        let element: Element | undefined = nodeElements.get(readingAnchor.id)?.closest('article.tree-node') ?? undefined;
        for (const index of readingAnchor.elementPath ?? []) element = element?.children[index];
        if (readingAnchor.elementPath && element) {
          viewport.scrollTop += element.getBoundingClientRect().top - viewport.getBoundingClientRect().top - readingAnchor.offset;
        } else viewport.scrollTop = contentInset() + node.top - readingAnchor.offset;
        updateScroll();
      }
      if (!restoringTransition()) readingAnchor = undefined;
    }
    if (centerAfterLayout) {
      viewport.scrollLeft = Math.max(0, position.inset + (position.starts[focused()] || 0) + workingWidth() / 2 - dimensions().width / 2);
      centerAfterLayout = false;
      updateScroll();
    }
    if (mode() === 'focused' && followLatest) {
      // Measured card heights change as tokens arrive. Follow the new geometry
      // immediately rather than restarting a smooth animation on every token.
      viewport.scrollTop = focusedFollowTop();
      updateScroll();
    }
  });

  createEffect(() => {
    const request = scrollRequest();
    if (!request || !viewport) return;
    const position = layout().items.get(request.id);
    if (!position) return;
    const composer = layout().composers[focused()];
    const targetBottom = contentInset() + (request.bottom && mode() === 'side' ? composer.top + composer.height : position.top + position.height);
    const top = request.bottom && mode() === 'focused' ? focusedFollowTop()
      : Math.max(0, Math.min(request.bottom ? targetBottom - dimensions().height + 48 : contentInset() + position.top - 150,
        Math.max(0, layout().height + contentInset() * 2 - dimensions().height)));
    const left = Math.max(0, layout().inset + layout().starts[focused()] + workingWidth() / 2 - dimensions().width / 2);
    interaction.setJumping(request.smooth && (Math.abs(viewport.scrollLeft - left) > 1 || Math.abs(viewport.scrollTop - top) > 1));
    viewport.scrollTo({ left, top, behavior: request.smooth ? 'smooth' : 'instant' });
    setScrollRequest(undefined);
    updateScroll();
  });

  const latestMessage = createMemo(() => {
    let latest: Wire | undefined;
    let timestamp = -Infinity;
    for (const node of props.graph.nodes.values()) {
      if (node.entry.type !== 'compaction' && !['user', 'assistant'].includes(node.entry.message?.role)) continue;
      const time = Number(node.entry.message?.timestamp) || Date.parse(node.entry.timestamp) || 0;
      if (time >= timestamp) { latest = node; timestamp = time; }
    }
    return latest;
  });

  // Keep the anchor alive through initial layout and ResizeObserver delivery.
  // Otherwise the first estimate wins, and wrapping differences move the text.
  onMount(() => {
    if (!restoringTransition()) return;
    let frame = 0;
    let previous = '';
    let stableFrames = 0;
    let attempts = 0;
    const settle = () => {
      batch(() => {
        for (const element of observed.keys()) measure(element);
        updateViewport();
      });
      if (readingAnchor?.elementPath) {
        let element: Element | undefined = nodeElements.get(readingAnchor.id)?.closest('article.tree-node') ?? undefined;
        for (const index of readingAnchor.elementPath) element = element?.children[index];
        if (element) {
          viewport.scrollTop += element.getBoundingClientRect().top - viewport.getBoundingClientRect().top - readingAnchor.offset;
          updateScroll();
        }
      }
      const position = layout();
      const signature = `${position.items.get(readingAnchor?.id)?.top}:${position.height}:${dimensions().width}:${dimensions().height}`;
      stableFrames = signature === previous ? stableFrames + 1 : 0;
      previous = signature;
      if (stableFrames >= 2 || ++attempts >= 12) {
        readingAnchor = undefined;
        setRestoringTransition(false);
      } else frame = requestAnimationFrame(settle);
    };
    frame = requestAnimationFrame(settle);
    onCleanup(() => cancelAnimationFrame(frame));
  });

  let initialScrollPending = !viewState.initialized && !transition;
  createEffect(() => {
    const latest = latestMessage();
    if (!initialScrollPending || !latest || !props.active) return;
    const frame = requestAnimationFrame(() => {
      initialScrollPending = false;
      setViewState('initialized', true);
      batch(() => {
        for (const element of observed.keys()) measure(element);
        updateViewport();
      });
      focus(latest.id, true, false);
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });

  const jumps = createMemo(() => {
    const latestLane = latestMessage()?.first ?? 0;
    const branchHidden = mode() === 'focused'
      ? scroll().top >= focusedFollowTop() - 2
      : focused() === latestLane;
    const origin = layout().inset - scroll().left;
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
    const latest = clamp(origin + (layout().starts[Math.max(0, latestLane)] || 0) + workingWidth() / 2 - jumpSizes().latest / 2,
      8, window.innerWidth - jumpSizes().latest - 8);

    return { branchHidden, latestHidden: mode() === 'focused', latest,
      branch: clamp(origin + (layout().starts[focused()] || 0) + workingWidth() / 2 - jumpSizes().branch / 2,
        8, window.innerWidth - jumpSizes().branch - 8) };
  });

  function openImage(image: PreviewImage) { props.onImage(image); }

  const view: ConversationView = { props, nodeIds, focused, layout, spacing, gridPlacement, workingWidth, scroll,
    inheritedVersion, versionFor, registerSection, observe, unobserve, dismissBranch };

  const [readingTarget, setReadingTarget] = createSignal<(() => string)>();
  const canvas = <ImageContext.Provider value={openImage}><div class="canvas-scroll-shell" classList={{ 'no-horizontal': !layout().hasHorizontal }}>
    <main ref={viewport} id="trace-viewport" class="transcript" aria-label={mode() === 'focused' ? 'Conversation — selected branch' : 'Conversation tree — scroll vertically through time, horizontally between branches'}
      classList={{ 'pan-ready': interaction.space(), panning: interaction.dragging() }}
      {...interaction.handlers}>
      <div ref={stage} class="tree-stage" style={{ width: `${layout().width}px`, height: `${layout().height}px`,
        'grid-template-columns': tracks().columns, 'grid-template-rows': tracks().rows }}>
        <RsvpTarget.Provider value={text => setReadingTarget(() => text)}>{props.children(view)}</RsvpTarget.Provider>
      </div>
    </main>
      <ScrollBar vertical position={scroll().top} client={dimensions().height} extent={Math.max(scroll().height, layout().height)}
        onChange={top => { viewport.scrollTop = top; handleViewportScroll(); }} />
      <ScrollBar position={scroll().left} client={dimensions().width} extent={Math.max(scroll().width, layout().width)}
        onChange={left => { viewport.scrollLeft = left; updateScroll(); }} />
      <div class="canvas-scroll-corner" />
  </div></ImageContext.Provider>;

  const bottom = <div class="bottom">
    <div class="jump-row"><div class="jump-actions" classList={{ 'has-jump-up': !jumps().branchHidden }}>
      <button ref={jumpUp} class="jump-up" hidden={jumps().branchHidden} style={{ left: `${jumps().branch}px` }}
        onClick={() => { const leaf = props.graph.leaves[focused()]; if (leaf) focus(leaf.id, true); }}>{mode() === 'focused' ? 'Jump to end' : 'Jump to branch’s end'}</button>
      <button ref={jumpLatest} id="jump" hidden={jumps().latestHidden} style={{ left: `${jumps().latest}px` }}
        onClick={() => { const latest = latestMessage(); if (latest) focus(latest.id, true); }}>Jump to latest message</button>
    </div></div>
    <div ref={composerRow} class="composer-row" style={{ height: layout().inlineComposers ? '0px' : `${composerHeights[lanes()[focused()].key] || 40}px` }} />
  </div>;

  const latestReadingText = () => {
    for (const id of [...nodeIds()].reverse()) {
      if (layout().items.get(id)?.hidden) continue;
      const parts = props.graph.nodes.get(id)?.parts || [];
      for (const part of [...parts].reverse()) {
        if (part.kind === 'message' && part.text) return part.text as string;
      }
    }
    return '';
  };
  return <div class="spicy-host" classList={{ 'route-hidden': !props.active, 'tree-mode': true, 'single-mode': mode() === 'focused', 'has-horizontal-scrollbar': layout().hasHorizontal }}
    aria-hidden={!props.active} inert={!props.active} tabIndex={-1}
    onKeyDown={keydown} onKeyUp={release} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) blur();
    }}>
    <RsvpReader active={props.active} latest={latestReadingText} target={() => readingTarget()?.() || ''} />
    <span class="layout-spacing" ref={spacingProbe} aria-hidden="true" />
    <ChatToolbar active={props.active} mode={mode()} notification={props.notification}
      onOptions={props.onOptions} onMode={changeMode}
      modeHref={props.modeHref} onModeLink={mode => changeMode(mode, false)} />
    {canvas}
    {bottom}
    <For each={laneKeys()}>{key => {
      let element!: HTMLDivElement;
      let input!: HTMLTextAreaElement;
      const index = () => lanes().findIndex(lane => lane.key === key);
      const lane = () => lanes()[index()];
      const history = createMemo(() => {
        const prompts: string[] = [];
        const seen = new Set<string>();
        let id = lane()?.leafId;
        while (id && !seen.has(id)) {
          seen.add(id);
          const entry = props.graph.raw.get(id);
          if (!entry) break;
          if (entry.message?.role === 'user') {
            const content = entry.message.content;
            const text = typeof content === 'string' ? content : (content || [])
              .filter((block: Wire) => block.type === 'text').map((block: Wire) => block.text).join('\n');
            if (text) prompts.push(text);
          }
          id = entry.parentId;
        }
        return prompts.reverse();
      });
      const inline = createMemo(() => layout().inlineComposers);
      onMount(() => { observe(key, element, 'composer'); inputElements.set(key, input); });
      onCleanup(() => { unobserve(element); inputElements.delete(key); });

      return <Portal mount={inline() ? stage : composerRow}>
        <Portal mount={mode() === 'focused' ? document.body : stage}>
        <Show when={props.active && branchLabel(key)}>{label =>
          <BranchLabel text={label().text} color={label().color} screen={mode() === 'focused'} muted={labelMuted()}
            style={{ width: mode() === 'focused' ? `${labelArea().width}px` : `${workingWidth()}px`,
              height: mode() === 'focused' ? `${Math.min(525, labelArea().height * 0.9)}px` : undefined,
              left: mode() === 'focused' ? `${labelArea().left}px` : `${layout().composers[index()]?.left || 0}px`,
              top: mode() === 'focused' ? `${labelArea().top + labelArea().height / 2}px` : `${(layout().composers[index()]?.top || 0) - 545}px` }} />
        }</Show>
        </Portal>
        <MessageComposer ref={value => { element = value; }} inputRef={value => { input = value; }}
          placeholder={branchLabel(key)?.text}
          value={props.drafts[key] || ''} history={history()} onChange={value => setDrafts(key, value)} leafId={lane()?.leafId}
          images={viewState.images[key] || []} onImagesChange={images => setViewState('images', key, images)}
          label={index() ? `Message draft (not sent), branch ${index() + 1}` : 'Message draft (not sent)'}
          class={inline() ? 'inline-composer' : undefined} hidden={mode() === 'focused' && index() !== focused()}
          style={{ width: `${workingWidth()}px`, 'margin-left': '0',
            left: `${inline() ? layout().composers[index()]?.left || 0 : layout().inset - scroll().left}px`,
            top: inline() ? `${layout().composers[index()]?.top || 0}px` : '0px' }}
          onFocus={() => selectLane(index(), false)} onSubmit={images => submit(key, lane().leafId, images)}
          running={props.running(lane()?.leafId)} health={props.health(lane()?.leafId)} busy={props.busy(lane()?.leafId)}
          contextUsage={props.contextUsage?.(lane()?.leafId)}
          onAbort={() => { if (props.running(lane()?.leafId)) props.onAbort(lane().leafId); }} />
      </Portal>;
    }}</For>
  </div>;
}
