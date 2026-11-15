import type { Entry, Wire } from '../frontend/src/types.ts';
import { createSystemPromptCatalog } from '../shared/system-prompts.ts';
import { createPrefixResolver } from '../shared/prefix-state.ts';

import type { PreviewRow, HistoryRow as Row } from '../shared/history.ts';

export function historyRows(entries: Entry[]): Row[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const visible = new Map<string, Row>();
  const catalog = createSystemPromptCatalog(entries, { details: false });
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


export function prepareHistory(members: { entries: Entry[]; state: { sessionUrlId?: string } }[], labels: Record<string, import('../shared/branch-labels.ts').BranchLabel> = {}) {
  const agents = members;
  const entries = new Map<string, Entry>();
  for (const agent of agents) for (const entry of agent.entries) entries.set(entry.id, entry);
  const rows = historyRows([...entries.values()]);
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
    const label = labels[`lane:${entry.id}`];
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

  return { rows: presentHistoryRows(rows) };
}

/** Finish the display rows here so the browser only creates elements. */
export function presentHistoryRows(rows: Row[], depth = 0): PreviewRow[] {
  const result: PreviewRow[] = [];
  const excerpt = (text: string) => text.replace(/\s+/g, ' ').trim();
  for (const row of rows) {
    let end = row;
    const labels = row.label ? [row.label] : [];
    while (end.children.length === 1 && !end.endsLane
      && end.children[0].associatedPrompt === end.associatedPrompt) {
      end = end.children[0];
      if (end.label) labels.push(end.label);
    }
    result.push({
      id: row.id, text: excerpt(row.text), href: row.href || '/', user: row.user,
      end: end !== row ? { text: excerpt(end.text), href: end.href || '/', user: end.user } : undefined,
      prompt: row.associatedPrompt ? `#${row.associatedPrompt}` : '',
      compactionStart: row.compactionStart, padding: `${depth * 2}ch`, labels,
      annotation: end.annotation ? excerpt(end.annotation) : undefined,
    });
    result.push(...presentHistoryRows(end.children, depth + 1));
  }
  return result;
}
