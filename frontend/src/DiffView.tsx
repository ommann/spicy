import { For, Show, createMemo } from 'solid-js';
import ScrollArea from './ScrollArea';
import { highlightTokens, supportsLanguage } from './syntax.mjs';
import { emphasizeRows } from './diff-model.mjs';
import type { Wire } from './types';
import { copySourceRows } from './source-selection';

const languages: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
  py: 'python', rs: 'rust', sh: 'bash', yml: 'yaml', md: 'markdown', html: 'xml', svg: 'xml',
};

function languageFor(name: string, fallback?: string) {
  const extension = name.split('.').at(-1)?.toLowerCase() || '';
  const language = languages[extension] || extension;
  return supportsLanguage(language) ? language : fallback;
}

function syntaxLines(text: string, language?: string) {
  const lines: { text: string; className: string }[][] = [[]];
  for (const token of highlightTokens(text, language)) {
    token.text.split('\n').forEach((text: string, index: number) => {
      if (index) lines.push([]);
      if (text) lines.at(-1)!.push({ text, className: token.className });
    });
  }
  return lines;
}

function prepareHunk(hunk: Wire, language?: string) {
  const rows = emphasizeRows(hunk.rows);
  const oldRows = rows.filter((row: Wire) => row.kind !== 'add' && row.kind !== 'meta');
  const newRows = rows.filter((row: Wire) => row.kind !== 'remove' && row.kind !== 'meta');
  const oldSyntax = syntaxLines(oldRows.map((row: Wire) => row.text).join('\n'), language);
  const newSyntax = syntaxLines(newRows.map((row: Wire) => row.text).join('\n'), language);
  const syntax = new Map<Wire, { text: string; className: string }[]>();
  oldRows.forEach((row: Wire, index: number) => syntax.set(row, oldSyntax[index]));
  newRows.forEach((row: Wire, index: number) => syntax.set(row, newSyntax[index]));
  return rows.map((row: Wire) => {
    let offset = 0;
    const tokens = (syntax.get(row) || [{ text: row.text, className: '' }]).flatMap(token => {
      const start = offset;
      offset += token.text.length;
      const boundaries = new Set<number>([start, offset]);
      for (const [a, b] of row.emphasis) {
        if (a > start && a < offset) boundaries.add(a);
        if (b > start && b < offset) boundaries.add(b);
      }
      const points = [...boundaries].sort((a, b) => a - b);
      return points.slice(0, -1).map((a, index) => ({
        text: token.text.slice(a - start, points[index + 1] - start), className: token.className,
        emphasized: row.emphasis.some(([x, y]: number[]) => a >= x && a < y),
      }));
    });
    return { ...row, tokens };
  });
}

export default function DiffView(props: { files: Wire[]; fullDocument?: boolean; language?: string; }) {
  const files = createMemo(() => props.files.map(file => ({ ...file, name: String(file.name || ''),
    hunks: file.hunks.map((hunk: Wire) => ({ ...hunk, rows: prepareHunk(hunk,
      file.name.startsWith('tools.') ? 'json' : languageFor(file.name, props.language)) })),
  })));

  return <ScrollArea class="diff-scroll-area" contentClass="diff-view" contentClassList={{ 'diff-document-view': !!props.fullDocument, 'code-diff': props.language !== 'markdown' }}
    events={{ 'aria-label': 'Changes', onCopy: event => copySourceRows(event, event.currentTarget) }}>
    <For each={files()}>{file => <section class="diff-document" style={{
      '--line-number-width': `${file.hunks.reduce((width: number, hunk: Wire) => hunk.rows.reduce((digits: number, row: Wire) =>
        Math.max(digits, String(row.kind === 'remove' ? row.oldLine || '' : row.newLine || '').length), width), 3) + 1}ch`,
    }}>
      <Show when={props.fullDocument && file.name !== 'content'}>
        <div class="diff-file">{file.name.replace(/^sections\./, '').replace(/^tools\./, '')}</div>
      </Show>
      <For each={file.hunks}>{hunk => <>
        <For each={hunk.rows}>{row => <div class={`diff-line diff-${row.kind}`}>
          <span class="diff-line-number" aria-hidden="true">{row.kind === 'meta' ? '' : row.kind === 'remove' ? row.oldLine : row.newLine}</span>
          <code class="diff-source" data-source-row><For each={row.tokens}>{token => <span class={token.className}
            classList={{ 'diff-word': token.emphasized }}>{token.text}</span>}</For></code>
        </div>}</For>
      </>}</For>
    </section>}</For>
  </ScrollArea>;
}
