import type { InlineExtension } from "../core/extensions/types.ts";
import codemodeExtension from "./codemode/index.ts";
import editManyExtension from "./edit-many/index.ts";
import llamaExtension from "./llama/index.ts";
import mcpExtension from "./mcp/index.ts";
import readManyExtension from "./read-many/index.ts";
import toolSearchExtension from "./tool-search/index.ts";

export const builtInExtensions: InlineExtension[] = [
	{ name: "llama.cpp", factory: llamaExtension, builtin: true },
	{ name: "read-many", factory: readManyExtension, replaceable: true, builtin: true },
	{ name: "edit-many", factory: editManyExtension, replaceable: true, builtin: true },
	// Replaceable: an extension that registers `codemode`, `tool_search`, or `/mcp` (such as a third-party
	// MCP extension) takes over instead of running alongside the built-in one.
	{ name: "codemode", factory: codemodeExtension, replaceable: true, builtin: true },
	{ name: "tool-search", factory: toolSearchExtension, replaceable: true, builtin: true },
	{ name: "mcp", factory: mcpExtension, replaceable: true, builtin: true },
];
