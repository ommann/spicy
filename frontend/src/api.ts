import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { RouterClient } from '@orpc/server';
import type { createRouter } from '../../backend/router.mjs';

export const api: RouterClient<ReturnType<typeof createRouter>, { token?: string }> = createORPCClient(new RPCLink({
  url: () => new URL('/rpc', window.location.origin).href,
  headers: ({ context }: { context: { token?: string } }) => context.token ? { 'X-Spicy-Token': context.token } : {},
}));

const procedures = {
  agents: api.agents.create,
  command: api.command,
  start: api.start,
  stop: api.stop,
  branch: api.branch,
  continue: api.continue,
  ui: api.ui,
  'auth/login': api.auth.login,
  'auth/reply': api.auth.reply,
  'auth/cancel': api.auth.cancel,
};
export type MutationInputs = { [K in keyof typeof procedures]: Exclude<Parameters<(typeof procedures)[K]>[0], undefined> };
type ReplyPayload<T> = T extends unknown ? Omit<T, 'agentId' | 'id'> : never;
export type UiReply = ReplyPayload<MutationInputs['ui']>;
export type SavedPromptInput = Extract<MutationInputs['command'], { type: 'save_system_prompt' }>['prompt'];
type MutationOutputs = { [K in keyof typeof procedures]: Awaited<ReturnType<(typeof procedures)[K]>> };
export const mutations: { [K in keyof MutationInputs]: (input: MutationInputs[K], options: { signal: AbortSignal; context: { token: string } }) => Promise<MutationOutputs[K]> } = procedures;
