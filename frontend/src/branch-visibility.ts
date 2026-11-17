import { createMemo, createSignal, onMount } from 'solid-js';
import { api } from './api';
import type { Wire } from './types';

type Change = Parameters<typeof api.hiddenBranches.change>[0];
function apply(ids: string[], change: Change): string[] {
  const result = new Set(ids);
  if ('from' in change) {
    if (result.delete(change.from)) result.add(change.to);
  } else if (change.hidden) result.add(change.leafId);
  else result.delete(change.leafId);
  return [...result];
}

export const [showOnlyHiddenBranches, setShowOnlyHiddenBranches] = createSignal(false);

export function createBranchVisibility(onError: (error: unknown) => void = console.error) {
  const [storedLeaves, setStoredLeaves] = createSignal<string[]>([]);
  const hiddenLeaves = createMemo(() => new Set(storedLeaves()));
  let pending: Change[] = [];
  let loaded = false;
  let writes = Promise.resolve();
  onMount(() => {
    void api.hiddenBranches.list({}).then(ids => {
      setStoredLeaves(pending.reduce(apply, ids));
      pending = [];
      loaded = true;
    }).catch(onError);
  });
  function change(input: Change) {
    if (!loaded) pending.push(input);
    setStoredLeaves(current => apply(current, input));
    writes = writes.then(async () => {
      const { token } = await api.info({});
      await api.hiddenBranches.change(input, { context: { token } });
    }).catch(async error => {
      onError(error);
      try { setStoredLeaves(await api.hiddenBranches.list({})); }
      catch (reloadError) { onError(reloadError); }
    });
  }
  return {
    hiddenLeaves,
    toggle(leafId: string) {
      change({ leafId, hidden: !hiddenLeaves().has(leafId) });
    },
    follow(previous: Wire[], next: Wire[]) {
      for (const lane of next) {
        const old = previous.find(item => item.key === lane.key);
        if (old && old.leafId !== lane.leafId && (!loaded || hiddenLeaves().has(old.leafId))) {
          change({ from: old.leafId, to: lane.leafId });
        }
      }
    },
  };
}
