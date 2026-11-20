import { createContext, createSignal, onCleanup, onMount, Show, For } from 'solid-js';
import { Portal } from 'solid-js/web';
import { rsvpTokens, type StyledRun } from './rsvp-text';
import { RsvpEngine } from '@rsvp-engine/core';
import { createKeyboardShortcuts } from './keyboard-shortcuts';
import { rsvpConfig as config } from './rsvp-config';
import './rsvp-reader.css';

export type HoveredReadingTarget = {
  element: HTMLElement;
  text: () => string;
  toggleSentenceLines?: () => void;
};

export const RsvpTarget = createContext<(target?: HoveredReadingTarget) => void>();

export default function RsvpReader(props: { active: boolean; latest: () => string; target: () => string }) {
  const [open, setOpen] = createSignal(false);
  const [showSpeed, setShowSpeed] = createSignal(false);
  const [starting, setStarting] = createSignal(0);
  let startSequence = 0;
  let speedTimer: ReturnType<typeof setTimeout> | undefined;
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  const engine = new RsvpEngine<string, { emphasis: StyledRun[] }>({ wpm: config.wpm });
  const [snapshot, setSnapshot] = createSignal(engine.getSnapshot());
  const unsubscribe = engine.subscribe(value => setSnapshot(value));
  const word = () => snapshot().currentItem?.value ?? '';
  const pivot = () => snapshot().currentItem?.ovpIndex ?? 0;
  const focal = () => Array.from(word().slice(pivot()))[0] ?? '';
  function styledSlice(start: number, end: number) {
    let offset = 0;
    return (snapshot().currentItem?.meta.emphasis ?? []).flatMap(run => {
      const from = Math.max(0, start - offset);
      const to = Math.min(run.text.length, end - offset);
      offset += run.text.length;
      return to > from ? [{ ...run, text: run.text.slice(from, to) }] : [];
    });
  }
  const markdownEmphasis = config.emphasis === 'all' || config.emphasis === 'markdown';
  const codeEmphasis = config.emphasis === 'all' || config.emphasis === 'code';
  const Styled = (props: { start: number; end: number }) => <For each={styledSlice(props.start, props.end)}>{run => <span classList={{ 'rsvp-bold': markdownEmphasis && run.bold, 'rsvp-italic': markdownEmphasis && run.italic, 'rsvp-strike': markdownEmphasis && run.strike, 'rsvp-code': codeEmphasis && run.code }}>{run.text}</span>}</For>;
  function cancelStart() {
    clearTimeout(startTimer);
    startTimer = undefined;
    setStarting(0);
  }
  function measureUnderline(line: HTMLSpanElement) {
    onMount(() => {
      const focus = line.parentElement!;
      const before = focus.previousElementSibling!;
      const context = document.createElement('canvas').getContext('2d');
      if (!context) return;
      context.font = getComputedStyle(focus).font;
      const metrics = context.measureText(word());
      // Measure only the leading text, excluding the countdown line itself.
      const range = document.createRange();
      range.selectNodeContents(before);
      const start = before.textContent ? range.getBoundingClientRect().left : focus.getBoundingClientRect().left;
      line.style.width = `${Math.max(0, metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight)}px`;
      line.style.left = `${start - focus.getBoundingClientRect().left - metrics.actualBoundingBoxLeft}px`;
    });
  }
  function close() {
    cancelStart();
    if (engine.state === 'PLAYING') engine.pause();
    setOpen(false);
    clearTimeout(speedTimer);
    setShowSpeed(false);
  }
  function toggle() {
    if (startTimer !== undefined) {
      cancelStart();
      return;
    }
    if (engine.state === 'PLAYING') engine.pause();
    else if (engine.totalItems) engine.play();
  }
  function seek(offset: number) {
    cancelStart();
    if (!engine.totalItems) return;
    if (engine.state === 'PLAYING') engine.pause();
    engine.seek(Math.max(0, Math.min(engine.totalItems - 1, engine.currentIndex + offset)));
  }
  function speed(delta: number) {
    engine.setWpm(Math.max(config.minWpm, Math.min(config.maxWpm, engine.wpm + delta)));
    setShowSpeed(true);
    clearTimeout(speedTimer);
    speedTimer = setTimeout(() => setShowSpeed(false), config.speedIndicatorMs);
  }
  createKeyboardShortcuts({ enabled: () => props.active, codes: ['KeyR'], allowInEditor: true, onKey: () => {
    const tokens = rsvpTokens(props.target() || props.latest());
    if (!tokens.length) return;
    cancelStart();
    if (engine.state === 'PLAYING') engine.pause();
    engine.loadTokens(tokens);
    if (!engine.totalItems) return;
    setOpen(true);
    if (config.startDelayMs <= 0) { engine.play(); return; }
    setStarting(++startSequence);
    startTimer = setTimeout(() => {
      startTimer = undefined;
      setStarting(0);
      engine.play();
    }, config.startDelayMs);
  } });
  function key(event: KeyboardEvent) {
    if (event.code === 'Escape') { close(); return; }
    if (event.code === 'Space') { if (!event.repeat) toggle(); }
    else if (event.code === 'ArrowUp') speed(config.speedStep);
    else if (event.code === 'ArrowDown') speed(-config.speedStep);
    else if (event.code === 'ArrowLeft') seek(-config.seekStep);
    else if (event.code === 'ArrowRight') seek(config.seekStep);
    else return;
  }
  createKeyboardShortcuts({
    enabled: () => props.active && open(),
    codes: ['Space', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'],
    modifiers: 'none',
    allowInEditor: true,
    onKey: key,
  });
  onCleanup(() => { clearTimeout(startTimer); clearTimeout(speedTimer); unsubscribe(); engine.destroy(); });
  return <Portal><Show when={open()}><div class="rsvp-overlay" onClick={close}><div class="rsvp-reader" classList={{ 'rsvp-centered': config.alignment === 'center', 'rsvp-no-focus': !config.highlightFocus }} style={{
      '--rsvp-font-family': config.fontFamily,
      '--rsvp-focal-offset': `${config.focalOffsetCh}ch`,
      '--rsvp-font-size': `clamp(${config.fontSize.minPx}px, ${config.fontSize.viewportVw}vw, ${config.fontSize.maxPx}px)`,
      '--rsvp-font-weight': config.fontWeight,
      '--rsvp-bold-weight': config.boldWeight,
      '--rsvp-line-height': config.lineHeight,
      '--rsvp-text-offset-y': `${config.textOffsetYPx}px`,
      '--rsvp-underline-thickness': `${config.underlineThicknessPx}px`,
      '--rsvp-underline-gap': `${config.underlineGapPx}px`,
    }} aria-label="Speed reader" onClick={event => event.stopPropagation()}>
      <div class="rsvp-stage" aria-hidden="true">
        <div class="rsvp-word"><span class="rsvp-before"><Styled start={0} end={pivot()} /></span><span class="rsvp-focus"><Styled start={pivot()} end={pivot() + focal().length} /><Show when={config.countdown && starting()} keyed>{(_sequence) => <span ref={measureUnderline} class="rsvp-start-progress" aria-hidden="true" style={{ '--rsvp-start-delay': `${config.startDelayMs}ms` }} />}</Show></span><span class="rsvp-after"><Styled start={pivot() + focal().length} end={word().length} /></span></div>
      </div>
      <Show when={showSpeed()}><span class="rsvp-speed">{snapshot().wpm} WPM</span></Show>
    </div></div></Show></Portal>;
}
