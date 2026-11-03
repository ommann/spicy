import { createEffect, onCleanup, onMount, Show, splitProps, type JSX } from 'solid-js';
import { closeModal, openModal, trackModal } from './modal-state';

export type DialogProps = Omit<JSX.DialogHtmlAttributes<HTMLDialogElement>, 'open'> & {
  /** Optional reactive visibility. Omit to use the native ref's showModal()/close(). */
  open?: boolean;
  /** Optional standard heading. Custom layouts can provide their own header. */
  title?: string;
  closeLabel?: string;
};

/** Native modal semantics (focus trapping, Escape and focus restoration), shared tracking and cleanup. */
export default function Dialog(props: DialogProps) {
  const [local, attributes] = splitProps(props, ['ref', 'open', 'title', 'closeLabel', 'children']);
  let element!: HTMLDialogElement;
  onMount(() => {
    const dispose = trackModal(element);
    onCleanup(() => {
      closeModal(element);
      dispose();
    });
    createEffect(() => {
      if (local.open === undefined) return;
      if (local.open && !element.open) openModal(element);
      else if (!local.open && element.open) closeModal(element);
    });
  });
  return <dialog class="chat-dialog" aria-label={local.title} {...attributes} ref={node => {
    element = node;
    if (typeof local.ref === 'function') local.ref(node);
  }}>
    <Show when={local.title}>
      <div class="chat-dialog-heading">
        <span>{local.title}</span>
        <button type="button" onClick={() => closeModal(element)}>{local.closeLabel ?? 'Close'}</button>
      </div>
    </Show>
    {local.children}
  </dialog>;
}
