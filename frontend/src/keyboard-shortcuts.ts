import { onCleanup, onMount } from 'solid-js';
import { modalOpen } from './modal-state';

// Page shortcuts must work even when focus remains on the document body.
export function createKeyboardShortcuts(options: {
  enabled?: () => boolean;
  codes: string[];
  allowInEditor?: boolean;
  modifiers?: 'ctrl-shift' | 'none';
  onKey: (event: KeyboardEvent) => void;
}) {
  onMount(() => {
    const keydown = (event: KeyboardEvent) => {
      if (options.enabled && !options.enabled()) return;
      if (modalOpen() || event.defaultPrevented || event.isComposing || event.repeat) return;
      if (options.modifiers === 'none') {
        if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
      } else if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return;
      if (!options.codes.includes(event.code)) return;
      if (!options.allowInEditor && event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      options.onKey(event);
    };
    window.addEventListener('keydown', keydown);
    onCleanup(() => window.removeEventListener('keydown', keydown));
  });
}
