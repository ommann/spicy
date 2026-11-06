import { For, Show, createContext, createEffect, createMemo, createResource, createSignal, onCleanup, useContext, type ParentProps } from 'solid-js';
import { contentText, handoffId, handoffResultData, handoffUrl } from './handoffs.mjs';
import Dialog from './Dialog';
import { closeModal, openModal } from './modal-state';
import { SectionContext } from './conversation-dom';
import type { Wire } from './types';

interface HandoffContextValue {
  task: (id: string) => Wire | undefined;
  error: (id: string) => string;
  open: (id: string) => void;
}
const HandoffContext = createContext<HandoffContextValue>();

// The PoC's source-only tool content, expressed as Solid JSX.
function ResultContent(props: { content: string | Wire[]; alt?: string }) {
  const blocks = () => typeof props.content === 'string' ? [{ type: 'text', text: props.content }] : props.content || [];
  return <For each={blocks()}>{block => <>
    <Show when={block.type === 'text'}><For each={(block.text || '').split(/(```[^\n]*\n[\s\S]*?(?:```|$))/g)}>{(part, index) =>
      <Show when={part}><pre class="text" classList={{ code: index() % 2 === 1 }}>{part}</pre></Show>
    }</For></Show>
    <Show when={block.type === 'image'}><Show when={/^image\/(png|jpeg|gif|webp|bmp)$/.test(block.mimeType || '') && typeof block.data === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(block.data)} fallback={<div class="error">Unsupported image content</div>}>
      <img class="attachment-image" src={`data:${block.mimeType};base64,${block.data}`} alt={props.alt || 'Image'} />
    </Show></Show>
  </>}</For>;
}

/** PoC renderTool + decorate presentation, without imperative DOM decoration. */
export function HandoffTool(props: { call: Wire; result?: Wire; entryId: string }) {
  const handoffs = useContext(HandoffContext);
  const args = () => props.call.arguments || {};
  const isSubmission = () => props.call.name === 'handoff_task_to_user';
  const id = () => handoffId(props.call, props.result);
  const task = () => (id() ? handoffs?.task(id()!) : undefined) || handoffResultData(props.result);
  const ready = () => !!id();
  const failed = () => !!props.result?.isError;
  const statusLabel = () => ({ incomplete: 'Incomplete', completed: 'Completed', rejected: 'Rejected' })[task()?.status as string] || (failed() ? 'Failed' : 'Pending');
  const name = () => args().tool || 'Task';
  const inputs = () => Object.fromEntries(Object.entries(args().inputs || {}).map(([key, input]) => [key, (input as Wire).value]));
  const error = () => props.result?.details?.status === 'error' ? JSON.stringify(props.result.details, null, 2) : props.result?.details?.error || contentText(props.result?.content);
  const data = createMemo(() => handoffResultData(props.result));
  const rendered = () => data() && (typeof data().status === 'string' || typeof data().instruction === 'string' || Object.hasOwn(data(), 'output') || Array.isArray(data().files) || typeof data().written === 'string' || data().rejection);
  const resultContent = () => rendered() && Array.isArray(props.result?.content) ? props.result!.content.filter((block: Wire) => block.type === 'image') : props.result?.content;

  return <section ref={useContext(SectionContext)} class="tool utw-tool" classList={{ handoff: isSubmission(), 'handoff-result': !isSubmission(), 'handoff-ready': ready(), error: failed() }}
    data-entry-id={props.entryId} data-task-id={ready() ? id() : undefined} tabIndex={ready() ? 0 : undefined} role={ready() ? 'button' : undefined}
    aria-haspopup={ready() ? 'dialog' : undefined}
    aria-label={ready() ? `${isSubmission() ? 'handoff_task_to_user' : 'Get handoff'} · ${task()?.tool || args().tool || id()} · ${['completed', 'rejected'].includes(task()?.status) ? 'preview handoff' : 'open handoff'}` : undefined}
    onClick={() => { if (ready()) handoffs?.open(id()!); }}
    onKeyDown={event => {
      if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key) || !ready()) return;
      event.preventDefault();
      handoffs?.open(id()!);
    }}>
    <Show when={isSubmission()} fallback={<div class="command">{['Get Handoff', args().mode, args().file].filter(Boolean).join(' · ')}</div>}>
      <div class="handoff-header"><span class="handoff-status" aria-label={statusLabel()}>{task()?.status === 'completed' ? '[X]' : task()?.status === 'rejected' || failed() ? '[!]' : '[ ]'}</span>
        <div class="command">Handoff: {name().charAt(0).toUpperCase() + name().slice(1)}</div>
      </div>
    </Show>
    <Show when={id()}><div class="handoff-id">{id()}</div></Show>
    <Show when={isSubmission()} fallback={<>
      <Show when={typeof data()?.status === 'string'}><div class="handoff-result-status">{data().status}</div></Show>
      <Show when={typeof data()?.instruction === 'string'}><pre class="text handoff-instructions">{data().instruction}</pre></Show>
      <Show when={data() && Object.hasOwn(data(), 'output')}><pre class="handoff-output">{JSON.stringify(data().output, null, 2)}</pre></Show>
      <Show when={Array.isArray(data()?.files)}><pre class="handoff-files">{data().files.join('\n')}</pre></Show>
      <Show when={typeof data()?.written === 'string'}><pre class="handoff-written">Written: {data().written}</pre></Show>
      <Show when={data()?.rejection}><pre class="handoff-rejection">{JSON.stringify(data().rejection, null, 2)}</pre></Show>
      <Show when={props.result}><ResultContent content={resultContent()} alt={args().file} /></Show>
    </>}>
      <Show when={args().instructions}><pre class="text handoff-instructions">{'```txt\n'}<span class="handoff-instruction-content">{args().instructions}</span>{'```'}</pre></Show>
      <Show when={Object.keys(args().inputs || {}).length}><pre class="text handoff-inputs">{JSON.stringify(inputs(), null, 2)}</pre></Show>
      <Show when={failed()}><pre class="handoff-error error">{error()}</pre></Show>
    </Show>
    <Show when={id() && handoffs?.error(id()!)}><div class="handoff-error error">{handoffs?.error(id()!)}</div></Show>
    <Show when={task()?.ui?.embeddable === false && handoffUrl(task())}><a href={handoffUrl(task())} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()}>Open tool</a></Show>
  </section>;
}

