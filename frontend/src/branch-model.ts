import type { Wire } from './types.ts';

export interface BranchModel { provider: string; id: string; name?: string }

// Follow ancestry, never array order: concurrent branches can use different models.
export function inheritedBranchModel(entries: Wire[], id: string | null): BranchModel | undefined {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const seen = new Set<string>();
  let entry = id ? byId.get(id) : undefined;
  while (entry && !seen.has(entry.id)) {
    seen.add(entry.id);
    if (entry.type === 'model_change') return { provider: entry.provider, id: entry.modelId };
    if (entry.message?.role === 'assistant' && entry.message.model)
      return { provider: entry.message.provider, id: entry.message.model };
    entry = byId.get(entry.parentId);
  }
  return undefined;
}
