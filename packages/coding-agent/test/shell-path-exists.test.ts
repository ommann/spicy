import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ existsSync: vi.fn(), spawnSync: vi.fn() }));
vi.mock("../src/config.ts", () => ({ getBinDir: () => "/tmp/spicy-bin" }));
vi.mock("node:fs", () => ({ existsSync: mocks.existsSync }));
vi.mock("child_process", () => ({ spawnSync: mocks.spawnSync }));

import { getShellConfig } from "../src/utils/shell.ts";

describe("Linux shell resolution", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("uses an existing custom shell", () => {
		mocks.existsSync.mockReturnValue(true);
		expect(getShellConfig("/custom/bash")).toEqual({ shell: "/custom/bash", args: ["-c"] });
	});

	it("rejects a missing custom shell", () => {
		mocks.existsSync.mockReturnValue(false);
		expect(() => getShellConfig("/missing/bash")).toThrow("Custom shell path not found");
	});

	it("prefers /bin/bash", () => {
		mocks.existsSync.mockReturnValue(true);
		expect(getShellConfig()).toEqual({ shell: "/bin/bash", args: ["-c"] });
		expect(mocks.spawnSync).not.toHaveBeenCalled();
	});

	it("finds bash on PATH", () => {
		mocks.existsSync.mockReturnValue(false);
		mocks.spawnSync.mockReturnValue({ status: 0, stdout: "/custom/bash\n" });
		expect(getShellConfig()).toEqual({ shell: "/custom/bash", args: ["-c"] });
	});

	it("falls back to sh", () => {
		mocks.existsSync.mockReturnValue(false);
		mocks.spawnSync.mockReturnValue({ status: 1, stdout: "" });
		expect(getShellConfig()).toEqual({ shell: "sh", args: ["-c"] });
	});
});
