// Copy source rows explicitly: grid layout can otherwise introduce tabs/spaces
// between the non-selectable gutter and the code in browser clipboard text.
export function copySourceRows(event: ClipboardEvent, container: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed || !event.clipboardData) return;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return;
  const rows: string[] = [];
  for (const source of container.querySelectorAll('[data-source-row]')) {
    if (!range.intersectsNode(source)) continue;
    const part = document.createRange();
    part.selectNodeContents(source);
    if (source.contains(range.startContainer)) part.setStart(range.startContainer, range.startOffset);
    if (source.contains(range.endContainer)) part.setEnd(range.endContainer, range.endOffset);
    rows.push(part.toString());
  }
  if (!rows.length) return;
  event.clipboardData.setData('text/plain', rows.join('\n'));
  event.preventDefault();
}

export function selectSource(element: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
