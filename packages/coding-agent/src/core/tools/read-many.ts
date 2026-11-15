import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { createReadToolDefinition, type ReadToolOptions } from "./read.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const schema = Type.Object({
	files: Type.Array(
		Type.Object({
			path: Type.String({ description: "Relative or absolute file path" }),
			offset: Type.Optional(Type.Integer({ minimum: 1, description: "Starting line (1-indexed)" })),
			limit: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum lines to read" })),
		}),
		{ minItems: 1, maxItems: 32 },
	),
});

export interface ReadManyToolOptions extends ReadToolOptions {
	/** Use "read" to replace the built-in reader, or "read_many" to supplement it. */
	name?: "read" | "read_many";
	/** Combined text output budget, excluding path headings and notices. Default: 200 KiB. */
	maxTotalBytes?: number;
}

/** Register this definition as a custom tool; the name "read" overrides the built-in. */
export function createReadManyToolDefinition(
	cwd: string,
	options?: ReadManyToolOptions,
): ToolDefinition<typeof schema> {
	const reader = createReadToolDefinition(cwd, options);
	const name = options?.name ?? "read_many";
	const maxTotalBytes = options?.maxTotalBytes ?? 200 * 1024;
	if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1) {
		throw new Error("maxTotalBytes must be a positive safe integer");
	}
	return {
		name,
		label: name,
		description: `Read up to 32 files, with optional per-file offset/limit. Supports text and images like read. Each text file is limited to 2000 lines or 50 KiB. Combined text budget: ${maxTotalBytes} bytes. Files that do not fit are omitted with a retry notice. Errors are reported per file. Results are in input order.`,
		promptSnippet: "Read multiple files with optional per-file line ranges",
		promptGuidelines: [`Use ${name} to examine files instead of cat or sed.`],
		parameters: schema,
		constrainedSampling: { type: "json_schema", strict: "prefer" },
		async execute(callId, { files }, signal, _onUpdate, ctx) {
			const content: Awaited<ReturnType<typeof reader.execute>>["content"] = [];
			let remaining = maxTotalBytes;
			for (const [index, file] of files.entries()) {
				if (signal?.aborted) throw new Error("Operation aborted");
				content.push({ type: "text", text: `=== ${JSON.stringify(file.path)} ===` });
				if (remaining === 0) {
					content.push({
						type: "text",
						text: "[Combined text budget exhausted. Retry this file in a separate call.]",
					});
					continue;
				}
				try {
					const result = await reader.execute(`${callId}-${index}`, file, signal, undefined, ctx);
					const bytes = result.content.reduce(
						(sum, block) => sum + (block.type === "text" ? Buffer.byteLength(block.text, "utf8") : 0),
						0,
					);
					if (bytes > remaining) {
						content.push({
							type: "text",
							text: "[File omitted: exceeds remaining combined text budget. Retry separately or with a smaller limit.]",
						});
					} else {
						content.push(...result.content);
						remaining -= bytes;
					}
				} catch (error) {
					if (signal?.aborted) throw new Error("Operation aborted");
					content.push({ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` });
				}
			}
			return { content, details: undefined };
		},
	};
}

export function createReadManyTool(cwd: string, options?: ReadManyToolOptions): AgentTool<typeof schema> {
	return wrapToolDefinition(createReadManyToolDefinition(cwd, options));
}
