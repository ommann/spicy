import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import { createFindToolDefinition, relativizeFindResultPath } from "../../../src/core/tools/find.ts";

/**
 * Regression test for https://github.com/earendil-works/pi/issues/6104
 *
 * path.resolve() preserves a trailing separator when resolving to POSIX /.
 * The find tool used to slice absolute results at searchPath.length + 1,
 * which dropped the first character of the first path segment for root searches.
 */
describe("issue #6104 find relativizes root search paths", () => {
	describe("POSIX root", () => {
		it("preserves the first segment for files under /", () => {
			expect(relativizeFindResultPath("/home/user/file.txt", "/", posix)).toBe("home/user/file.txt");
		});

		it("preserves the first segment and one trailing slash for directories under /", () => {
			expect(relativizeFindResultPath("/home/user/project/", "/", posix)).toBe("home/user/project/");
		});

		it("preserves backslashes in POSIX filenames", () => {
			expect(relativizeFindResultPath("/home/user/file\\", "/home/user", posix)).toBe("file\\");
		});
	});

	describe("absolute results outside the search path", () => {
		it("falls back to path.relative when the absolute paths do not share a prefix", () => {
			expect(relativizeFindResultPath("/tmp/results/file.txt", "/workspace/project", posix)).toBe(
				"../../tmp/results/file.txt",
			);
		});

		it("keeps a trailing slash on directories resolved through path.relative", () => {
			expect(relativizeFindResultPath("/tmp/results/dir/", "/workspace/project", posix)).toBe(
				"../../tmp/results/dir/",
			);
		});
	});

	describe("through the find tool", () => {
		it("relativizes custom glob results against a root search path", async () => {
			const def = createFindToolDefinition("/", {
				operations: {
					exists: () => true,
					glob: () => ["/home/user/project/", "/home/user/project/file.txt"],
				},
			});
			// The find tool implementation does not touch ctx; pass a minimal stub.
			const ctx = {} as Parameters<typeof def.execute>[4];
			const result = (await def.execute("call-1", { pattern: "**" }, undefined, undefined, ctx)) as {
				content: Array<{ type: string; text?: string }>;
			};
			expect(result.content[0]?.text).toBe("home/user/project/\nhome/user/project/file.txt");
		});
	});
});
