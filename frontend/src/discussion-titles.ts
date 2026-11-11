import { getDiscussionTitle } from '../../packages/coding-agent/src/core/discussion-title';
import { branchEntries } from './session-entries.mjs';

const key = 'spicy-discussion-titles';
function read(): Record<string, { title: string; headId: string }> {
  try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
}
export function cachedDiscussionTitle(sessionId: string): string | undefined {
  return read()[sessionId]?.title;
}
export function cacheDiscussionTitle(sessionId: string, entries: any[], headId: string) {
  const title = getDiscussionTitle(branchEntries(entries, headId));
  if (!title) return;
  try {
    const cache = read();
    cache[sessionId] = { title, headId };
    localStorage.setItem(key, JSON.stringify(cache));
  } catch { /* History remains the source of truth when storage is unavailable. */ }
}
