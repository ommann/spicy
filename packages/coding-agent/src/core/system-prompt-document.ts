import { getSystemMessageText } from "@earendil-works/pi-ai";
import type { SystemMessage } from "@earendil-works/pi-ai/compat";

/** Serializable prompt content only. These selections never control tools or permissions. */
export interface SystemPromptPart {
	id: string;
	label: string;
	source: string;
	/** Top-level transcript section; omitted on nested parts. */
	section?: string;
	/** Historical sections may already contain their exact serialized wrapper. */
	verbatim?: boolean;
	text?: string;
	/** Composer defaults only; ordinary prompt rendering is unchanged. */
	defaultIncluded?: boolean;
	/** Render this choice on its parent's row, without another tree level. */
	inline?: boolean;
	children?: SystemPromptPart[];
	separator?: string;
	prefix?: string;
	suffix?: string;
}

export interface SystemPromptDocument {
	version: 1;
	parts: SystemPromptPart[];
	content?: SystemPromptPart;
	/** Opaque exact replacement; kept separate from structured transcript sections. */
	forced?: SystemPromptPart;
}

/** The editable source, stored alongside its rendered snapshot in the session file. */
export interface SystemPromptBuilder {
	document: SystemPromptDocument;
	excludedIds: string[];
}

export interface SavedSystemPrompt extends SystemPromptBuilder {
	id: string;
	title: string;
	toolsAdded: NonNullable<SystemMessage["toolsAdded"]>;
	output: { content: string; sections?: Record<string, string> };
}

export type SaveSystemPromptInput = Omit<SavedSystemPrompt, "id" | "output">;
export const SAVED_SYSTEM_PROMPT_ENTRY = "saved-system-prompt";

function renderPart(part: SystemPromptPart, excluded: ReadonlySet<string>): string | undefined {
	if (excluded.has(part.id)) return undefined;
	let content = part.text ?? "";
	if (part.children) {
		const children = part.children
			.map((child) => renderPart(child, excluded))
			.filter((text): text is string => text !== undefined);
		if (part.children.length && !children.length && part.text === undefined) return undefined;
		content += children.join(part.separator ?? "");
	}
	return `${part.prefix ?? ""}${content}${part.suffix ?? ""}`;
}

export function renderSystemPromptPart(part: SystemPromptPart): string | undefined {
	return renderPart(part, new Set());
}

export function renderSystemPromptSections(
	document: SystemPromptDocument,
	excludedIds: readonly string[] = [],
): Record<string, string> {
	const excluded = new Set(excludedIds);
	const sections: Record<string, string> = {};
	for (const part of document.parts) {
		if (!part.section) throw new Error(`Missing section on prompt part ${part.id}`);
		const text = renderPart(part, excluded);
		if (text !== undefined)
			sections[part.section] =
				part.section === "preamble" || part.verbatim ? text : `<${part.section}>\n${text}\n</${part.section}>`;
	}
	return sections;
}

export function renderSystemPromptDocument(
	document: SystemPromptDocument,
	excludedIds: readonly string[] = [],
): { content: string; sections?: Record<string, string> } {
	if (document.forced) return { content: renderPart(document.forced, new Set(excludedIds)) ?? "" };
	return {
		content: document.content ? (renderPart(document.content, new Set(excludedIds)) ?? "") : "",
		sections: renderSystemPromptSections(document, excludedIds),
	};
}

/** Older snapshots sometimes retained an override that the recorded sections did not use. */
export function systemPromptBuilderForOutput(
	builder: SystemPromptBuilder,
	output: { content?: string; sections?: Record<string, string | null> },
): SystemPromptBuilder {
	if (!output.sections || !builder.document.forced) return builder;
	return { ...builder, document: { ...builder.document, forced: undefined } };
}

export function systemPromptOutputMatches(
	builder: SystemPromptBuilder,
	output: { content: string; sections?: Record<string, string | null> },
): boolean {
	const source = systemPromptBuilderForOutput(builder, output);
	const rendered = renderSystemPromptDocument(source.document, source.excludedIds);
	return (
		getSystemMessageText({ role: "system", ...rendered, timestamp: 0 }) ===
		getSystemMessageText({ role: "system", ...output, timestamp: 0 })
	);
}

/** Old recordings remain exact opaque sections, without guessing structure from text. */
export function systemPromptDocumentFromState(state: {
	content: string;
	sections?: Record<string, string | null>;
}): SystemPromptDocument {
	return {
		version: 1,
		...(state.content
			? {
					content: {
						id: "recorded-content",
						label: "Recorded leading instructions",
						source: "recorded",
						text: state.content,
					},
				}
			: {}),
		parts: Object.entries(state.sections ?? {})
			.filter((entry): entry is [string, string] => typeof entry[1] === "string")
			.map(([name, text]) => ({
				id: name,
				label: name.replaceAll("_", " "),
				source: "recorded",
				section: name,
				verbatim: true,
				text,
			})),
	};
}
