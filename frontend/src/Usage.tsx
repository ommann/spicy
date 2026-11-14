import { For, Show, createMemo, createSignal, onMount } from 'solid-js';
import Dialog from './Dialog';
import { api } from './api';
import { usageWindowNames, type UsageWindow } from '../../shared/usage';
import { formatSchedule, usageForecast, usageDayBoundaries, usageWindowStart, weeklyCalendarRange, type UsageSample } from './usage-projection';
import './usage.css';

export default function Usage(props: { onClose: () => void }) {
  const [samples, setSamples] = createSignal<UsageSample[]>([]);
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(true);
  const windows = createMemo(() => Object.fromEntries(usageWindowNames.map(usageWindow => {
    const history = samples().filter(sample => sample.window === usageWindow);
    const latest = history.at(-1);
    const current = latest ? history.filter(sample => sample.resetAt === latest.resetAt && sample.observedAt >= usageWindowStart(latest)) : [];
    return [usageWindow, { latest, current, forecast: usageForecast(current) }];
  })) as Record<UsageWindow, { latest?: UsageSample; current: UsageSample[]; forecast: ReturnType<typeof usageForecast> }>);
  async function load() {
    setError('');
    try { await api.auth.codexUsage({}); }
    catch { setError('Could not refresh limits. Showing saved usage.'); }
    try { setSamples(await api.auth.usageHistory({})); }
    catch { setError('Could not read saved usage.'); }
    finally { setLoading(false); }
  }
  // One user-initiated fetch per opening; successful responses are persisted by the backend.
  onMount(() => { void load(); });
  return <Dialog title="Usage" open onClose={props.onClose}>
    <div class="usage-view">
      <Show when={error()}><p role="alert">{error()}</p></Show>
      <Show when={!loading()} fallback={<p>Loading usage...</p>}>
        <For each={usageWindowNames}>{usageWindow => {
          const model = () => windows()[usageWindow];
          const latest = () => model().latest;
          const range = () => usageWindow === 'weekly' && latest() ? weeklyCalendarRange(latest()!.resetAt) : null;
          const start = () => range()?.start ?? (latest() ? usageWindowStart(latest()!) : 0);
          const end = () => range()?.end ?? latest()?.resetAt ?? 0;
          const x = (at: number) => 40 + 500 * (at - start()) / Math.max(1, end() - start());
          const y = (remaining: number) => 225 - remaining * 2;
          const days = () => usageWindow === 'weekly' ? usageDayBoundaries(start(), end()) : [];
          const sections = () => {
            if (usageWindow !== 'weekly' || !latest()) return [];
            const edges = [start(), ...days(), end()];
            return edges.slice(0, -1).map((at, index) => ({ at, center: (at + edges[index + 1]) / 2 }));
          };
          const points = () => model().current.map(sample => `${x(sample.observedAt)},${y(100 - sample.usedPercent)}`).join(' ');
          return <section class="usage-window">
            <header><span>{usageWindow === 'weekly' ? 'Weekly' : '5-hour'}: {latest() ? `${100 - latest()!.usedPercent}% left` : 'No samples yet'}</span><Show when={latest()}>{sample => <span class="usage-muted">Reset: {new Date(sample().resetAt).toLocaleString()}</span>}</Show></header>
            <Show when={latest()}>{sample => <>
              <svg viewBox="0 0 560 250" role="img" aria-label={`${usageWindow} remaining usage: solid history, dashed projection`}>
                <For each={[100, 75, 50, 25, 0]}>{percent => <><text x="0" y={y(percent) + 4}>{percent}%</text><line class="usage-grid" x1="40" x2="540" y1={y(percent)} y2={y(percent)} /></>}</For>
                <For each={days()}>{day => <line class="usage-grid" x1={x(day)} x2={x(day)} y1="25" y2="225" />}</For>
                <For each={sections()}>{section => <text x={x(section.center)} y="243" text-anchor="middle">{new Date(section.at).toLocaleDateString(undefined, { weekday: 'short' })}</text>}</For>
                <line class="usage-reset" x1={x(sample().resetAt)} x2={x(sample().resetAt)} y1="25" y2="225" />
                <Show when={model().current[0]}>{first => <>
                  <line class="usage-projected usage-start-connection" x1={x(usageWindowStart(sample()))} y1={y(100)} x2={x(first().observedAt)} y2={y(100 - first().usedPercent)} />
                  <circle class="usage-start" cx={x(usageWindowStart(sample()))} cy={y(100)} r="3"><title>Window start: 100% remaining</title></circle>
                </>}</Show>
                <polyline class="usage-actual" points={points()} />
                <circle cx={x(sample().observedAt)} cy={y(100 - sample().usedPercent)} r="3" />
                <Show when={model().forecast?.projection}>{projection => <line class="usage-projected" x1={x(sample().observedAt)} y1={y(100 - sample().usedPercent)} x2={x(projection().at)} y2={y(projection().remaining)} />}</Show>
              </svg>
            </>}</Show>
          </section>;
        }}</For>
        <div class="usage-schedule">
          <For each={usageWindowNames}>{usageWindow => <div>{usageWindow === 'weekly' ? 'Weekly' : '5-hour'}: {windows()[usageWindow].forecast ? formatSchedule(windows()[usageWindow].forecast!.scheduleOffset) : 'Not enough trend data yet'}</div>}</For>
        </div>
      </Show>
    </div>
  </Dialog>;
}
