import { createContext, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { rsvpText } from './rsvp-text';
import { RsvpEngine, TextTokenizer } from '@rsvp-engine/core';
import { createKeyboardShortcuts } from './keyboard-shortcuts';
import './rsvp-reader.css';

const START_DELAY_MS = 500;

export const RsvpTarget = createContext<(text?: () => string) => void>();

export default function RsvpReader(props: { active: boolean; latest: () => string; target: () => string }) {
  const [open, setOpen] = createSignal(false);
  const [showSpeed, setShowSpeed] = createSignal(false);
  const [starting, setStarting] = createSignal(0);
  let startSequence = 0;
  let speedTimer: ReturnType<typeof setTimeout> | undefined;
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  const engine = new RsvpEngine({ tokenizer: new TextTokenizer(), wpm: 400 });
  const [snapshot, setSnapshot] = createSignal(engine.getSnapshot());
  const unsubscribe = engine.subscribe(value => setSnapshot(value));
  const word = () => snapshot().currentItem?.value ?? '';
  const pivot = () => snapshot().currentItem?.ovpIndex ?? 0;
  const focal = () => Array.from(word().slice(pivot()))[0] ?? '';
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
    engine.setWpm(Math.max(100, Math.min(1000, engine.wpm + delta)));
    setShowSpeed(true);
    clearTimeout(speedTimer);
    speedTimer = setTimeout(() => setShowSpeed(false), 1200);
  }
  createKeyboardShortcuts({ enabled: () => props.active, codes: ['KeyR'], allowInEditor: true, onKey: () => {
    const source = rsvpText(props.target() || props.latest());
    if (!source.trim()) return;
    cancelStart();
    if (engine.state === 'PLAYING') engine.pause();
    engine.load(source);
    if (!engine.totalItems) return;
    setOpen(true);
    setStarting(++startSequence);
    startTimer = setTimeout(() => {
      startTimer = undefined;
      setStarting(0);
      engine.play();
    }, START_DELAY_MS);
  } });
  function key(event: KeyboardEvent) {
    if (event.code === 'Escape') { close(); return; }
    if (event.code === 'Space') { if (!event.repeat) toggle(); }
    else if (event.code === 'ArrowUp') speed(25);
    else if (event.code === 'ArrowDown') speed(-25);
    else if (event.code === 'ArrowLeft') seek(-10);
    else if (event.code === 'ArrowRight') seek(10);
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
  return <Portal><Show when={open()}><div class="rsvp-overlay" onClick={close}><div class="rsvp-reader" aria-label="Speed reader" onClick={event => event.stopPropagation()}>
      <div class="rsvp-stage" aria-hidden="true">
        <div class="rsvp-word"><span class="rsvp-before">{word().slice(0, pivot())}</span><span class="rsvp-focus">{focal()}<Show when={starting()} keyed>{() => <span ref={measureUnderline} class="rsvp-start-progress" aria-hidden="true" style={{ '--rsvp-start-delay': `${START_DELAY_MS}ms` }} />}</Show></span><span class="rsvp-after">{word().slice(pivot() + focal().length)}</span></div>
      </div>
      <Show when={showSpeed()}><span class="rsvp-speed">{snapshot().wpm} WPM</span></Show>
    </div></div></Show></Portal>;
}
