import { createHash } from "node:crypto";
import type { SystemPromptSections } from "./system-prompt.ts";

export interface SystemPromptCandidate {
	key: string;
	sections: SystemPromptSections;
	currentSections: SystemPromptSections;
	parentId: string | null;
}

export interface SystemPromptPolicy {
	/** Web-only: preview the candidate before recording any starting messages. */
	decide(candidate: SystemPromptCandidate): "accept" | "current" | "cancel";
	onPriorityChange?(reason: string): void;
}

export function promptCandidateKey(sections: SystemPromptSections): string {
	return createHash("sha256").update(JSON.stringify(sections)).digest("hex");
}

/** Classify a complete revision; never rewrite or merge the builder's output. */
export function isDiscoveryOnlyChange(
	accepted: SystemPromptSections,
	proposed: SystemPromptSections,
	rulesWithPreviousTools: string | undefined,
): boolean {
	const changed = [...new Set([...Object.keys(accepted), ...Object.keys(proposed)])].filter(
		(key) => accepted[key] !== proposed[key],
	);
	return (
		changed.length > 0 &&
		changed.some((key) => key === "tools" || key === "mcp_servers") &&
		changed.every(
			(key) =>
				key === "tools" || key === "mcp_servers" || (key === "rules" && accepted.rules === rulesWithPreviousTools),
		)
	);
}
