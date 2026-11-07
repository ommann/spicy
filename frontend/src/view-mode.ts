import { createSignal } from 'solid-js';

export type ViewMode = 'focused' | 'side';
const storageKey = 'spicy.view-mode';

function savedMode(): ViewMode {
  try { return localStorage.getItem(storageKey) === 'focused' ? 'focused' : 'side'; }
  catch { return 'side'; }
}

const [viewMode, updateViewMode] = createSignal<ViewMode>(savedMode());
export { viewMode };

export function chatViewPath(mode = viewMode()) {
  return mode === 'focused' ? '/single' : '/tree';
}

export function setViewMode(value: ViewMode) {
  updateViewMode(value);
  try { localStorage.setItem(storageKey, value); } catch { /* Storage may be unavailable. */ }
}
