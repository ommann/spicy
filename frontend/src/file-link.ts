import { createContext } from 'solid-js';

export const FileLinkCwdContext = createContext<() => string>(() => '');

export function fileLink(href: string, cwd: string): string {
  const path = href.trim();
  if (/^[a-z][a-z\d+.-]*:/i.test(path)) return href;
  const base = `file://${cwd.startsWith('/') ? '' : '/'}${cwd.replace(/\/$/, '')}/`;
  return new URL(path.split('/').map(encodeURIComponent).join('/'), base).href;
}
