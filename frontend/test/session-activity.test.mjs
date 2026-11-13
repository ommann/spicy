import test from 'node:test';
import assert from 'node:assert/strict';
import { activityTime } from '../src/session-activity.ts';

test('session activity labels share the existing time ranges', () => {
  const now = Date.UTC(2026, 10, 13, 12);
  for (const [minutes, expected] of [
    [-1, 'just now'], [0, 'just now'], [0.99, 'just now'],
    [1, '1 min ago'], [59, '59 min ago'],
    [60, '1 hr ago'], [1439, '23 hr ago'],
    [1440, 'yesterday'], [2879, 'yesterday'],
    [2880, '2 days ago'], [10080, '7 days ago'],
  ]) {
    assert.equal(activityTime(now - minutes * 60000, now), expected);
  }
});
