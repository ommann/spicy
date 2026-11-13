import { createMemo, createSignal, untrack } from 'solid-js';
import { followHiddenLeaves } from './branch-visibility-model.ts';
import type { Wire } from './types';

const storageKey = 'spicy.hidden-branches';
function load(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(storageKey) || '[]');
    const ids = Array.isArray(value) ? value
      : value && typeof value === 'object' ? Object.values(value).filter(Array.isArray).flat() : [];
    return [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
  } catch { return []; }
}
const [storedLeaves, setStoredLeaves] = createSignal(load());
export const [showOnlyHiddenBranches, setShowOnlyHiddenBranches] = createSignal(false);

export function createBranchVisibility() {
  const hiddenLeaves = createMemo(() => new Set(storedLeaves()));
  function save(ids: string[]) {
    setStoredLeaves(ids);
    try { window.localStorage.setItem(storageKey, JSON.stringify(ids)); }
    catch { /* The filter still works without persistence. */ }
  }
  return {
    hiddenLeaves,
    toggle(leafId: string) {
      const ids = new Set(hiddenLeaves());
      if (ids.has(leafId)) ids.delete(leafId);
      else ids.add(leafId);
      save([...ids]);
    },
    follow(previous: Wire[], next: Wire[]) {
      untrack(() => {
        const current = storedLeaves();
        const updated = followHiddenLeaves(current, previous, next);
        if (updated.length !== current.length || updated.some((id, index) => id !== current[index])) save(updated);
      });
    },
  };
}
