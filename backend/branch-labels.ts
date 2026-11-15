import { eq } from 'drizzle-orm';
import { branchLabels, historyEntries, invalidatePreviews, withDatabase } from '../packages/coding-agent/src/core/session-storage.ts';
import type { BranchLabel } from '../shared/branch-labels.ts';

export function readBranchLabels(directory: string): Record<string, BranchLabel> {
  // Initialize settings for existing history databases as well as new installs.
  return withDatabase(directory, true, db => Object.fromEntries(db.select().from(branchLabels).all()
    .map(({ key, text, color }) => [key, { text, color }]))) ?? {};
}
export function changeBranchLabel(directory: string, input: { key: string; label?: BranchLabel; from?: string }) {
  return withDatabase(directory, true, db => db.transaction(tx => {
    let label = input.label;
    if (input.from !== undefined) {
      if (input.from === input.key) return;
      label = tx.select().from(branchLabels).where(eq(branchLabels.key, input.from)).get();
      if (!label) return;
      tx.delete(branchLabels).where(eq(branchLabels.key, input.from)).run();
    }
    if (label) tx.insert(branchLabels).values({ key: input.key, text: label.text, color: label.color })
      .onConflictDoUpdate({ target: branchLabels.key, set: { text: label.text, color: label.color } }).run();
    else tx.delete(branchLabels).where(eq(branchLabels.key, input.key)).run();
    const keys = [input.key, input.from].filter((key): key is string => !!key);
    const affected = new Set<string>();
    for (const key of keys) {
      if (!key.startsWith('lane:')) continue;
      for (const entry of tx.select({ sessionPath: historyEntries.sessionPath }).from(historyEntries)
        .where(eq(historyEntries.id, key.slice(5))).all()) affected.add(entry.sessionPath);
    }
    if (!affected.size) invalidatePreviews(tx);
    for (const sessionPath of affected) invalidatePreviews(tx, sessionPath);
  }));
}
