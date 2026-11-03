export function promptLabel(number: number, title?: string) {
  return `#${number}${title ? ` - ${title}` : ''}`;
}
