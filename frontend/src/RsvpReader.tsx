import { createContext, createSignal, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Lexer, type Token } from 'marked';
import { RsvpEngine, TextTokenizer } from '@rsvp-engine/core';
import { createKeyboardShortcuts } from './keyboard-shortcuts';
import './rsvp-reader.css';

export const RsvpTarget = createContext<(text?: () => string) => void>();

// Consume Markdown tokens as data, never recover text from rendered DOM.
function prose(source: string): string {
  function text(tokens: Token[]): string {
    return tokens.map(token => {
      if (token.type === 'space' || token.type === 'hr') return '\n';
      if (token.type === 'list') return token.items.map((item: { tokens: Token[] }) => text(item.tokens)).join('\n');
      if (token.type === 'table') return [token.header, ...token.rows].map(row => row.map((cell: { tokens: Token[] }) => text(cell.tokens)).join(' ')).join('\n');
      if (token.type === 'br') return '\n';
      if ('tokens' in token && Array.isArray(token.tokens)) return text(token.tokens);
      if ('text' in token && typeof token.text === 'string') return token.text;
      return '';
    }).join('\n');
  }
  return text(Lexer.lex(source));
}

export default function RsvpReader(props: { active: boolean; latest: () => string; target: () => string }) {
  const [open, setOpen] = createSignal(false);
  const [showSpeed, setShowSpeed] = createSignal(false);
  let speedTimer: ReturnType<typeof setTimeout> | undefined;
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  const engine = new RsvpEngine({ tokenizer: new TextTokenizer(), wpm: 300 });
  const [snapshot, setSnapshot] = createSignal(engine.getSnapshot());
  const unsubscribe = engine.subscribe(value => setSnapshot(value));
  const word = () => snapshot().currentItem?.value ?? '';
  const pivot = () => snapshot().currentItem?.ovpIndex ?? 0;
  const focal = () => Array.from(word().slice(pivot()))[0] ?? '';
  function close() {
    clearTimeout(startTimer);
    startTimer = undefined;
    if (engine.state === 'PLAYING') engine.pause();
    setOpen(false);
    clearTimeout(speedTimer);
    setShowSpeed(false);
  }
  function toggle() {
    if (startTimer !== undefined) {
      clearTimeout(startTimer);
      startTimer = undefined;
      return;
    }
    if (engine.state === 'PLAYING') engine.pause();
    else if (engine.totalItems) engine.play();
  }
  function seek(offset: number) {
    clearTimeout(startTimer);
    startTimer = undefined;
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
    const source = prose(props.target() || props.latest());
    if (!source.trim()) return;
    clearTimeout(startTimer);
    startTimer = undefined;
    if (engine.state === 'PLAYING') engine.pause();
    engine.load(source);
    if (!engine.totalItems) return;
    setOpen(true);
    startTimer = setTimeout(() => {
      startTimer = undefined;
      engine.play();
    }, 1000);
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
        <div class="rsvp-word"><span class="rsvp-before">{word().slice(0, pivot())}</span><span class="rsvp-focus">{focal()}</span><span class="rsvp-after">{word().slice(pivot() + focal().length)}</span></div>
      </div>
      <Show when={showSpeed()}><span class="rsvp-speed">{snapshot().wpm} WPM</span></Show>
    </div></div></Show></Portal>;
}
