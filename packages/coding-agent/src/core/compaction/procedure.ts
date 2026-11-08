import type { StreamFn, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { RetryCallbacks, RetryPolicy } from "@earendil-works/pi-ai";
import type { Model, Usage } from "@earendil-works/pi-ai/compat";
import type { CompactionPreparation, CompactionResult } from "./compaction.ts";

/** Options available to a compaction method's model calls. */
export interface CompactionModelOptions {
	model: Model<any>;
	apiKey?: string;
	headers?: Record<string, string>;
	customInstructions?: string;
	signal?: AbortSignal;
	thinkingLevel?: ThinkingLevel;
	streamFn?: StreamFn;
	env?: Record<string, string>;
	retry?: RetryPolicy;
	callbacks?: RetryCallbacks;
	sessionId?: string;
}

/** Model output, before file lists or other additions. */
export interface CompactionDraft {
	text: string;
	usage?: Usage;
}

export interface FinishedCompaction<T = unknown> {
	summaryFormat?: "verbatim";
	summary: string;
	details?: T;
}

/** A named method: get the model's answer, then finish the summary in code. */
export interface CompactionProcedure<T = unknown> {
	id: string;
	generate(preparation: CompactionPreparation, options: CompactionModelOptions): Promise<CompactionDraft>;
	finish(
		draft: CompactionDraft,
		preparation: CompactionPreparation,
	): FinishedCompaction<T> | Promise<FinishedCompaction<T>>;
}

/** Run a method without changing or saving session history. */
export async function runCompaction<T>(
	preparation: CompactionPreparation,
	options: CompactionModelOptions,
	procedure: CompactionProcedure<T>,
): Promise<CompactionResult<T>> {
	if (!preparation.firstKeptEntryId) {
		throw new Error("First kept entry has no UUID - session may need migration");
	}
	options.signal?.throwIfAborted();
	const draft = await procedure.generate(preparation, options);
	options.signal?.throwIfAborted();
	const finished = await procedure.finish(draft, preparation);
	options.signal?.throwIfAborted();
	return {
		procedureId: procedure.id,
		...(finished.summaryFormat ? { summaryFormat: finished.summaryFormat } : {}),
		summary: finished.summary,
		firstKeptEntryId: preparation.firstKeptEntryId,
		tokensBefore: preparation.tokensBefore,
		usage: draft.usage,
		details: finished.details,
	};
}
