import Database from 'better-sqlite3';
import { asc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { getAgentDir, getSessionsDir } from '../config.ts';
import type { FileEntry, SessionHeader, SessionInfo } from './session-manager.ts';
import { hydrateSessionEntry, serializeSessionEntry } from './session-attachments.ts';

export const historySessions = sqliteTable('history_sessions', {
  path: text('path').primaryKey(),
  directory: text('directory').notNull(),
  id: text('id').notNull(),
  urlId: text('url_id'),
  cwd: text('cwd').notNull(),
  parentSession: text('parent_session'),
  timestamp: text('timestamp').notNull(),
  updatedAt: integer('updated_at').notNull(),
  header: text('header').notNull(),
}, table => [index('history_sessions_directory').on(table.directory), index('history_sessions_url').on(table.urlId)]);

export const historyEntries = sqliteTable('history_entries', {
  sessionPath: text('session_path').notNull().references(() => historySessions.path, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(),
  id: text('id').notNull(),
  parentId: text('parent_id'),
  type: text('type').notNull(),
  timestamp: text('timestamp').notNull(),
  payload: text('payload').notNull(),
}, table => [primaryKey({ columns: [table.sessionPath, table.id] }),
  uniqueIndex('history_entries_order').on(table.sessionPath, table.sequence),
  index('history_entries_parent').on(table.sessionPath, table.parentId)]);

/** A configured store contains all its chats, never a database per chat. */
export function historyDatabasePath(directory: string): string {
  if (process.env.SPICY_HISTORY_DB) return resolve(process.env.SPICY_HISTORY_DB);
  const normalized = resolve(directory);
  const sessions = resolve(getSessionsDir());
  return normalized === sessions || normalized.startsWith(sessions + sep)
    ? join(getAgentDir(), 'history.sqlite') : join(normalized, 'history.sqlite');
}

export function withDatabase<T>(directory: string, write: boolean, run: (db: ReturnType<typeof drizzle>) => T): T | undefined {
  const file = historyDatabasePath(directory);
  if (!write && !existsSync(file)) return undefined;
  if (write) mkdirSync(dirname(file), { recursive: true });
  const connection = new Database(file, { readonly: !write, fileMustExist: !write });
  if (write) chmodSync(file, 0o600);
  try {
    connection.pragma('busy_timeout = 10000');
    connection.pragma('foreign_keys = ON');
    const db = drizzle(connection);
    const version = connection.pragma('user_version', { simple: true });
    if (version !== 0 && version !== 1) throw new Error(`Unsupported history schema: ${version}`);
    if (write) {
      connection.pragma('journal_mode = WAL');
      connection.pragma('synchronous = FULL');
      connection.exec(`CREATE TABLE IF NOT EXISTS usage_samples (
        account TEXT NOT NULL, observed_at INTEGER NOT NULL, window TEXT NOT NULL,
        used_percent REAL NOT NULL, reset_at INTEGER NOT NULL,
        PRIMARY KEY(account, window, observed_at)
      )`);
      if (version === 0) db.transaction(tx => {
        tx.run(sql`CREATE TABLE IF NOT EXISTS history_sessions (path TEXT PRIMARY KEY NOT NULL, directory TEXT NOT NULL, id TEXT NOT NULL, url_id TEXT, cwd TEXT NOT NULL, parent_session TEXT, timestamp TEXT NOT NULL, updated_at INTEGER NOT NULL, header TEXT NOT NULL)`);
        tx.run(sql`CREATE INDEX IF NOT EXISTS history_sessions_directory ON history_sessions(directory)`);
        tx.run(sql`CREATE INDEX IF NOT EXISTS history_sessions_url ON history_sessions(url_id)`);
        tx.run(sql`CREATE TABLE IF NOT EXISTS history_entries (session_path TEXT NOT NULL REFERENCES history_sessions(path) ON DELETE CASCADE, sequence INTEGER NOT NULL, id TEXT NOT NULL, parent_id TEXT, type TEXT NOT NULL, timestamp TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(session_path, id))`);
        tx.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS history_entries_order ON history_entries(session_path, sequence)`);
        tx.run(sql`CREATE INDEX IF NOT EXISTS history_entries_parent ON history_entries(session_path, parent_id)`);
        // General read model: query every chat without constructing agent sessions.
        tx.run(sql`CREATE VIEW IF NOT EXISTS history_messages AS
          SELECT session_path, id, parent_id, sequence, timestamp,
            json_extract(payload, '$.message.role') AS role,
            COALESCE(json_extract(payload, '$.message.timestamp'), CAST(unixepoch(timestamp, 'subsec') * 1000 AS INTEGER)) AS activity_at,
            CASE WHEN json_type(payload, '$.message.content') = 'text' THEN json_extract(payload, '$.message.content')
              ELSE (SELECT group_concat(json_extract(value, '$.text'), char(10)) FROM json_each(json_extract(payload, '$.message.content')) WHERE json_extract(value, '$.type') = 'text') END AS text
          FROM history_entries WHERE type = 'message'`);
        tx.run(sql`CREATE VIEW IF NOT EXISTS history_previews AS
          SELECT s.*, m.id AS latest_entry_id, m.role AS latest_role, m.text AS latest_text,
            COALESCE(m.activity_at, CAST(unixepoch(s.timestamp, 'subsec') * 1000 AS INTEGER)) AS activity_at
          FROM history_sessions s LEFT JOIN history_messages m ON m.session_path = s.path AND m.id = (
            SELECT id FROM history_messages WHERE session_path = s.path AND role IN ('user', 'assistant') AND trim(COALESCE(text, '')) != ''
            ORDER BY activity_at DESC, sequence DESC LIMIT 1)`);
        tx.run(sql`CREATE VIEW IF NOT EXISTS history_catalog AS
          SELECT p.*,
            (SELECT count(*) FROM history_entries WHERE session_path = p.path AND type = 'message') AS message_count,
            (SELECT text FROM history_messages WHERE session_path = p.path AND role = 'user' AND COALESCE(text, '') != '' ORDER BY sequence LIMIT 1) AS first_message,
            (SELECT group_concat(text, ' ') FROM (SELECT text FROM history_messages WHERE session_path = p.path AND role IN ('user', 'assistant') AND COALESCE(text, '') != '' ORDER BY sequence)) AS messages_text,
            (SELECT NULLIF(trim(json_extract(payload, '$.name')), '') FROM history_entries WHERE session_path = p.path AND type = 'session_info' ORDER BY sequence DESC LIMIT 1) AS name,
            (SELECT MAX(activity_at) FROM history_messages WHERE session_path = p.path AND role IN ('user', 'assistant')) AS last_activity
          FROM history_previews p`);
        tx.run(sql`PRAGMA user_version = 1`);
      }, { behavior: 'immediate' });
    }
    if (version === 0 && !write) throw new Error(`Uninitialized history database: ${file}`);
    return run(db);
  } finally { connection.close(); }
}

export function readStoredHistory(sessionPath: string, hydrate = true): FileEntry[] | undefined {
  const key = resolve(sessionPath);
  return withDatabase(dirname(key), false, db => {
    const session = db.select().from(historySessions).where(eq(historySessions.path, key)).get();
    if (!session) return undefined;
    const entries = db.select({ payload: historyEntries.payload }).from(historyEntries)
      .where(eq(historyEntries.sessionPath, key)).orderBy(asc(historyEntries.sequence)).all();
    const records = [JSON.parse(session.header) as FileEntry, ...entries.map(entry => JSON.parse(entry.payload) as FileEntry)];
    return hydrate ? records.map(entry => hydrateSessionEntry(entry, key)) : records;
  });
}

export function readStoredHeader(sessionPath: string): SessionHeader | undefined {
  const key = resolve(sessionPath);
  return withDatabase(dirname(key), false, db => {
    const row = db.select({ header: historySessions.header }).from(historySessions).where(eq(historySessions.path, key)).get();
    return row ? JSON.parse(row.header) as SessionHeader : undefined;
  });
}

export function listStoredHistories(directory: string, all = false): { path: string; updatedAt: number }[] {
  return withDatabase(directory, false, db => {
    const query = db.select({ path: historySessions.path, updatedAt: historySessions.updatedAt }).from(historySessions);
    const root = resolve(directory);
    return query.where(all
      ? sql`${historySessions.directory} = ${root} OR substr(${historySessions.directory}, 1, ${root.length + 1}) = ${root + sep}`
      : eq(historySessions.directory, root)).all();
  }) ?? [];
}

export function writeStoredHistory(sessionPath: string, entries: FileEntry[], exclusive = false): void {
  const key = resolve(sessionPath);
  withDatabase(dirname(key), true, db => db.transaction(tx => {
    const existing = tx.select().from(historySessions).where(eq(historySessions.path, key)).get();
    if (exclusive && existing) throw new Error(`History already exists: ${key}`);
    const header = entries[0];
    if (!header || header.type !== 'session') throw new Error('History must start with a session header');
    tx.delete(historyEntries).where(eq(historyEntries.sessionPath, key)).run();
    tx.insert(historySessions).values({ path: key, directory: dirname(key), id: header.id, urlId: header.urlId,
      cwd: header.cwd ?? '', parentSession: header.parentSession, timestamp: header.timestamp,
      updatedAt: Date.now(), header: JSON.stringify(header) }).onConflictDoUpdate({ target: historySessions.path,
        set: { id: header.id, urlId: header.urlId, cwd: header.cwd ?? '', parentSession: header.parentSession ?? null,
          timestamp: header.timestamp, updatedAt: Date.now(), header: JSON.stringify(header) } }).run();
    let sequence = 0;
    for (const entry of entries) {
      if (entry.type === 'session') continue;
      tx.insert(historyEntries).values({ sessionPath: key, sequence: sequence++, id: entry.id, parentId: entry.parentId,
        type: entry.type, timestamp: entry.timestamp, payload: serializeSessionEntry(entry, key) }).run();
    }
  }, { behavior: 'immediate' }));
}

export function readStoredPreview(sessionPath: string): { id: string; text: string; user: boolean; activity: number } | undefined {
  const key = resolve(sessionPath);
  return withDatabase(dirname(key), false, db => {
    const row = db.get<{ latest_entry_id: string | null; latest_text: string | null; latest_role: string | null; activity_at: number }>(
      sql`SELECT latest_entry_id, latest_text, latest_role, activity_at FROM history_previews WHERE path = ${key}`);
    return row?.latest_entry_id && row.latest_text ? { id: row.latest_entry_id, text: row.latest_text, user: row.latest_role === 'user', activity: row.activity_at } : undefined;
  });
}

export function readStoredSessionInfo(sessionPath: string): SessionInfo | undefined {
  const key = resolve(sessionPath);
  return withDatabase(dirname(key), false, db => {
    const row = db.get<{ path: string; id: string; url_id: string | null; cwd: string; parent_session: string | null;
      timestamp: string; updated_at: number; name: string | null; message_count: number; first_message: string | null;
      messages_text: string | null; last_activity: number | null }>(sql`SELECT * FROM history_catalog WHERE path = ${key}`);
    if (!row) return undefined;
    return { path: row.path, id: row.id, urlId: row.url_id ?? undefined, cwd: row.cwd,
      parentSessionPath: row.parent_session ?? undefined, name: row.name ?? undefined,
      created: new Date(row.timestamp), modified: new Date(row.last_activity && row.last_activity > 0 ? row.last_activity : Date.parse(row.timestamp) || row.updated_at),
      messageCount: row.message_count, firstMessage: row.first_message || '(no messages)', allMessagesText: row.messages_text || '' };
  });
}

export function appendStoredEntry(sessionPath: string, entry: Exclude<FileEntry, SessionHeader>): void {
  const key = resolve(sessionPath);
  withDatabase(dirname(key), true, db => db.transaction(tx => {
    const sequence = tx.select({ next: sql<number>`COALESCE(MAX(sequence), -1) + 1` }).from(historyEntries)
      .where(eq(historyEntries.sessionPath, key)).get()!.next;
    tx.insert(historyEntries).values({ sessionPath: key, sequence, id: entry.id, parentId: entry.parentId,
      type: entry.type, timestamp: entry.timestamp, payload: serializeSessionEntry(entry, key) }).run();
    tx.update(historySessions).set({ updatedAt: Date.now() }).where(eq(historySessions.path, key)).run();
  }, { behavior: 'immediate' }));
}
