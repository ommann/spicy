import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export const workspaceSourcePaths = {
	mcpIndex: fileURLToPath(new URL("./packages/mcp/src/index.ts", import.meta.url)),
	mcpOAuth: fileURLToPath(new URL("./packages/mcp/src/oauth/index.ts", import.meta.url)),
	mcpTesting: fileURLToPath(new URL("./packages/mcp/src/testing/index.ts", import.meta.url)),
	aiIndex: fileURLToPath(import.meta.resolve("@earendil-works/pi-ai")),
	aiOAuth: fileURLToPath(import.meta.resolve("@earendil-works/pi-ai/oauth")),
	agentIndex: fileURLToPath(new URL("./packages/agent/src/index.ts", import.meta.url)),
	codemodeIndex: fileURLToPath(new URL("./packages/codemode/src/index.ts", import.meta.url)),
	codemodeDeclarations: fileURLToPath(new URL("./packages/codemode/src/declarations.ts", import.meta.url)),
	codemodeSource: fileURLToPath(new URL("./packages/codemode/src/source.ts", import.meta.url)),
	codingAgentIndex: fileURLToPath(new URL("./packages/coding-agent/src/index.ts", import.meta.url)),
} as const;

export default defineConfig({
	resolve: {
		alias: [
			{ find: /^@earendil-works\/pi-mcp$/, replacement: workspaceSourcePaths.mcpIndex },
			{ find: /^@earendil-works\/pi-mcp\/oauth$/, replacement: workspaceSourcePaths.mcpOAuth },
			{ find: /^@earendil-works\/pi-mcp\/testing$/, replacement: workspaceSourcePaths.mcpTesting },
			{ find: /^@earendil-works\/pi-agent-core$/, replacement: workspaceSourcePaths.agentIndex },
			{ find: /^@earendil-works\/pi-codemode$/, replacement: workspaceSourcePaths.codemodeIndex },
			{ find: /^@earendil-works\/pi-codemode\/declarations$/, replacement: workspaceSourcePaths.codemodeDeclarations },
			{ find: /^@earendil-works\/pi-codemode\/source$/, replacement: workspaceSourcePaths.codemodeSource },
		],
	},
});
