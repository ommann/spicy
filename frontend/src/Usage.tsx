import { For, Show, createSignal, onMount } from 'solid-js';
import Dialog from './Dialog';
import { api } from './api';
import { formatSchedule, projectUsage, usageDayBoundaries, usageSchedule, weeklyCalendarRange, type UsageSample } from './usage-projection';
import './usage.css';

export default function Usage(props: { onClose: () => void }) {
  const [samples, setSamples] = createSignal<UsageSample[]>([]);
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(true);
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
        <For each={['5-hour', 'weekly']}>{window => {
          const history = () => samples().filter(sample => sample.window === window);
          const latest = () => history().at(-1);
          const current = () => history().filter(sample => sample.resetAt === latest()?.resetAt);
          const projection = () => projectUsage(current());
          const range = () => window === 'weekly' && latest() ? weeklyCalendarRange(latest()!.resetAt) : null;
          const start = () => range()?.start ?? current()[0]?.observedAt ?? 0;
          const end = () => range()?.end ?? latest()?.resetAt ?? 0;
          const x = (at: number) => 40 + 500 * (at - start()) / Math.max(1, end() - start());
          const y = (remaining: number) => 225 - remaining * 2;
          const days = () => window === 'weekly' ? usageDayBoundaries(start(), end()) : [];
          const sections = () => {
            if (window !== 'weekly' || !latest()) return [];
            const edges = [start(), ...days(), end()];
            return edges.slice(0, -1).map((at, index) => ({ at, center: (at + edges[index + 1]) / 2 }));
          };
          const points = () => current().map(sample => `${x(sample.observedAt)},${y(100 - sample.usedPercent)}`).join(' ');
          return <section class="usage-window">
            <header><span>{window === 'weekly' ? 'Weekly' : '5-hour'}: {latest() ? `${100 - latest()!.usedPercent}% left` : 'No samples yet'}</span><Show when={latest()}>{sample => <span class="usage-muted">Reset: {new Date(sample().resetAt).toLocaleString()}</span>}</Show></header>
            <Show when={latest()}>{sample => <>
              <svg viewBox="0 0 560 250" role="img" aria-label={`${window} remaining usage: solid history, dashed projection`}>
                <For each={[100, 75, 50, 25, 0]}>{percent => <><text x="0" y={y(percent) + 4}>{percent}%</text><line class="usage-grid" x1="40" x2="540" y1={y(percent)} y2={y(percent)} /></>}</For>
                <For each={days()}>{day => <>
                  <line class="usage-grid" x1={x(day)} x2={x(day)} y1="25" y2="225" />
                </>}</For>
                <For each={sections()}>{section => <text x={x(section.center)} y="243" text-anchor="middle">{new Date(section.at).toLocaleDateString(undefined, { weekday: 'short' })}</text>}</For>
                <line class="usage-reset" x1={x(sample().resetAt)} x2={x(sample().resetAt)} y1="25" y2="225" />
                <polyline class="usage-actual" points={points()} />
                <circle cx={x(sample().observedAt)} cy={y(100 - sample().usedPercent)} r="3" />
                <Show when={projection()}>{end => <line class="usage-projected" x1={x(sample().observedAt)} y1={y(100 - sample().usedPercent)} x2={x(end().at)} y2={y(end().remaining)} />}</Show>
              </svg>
            </>}</Show>
          </section>;
        }}</For>
        <div class="usage-schedule">
          <For each={['5-hour', 'weekly']}>{window => {
            const offset = () => usageSchedule(samples().filter(sample => sample.window === window));
            return <div>{window === 'weekly' ? 'Weekly' : '5-hour'}: {offset() === null ? 'Not enough trend data yet' : formatSchedule(offset()!)}</div>;
          }}</For>
        </div>
      </Show>
    </div>
  </Dialog>;
}
