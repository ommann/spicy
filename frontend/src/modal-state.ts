import { createSignal } from 'solid-js';

const dialogs = new Set<HTMLDialogElement>();
const [modalOpen, setModalOpen] = createSignal(false);
export { modalOpen };

export function trackModal(dialog: HTMLDialogElement) {
  const update = (event: Event) => {
    if ((event as ToggleEvent).newState === 'open') dialogs.add(dialog);
    else dialogs.delete(dialog);
    setModalOpen(dialogs.size > 0);
  };
  dialog.addEventListener('beforetoggle', update);
  return () => {
    dialog.removeEventListener('beforetoggle', update);
    dialogs.delete(dialog);
    setModalOpen(dialogs.size > 0);
  };
}

export function openModal(dialog: HTMLDialogElement) {
  dialog.showModal();
  if (dialogs.has(dialog)) return;
  dialogs.add(dialog);
  setModalOpen(true);
  dialog.addEventListener('close', () => {
    dialogs.delete(dialog);
    setModalOpen(dialogs.size > 0);
  }, { once: true });
}

export function closeModal(dialog: HTMLDialogElement) {
  dialog.close();
  dialogs.delete(dialog);
  setModalOpen(dialogs.size > 0);
}
