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

/** Tool declarations must be usable immediately. Do not adopt unrelated prompt sections with them. */
export function withPriorityToolSections(
	accepted: SystemPromptSections,
	proposed: SystemPromptSections,
	toolNames: readonly string[],
	toolGuidelines: Record<string, string[]>,
): SystemPromptSections {
	const result = { ...accepted };
	// An accepted exact replacement has no independently editable tool sections.
	if (Object.keys(accepted).every((key) => key === "preamble")) return result;
	if (proposed.tools !== undefined) result.tools = proposed.tools;
	else delete result.tools;
	const ruleLines = (section = "") =>
		section.split("\n").filter((line) => line && line !== "<rules>" && line !== "</rules>");
	const rules = ruleLines(accepted.rules);
	const bashRule = "- Use bash for file operations like ls, rg, find";
	const needsBashRule = toolNames.includes("bash") && !toolNames.some((name) => ["grep", "find", "ls"].includes(name));
	const inactiveRules = new Set(
		Object.entries(toolGuidelines)
			.filter(([name]) => !toolNames.includes(name))
			.flatMap(([, guidelines]) => guidelines.map((guideline) => `- ${guideline.trim()}`)),
	);
	const nextRules = rules.filter((rule) => !inactiveRules.has(rule) && (rule !== bashRule || needsBashRule));
	if (needsBashRule && !nextRules.includes(bashRule)) nextRules.unshift(bashRule);
	for (const name of toolNames) {
		for (const guideline of toolGuidelines[name] ?? []) {
			const rule = `- ${guideline.trim()}`;
			if (guideline.trim() && !nextRules.includes(rule)) nextRules.push(rule);
		}
	}
	if (accepted.rules !== undefined || proposed.rules !== undefined) {
		const proposedRules = ruleLines(proposed.rules);
		result.rules =
			proposedRules.length === nextRules.length && proposedRules.every((rule) => nextRules.includes(rule))
				? (proposed.rules ?? "")
				: `<rules>\n${nextRules.join("\n")}\n</rules>`;
	}
	return result;
}
