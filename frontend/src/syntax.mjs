import { common, createLowlight } from 'lowlight';

const lowlight = createLowlight(common);

export const supportsLanguage = language => !!language && lowlight.registered(language);

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
