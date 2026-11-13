import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { RpcSessionState } from '../packages/coding-agent/src/modes/rpc/rpc-types.ts';

/** Records crossing the JSON RPC boundary can include extension-defined fields. */
export type RpcRecord = Record<string, any>;
export type HistoryEntry = SessionEntry & { message?: RpcRecord };
export interface History { entries: HistoryEntry[]; leafId: string | null }
export type SessionState = Partial<Omit<RpcSessionState, 'model' | 'thinkingLevel'>> & { model?: { provider: string; id: string } | null; thinkingLevel?: string; cwd?: string; sessionFile?: string; contextUsage?: unknown };
export interface SelectedSession { file: string; cwd: string; id?: string }
export interface AgentSource { agentId: string | null; sessionId: string | null; entryId: string | null }
export interface AgentClient { send(type: string, data: unknown): void }
export interface RegistryOptions {
  cwd: string; managed: string; cli: string; resolver: string; extension: string;
  fixture?: string; extraExtension?: string;
}
