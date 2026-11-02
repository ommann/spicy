import { For, createSignal, onCleanup, type JSX } from 'solid-js';
import ScrollArea from './ScrollArea';

export interface SelectOption {
  value: string;
  label: string;
}

export default function Select(props: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  class?: string;
  style?: JSX.CSSProperties;
  children?: JSX.Element;
}) {
  let dialog!: HTMLDialogElement;
  const [open, setOpen] = createSignal(false);
  const selected = () => props.options.find(option => option.value === props.value)?.label || 'Choose';
  function show() {
    dialog.showModal();
    setOpen(true);
    dialog.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  }
  function choose(value: string) {
    props.onChange(value);
    dialog.close();
  }
  function navigate(event: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  }
  onCleanup(() => dialog?.close());
  return <>
    <button type="button" class={props.class || 'select-choice'} style={props.style} aria-label={`${props.label}: ${selected()}`}
      aria-haspopup="dialog" aria-expanded={open()} onClick={show}>{props.children ?? selected()}</button>
    <dialog ref={dialog} class="chat-dialog select-dialog" aria-label={props.label} onClose={() => setOpen(false)}>
      <div class="chat-dialog-heading"><span>{props.label}</span><button type="button" onClick={() => dialog.close()}>Close</button></div>
      <ScrollArea class="select-options" vertical>
        <div role="listbox" aria-label={props.label} onKeyDown={navigate}>
          <For each={props.options}>{option => <button type="button" class="select-choice" role="option"
            aria-selected={option.value === props.value} onClick={() => choose(option.value)}>{option.label}</button>}</For>
        </div>
      </ScrollArea>
    </dialog>
  </>;
}
