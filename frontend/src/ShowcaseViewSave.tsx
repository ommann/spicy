import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { showcaseViewSchema, type ShowcaseView } from '../../shared/showcase-view';
import { api } from './api';
import Dialog from './Dialog';
import Input from './Input';
import { createKeyboardShortcuts } from './keyboard-shortcuts';

export default function ShowcaseViewSave(props: { token: () => string; viewport: () => HTMLElement }) {
  let dialog!: HTMLDialogElement;
  let nameInput!: HTMLInputElement;
  let pointer: ShowcaseView['pointer'] = null;
  let placement: Omit<ShowcaseView, 'name'>;
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  createKeyboardShortcuts({ codes: ['KeyQ'], enabled: () => !pending(), allowInEditor: true, onKey: open });

  onMount(() => {
    const track = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.composedPath().includes(props.viewport())) {
        pointer = { x: event.clientX, y: event.clientY };
      }
    };
    window.addEventListener('pointermove', track, { capture: true, passive: true });
    onCleanup(() => window.removeEventListener('pointermove', track, true));
  });

  function open() {
    const viewport = props.viewport();
    placement = {
      path: location.pathname + location.search + location.hash,
      width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
      top: viewport.scrollTop, left: viewport.scrollLeft,
      pointer: pointer && pointer.x < innerWidth && pointer.y < innerHeight ? pointer : null,
    };
    setError('');
    nameInput.value = '';
    dialog.showModal();
    nameInput.focus();
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (pending()) return;
    const view = showcaseViewSchema.safeParse({ ...placement, name: nameInput.value });
    if (!view.success) { setError(view.error.issues[0].message); return; }
    setPending(true);
    setError('');
    try {
      await api.showcaseViews.save(view.data, { context: { token: props.token() } });
      dialog.close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save showcase view.');
    } finally {
      setPending(false);
    }
  }

  return <Dialog ref={dialog} title="Save showcase">
    <form onSubmit={save}>
      <label>Name <Input ref={nameInput} required maxLength={64} /></label>
      <Show when={error()}><p role="alert">{error()}</p></Show>
      <button type="submit" disabled={pending()} style={{ 'justify-self': 'end' }}>Save</button>
    </form>
  </Dialog>;
}
