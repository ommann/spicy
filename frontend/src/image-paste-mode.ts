import { createSignal } from 'solid-js';

const [pasteImagePaths, updatePasteImagePaths] = createSignal(window.localStorage.getItem('spicy-paste-image-paths') === 'true');
export { pasteImagePaths };

export function setPasteImagePaths(value: boolean) {
  updatePasteImagePaths(value);
  window.localStorage.setItem('spicy-paste-image-paths', String(value));
}
