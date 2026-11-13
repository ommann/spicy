import { Type } from '@earendil-works/pi-ai';
import { getDiscussionTitle } from '../packages/coding-agent/src/core/discussion-title.ts';
import { observeProviderConnection } from './provider-connection.ts';

// RPC exposes fork (a new file), but not same-session /tree navigation.
// This private command uses Pi's existing tree navigation implementation.
export default function treeNavigation(pi) {
  pi.registerTool({
    name: 'set_title', label: 'Set title',
    description: 'Set the discussion title for the current branch.',
    parameters: Type.Object({ title: Type.String({ minLength: 1 }) }),
    async execute(_id, { title }) {
      title = title.trim();
      if (!title) throw new Error('Title must not be empty');
      return { content: [{ type: 'text', text: title }], details: { title } };
    },
  });
  pi.registerTool({
    name: 'get_title', label: 'Get title',
    description: 'Read the current branch’s discussion title.',
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _update, ctx) {
      const title = getDiscussionTitle(ctx.sessionManager.getBranch());
      return { content: [{ type: 'text', text: title ?? 'No title set' }], details: { title: title ?? null } };
    },
  });
  const connection = observeProviderConnection(state => {
    process.stdout.write(JSON.stringify({ type: 'provider_connection', state }) + '\n');
  });
  pi.on('session_start', (_event, ctx) => connection.setModel(ctx.model));
  pi.on('model_select', event => connection.setModel(event.model));
  pi.on('after_provider_response', event => connection.response(event.status));
  pi.on('session_shutdown', () => connection.close());

  pi.registerCommand('spicy-reload', {
    description: 'Reload Pi resources from the web UI',
    handler: async (_args, ctx) => {
      await ctx.reload();
    },
  });
  pi.registerCommand('spicy-tree', {
    handler: async (args, ctx) => {
      const result = await ctx.navigateTree(args.trim(), { summarize: false });
      if (result.cancelled) throw new Error('Tree navigation cancelled');
    },
  });
}
