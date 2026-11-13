import { SessionManager } from './session-manager.ts';
import { readStoredHeader } from './session-storage.ts';

/** Copy legacy histories into the configured store. Original JSONL files are untouched. */
export async function importLegacyHistories(directories: string[] = []): Promise<number> {
  const sessions = [...await SessionManager.listAll()];
  for (const directory of directories) sessions.push(...await SessionManager.listAll(directory));
  let imported = 0;
  for (const session of new Map(sessions.map(session => [session.path, session])).values()) {
    if (readStoredHeader(session.path)) continue;
    SessionManager.open(session.path, undefined, session.cwd);
    imported++;
  }
  return imported;
}
