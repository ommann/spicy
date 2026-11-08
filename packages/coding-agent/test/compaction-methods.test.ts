import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai/compat";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type CompactionMethod,
	type CompactionPreparation,
	compact,
	getCompactionProcedure,
	runCompaction,
} from "../src/core/compaction/index.ts";
import { convertToLlm } from "../src/core/messages.ts";
import { SessionManager } from "../src/core/session-manager.ts";

const { complete } = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("@earendil-works/pi-ai/compat", async (importOriginal) => ({
	...(await importOriginal<typeof import("@earendil-works/pi-ai/compat")>()),
	completeSimple: complete,
}));

const answer = "\nThe model's answer.\n ";
const model = getModel("anthropic", "claude-sonnet-4-5");
function preparation(): CompactionPreparation {
	return {
		firstKeptEntryId: "kept",
		messagesToSummarize: [{ role: "user", content: "Old chat", timestamp: 1 }],
		turnPrefixMessages: [],
		isSplitTurn: false,
		tokensBefore: 100,
		fileOps: { read: new Set(["read.ts"]), edited: new Set(["edited.ts"]), written: new Set() },
		settings: { enabled: true, reserveTokens: 10, keepRecentTokens: 20 },
	};
}
function run(method: CompactionMethod, input = preparation()) {
	const args: Parameters<typeof compact> = [input, model, "test-key"];
	args[12] = method;
	return compact(...args);
}

beforeEach(() => complete.mockReset().mockResolvedValue(fauxAssistantMessage(answer)));

describe("numbered compaction methods", () => {
	it("method 1 keeps the original file lists and summary wrapper", async () => {
		const result = await run(1);
		expect(result.procedureId).toBe("full-branch-summary-v1");
		expect(result.summary).toBe(
			`${answer}\n\n<read-files>\nread.ts\n</read-files>\n\n<modified-files>\nedited.ts\n</modified-files>`,
		);
		expect(result.details).toEqual({ readFiles: ["read.ts"], modifiedFiles: ["edited.ts"] });
		const session = SessionManager.inMemory();
		session.appendCompactionRoot(result.summary, 100, result.details, false, result.usage, result);
		expect(JSON.stringify(convertToLlm(session.buildSessionProjection().messages))).toContain("<summary>");
	});

	it("method 2 keeps the answer unchanged, including whitespace", async () => {
		const result = await run(2);
		expect(result).toMatchObject({ procedureId: "model-summary-v1", summary: answer, summaryFormat: "verbatim" });
		expect(result.details).toBeUndefined();
		expect(complete).toHaveBeenCalledTimes(1);
	});

	it("method 2 uses one model answer even when a turn is split", async () => {
		const input = preparation();
		input.isSplitTurn = true;
		input.previousSummary = "Previous summary";
		input.turnPrefixMessages = [{ role: "user", content: "Turn to summarize", timestamp: 2 }];
		const result = await run(2, input);
		expect(result.summary).toBe(answer);
		expect(complete).toHaveBeenCalledTimes(1);
		const request = JSON.stringify(complete.mock.calls[0][1]);
		expect(request).toContain("Old chat");
		expect(request).toContain("Turn to summarize");
		expect(request).toContain("Previous summary");
	});

	it("method 2 stays unchanged after saving and reopening the chat", async () => {
		const dir = mkdtempSync(join(tmpdir(), "spicy-model-only-"));
		try {
			const result = await run(2);
			const session = SessionManager.create(dir, dir);
			session.appendCompactionRoot(result.summary, 100, result.details, false, result.usage, result);
			session.appendMessage(fauxAssistantMessage("Flush"));
			const loaded = SessionManager.open(session.getSessionFile()!);
			const [summary] = convertToLlm(loaded.buildSessionProjection().messages);
			expect(summary).toMatchObject({ role: "user", content: [{ type: "text", text: answer }] });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects unknown methods without making a model call", async () => {
		expect(() => getCompactionProcedure(3 as CompactionMethod)).toThrow("Unknown compaction method");
		expect(complete).not.toHaveBeenCalled();
	});

	it("allows method 2 through the shared runner", async () => {
		const result = await runCompaction(preparation(), { model, apiKey: "test-key" }, getCompactionProcedure(2));
		expect(result.summary).toBe(answer);
	});
});
