import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { SessionManager } from '../src/core/session-manager.ts';
import { listStoredHistories } from '../src/core/session-storage.ts';

const directory = mkdtempSync(join(tmpdir(), 'spicy-storage-scope-'));
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

it('scopes discovery to the requested directory even in a shared database', async () => {
  vi.stubEnv('SPICY_HISTORY_DB', join(directory, 'shared.sqlite'));
  const agentDir = join(directory, 'agent_%');
  vi.stubEnv('SPICY_CODING_AGENT_DIR', agentDir);
  const root = join(agentDir, 'sessions');
  const paths = [root, join(root, 'nested'), root + '-other'];
  const sessions = paths.map(path => {
    const session = SessionManager.create(directory, path);
    session.appendMessage({ role: 'user', content: 'Scope test', timestamp: Date.now() });
    return session;
  });
  expect(listStoredHistories(root).map(row => row.path)).toEqual([sessions[0].getSessionFile()]);
  expect(listStoredHistories(root, true).map(row => row.path).sort()).toEqual(
    sessions.slice(0, 2).map(session => session.getSessionFile()).sort(),
  );
  expect((await SessionManager.listAll()).map(session => session.path).sort()).toEqual(
    sessions.slice(0, 2).map(session => session.getSessionFile()).sort(),
  );
});
