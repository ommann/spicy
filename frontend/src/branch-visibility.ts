import { createMemo, createSignal } from 'solid-js';
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
  function persist(ids: string[]) {
    try { window.localStorage.setItem(storageKey, JSON.stringify(ids)); }
    catch { /* The filter still works without persistence. */ }
  }
  function save(ids: string[]) {
    setStoredLeaves(ids);
    persist(ids);
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
      setStoredLeaves(current => {
        const updated = followHiddenLeaves(current, previous, next);
        if (updated.length === current.length && updated.every((id, index) => id === current[index])) return current;
        persist(updated);
        return updated;
      });
    },
  };
}
