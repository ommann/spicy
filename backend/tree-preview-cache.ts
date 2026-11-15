import { treePreviewCache, withDatabase } from '../packages/coding-agent/src/core/session-storage.ts';

/** Load cached cards once; only build cards whose members changed. */
export function withTreePreviews<T>(directory: string, run: (get: (key: string, signature: string, build: () => T) => T) => T[]): T[] {
  if (!process.env.SPICY_HISTORY_DB) return run((_key, _signature, build) => build());
  const existing = new Map((withDatabase(directory, false, db => db.select().from(treePreviewCache).all()) ?? [])
    .map(row => [row.key, row]));
  const updates: { key: string; signature: string; payload: string }[] = [];
  const result = run((key, signature, build) => {
    const cached = existing.get(key);
    if (cached?.signature === signature) return JSON.parse(cached.payload) as T;
    const card = build();
    updates.push({ key, signature, payload: JSON.stringify(card) });
    return card;
  });
  if (updates.length) withDatabase(directory, true, db => db.transaction(tx => {
    for (const row of updates) tx.insert(treePreviewCache).values(row)
      .onConflictDoUpdate({ target: treePreviewCache.key, set: { signature: row.signature, payload: row.payload } }).run();
  }));
  return result;
}
