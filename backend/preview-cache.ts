import { and, eq } from 'drizzle-orm';
import { historyDatabasePath, previewCache, previewRevision, withDatabase } from '../packages/coding-agent/src/core/session-storage.ts';

// Bump when the prepared response or preview rules change.
const formatVersion = 2;
const pending = new Map<string, Promise<unknown>>();
const initialized = new Set<string>();

/** Valid cached output bypasses all session listing and preview construction. */
export async function cachedPreviews<T>(directory: string, build: () => Promise<T>): Promise<T> {
  // Independent history databases cannot share one invalidation revision.
  if (!process.env.SPICY_HISTORY_DB) return build();
  const database = historyDatabasePath(directory);
  if (!initialized.has(database)) {
    withDatabase(directory, true, () => {});
    initialized.add(database);
  }
  const key = `histories:${formatVersion}:${directory}`;
  const state = withDatabase(directory, false, db => db.select({ revision: previewRevision.revision, payload: previewCache.payload })
    .from(previewRevision).leftJoin(previewCache, and(eq(previewCache.key, key), eq(previewCache.revision, previewRevision.revision)))
    .where(eq(previewRevision.id, 1)).get());
  if (!state) throw new Error('Missing preview cache revision');
  if (state.payload !== null) return JSON.parse(state.payload) as T;
  const pendingKey = `${database}:${key}:${state.revision}`;
  const existing = pending.get(pendingKey);
  if (existing) return existing as Promise<T>;
  const request = (async () => {
    const value = await build();
    const payload = JSON.stringify(value);
    withDatabase(directory, true, db => db.transaction(tx => {
      const current = tx.select().from(previewRevision).where(eq(previewRevision.id, 1)).get();
      // A chat or label changed while building: don't cache outdated results.
      if (current?.revision !== state.revision) return;
      tx.insert(previewCache).values({ key, revision: state.revision, payload })
        .onConflictDoUpdate({ target: previewCache.key, set: { revision: state.revision, payload } }).run();
    }, { behavior: 'immediate' }));
    return value;
  })();
  pending.set(pendingKey, request);
  try { return await request; }
  finally { pending.delete(pendingKey); }
}
