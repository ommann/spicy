import type { Stmt } from 'sh-syntax';

const indent = '    ';
const wrapColumn = 80;

type ChainPart = { stmt: Stmt; operator?: string };

// Only split simple commands and their chains. Compound commands, heredocs,
// and comments keep their original layout rather than risking a syntax change.
function flatten(stmt: Stmt, slice: (start: number, end: number) => string, parts: ChainPart[]): boolean {
  if (stmt.comments.length || stmt.background || stmt.coprocess || stmt.disown || stmt.negated) return false;
  const cmd = stmt.cmd;
  if (cmd?.type === 'CallExpr' && !stmt.redirs.some(redir => redir.hdoc)) {
    parts.push({ stmt });
    return true;
  }
  if (cmd?.type !== 'BinaryCmd' || !cmd.x || !cmd.y || stmt.redirs.length) return false;
  const operator = slice(cmd.x.end, cmd.y.start).trim();
  if (!/^(?:&&|\|\||\||\|&)$/.test(operator) || !flatten(cmd.x, slice, parts)) return false;
  parts[parts.length - 1].operator = operator;
  return flatten(cmd.y, slice, parts);
}

export async function prettyShell(source: string): Promise<string | null> {
  const { createSourceIndex, parse } = await import('sh-syntax');
  const ast = await parse(source, { keepComments: true }).catch(() => null);
  if (!ast || ast.lastComments.length || !ast.stmts.length) return null;
  const index = createSourceIndex(source);
  const slice = (start: number, end: number) => source.slice(index(start), index(end));
  const lines: string[] = [];
  let previousWasMultiline = false;
  for (const [i, stmt] of ast.stmts.entries()) {
    const previous = ast.stmts[i - 1];
    if (previous) {
      const gap = slice(previous.end, stmt.start);
      if (!/^\s*$/.test(gap)) return null;
      if (previousWasMultiline || gap.includes('\n\n')) lines.push('');
    }
    const firstLine = lines.length;
    const parts: ChainPart[] = [];
    if (!flatten(stmt, slice, parts) || slice(stmt.start, stmt.end).includes('\n')) return null;
    for (const [j, part] of parts.entries()) {
      const { stmt: leaf, operator } = part;
      const cmd = leaf.cmd;
      if (cmd?.type !== 'CallExpr') return null;
      const prefix = j ? indent : '';
      const suffix = operator ? ` ${operator}` : '';
      const end = Math.max(cmd.end, ...leaf.redirs.map(redir => redir.end));
      let text = slice(leaf.start, end);
      if (prefix.length + text.length + suffix.length > wrapColumn) {
        const breaks = cmd.args.slice(1).filter(word => /^--[\w-]/.test(slice(word.start, word.end))).map(word => word.start);
        // Keep a trailing group of redirects together, e.g. >file 2>&1.
        const firstRedirect = leaf.redirs[0];
        if (firstRedirect && firstRedirect.start >= cmd.end) breaks.push(firstRedirect.start);
        const tokenEnds = [...cmd.args, ...leaf.redirs].map(node => node.end);
        let start = leaf.start;
        const pieces = breaks.map(stop => {
          const previousEnd = Math.max(start, ...tokenEnds.filter(offset => offset <= stop));
          const piece = slice(start, previousEnd);
          start = stop;
          return piece;
        });
        text = [...pieces, slice(start, end)].join(` \\\n${prefix}${indent}`);
      }
      lines.push(prefix + text + suffix);
    }
    previousWasMultiline = lines.length - firstLine > 1 || lines[firstLine].includes('\n');
  }
  const formatted = lines.join('\n');
  return formatted === source ? null : formatted;
}
