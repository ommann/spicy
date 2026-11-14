import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { readUsage, saveUsage, usageAccount } from '../usage-history.ts';
import { formatSchedule, projectUsage, usageDayBoundaries, usageSchedule, usageRate, weeklyCalendarRange } from '../../frontend/src/usage-projection.ts';

test('usage snapshots persist with isolated accounts and validated windows', t => {
  const directory = mkdtempSync(join(tmpdir(), 'spicy-usage-'));
  const previous = process.env.SPICY_HISTORY_DB;
  process.env.SPICY_HISTORY_DB = join(directory, 'history.sqlite');
  t.after(() => {
    if (previous === undefined) delete process.env.SPICY_HISTORY_DB;
    else process.env.SPICY_HISTORY_DB = previous;
    rmSync(directory, { recursive: true, force: true });
  });
  const account = usageAccount('usage-test');
  saveUsage(account, { rate_limit: { primary_window: { used_percent: 20, reset_at: 100 }, secondary_window: { used_percent: 30, reset_at: 200 } } }, 1000);
  saveUsage(account, { rate_limit: { primary_window: { used_percent: 40, reset_at: 100 }, secondary_window: { used_percent: -1, reset_at: 200 } } }, 2000);
  assert.equal(readUsage(account).length, 3);
  assert.deepEqual(readUsage(usageAccount('other-account')), []);
  assert.equal(readUsage(account).at(-1)?.usedPercent, 40);
});

test('schedule compares projected depletion with reset, not current linear budget', () => {
  const hour = 3600000;
  const samples = [25, 50, 75].map((usedPercent, index) => ({ observedAt: (index + 1) * hour, usedPercent, resetAt: 5 * hour, window: '5-hour' as const }));
  assert.equal(usageSchedule(samples), -hour);
  const slower = samples.map(sample => ({ ...sample, usedPercent: sample.usedPercent / 2 }));
  assert.equal(usageSchedule(slower), 3 * hour);
  assert.equal(usageSchedule([]), null);
  assert.equal(formatSchedule(90000000), 'Behind schedule: 1d 1h');
  assert.equal(formatSchedule(-5400000), 'Ahead of schedule: 1h 30m');
  assert.equal(formatSchedule(0), 'On schedule');
  assert.equal(formatSchedule(1000), 'On schedule');
  assert.equal(formatSchedule(-1000), 'On schedule');
});

test('regression resists a one-point tick and includes flat observations', () => {
  const hour = 3600000;
  const samples = [4, 8, 12, 16].map((usedPercent, index) => ({ observedAt: (index + 1) * hour, usedPercent, resetAt: 7 * 24 * hour, window: 'weekly' as const }));
  const before = projectUsage(samples)!.at;
  const after = projectUsage([...samples, { ...samples.at(-1)!, observedAt: 4 * hour + 60000, usedPercent: 17 }])!.at;
  assert.ok(Math.abs(after - before) < hour);
  const flat = [...samples, { ...samples.at(-1)!, observedAt: 5 * hour }];
  assert.ok(projectUsage(flat)!.at > before);
  assert.notEqual(projectUsage(samples.map(sample => ({ ...sample, usedPercent: 40 }))), null);
  assert.equal(projectUsage(samples.map(sample => ({ ...sample, usedPercent: 1 }))), null);
});

test('100% boundary anchors both windows independently of calendar padding', () => {
  const hour = 3600000;
  for (const [window, duration] of [['5-hour', 5 * hour], ['weekly', 168 * hour]] as const) {
    const start = new Date(2026, 10, 12, 3, 30).getTime();
    const sample = { observedAt: start + duration / 2, usedPercent: 40, resetAt: start + duration, window };
    const samples = [sample];
    assert.ok(Math.abs(usageRate(samples)! - 80 / duration) < 1e-12);
    assert.ok(Math.abs(usageSchedule(samples)! - duration / 4) < 1);
    assert.deepEqual(samples, [sample]);
  }
});

test('weekly calendar shows eight whole days unless reset is midnight', () => {
  const reset = new Date(2026, 10, 19, 3, 30).getTime();
  const range = weeklyCalendarRange(reset);
  assert.equal(new Date(range.start).getHours(), 0);
  assert.equal(new Date(range.end).getHours(), 0);
  assert.equal(usageDayBoundaries(range.start, range.end).length + 1, 8);
  assert.ok(range.end > reset);
  const midnight = new Date(2026, 10, 19).getTime();
  const exact = weeklyCalendarRange(midnight);
  assert.equal(exact.end, midnight);
  assert.equal(usageDayBoundaries(exact.start, exact.end).length + 1, 7);
});

test('day sections follow local midnights within chart bounds', () => {
  const start = new Date(2026, 10, 14, 17).getTime();
  const end = new Date(2026, 10, 17, 3).getTime();
  const days = usageDayBoundaries(start, end);
  assert.deepEqual(days.map(at => new Date(at).getDate()), [15, 16, 17]);
  assert.ok(days.every(at => new Date(at).getHours() === 0 && at > start && at < end));
  assert.deepEqual(usageDayBoundaries(end, start), []);
});

test('simple projection stops at zero or reset and never crosses reset windows', () => {
  const hour = 3600000;
  const sample = (observedAt: number, usedPercent: number, resetAt = 5 * hour) => ({ observedAt, usedPercent, resetAt, window: '5-hour' as const });
  assert.deepEqual(projectUsage([sample(hour, 25), sample(2 * hour, 50), sample(3 * hour, 75)]), { at: 4 * hour, remaining: 0 });
  assert.deepEqual(projectUsage([sample(hour, 10), sample(2 * hour, 20), sample(3 * hour, 30)]), { at: 5 * hour, remaining: 50 });
  assert.equal(projectUsage([sample(1000, 20)]), null);
  assert.equal(projectUsage([sample(hour, 0), sample(2 * hour, 0)]), null);
  assert.equal(projectUsage([sample(5 * hour, 40)]), null);
  const current = [sample(hour, 10), sample(2 * hour, 20)];
  assert.deepEqual(projectUsage([sample(0, 90, hour), ...current]), projectUsage(current));
});