/** A click loads one task. UTW owns everything inside its tool page. */
export default function Handoffs(props: ParentProps<{ sessionKey: string }>) {
  return <Show when={props.sessionKey || 'empty'} keyed>{_key => <HandoffDialog>{props.children}</HandoffDialog>}</Show>;
}

function HandoffDialog(props: ParentProps) {
  const [requested, setRequested] = createSignal<{ id: string; mode: 'floating' | 'fullscreen' }>();
  const [mode, setMode] = createSignal<'floating' | 'fullscreen'>('floating');
  const [rejecting, setRejecting] = createSignal(false);
  const [framePage, setFramePage] = createSignal<{ url: string; task: Wire }>();
  let dialog!: HTMLDialogElement;
  let backdropPress = false;
  const [metadata] = createResource(requested, async ({ id }) => {
    const response = await fetch(`/utw/tasks/${id}`, { signal: AbortSignal.timeout(15000) });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Spicy returned a page instead of task metadata. Restart spicy.');
    const task = await response.json();
    if (!response.ok) throw new Error(task.error || `HTTP ${response.status}`);
    if (task.task_id !== id) throw new Error('UTW task mismatch');
    if (!handoffUrl(task)) throw new Error('UTW did not provide a usable tool URL');
    return task as Wire;
  });
  const [loadedTask, setLoadedTask] = createSignal<Wire>();
  createEffect(() => {
    if (metadata.state !== 'ready') return;
    const task = metadata()!;
    setLoadedTask(task);
    if (!task.ui.embeddable) return;
    const url = handoffUrl(task)!;
    setFramePage(previous => previous && previous.task.task_id === task.task_id && previous.task.status === task.status && previous.url === url ? previous : { task, url });
    setMode(requested()!.mode);
    setRejecting(false);
    openModal(dialog);
  });
  function close() { closeModal(dialog); }
  const context: HandoffContextValue = {
    task: id => loadedTask()?.task_id === id ? loadedTask() : undefined,
    error: id => requested()?.id === id && metadata.error ? `Could not open handoff: ${metadata.error.message}` : '',
    open: id => setRequested({ id, mode: 'floating' }),
  };
  function reject() {
    const task = loadedTask();
    const url = handoffUrl(task);
    if (!url || task?.status !== 'incomplete') return;
    setRejecting(true);
    setFramePage({ task, url: new URL(`/tasks/${encodeURIComponent(task.task_id)}/reject`, url).href });
  }
  function onBackdrop(event: MouseEvent) {
    if (event.target !== event.currentTarget) return false;
    const bounds = dialog.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
  }
  onCleanup(() => closeModal(dialog));

  return <HandoffContext.Provider value={context}>
    {props.children}
    <Dialog id="handoff-overlay" ref={dialog} class={mode()} aria-label="Tool UI"
      onCancel={event => { event.preventDefault(); close(); }}
      onPointerDown={event => { backdropPress = onBackdrop(event); }}
      onPointerCancel={() => { backdropPress = false; }}
      onClick={event => { if (backdropPress && onBackdrop(event)) close(); backdropPress = false; }}>
      <header><strong id="handoff-title">{loadedTask()?.tool || ''}</strong>
        <div class="handoff-actions">
          <Show when={rejecting()}><button id="handoff-back" type="button" onClick={() => { const task = loadedTask(); if (task) setRequested({ id: task.task_id, mode: mode() }); }}>Back to task</button></Show>
          <Show when={!rejecting() && loadedTask()?.status === 'incomplete'}><button id="handoff-reject" type="button" onClick={reject}>Reject</button></Show>
          <button id="handoff-maximize" type="button" aria-pressed={mode() === 'fullscreen'} onClick={() => setMode(value => value === 'fullscreen' ? 'floating' : 'fullscreen')}>{mode() === 'fullscreen' ? 'Restore' : 'Maximize'}</button>
          <button id="handoff-close" type="button" onClick={close}>Close</button>
        </div>
      </header>
      <Show when={metadata.error}><div id="handoff-connection" role="status">Could not open handoff: {metadata.error.message}</div></Show>
      <Show when={framePage()} keyed>{page => <iframe id="handoff-frame" title="Tool UI" sandbox="allow-scripts allow-forms allow-same-origin allow-downloads" src={page.url} />}</Show>
    </Dialog>
  </HandoffContext.Provider>;
}
