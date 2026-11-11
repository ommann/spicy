import { createSignal } from 'solid-js';

const storageKey = 'spicy.chat-arrow-cursor';
function savedArrowCursor() {
  try { return localStorage.getItem(storageKey) === 'true'; }
  catch { return false; }
}

const [chatArrowCursor, updateChatArrowCursor] = createSignal(savedArrowCursor());
export { chatArrowCursor };

export function setChatArrowCursor(value: boolean) {
  updateChatArrowCursor(value);
  try { localStorage.setItem(storageKey, String(value)); }
  catch { /* Storage may be unavailable. */ }
}
