import { SessionManager, type SessionInfo, type SessionEntry } from '../packages/coding-agent/src/core/session-manager.ts';
import { readStoredHistory, readStoredPreview } from '../packages/coding-agent/src/core/session-storage.ts';
import { getDiscussionTitle } from '../packages/coding-agent/src/core/discussion-title.ts';
import path from 'node:path';

/** Read saved histories without creating agents or resolving image attachments. */
export async function historyCards(managed: string) {
  const sessions = [...new Map([...await SessionManager.listAll(), ...await SessionManager.listAll(managed)]
    .map(session => [path.resolve(session.path), session])).values()];
  const byPath = new Map(sessions.map(session => [path.resolve(session.path), session]));
  function ancestry(session: SessionInfo) {
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
  const groups = new Map<string, SessionInfo[]>();
  for (const session of sessions) {
    const root = ancestry(session).at(-1)!;
    const key = path.resolve(root.path);
    const group = groups.get(key) ?? [];
    group.push(session);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    group.sort((a, b) => ancestry(a).length - ancestry(b).length || a.created.getTime() - b.created.getTime() || a.path.localeCompare(b.path));
    const members = group.map(session => {
      const records = readStoredHistory(session.path, false);
      if (!records) throw new Error(`History has not been imported: ${session.path}`);
      const entries = records.filter((entry): entry is SessionEntry => entry.type !== 'session');
      return { entries, leafId: entries.at(-1)?.id ?? null,
        state: { sessionUrlId: session.urlId, sessionFile: session.path } };
    });
    const latest = group.flatMap((session, index) => {
      const preview = readStoredPreview(session.path);
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
      path: group[0].cwd, modified: Math.max(...group.map(session => session.modified.getTime())), members, latest };
  }).sort((a, b) => b.modified - a.modified);
}
