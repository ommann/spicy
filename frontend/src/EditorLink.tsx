import { createSignal, useContext, type JSX } from 'solid-js';
import { api } from './api';
import { FileLinkCwdContext } from './file-link';

export default function EditorLink(props: { path: string; line?: number; children: JSX.Element; class?: string }) {
  const cwd = useContext(FileLinkCwdContext);
  const [busy, setBusy] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  async function open() {
    setBusy(true);
    setFailed(false);
    try {
      const { token, cwd: defaultCwd } = await api.info({});
      await api.openEditor({ cwd: cwd() || defaultCwd, path: props.path, line: props.line || 1 }, { context: { token } });
    } catch (error) {
      setFailed(true);
      console.error('Could not open editor:', error);
    }
    finally { setBusy(false); }
  }
  return <><span role="button" tabIndex={0} class={`editor-link ${props.class || ''}`} aria-disabled={busy()}
    style={{ color: failed() ? 'var(--status-error)' : undefined }}
    aria-label={`Open ${props.path} at line ${props.line || 1} in VS Code`}
    onKeyDown={event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); event.stopPropagation(); if (!busy()) void open();
      }
    }}
    onMouseDown={event => {
      if (event.button === 1) event.preventDefault();
    }}
    onAuxClick={event => {
      if (event.button !== 1) return;
      event.preventDefault(); event.stopPropagation(); if (!busy()) void open();
    }}
    onClick={event => { event.stopPropagation(); if (!busy()) void open(); }}>{props.children}</span>
    </>;
}
