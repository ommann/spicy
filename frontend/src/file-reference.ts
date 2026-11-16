export interface FileReference {
  path: string;
  line?: number;
}

/** Recognize a single file reference, not commands, URLs, or arbitrary inline code. */
export function parseFileReference(text: string): FileReference | undefined {
  const match = text.match(/^([^\s`<>"'|?*:#]+?)(?::([1-9]\d*)(?::[1-9]\d*|[-–][1-9]\d*)?|#L([1-9]\d*)(?:-L[1-9]\d*)?)?$/);
  if (!match) return undefined;
  const path = match[1];
  // Require a file-like basename. Extensionless names remain ordinary code.
  if (!/(?:^|\/)\.?[\w@-][\w.@-]*\.[a-zA-Z0-9][\w-]*$/.test(path)) return undefined;
  if (path.includes('//') || /[(){}[\]=;,]/.test(path)) return undefined;
  const line = match[2] || match[3];
  if (line && !Number.isSafeInteger(Number(line))) return undefined;
  return { path, ...(line ? { line: Number(line) } : {}) };
}
