import { afterEach, describe, expect, it, vi } from "vitest";
import { killProcessTree } from "../../../src/utils/shell.ts";

afterEach(() => vi.restoreAllMocks());

// Spicy is Linux-only; Windows taskkill coverage was replaced with POSIX cleanup coverage.
describe("process tree cleanup", () => {
	it("kills the process group without separately killing the child", () => {
		const kill = vi.spyOn(process, "kill").mockReturnValue(true);

		killProcessTree(1234);

		expect(kill.mock.calls).toEqual([[-1234, "SIGKILL"]]);
	});

	it("falls back to the child when killing the process group fails", () => {
		const kill = vi.spyOn(process, "kill").mockReturnValue(true).mockImplementationOnce(() => {
			throw Object.assign(new Error("No such process group"), { code: "ESRCH" });
		});

		killProcessTree(1234);

		expect(kill.mock.calls).toEqual([
			[-1234, "SIGKILL"],
			[1234, "SIGKILL"],
		]);
	});

	it("tolerates an already-exited process after trying the group and child", () => {
		const kill = vi.spyOn(process, "kill").mockImplementation(() => {
			throw Object.assign(new Error("No such process"), { code: "ESRCH" });
		});

		expect(() => killProcessTree(1234)).not.toThrow();
		expect(kill.mock.calls).toEqual([
			[-1234, "SIGKILL"],
			[1234, "SIGKILL"],
		]);
	});
});
