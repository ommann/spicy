import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { createEditToolDefinition, type EditToolDetails, type EditToolOptions, editSchema } from "./edit.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const schema = Type.Object({ files: Type.Array(editSchema, { minItems: 1, maxItems: 32 }) });

export interface EditManyToolOptions extends EditToolOptions {
	name?: "edit" | "edit_many";
}

export interface EditManyToolDetails {
	files: {
		path: string;
		content: { type: "text"; text: string }[];
		details?: EditToolDetails;
		isError?: boolean;
	}[];
}

export function createEditManyToolDefinition(
	cwd: string,
	options?: EditManyToolOptions,
): ToolDefinition<typeof schema, EditManyToolDetails> {
	const editor = createEditToolDefinition(cwd, options);
	const name = options?.name ?? "edit_many";
	return {
		name,
		label: name,
		description: `${editor.description} Apply this behavior to each entry in files (up to 32). Files are edited sequentially in input order. Each file is independent: failures do not roll back successful files or prevent later edits. Cancellation stops remaining files; completed edits remain applied.`,
		promptSnippet: "Edit multiple files using exact text replacement",
		promptGuidelines: editor.promptGuidelines,
		parameters: schema,
		constrainedSampling: { type: "json_schema", strict: "prefer" },
		async execute(callId, { files }, signal, _onUpdate, ctx) {
			const results: EditManyToolDetails["files"] = [];
			for (const [index, file] of files.entries()) {
				if (signal?.aborted) throw new Error("Operation aborted; earlier file edits may already be applied");
				try {
					const result = await editor.execute(`${callId}-${index}`, file, signal, undefined, ctx);
					results.push({
						path: file.path,
						content: result.content.filter((block) => block.type === "text"),
						details: result.details,
					});
				} catch (error) {
					if (signal?.aborted) throw new Error("Operation aborted; earlier file edits may already be applied");
					results.push({
						path: file.path,
						content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
						isError: true,
					});
				}
			}
			return {
				content: results.map((result) => ({
					type: "text" as const,
					text: `=== ${JSON.stringify(result.path)} ===\n${result.isError ? "Error: " : ""}${result.content.map((block) => block.text).join("\n")}`,
				})),
				details: { files: results },
			};
		},
	};
}

export function createEditManyTool(cwd: string, options?: EditManyToolOptions): AgentTool<typeof schema> {
	return wrapToolDefinition(createEditManyToolDefinition(cwd, options));
}
