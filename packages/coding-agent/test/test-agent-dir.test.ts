import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getAgentDir } from "../src/config.ts";
import { SessionManager } from "../src/core/session-manager.ts";

describe("test agent directory isolation", () => {
	it("persists default sessions only inside the disposable agent directory", () => {
		const agentDir = getAgentDir();
		expect(relative(tmpdir(), agentDir)).toMatch(/^spicy-test-agent-/);
		const session = SessionManager.create(process.cwd());
		session.appendMessage({ role: "user", content: "test isolation", timestamp: Date.now() });
		const file = session.getSessionFile()!;
		expect(relative(join(agentDir, "sessions"), file).startsWith("..")).toBe(false);
		expect(existsSync(file)).toBe(true);
	});

	it("retains the isolated baseline after restoring environment stubs", () => {
		const agentDir = getAgentDir();
		vi.stubEnv("PI_CODING_AGENT_DIR", "/unused-test-override");
		vi.unstubAllEnvs();
		expect(getAgentDir()).toBe(agentDir);
	});

	it("passes isolation to child processes", () => {
		const inherited = execFileSync(
			process.execPath,
			["-e", "process.stdout.write(process.env.PI_CODING_AGENT_DIR)"],
			{
				encoding: "utf8",
			},
		);
		expect(inherited).toBe(getAgentDir());
	});
});
