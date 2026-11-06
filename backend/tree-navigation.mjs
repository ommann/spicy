import { observeProviderConnection } from './provider-connection.mjs';

// RPC exposes fork (a new file), but not same-session /tree navigation.
// This private command uses Pi's existing tree navigation implementation.
export default function treeNavigation(pi) {
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
  pi.registerCommand('lilim-tree', {
    handler: async (args, ctx) => {
      const result = await ctx.navigateTree(args.trim(), { summarize: false });
      if (result.cancelled) throw new Error('Tree navigation cancelled');
    },
  });
}
