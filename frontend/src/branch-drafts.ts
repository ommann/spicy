import type { Wire } from './types.ts';
interface SentDraft { parentId: string | null; sentAt?: number; text?: string }

// Pi may insert system-prefix changes between the branch point and the user message.
// Those records belong to the committed branch, not a second optimistic branch.
export function hasCommittedDraft(entries: Wire[], draft: SentDraft) {
  const sentAt = draft.sentAt;
  if (!sentAt) return false;
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  return entries.some(entry => {
    if (entry.message?.role !== 'user' || !(entry.message.timestamp >= sentAt)) return false;
    const content = entry.message.content;
    const text = typeof content === 'string' ? content : (content || [])
      .filter((part: Wire) => part.type === 'text').map((part: Wire) => part.text).join('');
    if (text !== draft.text) return false;
    let parentId = entry.parentId;
    const seen = new Set();
    while (parentId !== draft.parentId) {
      if (seen.has(parentId)) return false;
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (parent?.message?.role !== 'system') return false;
      parentId = parent.parentId;
    }
    return true;
  });
}
