import { createHash } from "node:crypto";
import type { SystemPromptSections } from "./system-prompt.ts";
import type { SystemPromptBuilder } from "./system-prompt-document.ts";

export interface SystemPromptCandidate {
	key: string;
	sections: SystemPromptSections;
	currentSections: SystemPromptSections;
	parentId: string | null;
}

export interface SelectedSystemPrompt {
	key: string;
	content: string;
	sections: Record<string, string>;
	promptBuilder?: SystemPromptBuilder;
}

export interface SystemPromptPolicy {
	/** An explicitly chosen composition, applied only to this branch's next run. */
	selected?: SelectedSystemPrompt;
	/** Web-only: preview the candidate before recording any starting messages. */
	decide(candidate: SystemPromptCandidate): "accept" | "current" | "cancel";
}

export function promptCandidateKey(sections: SystemPromptSections): string {
	return createHash("sha256").update(JSON.stringify(sections)).digest("hex");
}

/** Classify a complete revision; never rewrite or merge the builder's output. */
export function isDiscoveryOnlyChange(
	accepted: SystemPromptSections,
	proposed: SystemPromptSections,
	rulesWithPreviousTools: string | undefined,
	toolDefinitionsChanged: boolean,
): boolean {
	const changed = [...new Set([...Object.keys(accepted), ...Object.keys(proposed)])].filter(
		(key) => accepted[key] !== proposed[key],
	);
	return (
		toolDefinitionsChanged &&
		changed.length > 0 &&
		changed.every((key) => key === "tools" || (key === "rules" && accepted.rules === rulesWithPreviousTools))
	);
}
