import { createSignal } from 'solid-js';

const storageKey = 'spicy.code-linewrap';
function savedLinewrap() {
  try { return localStorage.getItem(storageKey) === 'true'; }
  catch { return false; }
}

const [codeLinewrap, updateCodeLinewrap] = createSignal(savedLinewrap());
export { codeLinewrap };

export function setCodeLinewrap(value: boolean) {
  updateCodeLinewrap(value);
  try { localStorage.setItem(storageKey, String(value)); }
  catch { /* Storage may be unavailable. */ }
}
