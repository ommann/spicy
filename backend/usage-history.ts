import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withDatabase } from '../packages/coding-agent/src/core/session-storage.ts';

import type { UsageSample } from '../shared/usage.ts';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}
export function usageAccount(account: string) { return createHash('sha256').update(account).digest('hex'); }
export function saveUsage(account: string, usage: unknown, observedAt = Date.now()) {
  const samples: UsageSample[] = [];
  const limits = record(record(usage).rate_limit);
  for (const [usageWindow, key] of [['5-hour', 'primary_window'], ['weekly', 'secondary_window']] as const) {
    const value = record(limits[key]);
    const usedPercent = value.used_percent;
    const resetAt = value.reset_at;
    if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100
      || typeof resetAt !== 'number' || !Number.isFinite(resetAt)) continue;
    samples.push({ observedAt, window: usageWindow, usedPercent, resetAt: resetAt * 1000 });
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
