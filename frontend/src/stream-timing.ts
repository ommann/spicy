type Row = Record<string, string | number | undefined>;
const rows: Row[] = [];
function push(row: Row) {
  rows.push(row);
  if (rows.length > 5000) rows.splice(0, rows.length - 5000);
}
// Inspect/export with window.spicyTiming; clear immediately before a diagnostic run.
Object.assign(window, { spicyTiming: {
  rows,
  clear: () => { rows.length = 0; },
  export: () => JSON.stringify(rows),
} });
try {
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) push({ type: 'longtask', at: performance.timeOrigin + entry.startTime, durationMs: entry.duration });
  }).observe({ entryTypes: ['longtask'] });
} catch { /* Long-task observations are not supported in every browser. */ }

export function traceRecord(agentId: string, record: Record<string, any>) {
  const start = performance.now();
  const row: Row = { agentId, type: record.type, event: record.assistantMessageEvent?.type,
    emittedAt: record.spicyEmittedAt, backendReceivedAt: record.spicyReceivedAt,
    backendSentAt: record.spicySentAt, browserReceivedAt: Date.now() };
  push(row);
  return () => {
    row.handlerMs = performance.now() - start;
    requestAnimationFrame(() => {
      row.frameDelayMs = performance.now() - start;
      // The second frame is a paint opportunity proxy, not proof of a completed paint.
      requestAnimationFrame(() => { row.paintOpportunityMs = performance.now() - start; });
    });
  };
}
