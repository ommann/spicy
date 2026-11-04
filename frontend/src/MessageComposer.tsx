import { Show, createEffect, createSignal, on, onCleanup, onMount, type JSX } from 'solid-js';
import ScrollableTextarea from './ScrollableTextarea';
import type { AgentHealthStatus } from './AgentHealth';
import './message-composer.css';

interface Props {
  value: string;
  onChange: (text: string) => void;
  onSubmit?: () => void;
  onAbort?: () => void;
  onFocus?: () => void;
  label?: string;
  leafId?: string;
  running?: boolean;
  health?: AgentHealthStatus;
  busy?: boolean;
  class?: string;
  hidden?: boolean;
  style?: JSX.CSSProperties;
  ref?: (element: HTMLDivElement) => void;
  inputRef?: (element: HTMLTextAreaElement) => void;
}

export default function MessageComposer(props: Props) {
  const [size, setSize] = createSignal({ height: 38, scrollable: false });
  let editor!: HTMLDivElement;
  let input!: HTMLTextAreaElement;
  let measure!: HTMLDivElement;

  function resize() {
    if (!input.getClientRects().length) return;

    const style = getComputedStyle(input);
    const lineHeight = parseFloat(style.lineHeight);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const rows = Math.max(5, Math.floor(window.innerHeight / lineHeight * .3));
    const contentHeight = Math.max(38, measure.scrollHeight);
    const height = Math.min(contentHeight, rows * lineHeight + padding);
    const scrollable = contentHeight > height;

    setSize(previous => previous.height === height && previous.scrollable === scrollable ? previous : { height, scrollable });
  }

  createEffect(on([() => props.value, () => props.hidden], resize));

  onMount(() => {
    const observer = new ResizeObserver(resize);
    observer.observe(editor);
    window.addEventListener('resize', resize);

    onCleanup(() => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    });
  });

  return <div class={`message-composer${props.class ? ` ${props.class}` : ''}`}
    hidden={props.hidden} style={props.style}
    ref={element => { editor = element; props.ref?.(element); }}>
    <Show when={props.running}><div class="composer-status">
      <span class="composer-working" role="status" data-status={props.health || 'ready'}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 0v12M1 3l10 6M1 9l10-6" /></svg>Working
      </span>
      <button class="composer-stop text-action" type="button" disabled={props.busy} onClick={props.onAbort}>Stop</button>
    </div></Show>
    <div class="editor" data-leaf-id={props.leafId} style={{ position: 'relative', top: 'auto', margin: '0' }}>
    <ScrollableTextarea ref={element => { input = element; props.inputRef?.(element); }}
      aria-label={props.label || 'Message draft (not sent)'} rows="1" wrap="soft" spellcheck={false}
      value={props.value} style={{ height: `${size().height}px`, 'overflow-y': size().scrollable ? 'auto' : 'hidden' }}
      onInput={event => props.onChange(event.currentTarget.value)} onFocus={props.onFocus}
      onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); props.onSubmit?.(); }
        if (event.key === 'Escape') { event.preventDefault(); props.onAbort?.(); }
      }} />
    <div ref={measure} class="composer-measure" aria-hidden="true">{props.value + '\u200b'}</div>
    </div>
  </div>;
}
