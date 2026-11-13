import { createSignal, For, onMount, Show } from 'solid-js';
import { api } from './api';
import { A } from '@solidjs/router';
import { branchLabel, type BranchLabel } from './branch-labels';
import type { Entry, Wire } from './types';
import { createSystemPromptCatalog } from './system-prompts';
import { createPrefixResolver } from './chat/prefix-state';
import { activityTime, createActivityClock } from './session-activity';

type Row = { id: string; text: string; prompt?: number; associatedPrompt?: number; title?: boolean; user?: boolean; priority?: boolean; endsLane?: boolean; compactionStart?: boolean; compactionRoot?: string; annotation?: string; label?: BranchLabel; href?: string; children: Row[] };

function historyRows(entries: Entry[]): Row[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const visible = new Map<string, Row>();
  const catalog = createSystemPromptCatalog(entries);
  const prefix = createPrefixResolver(entries);
  for (const entry of entries) {
    const message = entry.message;
    if (!message) continue;
    const system = message.role === 'system';
    const title = message.role === 'toolResult' && message.toolName === 'set_title' && !message.isError;
    const content = message.content;
    const text = title ? message.details?.title : typeof content === 'string' ? content
      : (content || []).filter((block: Wire) => block.type === 'text').map((block: Wire) => block.text).join('\n');
    if (system) visible.set(entry.id, { id: entry.id, text: '', prompt: catalog.numberFor(prefix.get(entry.id)),
      priority: prefix.changesPrefix(entry) && !!(message.toolsAdded?.length || message.toolsRemoved?.length), children: [] });
    else if (text && (title || ['user', 'assistant'].includes(message.role))) {
      let root = entry;
      const seen = new Set<string>();
      while (root.parentId && byId.has(root.parentId) && !seen.has(root.id)) {
        seen.add(root.id);
        root = byId.get(root.parentId)!;
      }
      visible.set(entry.id, { id: entry.id, text, title, user: message.role === 'user',
        compactionRoot: root.type === 'compaction' && root.parentId === null ? root.id : undefined,
        associatedPrompt: catalog.numberFor(prefix.get(entry.id)), children: [] });
    }
  }
  const roots: Row[] = [];
  for (const [id, row] of visible) {
    let parent = byId.get(id)?.parentId;
    const seen = new Set<string>();
    while (parent && !visible.has(parent) && !seen.has(parent)) {
      seen.add(parent);
      parent = byId.get(parent)?.parentId;
    }
    (parent && visible.has(parent) ? visible.get(parent)!.children : roots).push(row);
  }
  let firstMessage = true;
  function summarize(row: Row, branchStart = false, inheritedPrompt?: number): Row[] {
    const activePrompt = row.prompt || inheritedPrompt;
    const startingMessage = !row.prompt && !row.title && firstMessage;
    if (startingMessage) firstMessage = false;
    const fork = row.children.length > 1;
    const endsLane = row.children.some(child => child.priority);
    const promptBoundary = row.children.some(child => child.prompt);
    const children = row.children.flatMap(child => summarize(child, fork || !!row.prompt, activePrompt));
    if (row.prompt || row.title) {
      if (children[0]) children[0] = { ...children[0],
        ...(row.prompt ? { associatedPrompt: row.prompt } : { annotation: row.text }),
      };
      return children;
    }
    if (startingMessage || branchStart || fork || promptBoundary || row.children.length === 0) {
      return [{ ...row, endsLane, children }];
    }
    return children;
  }
  const summary = roots.flatMap(row => summarize(row));
  const markedCompactions = new Set<string>();
  function markCompactionStarts(items: Row[]) {
    for (const row of items) {
      if (row.compactionRoot && !markedCompactions.has(row.compactionRoot)) {
        row.compactionStart = true;
        markedCompactions.add(row.compactionRoot);
      }
      markCompactionStarts(row.children);
    }
  }
  markCompactionStarts(summary);
  return summary;
}

