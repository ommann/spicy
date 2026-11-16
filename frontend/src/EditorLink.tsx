import { createSignal, Show, useContext, type JSX } from 'solid-js';
import { api } from './api';
import { FileLinkCwdContext } from './file-link';

export default function EditorLink(props: { path: string; line?: number; children: JSX.Element; class?: string }) {
  const cwd = useContext(FileLinkCwdContext);
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  async function open() {
    setBusy(true);
    setError('');
    try {
      const { token, cwd: defaultCwd } = await api.info({});
      await api.openEditor({ cwd: cwd() || defaultCwd, path: props.path, line: props.line || 1 }, { context: { token } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(`VS Code could not open ${props.path}:${props.line || 1}: ${message}`);
    }
    finally { setBusy(false); }
  }
  return <><span role="button" tabIndex={0} class={`editor-link ${props.class || ''}`} aria-disabled={busy()}
    aria-label={`Open ${props.path} at line ${props.line || 1} in VS Code`}
    onKeyDown={event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); event.stopPropagation(); if (!busy()) void open();
      }
    }}
    onClick={event => { event.stopPropagation(); if (!busy()) void open(); }}>{props.children}</span>
    <Show when={error()}><span class="editor-link-error" role="alert">{error()}</span></Show></>;
}
