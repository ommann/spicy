import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureTool, type ToolStatus } from "../src/utils/tools-manager.ts";

vi.mock("fs", async (importOriginal) => ({
	...(await importOriginal<typeof import("fs")>()),
	existsSync: vi.fn(() => false),
}));
vi.mock("child_process", () => ({
	spawnSync: vi.fn(() => ({ error: new Error("not found") })),
}));

afterEach(() => vi.clearAllMocks());

describe("ensureTool", () => {
	it("reports missing tools without fetching or writing to the console", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch");
		const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
		const statuses: ToolStatus[] = [];
		try {
			expect(await ensureTool("fd", (status) => statuses.push(status))).toBeUndefined();
			expect(statuses).toEqual([
				{ type: "warning", message: "fd not found. Install it locally and add it to PATH." },
			]);
			expect(fetchMock).not.toHaveBeenCalled();
			expect(consoleLog).not.toHaveBeenCalled();
		} finally {
			fetchMock.mockRestore();
			consoleLog.mockRestore();
		}
	});

	it("uses an existing local binary", async () => {
		vi.mocked(existsSync).mockReturnValueOnce(true);
		expect(await ensureTool("rg")).toMatch(/\/bin\/rg$/);
		expect(spawnSync).not.toHaveBeenCalled();
	});
});
