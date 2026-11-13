import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { RouterClient } from '@orpc/server';
import type { createRouter } from '../../backend/router.ts';

export const api: RouterClient<ReturnType<typeof createRouter>, { token?: string }> = createORPCClient(new RPCLink({
  url: () => new URL('/rpc', window.location.origin).href,
  headers: ({ context }: { context: { token?: string } }) => context.token ? { 'X-Spicy-Token': context.token } : {},
}));

type ReplyPayload<T> = T extends unknown ? Omit<T, 'agentId' | 'id'> : never;
export type UiReply = ReplyPayload<Parameters<typeof api.ui>[0]>;
export type SavedPromptInput = Extract<Parameters<typeof api.command>[0], { type: 'save_system_prompt' }>['prompt'];
