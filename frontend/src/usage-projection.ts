import { usageWindows, usageWindowStart, type UsageSample } from '../../shared/usage.ts';
export { usageWindowStart, type UsageSample } from '../../shared/usage.ts';

export function weeklyCalendarRange(resetAt: number) {
  const start = new Date(resetAt - usageWindows.weekly.duration);
  start.setHours(0, 0, 0, 0);
  const end = new Date(resetAt);
  end.setHours(0, 0, 0, 0);
  if (end.getTime() < resetAt) end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime() };
}

export function usageDayBoundaries(start: number, end: number): number[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const day = new Date(start);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + 1);
  const boundaries: number[] = [];
  while (day.getTime() < end && boundaries.length < 14) {
    boundaries.push(day.getTime());
    day.setDate(day.getDate() + 1);
  }
  return boundaries;
}

// Ordinary least squares on time-bucket averages avoids overweighting bursts of
// hover requests. Flat observations matter: they represent elapsed idle time.
export function usageRate(samples: UsageSample[]) {
  const latest = samples.at(-1);
  if (!latest || latest.observedAt >= latest.resetAt) return null;
  const { bucket: bucketMs, minimumSpan } = usageWindows[latest.window];
  const windowStart = usageWindowStart(latest);
  const current = samples.filter(sample => sample.resetAt === latest.resetAt && sample.window === latest.window
    && sample.observedAt >= windowStart && sample.observedAt <= latest.observedAt && Number.isFinite(sample.usedPercent));
  const buckets = new Map<number, { time: number; used: number; count: number }>();
  for (const sample of current) {
    const key = Math.floor(sample.observedAt / bucketMs);
    const bucket = buckets.get(key) ?? { time: 0, used: 0, count: 0 };
    bucket.time += sample.observedAt - latest.observedAt;
    bucket.used += sample.usedPercent;
    bucket.count++;
    buckets.set(key, bucket);
  }
  // Keep the known window-start boundary separate from sampled bucket averages.
  // It belongs to the actual allowance window, not the chart's calendar padding.
  const points = [
    { time: windowStart - latest.observedAt, used: 0 },
    ...[...buckets.values()].map(bucket => ({ time: bucket.time / bucket.count, used: bucket.used / bucket.count })),
  ];
  if (points.length < 2 || Math.max(...points.map(point => point.time)) - Math.min(...points.map(point => point.time)) < minimumSpan
    || Math.max(...points.map(point => point.used)) - Math.min(...points.map(point => point.used)) < 3) return null;
  const meanTime = points.reduce((sum, point) => sum + point.time, 0) / points.length;
  const meanUsed = points.reduce((sum, point) => sum + point.used, 0) / points.length;
  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    covariance += (point.time - meanTime) * (point.used - meanUsed);
    variance += (point.time - meanTime) ** 2;
  }
  const rate = covariance / variance;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

export function usageForecast(samples: UsageSample[]) {
  const latest = samples.at(-1);
  if (!latest) return null;
  const rate = usageRate(samples);
  if (rate === null) return null;
  const depletionAt = latest.observedAt + (100 - latest.usedPercent) / rate;
  const at = Math.min(latest.resetAt, depletionAt);
  return {
    scheduleOffset: depletionAt - latest.resetAt,
    projection: { at, remaining: Math.max(0, 100 - latest.usedPercent - rate * (at - latest.observedAt)) },
  };
}

export function usageSchedule(samples: UsageSample[]) {
  return usageForecast(samples)?.scheduleOffset ?? null;
}

export function formatSchedule(offset: number) {
  if (Math.abs(offset) < 60000) return 'On schedule';
  const minutes = Math.round(Math.abs(offset) / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  const rest = minutes % 60;
  const duration = [days ? `${days}d` : '', hours ? `${hours}h` : '', rest ? `${rest}m` : ''].filter(Boolean).join(' ') || '<1m';
  return `${offset < 0 ? 'Ahead of schedule' : 'Behind schedule'}: ${duration}`;
}

export function projectUsage(samples: UsageSample[]) {
  return usageForecast(samples)?.projection ?? null;
}
