// RPC exposes fork (a new file), but not same-session /tree navigation.
// This private command uses Pi's existing tree navigation implementation.
export default function treeNavigation(pi) {
  pi.registerCommand('lilim-reload', {
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
