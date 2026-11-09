import { createSignal } from 'solid-js';

export type BranchLabel = { text: string; color: string };
const storageKey = 'spicy.branch-labels.v1';
function load(): Record<string, BranchLabel> {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || '{}');
    return Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, BranchLabel] => {
      const value = entry[1] as BranchLabel | null;
      return !!value && typeof value.text === 'string' && value.text.length > 0
        && typeof value.color === 'string' && /^[a-z]+$/i.test(value.color) && CSS.supports('color', value.color);
    }));
  } catch { return {}; }
}
const [labels, setLabels] = createSignal(load());
export const branchLabel = (key: string) => labels()[key];
export function transferBranchLabel(from: string, to: string) {
  if (from === to || !labels()[from]) return;
  const next = { ...labels(), [to]: labels()[from] };
  delete next[from];
  localStorage.setItem(storageKey, JSON.stringify(next));
  setLabels(next);
}
export function setBranchLabel(key: string, label?: BranchLabel) {
  const next = { ...labels() };
  if (label) next[key] = label;
  else delete next[key];
  localStorage.setItem(storageKey, JSON.stringify(next));
  setLabels(next);
}
