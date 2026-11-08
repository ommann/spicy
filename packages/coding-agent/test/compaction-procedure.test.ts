import { getModel } from "@earendil-works/pi-ai/compat";
import { describe, expect, it, vi } from "vitest";
import {
	type CompactionPreparation,
	type CompactionProcedure,
	createFileOps,
	fullBranchCompactionProcedure,
	runCompaction,
} from "../src/core/compaction/index.ts";

function preparation(): CompactionPreparation {
	return {
		firstKeptEntryId: "kept-entry",
		messagesToSummarize: [],
		turnPrefixMessages: [],
		isSplitTurn: false,
		tokensBefore: 100,
		fileOps: createFileOps(),
		settings: { enabled: true, reserveTokens: 10, keepRecentTokens: 20 },
	};
}

const options = { model: getModel("anthropic", "claude-sonnet-4-5") };

function method() {
	return {
		id: "test-summary-v1",
		generate: vi.fn(async () => ({ text: "Model answer" })),
		finish: vi.fn(async (draft: { text: string }) => ({
			summary: `Finished: ${draft.text}`,
			details: { format: "test" },
		})),
	} satisfies CompactionProcedure<{ format: string }>;
}

describe("compaction methods", () => {
	it("runs model generation before finishing and records the method ID", async () => {
		const input = preparation();
		const procedure = method();
		const result = await runCompaction(input, options, procedure);
		expect(procedure.generate).toHaveBeenCalledWith(input, options);
		expect(procedure.finish).toHaveBeenCalledWith({ text: "Model answer" }, input);
		expect(result).toEqual({
			procedureId: "test-summary-v1",
			summary: "Finished: Model answer",
			firstKeptEntryId: "kept-entry",
			tokensBefore: 100,
			usage: undefined,
			details: { format: "test" },
		});
	});

	it("keeps file-list additions in the built-in method, not in the shared runner", async () => {
		const input = preparation();
		input.fileOps.read.add("b.ts");
		input.fileOps.read.add("a.ts");
		input.fileOps.edited.add("a.ts");
		const draft = { text: "Summary" };
		const finished = await fullBranchCompactionProcedure.finish(draft, input);
		expect(finished).toEqual({
			summary: "Summary\n\n<read-files>\nb.ts\n</read-files>\n\n<modified-files>\na.ts\n</modified-files>",
			details: { readFiles: ["b.ts"], modifiedFiles: ["a.ts"] },
		});
		expect(draft.text).toBe("Summary");

		const other = await runCompaction(input, options, method());
		expect(other.summary).toBe("Finished: Model answer");
		expect(other.details).toEqual({ format: "test" });
	});

	it("keeps model usage separate from the finished text", async () => {
		const usage = {
			input: 1,
			output: 2,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 3,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		};
		const result = await runCompaction(preparation(), options, {
			...method(),
			generate: async () => ({ text: "Answer", usage }),
		});
		expect(result.usage).toBe(usage);
	});

	it("rejects invalid input before calling the model", async () => {
		const procedure = method();
		await expect(runCompaction({ ...preparation(), firstKeptEntryId: "" }, options, procedure)).rejects.toThrow(
			"First kept entry",
		);
		expect(procedure.generate).not.toHaveBeenCalled();
	});

	it("does not finish after model generation fails", async () => {
		const procedure = method();
		procedure.generate.mockRejectedValue(new Error("Model failed"));
		await expect(runCompaction(preparation(), options, procedure)).rejects.toThrow("Model failed");
		expect(procedure.finish).not.toHaveBeenCalled();
	});

	it("does not return an unfinished result when finishing fails", async () => {
		const procedure = method();
		procedure.finish.mockRejectedValue(new Error("Finish failed"));
		await expect(runCompaction(preparation(), options, procedure)).rejects.toThrow("Finish failed");
	});

	it("honors cancellation before generation and before finishing", async () => {
		const controller = new AbortController();
		const procedure = method();
		controller.abort();
		await expect(
			runCompaction(preparation(), { ...options, signal: controller.signal }, procedure),
		).rejects.toThrow();
		expect(procedure.generate).not.toHaveBeenCalled();

		const during = new AbortController();
		procedure.generate.mockImplementation(async () => {
			during.abort();
			return { text: "Cancelled answer" };
		});
		await expect(runCompaction(preparation(), { ...options, signal: during.signal }, procedure)).rejects.toThrow();
		expect(procedure.finish).not.toHaveBeenCalled();
	});
});
