import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	expandPath,
	pathExists,
	resolveReadPath,
	resolveReadPathAsync,
	resolveToCwd,
} from "../src/core/tools/path-utils.ts";

describe("path-utils", () => {
	it("expands home paths without expanding tilde-prefixed filenames", () => {
		expect(expandPath("~")).toBe(homedir());
		expect(expandPath("~/Documents/file.txt")).toBe(join(homedir(), "Documents/file.txt"));
		expect(expandPath("~draft.md")).toBe("~draft.md");
		expect(expandPath("@~draft.md")).toBe("~draft.md");
	});

	it("normalizes pasted Unicode spaces", () => {
		expect(expandPath("file\u00a0name.txt")).toBe("file name.txt");
	});

	it("resolves absolute and relative paths", () => {
		const cwd = join(tmpdir(), "path-utils-cwd");
		const absolute = resolve(tmpdir(), "file.txt");
		expect(resolveToCwd(absolute, cwd)).toBe(absolute);
		expect(resolveToCwd("relative/file.txt", cwd)).toBe(resolve(cwd, "relative/file.txt"));
		expect(resolveToCwd("~draft.md", cwd)).toBe(join(cwd, "~draft.md"));
		expect(resolveToCwd("@~draft.md", cwd)).toBe(join(cwd, "~draft.md"));
	});

	describe("read paths", () => {
		let directory: string;
		beforeEach(() => {
			directory = mkdtempSync(join(tmpdir(), "path-utils-test-"));
		});
		afterEach(() => {
			rmSync(directory, { recursive: true, force: true });
		});

		it("resolves existing and missing files consistently in both APIs", async () => {
			writeFileSync(join(directory, "existing.txt"), "content");
			for (const name of ["existing.txt", "missing.txt"]) {
				expect(resolveReadPath(name, directory)).toBe(join(directory, name));
				expect(await resolveReadPathAsync(name, directory)).toBe(join(directory, name));
			}
			expect(await pathExists(join(directory, "existing.txt"))).toBe(true);
			expect(await pathExists(join(directory, "missing.txt"))).toBe(false);
		});

		it("does not substitute different Unicode filenames", async () => {
			writeFileSync(join(directory, "file\u0065\u0301.txt"), "content");
			writeFileSync(join(directory, "Capture d\u2019cran.txt"), "content");
			for (const name of ["file\u00e9.txt", "Capture d'cran.txt"]) {
				expect(resolveReadPath(name, directory)).toBe(join(directory, name));
				expect(await resolveReadPathAsync(name, directory)).toBe(join(directory, name));
				expect(await pathExists(join(directory, name))).toBe(false);
			}
		});
	});
});