function excerpt(text: string) {
  const line = text.replace(/\s+/g, ' ').trim();
  return line;
}

function Rows(props: { rows: Row[]; depth?: number }) {
  return <For each={props.rows}>{row => {
    let end = row;
    const labels: BranchLabel[] = row.label ? [row.label] : [];
    while (end.children.length === 1 && !end.endsLane
      && end.children[0].associatedPrompt === end.associatedPrompt) {
      end = end.children[0];
      if (end.label) labels.push(end.label);
    }
    return <>
      <span class="history-data-prompt" classList={{ 'history-data-compaction': row.compactionStart }}>{row.associatedPrompt ? `#${row.associatedPrompt}` : ''}</span>
      <div class="history-data-text" style={{ 'padding-left': `${(props.depth || 0) * 2}ch` }}>
        <A classList={{ 'history-data-user': row.user }} href={row.href || '/'}>{excerpt(row.text)}</A>
        <Show when={end !== row}>
          {' ... '}
          <A classList={{ 'history-data-user': end.user }} href={end.href || '/'}>{excerpt(end.text)}</A>
        </Show>
      </div>
      <div class="history-data-meta">
        <Show when={labels.length}><span class="history-data-labels"><For each={labels}>{label => <span style={{ color: 'var(--status-error)' }}>{label.text}</span>}</For></span></Show>
        <Show when={end.annotation}><span class="history-data-title">{excerpt(end.annotation!)}</span></Show>
      </div>
      <Rows rows={end.children} depth={(props.depth || 0) + 1} />
    </>;
  }}</For>;
}

export default function SessionHistory(props: { projectQuery: string }) {
  const now = createActivityClock();
  const [histories, setHistories] = createSignal<{ id: string; path: string; modified: number; rows: Row[]; latest?: { text: string; user: boolean; href: string; title?: string } }[]>([]);
  const [error, setError] = createSignal('');
  onMount(async () => {
    try {
      const cards = await api.histories({});
      for (const value of cards) {
        try {
          const agents = value.members;
          const entries = new Map<string, Entry>();
          for (const agent of agents) for (const entry of agent.entries) entries.set(entry.id, entry);
          const rows = historyRows([...entries.values()]);
          const latest = value.latest;
          function linkRows(items: Row[]) {
            for (const row of items) {
              const branch = agents.find(agent => agent.state?.sessionUrlId && agent.entries.some((entry: Entry) => entry.id === row.id));
              if (branch) row.href = `/b/${branch.state!.sessionUrlId}`;
              linkRows(row.children);
            }
          }
          linkRows(rows);
          const displayed = new Map<string, Row>();
          const indexRows = (items: Row[]) => { for (const row of items) { displayed.set(row.id, row); indexRows(row.children); } };
          indexRows(rows);
          for (const entry of entries.values()) {
            const label = branchLabel(`lane:${entry.id}`);
            if (!label) continue;
            let id: string | null | undefined = entry.id;
            const visited = new Set<string>();
            while (id && !displayed.has(id) && !visited.has(id)) {
              visited.add(id);
              id = entries.get(id)?.parentId;
            }
            if (id && displayed.has(id)) displayed.get(id)!.label = label;
            else {
              for (const row of displayed.values()) {
                let ancestor: string | null | undefined = row.id;
                const seen = new Set<string>();
                while (ancestor && ancestor !== entry.id && !seen.has(ancestor)) {
                  seen.add(ancestor);
                  ancestor = entries.get(ancestor)?.parentId;
                }
                if (ancestor === entry.id) { row.label = label; break; }
              }
            }
          }
          const cwd = value.path;
          setHistories(previous => [...previous, {
            id: value.id,
            path: cwd.replace(/^\/home\/[^/]+(?=\/|$)|^\/Users\/[^/]+(?=\/|$)/, '~'),
            modified: value.modified,
            rows,
            latest,
          }]);
        } catch (failure) { setError(String(failure)); }
      }
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
