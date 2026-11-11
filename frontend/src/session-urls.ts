const sessionPrefix = /^\/([abcdefghjkmnopqrstuvwxyz23456789]{8})(?=\/|$)/;

export function sessionUrlIdFromPath(path: string): string | undefined {
  return sessionPrefix.exec(path)?.[1];
}

export function sessionViewPath(path: string): string {
  return path.replace(sessionPrefix, '') || '/';
}

export function sessionPath(path: string, urlId?: string): string {
  const view = sessionViewPath(path);
  return urlId ? `/${urlId}${view === '/' ? '' : view}` : view;
}
