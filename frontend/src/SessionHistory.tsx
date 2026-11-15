import { createSignal, For, onMount, Show } from 'solid-js';
import { api } from './api';
import { A } from '@solidjs/router';
import type { PreviewRow as Row } from '../../shared/history';
import { activityTime, createActivityClock } from './session-activity';

function Rows(props: { rows: Row[] }) {
  return <For each={props.rows}>{row => <>
    <span class="history-data-prompt" classList={{ 'history-data-compaction': row.compactionStart }}>{row.prompt}</span>
    <div class="history-data-text" style={{ 'padding-left': row.padding }}>
      <A classList={{ 'history-data-user': row.user }} href={row.href}>{row.text}</A>
      <Show when={row.end}>{end => <>{' ... '}<A classList={{ 'history-data-user': end().user }} href={end().href}>{end().text}</A></>}</Show>
    </div>
    <div class="history-data-meta">
      <Show when={row.labels.length}><span class="history-data-labels"><For each={row.labels}>{label => <span style={{ color: 'var(--status-error)' }}>{label.text}</span>}</For></span></Show>
      <Show when={row.annotation}><span class="history-data-title">{row.annotation}</span></Show>
    </div>
  </>}</For>;
}

export default function SessionHistory(props: { projectQuery: string }) {
  const now = createActivityClock();
  const [histories, setHistories] = createSignal<{ id: string; path: string; modified: number; rows: Row[]; latest?: { text: string; user: boolean; href: string; title?: string } }[]>([]);
  const [error, setError] = createSignal('');
  onMount(async () => {
    try {
      const cards = await api.histories({});
      setHistories(cards);
    } catch (failure) { setError(String(failure)); }
  });
  const filtered = () => histories().filter(history => history.path.toLowerCase().includes(props.projectQuery.toLowerCase()));
  const day = (modified: number) => new Date(modified).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  return <>
    <Show when={error()}><p role="alert">{error()}</p></Show>
    <For each={filtered()}>{(history, index) => <>
      <Show when={index() === 0 || day(filtered()[index() - 1].modified) !== day(history.modified)}>
        <h2 class="history-date-divider">{day(history.modified)}</h2>
      </Show>
      <article class="history-card history-data">
        <Show when={history.latest}>{latest => <>
          <div class="history-latest-message history-latest-title">
            <div class="history-heading-text"><A href={latest().href}>{latest().title || 'Untitled'}</A>{' in '}{history.path}{' '}<A class="history-tree-id" href={`/t/${history.id}`}>{history.id}</A></div>
            <time class="history-activity" dateTime={new Date(history.modified).toISOString()} title={new Date(history.modified).toLocaleString()}>{activityTime(history.modified, now())}</time>
          </div>
          <div class="history-latest-message">
            <A classList={{ 'history-data-user': latest().user }} href={latest().href}>{latest().text}</A>
          </div>
        </>}</Show>
        <div class="history-data-grid"><Rows rows={history.rows} /></div>
      </article>
    </>}</For>
  </>;
}
