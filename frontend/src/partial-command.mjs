/** Decode the available portion of a streamed JSON command string. */
export function partialCommand(partial) {
  const match = /"command"\s*:\s*"((?:[^"\\]|\\.)*)/s.exec(partial || '');
  if (!match) return '';
  const text = match[1];
  // A chunk can end midway through a JSON escape (including \uXXXX).
  for (let trim = 0; trim <= Math.min(6, text.length); trim++) {
    try { return JSON.parse(`"${text.slice(0, text.length - trim)}"`); }
    catch { /* Wait for the remaining escape characters. */ }
  }
  return '';
}
