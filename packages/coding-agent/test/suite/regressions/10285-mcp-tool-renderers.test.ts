import { describe, expect, it } from "vitest";
import type { ToolRenderContext } from "../../../src/core/extensions/types.ts";
import { createMcpExtension } from "../../../src/extensions/mcp/index.ts";
import { initTheme, theme } from "../../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../../src/utils/ansi.ts";
import { createHarness } from "../harness.ts";

const mcpExtension = createMcpExtension({ loadConfig: () => ({ servers: [], errors: [] }) });

describe("MCP tool renderers", () => {
	// Regression #10285: a resumed session renders MCP tool calls before their server connected, if it
	// ever does. They render with the MCP renderers anyway, instead of the expanded fallback.
	it("renders calls to MCP tools that are not registered", async () => {
		initTheme("dark");
		const harness = await createHarness({ extensionFactories: [mcpExtension] });
		try {
			const resolve = (toolName: string) =>
				harness.session.extensionRunner.resolveToolRenderers(toolName, () =>
					harness.session.getToolDefinition(toolName),
				);

			const call = resolve("mcp__my_docs__search")?.renderCall?.({ query: "pi" }, theme, {
				expanded: false,
			} as unknown as ToolRenderContext);
			expect(stripAnsi(call?.render(100).join("\n") ?? "")).toContain('my_docs/search query="pi"');
			expect(resolve("not_mcp")).toBeUndefined();
			// Registered tools keep their own renderers.
			expect(resolve("read")?.renderCall).toBe(harness.session.getToolDefinition("read")?.renderCall);
		} finally {
			harness.cleanup();
		}
	});
});
