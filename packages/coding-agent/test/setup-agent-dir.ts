import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

// Run before test modules load. A temporary cwd does not isolate persisted
// sessions: their default location is inside SPICY_CODING_AGENT_DIR.
// Assign directly so vi.unstubAllEnvs() restores this safe test baseline,
// rather than the developer's agent directory. Child processes inherit it too.
const agentDir = mkdtempSync(join(tmpdir(), "spicy-test-agent-"));
process.env.SPICY_CODING_AGENT_DIR = agentDir;
// Validation can inherit the live server's database through its tool process.
// Let each test's directory select its store, never the inherited live database.
delete process.env.SPICY_HISTORY_DB;

afterAll(() => {
	rmSync(agentDir, { recursive: true, force: true });
});
