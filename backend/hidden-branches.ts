import { eq } from 'drizzle-orm';
import { hiddenBranches, withDatabase } from '../packages/coding-agent/src/core/session-storage.ts';

type Change = { leafId: string; hidden: boolean } | { from: string; to: string };

export function readHiddenBranches(directory: string): string[] {
  return withDatabase(directory, true, db => db.select().from(hiddenBranches).all().map(row => row.leafId))!;
}

export function changeHiddenBranch(directory: string, change: Change): void {
  withDatabase(directory, true, db => db.transaction(tx => {
    if ('from' in change) {
      if (change.from === change.to) return;
      const removed = tx.delete(hiddenBranches).where(eq(hiddenBranches.leafId, change.from)).run();
      if (removed.changes) tx.insert(hiddenBranches).values({ leafId: change.to }).onConflictDoNothing().run();
    } else if (change.hidden) {
      tx.insert(hiddenBranches).values({ leafId: change.leafId }).onConflictDoNothing().run();
    } else {
      tx.delete(hiddenBranches).where(eq(hiddenBranches.leafId, change.leafId)).run();
    }
  }));
}
