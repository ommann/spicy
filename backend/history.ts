import { SessionManager, type SessionInfo, type SessionEntry } from '../packages/coding-agent/src/core/session-manager.ts';
import { eq } from 'drizzle-orm';
import { historySessions, sessionPreviewRevisions, withDatabase, readStoredHistory, readStoredPreview } from '../packages/coding-agent/src/core/session-storage.ts';
import { getDiscussionTitle } from '../packages/coding-agent/src/core/discussion-title.ts';
import path from 'node:path';
import { readBranchLabels } from './branch-labels.ts';
import { prepareHistory } from './history-preview.ts';
import { cachedPreviews } from './preview-cache.ts';
import { withTreePreviews } from './tree-preview-cache.ts';

type HistoryCard = ReturnType<typeof prepareHistory> & {
  id: string; path: string; modified: number;
  latest?: { text: string; user: boolean; href: string; title?: string };
};

type PreviewSession = Pick<SessionInfo, 'path' | 'urlId' | 'cwd' | 'parentSessionPath' | 'created' | 'modified'> & { revision?: number };

/** Read saved histories without creating agents or resolving image attachments. */
export function historyCards(managed: string) {
  return cachedPreviews(managed, () => buildHistoryCards(managed));
}

async function buildHistoryCards(managed: string) {
  const labels = readBranchLabels(managed);
  const roots = [path.resolve(managed)];
  const sessions: PreviewSession[] = process.env.SPICY_HISTORY_DB
    ? (withDatabase(managed, false, db => db.select({ session: historySessions, revision: sessionPreviewRevisions.revision })
      .from(historySessions).leftJoin(sessionPreviewRevisions, eq(sessionPreviewRevisions.sessionPath, historySessions.path)).all()) ?? [])
      .filter(({ session }) => roots.some(root => session.directory === root || session.directory.startsWith(root + path.sep)))
      .map(({ session, revision }) => ({ path: session.path, urlId: session.urlId ?? undefined, cwd: session.cwd,
        parentSessionPath: session.parentSession ?? undefined, created: new Date(session.timestamp),
        modified: new Date(session.updatedAt), revision: revision ?? 0 }))
    : await SessionManager.listAll(managed);
  const byPath = new Map(sessions.map(session => [path.resolve(session.path), session]));
  function ancestry(session: PreviewSession) {
    const chain = [session];
    const seen = new Set([path.resolve(session.path)]);
    while (session.parentSessionPath) {
      const parent = byPath.get(path.resolve(session.parentSessionPath));
      if (!parent || seen.has(path.resolve(parent.path))) break;
      chain.push(parent);
      seen.add(path.resolve(parent.path));
      session = parent;
    }
    return chain;
  }
  const groups = new Map<string, PreviewSession[]>();
  for (const session of sessions) {
    const root = ancestry(session).at(-1)!;
    const key = path.resolve(root.path);
    const group = groups.get(key) ?? [];
    group.push(session);
    groups.set(key, group);
  }
  return withTreePreviews<HistoryCard>(managed, cached => [...groups.values()].map(group => {
    group.sort((a, b) => ancestry(a).length - ancestry(b).length || a.created.getTime() - b.created.getTime() || a.path.localeCompare(b.path));
    const signature = JSON.stringify([1, ...group.map(session => [session.path, session.revision,
      session.urlId, session.cwd, session.parentSessionPath, session.created.getTime()])]);
    return cached(`tree:1:${path.resolve(managed)}:${group[0].path}`, signature, () => {
      const activity = new Map<string, number>();
      const members = group.map(session => {
        const records = readStoredHistory(session.path, false);
        if (!records) throw new Error(`History has not been imported: ${session.path}`);
        const entries = records.filter((entry): entry is SessionEntry => entry.type !== 'session');
        return { entries, leafId: entries.at(-1)?.id ?? null,
          state: { sessionUrlId: session.urlId, sessionFile: session.path } };
      });
      const latest = group.flatMap((session, index) => {
        const preview = readStoredPreview(session.path);
        activity.set(session.path, preview?.activity ?? session.created.getTime());
        if (!preview) return [];
        const member = members[index];
        const byId = new Map(member.entries.map(entry => [entry.id, entry]));
        const branch: SessionEntry[] = [];
        const seen = new Set<string>();
        let id = member.leafId;
        while (id && !seen.has(id)) {
          const entry = byId.get(id);
          if (!entry) break;
          seen.add(id); branch.push(entry); id = entry.parentId;
        }
        // A later branch can exclude the latest visible message.
        if (!seen.has(preview.id)) {
          branch.length = 0; seen.clear(); id = preview.id;
          while (id && !seen.has(id)) {
            const entry = byId.get(id);
            if (!entry) break;
            seen.add(id); branch.push(entry); id = entry.parentId;
          }
        }
        return [{ ...preview, text: preview.text.replace(/\s+/g, ' '), href: `/b/${session.urlId}`,
          title: getDiscussionTitle(branch.reverse()) }];
      }).sort((a, b) => b.activity - a.activity)[0];
      return { id: group[0].urlId || Buffer.from(group[0].path).toString('base64url'),
        path: group[0].cwd.replace(/^\/home\/[^/]+(?=\/|$)|^\/Users\/[^/]+(?=\/|$)/, '~'), modified: Math.max(...group.map(session => activity.get(session.path)!)), ...prepareHistory(members, labels), latest };
    });
  })).sort((a, b) => b.modified - a.modified);
}
