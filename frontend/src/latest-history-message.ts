import type { Entry, Wire } from './types';

export function latestHistoryMessage(entries: Entry[]) {
  let latest: { id: string; text: string; user: boolean; timestamp: number } | undefined;
  for (const entry of entries) {
    const message = entry.message;
    if (!message || !['user', 'assistant'].includes(message.role)) continue;
    const text = (typeof message.content === 'string' ? message.content
      : (message.content || []).filter((block: Wire) => block.type === 'text').map((block: Wire) => block.text).join('\n')).trim();
    if (!text) continue;
    const timestamp = Number.isFinite(message.timestamp) ? message.timestamp : Date.parse(entry.timestamp || '') || 0;
    if (!latest || timestamp >= latest.timestamp) latest = { id: entry.id, text, user: message.role === 'user', timestamp };
  }
  return latest;
}
