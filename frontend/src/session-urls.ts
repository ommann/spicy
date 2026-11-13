const id = '[abcdefghjkmnopqrstuvwxyz23456789]{8}';
const branch = new RegExp(`^/b/(${id})(?=/|$)`);
const tree = new RegExp(`^/t/(${id})(?:/(${id}))?/?$`);
const legacy = new RegExp(`^/(${id})(?=/|$)`);

export function sessionUrlIdFromPath(path: string): string | undefined {
  const match = tree.exec(path);
  return match?.[2] || match?.[1] || branch.exec(path)?.[1] || legacy.exec(path)?.[1];
}

export function treeUrlIdFromPath(path: string): string | undefined {
  return tree.exec(path)?.[1];
}

export function sessionViewPath(path: string): string {
  if (tree.test(path)) return '/tree';
  if (branch.test(path)) return path.replace(branch, '') || '/single';
  return path.replace(legacy, '') || '/';
}

export function sessionPath(path: string, urlId?: string, treeId?: string): string {
  const view = sessionViewPath(path);
  if (!urlId) return view;
  if (view === '/tree') {
    const rootId = treeId || treeUrlIdFromPath(path) || urlId;
    return `/t/${rootId}${rootId === urlId ? '' : `/${urlId}`}`;
  }
  return `/b/${urlId}${['/', '/chat', '/single'].includes(view) ? '' : view}`;
}
