import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "../src/core/extensions/types.ts";
import { createReadManyTool } from "../src/core/tools/read-many.ts";
import { builtInExtensions } from "../src/extensions/index.ts";

function tool(options: { name?: "read" | "read_many"; maxTotalBytes?: number } = {}) {
	return createReadManyTool("/tmp", {
		...options,
		operations: {
			access: async (path) => {
				if (path.endsWith("missing")) throw new Error("missing file");
			},
			readFile: async () => Buffer.from("one\ntwo\nthree"),
		},
	});
}

const text = (result: Awaited<ReturnType<ReturnType<typeof tool>["execute"]>>) =>
	result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");

describe("read many", () => {
	it("registers read_many as an active built-in extension without replacing read", async () => {
		const extension = builtInExtensions.find((entry) => typeof entry !== "function" && entry.name === "read-many");
		if (!extension || typeof extension === "function") throw new Error("Missing read-many built-in extension");
		const registerTool = vi.fn();
		await extension.factory({ registerTool } as unknown as ExtensionAPI);
		expect(registerTool).toHaveBeenCalledOnce();
		expect(registerTool.mock.calls[0][0].name).toBe("read_many");
		expect(registerTool.mock.calls[0][0].defaultActive).not.toBe(false);
	});
	it("supports supplemental and replacement names", () => {
		expect(tool().name).toBe("read_many");
		expect(tool({ name: "read" }).name).toBe("read");
	});
	it("preserves order, ranges, and per-file errors", async () => {
		const result = text(
			await tool().execute("test", {
				files: [{ path: "first", offset: 2, limit: 1 }, { path: "missing" }, { path: "last" }],
			}),
		);
		expect(result).toContain('=== "first" ===\ntwo');
		expect(result).toContain("Error: missing file");
		expect(result).toContain('=== "last" ===\none\ntwo\nthree');
		expect(result.indexOf('"first"')).toBeLessThan(result.indexOf('"last"'));
	});
	it("omits results that exceed the combined budget", async () => {
		const result = text(await tool({ maxTotalBytes: 15 }).execute("test", { files: [{ path: "a" }, { path: "b" }] }));
		expect(result.match(/one\ntwo\nthree/g)).toHaveLength(1);
		expect(result).toContain("File omitted");
	});
	it("honors cancellation", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(tool().execute("test", { files: [{ path: "a" }] }, controller.signal)).rejects.toThrow("aborted");
	});
	it("validates budget options", () => {
		expect(() => tool({ maxTotalBytes: 0 })).toThrow("positive safe integer");
	});
});
