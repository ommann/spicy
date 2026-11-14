import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withDatabase } from '../packages/coding-agent/src/core/session-storage.ts';

export interface UsageSample { observedAt: number; window: string; usedPercent: number; resetAt: number }
export function usageAccount(account: string) { return createHash('sha256').update(account).digest('hex'); }
export function saveUsage(account: string, usage: any, observedAt = Date.now()) {
  const samples: UsageSample[] = [];
  for (const [window, key] of [['5-hour', 'primary_window'], ['weekly', 'secondary_window']]) {
    const value = usage?.rate_limit?.[key];
    if (!Number.isFinite(value?.used_percent) || value.used_percent < 0 || value.used_percent > 100 || !Number.isFinite(value?.reset_at)) continue;
    samples.push({ observedAt, window, usedPercent: value.used_percent, resetAt: value.reset_at * 1000 });
  }
  if (!samples.length) return;
  withDatabase(process.cwd(), true, db => db.transaction(tx => {
    for (const sample of samples) tx.run(sql`INSERT OR REPLACE INTO usage_samples (account, observed_at, window, used_percent, reset_at)
      VALUES (${account}, ${sample.observedAt}, ${sample.window}, ${sample.usedPercent}, ${sample.resetAt})`);
  }));
}
export function readUsage(account: string): UsageSample[] {
  return withDatabase(process.cwd(), false, db => {
    if (!db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'usage_samples'`)) return [];
    return db.all(sql`SELECT observed_at AS observedAt, window, used_percent AS usedPercent, reset_at AS resetAt
      FROM usage_samples WHERE account = ${account} ORDER BY observed_at DESC LIMIT 2000`).reverse() as UsageSample[];
  }) ?? [];
}
