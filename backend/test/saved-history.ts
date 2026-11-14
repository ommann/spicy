import { readStoredHistory } from '../../packages/coding-agent/src/core/session-storage.ts';

export function savedHistory(path: string): string {
  const records = readStoredHistory(path, false);
  if (!records) throw new Error(`Missing saved history: ${path}`);
  return records.map(record => JSON.stringify(record)).join('\n') + '\n';
}
