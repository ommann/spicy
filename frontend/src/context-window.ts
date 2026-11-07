export interface ContextWindowUsage {
  percent: number | null;
  contextWindow: number;
}

export function formatContextWindow(usage?: ContextWindowUsage | null): string {
  if (!usage || !Number.isFinite(usage.contextWindow) || usage.contextWindow <= 0) return '';
  const limit = usage.contextWindow;
  const capacity = limit >= 1_000_000 ? `${Number((limit / 1_000_000).toFixed(1))}m`
    : limit >= 1_000 ? `${Number((limit / 1_000).toFixed(1))}k` : String(limit);
  const percent = usage.percent !== null && Number.isFinite(usage.percent) ? `${usage.percent.toFixed(1)}%` : '?';
  return `${percent}/${capacity}`;
}
