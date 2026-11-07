import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { RouterClient } from '@orpc/server';
import type { createRouter } from '../../backend/router.mjs';

export const api: RouterClient<ReturnType<typeof createRouter>, { token?: string }> = createORPCClient(new RPCLink({
  url: () => new URL('/rpc', window.location.origin).href,
  headers: ({ context }: { context: { token?: string } }) => context.token ? { 'X-Spicy-Token': context.token } : {},
}));

export const mutations = {
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
