const hour = 60 * 60 * 1000;
export const usageWindows = {
  '5-hour': { duration: 5 * hour, bucket: 5 * 60000, minimumSpan: 15 * 60000 },
  weekly: { duration: 7 * 24 * hour, bucket: 30 * 60000, minimumSpan: 2 * hour },
} as const;
export type UsageWindow = keyof typeof usageWindows;
export const usageWindowNames = Object.keys(usageWindows) as UsageWindow[];
export interface UsageSample { observedAt: number; window: UsageWindow; usedPercent: number; resetAt: number }
export function usageWindowStart(sample: UsageSample) {
  return sample.resetAt - usageWindows[sample.window].duration;
}
