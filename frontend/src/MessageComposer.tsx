import { For, Show, createEffect, createSignal, on, onCleanup, onMount, type JSX } from 'solid-js';
import ScrollableTextarea from './ScrollableTextarea';
import type { AgentHealthStatus } from './AgentHealth';
import './message-composer.css';
import { pasteImagePaths } from './image-paste-mode';
import { clipboardImages, imageSource, type ImageAttachment } from './image-attachments';

interface Props {
  value: string;
  history?: string[];
  onChange: (text: string) => void;
  onSubmit?: (images?: ImageAttachment[]) => void | boolean | Promise<boolean>;
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
  let historyIndex: number | undefined;
  let unsentDraft = '';
  function navigateHistory(event: KeyboardEvent) {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || input.selectionStart !== input.selectionEnd) return;
    const older = event.key === 'ArrowUp';
    if (!older && event.key !== 'ArrowDown') return;
    const caret = input.selectionStart;
    if (older ? input.value.slice(0, caret).includes('\n') : input.value.slice(caret).includes('\n')) return;
    const history = props.history || [];
    if (!history.length || (!older && historyIndex === undefined)) return;
    event.preventDefault();
    if (historyIndex === undefined) {
      unsentDraft = props.value;
      historyIndex = history.length;
    }
    historyIndex = Math.max(0, Math.min(history.length, historyIndex + (older ? -1 : 1)));
    const value = historyIndex === history.length ? unsentDraft : history[historyIndex];
    if (historyIndex === history.length) historyIndex = undefined;
    props.onChange(value);
    input.value = value;
    input.setSelectionRange(value.length, value.length);
  }
  const [images, setImages] = createSignal<ImageAttachment[]>([]);
  const [pasting, setPasting] = createSignal(false);
  const [attachmentError, setAttachmentError] = createSignal('');
  async function submit() {
    if (pasting() || props.busy) return;
    historyIndex = undefined;
    const sent = images();
    if (await props.onSubmit?.(sent) === true) setImages(current => current.filter(image => !sent.includes(image)));
  }
  async function paste(event: ClipboardEvent) {
    if (!event.clipboardData || !Array.from(event.clipboardData.items).some(item => item.kind === 'file' && item.type.startsWith('image/'))) return;
    event.preventDefault();
    const items = event.clipboardData.items;
    const asPaths = pasteImagePaths();
    setPasting(true);
    setAttachmentError('');
    try {
      const pasted = await clipboardImages(items);
      if (!pasted.length) throw new Error('Unsupported image format');
      if (asPaths) {
        const info = await fetch('/api/info').then(response => response.json());
        const response = await fetch('/api/attachments', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Spicy-Token': info.token }, body: JSON.stringify({ images: pasted }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not save image');
        input.setRangeText(result.paths.join('\n'), input.selectionStart, input.selectionEnd, 'end');
        props.onChange(input.value);
      } else setImages(current => [...current, ...pasted]);
    }
    catch (error) { setAttachmentError(error instanceof Error ? error.message : String(error)); }
    finally { setPasting(false); }
  }
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
      <button class="composer-stop text-action" type="button" disabled={props.busy} onClick={() => props.onAbort?.()}>Stop</button>
    </div></Show>
    <Show when={pasting()}><span role="status">Saving image…</span></Show>
    <Show when={images().length}><div class="composer-attachments" aria-label="Attached images">
      <For each={images()}>{image => <div><img src={imageSource(image)} alt="Attached image" />
        <button type="button" aria-label="Remove attached image" onClick={() => setImages(current => current.filter(item => item !== image))}>Remove</button></div>}</For>
    </div></Show>
    <Show when={attachmentError()}><div role="alert">{attachmentError()}</div></Show>
    <div class="editor" data-leaf-id={props.leafId} style={{ position: 'relative', top: 'auto', margin: '0' }}>
    <ScrollableTextarea ref={element => { input = element; props.inputRef?.(element); }}
      aria-label={props.label || 'Message draft (not sent)'} rows="1" wrap="soft" spellcheck={false}
      value={props.value} style={{ height: `${size().height}px`, 'overflow-y': size().scrollable ? 'auto' : 'hidden' }}
      onPaste={paste}
      onInput={event => { historyIndex = undefined; props.onChange(event.currentTarget.value); }} onFocus={props.onFocus}
      onKeyDown={event => {
        navigateHistory(event);
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void submit(); }
        if (event.key === 'Escape') { event.preventDefault(); props.onAbort?.(); }
      }} />
    <div ref={measure} class="composer-measure" aria-hidden="true">{props.value + '\u200b'}</div>
    </div>
  </div>;
}
