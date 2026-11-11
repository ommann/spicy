import { common, createLowlight } from 'lowlight';

const lowlight = createLowlight(common);

export const supportsLanguage = language => !!language && lowlight.registered(language);

// Deliberately recognize only direct interpreter commands, not arbitrary shell syntax.
// Keep every character, including delimiters and tab-stripped heredoc indentation.
export function highlightHeredocTokens(text) {
  const tokens = [];
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
  let shell = '';
  for (let i = 0; i < lines.length; i++) {
    const header = /(?:^|[;&|]\s*)\s*(node(?:js)?|python(?:\d+(?:\.\d+)?)?)(?:[ \t]+(?:--input-type=module|-u|-B|-))*[ \t]+<<(-?)[ \t]*(?:'([A-Za-z_][\w]*)'|"([A-Za-z_][\w]*)"|([A-Za-z_][\w]*))[ \t]*\r?\n$/.exec(lines[i]);
    shell += lines[i];
    if (!header) continue;
    const marker = header[3] || header[4] || header[5];
    let end = i + 1;
    for (; end < lines.length; end++) {
      let line = lines[end].replace(/\r?\n$/, '');
      if (header[2]) line = line.replace(/^\t+/, '');
      if (line === marker) break;
    }
    if (end === lines.length) continue;
    tokens.push(...highlightTokens(shell, 'bash'));
    shell = '';
    tokens.push(...highlightTokens(lines.slice(i + 1, end).join(''), header[1].startsWith('node') ? 'javascript' : 'python'));
    shell = lines[end];
    i = end;
  }
  tokens.push(...highlightTokens(shell, 'bash'));
  return tokens;
}

// Keep highlighting as data: callers render escaped text, never HTML strings.
export function highlightTokens(text, language) {
  if (!supportsLanguage(language)) return [{ text, className: '' }];
  const tokens = [];
  function visit(node, classes = []) {
    const nested = [...classes, ...(node.properties?.className || [])];
    if (node.type === 'text') tokens.push({ text: node.value, className: nested.join(' ') });
    else for (const child of node.children || []) visit(child, nested);
  }
  visit(lowlight.highlight(language, text));
  return tokens;
}
