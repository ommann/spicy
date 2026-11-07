import { Show, createContext, createSignal, onCleanup, useContext, type ParentProps } from 'solid-js';
import Dialog from './Dialog';
import { closeModal, openModal } from './modal-state';
import './tool-apps.css';

export type ToolAppPage = { id: string; title: string } & (
  { url: string; html?: never } | { html: string; url?: never }
);
export const ToolAppContext = createContext<{ open: (page: ToolAppPage) => void }>();
export const useToolApps = () => useContext(ToolAppContext);

/** Reusable iframe shell for tool UIs, independent of any task service or MCP transport. */
export default function ToolApps(props: ParentProps<{ sessionKey: string }>) {
  return <Show when={props.sessionKey || 'empty'} keyed>{_session => <ToolAppDialog>{props.children}</ToolAppDialog>}</Show>;
}

function ToolAppDialog(props: ParentProps) {
  const [page, setPage] = createSignal<ToolAppPage>();
  const [mode, setMode] = createSignal<'floating' | 'fullscreen'>('floating');
  let dialog!: HTMLDialogElement;
  let backdropPress = false;
  function close() { closeModal(dialog); }
  function onBackdrop(event: MouseEvent) {
    if (event.target !== event.currentTarget) return false;
    const bounds = dialog.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
  }
  onCleanup(close);
  return <ToolAppContext.Provider value={{ open: next => {
    if (next.url) {
      const url = new URL(next.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid tool app URL');
    }
    setPage(previous => previous?.id === next.id && previous.url === next.url && previous.html === next.html ? previous : next);
    openModal(dialog);
  } }}>
    {props.children}
    <Dialog class={`tool-app-dialog ${mode()}`} ref={dialog} aria-label="Tool UI"
      onCancel={event => { event.preventDefault(); close(); }}
      onPointerDown={event => { backdropPress = onBackdrop(event); }}
      onPointerCancel={() => { backdropPress = false; }}
      onClick={event => { if (backdropPress && onBackdrop(event)) close(); backdropPress = false; }}>
      <header><strong>{page()?.title || 'Tool UI'}</strong><div class="tool-app-actions">
        <button type="button" aria-pressed={mode() === 'fullscreen'} onClick={() => setMode(value => value === 'fullscreen' ? 'floating' : 'fullscreen')}>{mode() === 'fullscreen' ? 'Restore' : 'Maximize'}</button>
        <button type="button" onClick={close}>Close</button>
      </div></header>
      <Show when={page()} keyed>{current => <iframe title={current.title} sandbox="allow-scripts allow-forms allow-downloads" src={current.url} srcdoc={current.html} />}</Show>
    </Dialog>
  </ToolAppContext.Provider>;
}
