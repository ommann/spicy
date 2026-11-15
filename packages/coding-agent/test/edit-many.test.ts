import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "../src/core/extensions/types.ts";
import { createEditManyTool } from "../src/core/tools/edit-many.ts";
import { builtInExtensions } from "../src/extensions/index.ts";

function setup() {
	const files = new Map([
		["/tmp/a.ts", "const a = 1;\n"],
		["/tmp/b.ts", "const b = 2;\n"],
	]);
	const tool = createEditManyTool("/tmp", {
		operations: {
			access: async (path) => {
				if (!files.has(path)) throw new Error("missing file");
			},
			readFile: async (path) => Buffer.from(files.get(path)!),
			writeFile: async (path, content) => {
				files.set(path, content);
			},
		},
	});
	return { files, tool };
}

describe("edit many", () => {
	it("registers edit_many as an active supplementary tool", async () => {
		const extension = builtInExtensions.find((entry) => typeof entry !== "function" && entry.name === "edit-many");
		if (!extension || typeof extension === "function") throw new Error("Missing edit-many extension");
		const registerTool = vi.fn();
		await extension.factory({ registerTool } as unknown as ExtensionAPI);
		expect(registerTool).toHaveBeenCalledOnce();
		expect(registerTool.mock.calls[0][0].name).toBe("edit_many");
		expect(registerTool.mock.calls[0][0].defaultActive).not.toBe(false);
	});
	it("edits files with normal edit patches and independent failures", async () => {
		const { files, tool } = setup();
		const result = await tool.execute("test", {
			files: [
				{ path: "a.ts", edits: [{ oldText: "1", newText: "3" }] },
				{ path: "missing", edits: [{ oldText: "1", newText: "3" }] },
				{ path: "b.ts", edits: [{ oldText: "2", newText: "4" }] },
			],
		});
		expect(files.get("/tmp/a.ts")).toBe("const a = 3;\n");
		expect(files.get("/tmp/b.ts")).toBe("const b = 4;\n");
		expect(result.details.files[0].details.patch).toContain("+const a = 3;");
		expect(result.details.files[1].isError).toBe(true);
		expect(result.details.files[2].details.patch).toContain("+const b = 4;");
	});
	it("keeps a file unchanged when one of its replacements fails", async () => {
		const { files, tool } = setup();
		const result = await tool.execute("test", {
			files: [
				{
					path: "a.ts",
					edits: [
						{ oldText: "1", newText: "3" },
						{ oldText: "not present", newText: "other" },
					],
				},
			],
		});
		expect(result.details.files[0].isError).toBe(true);
		expect(files.get("/tmp/a.ts")).toBe("const a = 1;\n");
	});
	it("honors cancellation before edits", async () => {
		const { files, tool } = setup();
		await expect(
			tool.execute(
				"test",
				{ files: [{ path: "a.ts", edits: [{ oldText: "1", newText: "3" }] }] },
				AbortSignal.abort(),
			),
		).rejects.toThrow("aborted");
		expect(files.get("/tmp/a.ts")).toBe("const a = 1;\n");
	});
	it("supports a replacement name", () => {
		expect(createEditManyTool("/tmp", { name: "edit" }).name).toBe("edit");
	});
});
