/**
 * System prompt construction and project context loading
 */

import { getSystemMessageText } from "@earendil-works/pi-ai";
import { getDocsPath, getReadmePath } from "../config.ts";
import { formatSkillsForPrompt, type Skill } from "./skills.ts";
import {
	renderSystemPromptDocument,
	renderSystemPromptPart,
	renderSystemPromptSections,
	type SystemPromptDocument,
	type SystemPromptPart,
} from "./system-prompt-document.ts";

export interface BuildSystemPromptOptions {
	/** Custom system prompt (replaces the default prefix). */
	customPrompt?: string;
	/** Exact full prompt replacement set by a before_agent_start handler. */
	forceSystemPrompt?: string;
	/** Tools to include in prompt. Default: [read, bash, edit, write]. */
	selectedTools?: string[];
	/**
	 * Selected tools whose declarations requests leave out (`prepareLoadout` hidden declarations).
	 * They are reachable only through another tool, so the tool list and rules leave them out too.
	 */
	hiddenTools?: string[];
	/** Optional one-line tool snippets keyed by tool name. */
	toolSnippets?: Record<string, string>;
	/** Guideline bullets contributed by each tool, keyed by tool name. */
	toolGuidelines?: Record<string, string[]>;
	/** Additional guideline bullets appended to the default system prompt rules. */
	promptGuidelines?: string[];
	/** Text appended from user configuration before project context, skills, and cwd. */
	appendSystemPrompt?: string;
	/** Additional XML-wrapped prompt sections keyed by tag name. */
	sections?: Record<string, string>;
	/** Structured contributions supplied by their actual sources, not inferred from text. */
	sectionParts?: Record<string, SystemPromptPart>;
	/** Read-only live contributions for the composer, including not-yet-included parts. */
	sectionPartSources?: Record<string, () => SystemPromptPart | undefined>;
	/** Working directory. */
	cwd: string;
	/** Pre-loaded context files. */
	contextFiles?: Array<{ path: string; content: string }>;
	/** Pre-loaded skills. */
	skills?: Skill[];
}

export type NormalizedBuildSystemPromptOptions = BuildSystemPromptOptions & {
	selectedTools: string[];
	hiddenTools: string[];
	toolSnippets: Record<string, string>;
	toolGuidelines: Record<string, string[]>;
	promptGuidelines: string[];
	appendSystemPrompt: string;
	sections: Record<string, string>;
	contextFiles: Array<{ path: string; content: string }>;
	skills: Skill[];
};

/**
 * Ordered system prompt sections, keyed by name. `preamble` is untagged text; every other
 * section is wrapped in a tag of the same name so the model can match later updates to it.
 * These become `SystemMessage.sections` in the transcript.
 */
export type SystemPromptSections = Record<string, string>;

const SYSTEM_PROMPT_SECTION_NAME = /^[a-z][a-z0-9_-]*$/;
/** Normalize prompt input into the mutable, collection-complete shape exposed to extensions. */
export function normalizeBuildSystemPromptOptions(input: BuildSystemPromptOptions): NormalizedBuildSystemPromptOptions {
	return {
		customPrompt: input.customPrompt,
		forceSystemPrompt: input.forceSystemPrompt,
		selectedTools: [...(input.selectedTools ?? ["read", "bash", "edit", "write"])],
		hiddenTools: [...(input.hiddenTools ?? [])],
		toolSnippets: { ...(input.toolSnippets ?? {}) },
		toolGuidelines: Object.fromEntries(
			Object.entries(input.toolGuidelines ?? {}).map(([name, guidelines]) => [name, [...guidelines]]),
		),
		promptGuidelines: [...(input.promptGuidelines ?? [])],
		appendSystemPrompt: input.appendSystemPrompt ?? "",
		sections: { ...(input.sections ?? {}) },
		sectionParts: { ...(input.sectionParts ?? {}) },
		sectionPartSources: { ...(input.sectionPartSources ?? {}) },
		cwd: input.cwd,
		contextFiles: (input.contextFiles ?? []).map((file) => ({ ...file })),
		skills: (input.skills ?? []).map((skill) => ({ ...skill })),
	};
}

function buildRules(
	selectedTools: string[],
	toolGuidelines: Record<string, string[]>,
	promptGuidelines: string[],
): SystemPromptPart[] {
	const rules: SystemPromptPart[] = [];
	const seen = new Set<string>();
	const addRule = (rule: string, source = "core"): void => {
		const normalized = rule.trim();
		if (!normalized || seen.has(normalized)) return;
		seen.add(normalized);
		const previous = rules.at(-1);
		if (previous?.source === source) {
			previous.text += `\n- ${normalized}`;
			return;
		}
		const occurrence = rules.filter((part) => part.source === source).length;
		rules.push({
			id: `rules/source/${encodeURIComponent(source)}/${occurrence}`,
			label:
				source === "core"
					? "Pi core"
					: source.startsWith("tool:")
						? `${source.slice(5)} rules`
						: "Additional rules",
			source,
			text: `- ${normalized}`,
		});
	};

	const hasBash = selectedTools.includes("bash");
	const hasGrep = selectedTools.includes("grep");
	const hasFind = selectedTools.includes("find");
	const hasLs = selectedTools.includes("ls");

	if (hasBash && !hasGrep && !hasFind && !hasLs) {
		addRule("Use bash for file operations like ls, rg, find");
	}

	for (const name of selectedTools) {
		for (const rule of toolGuidelines[name] ?? []) addRule(rule, `tool:${name}`);
	}
	for (const rule of promptGuidelines) addRule(rule, "configuration");
	addRule("Be concise in your responses");
	addRule("Show file paths clearly when working with files");
	const core = rules.filter((part) => part.source === "core");
	if (core.length > 1) {
		core[0].label = "Pi core start";
		core[core.length - 1].label = "Pi core end";
	}
	return rules;
}

/** Construct the content tree before rendering; text comparisons are presentation only. */
export function buildSystemPromptDocument(input: BuildSystemPromptOptions): SystemPromptDocument {
	const options = normalizeBuildSystemPromptOptions(input);
	const {
		customPrompt,
		selectedTools,
		hiddenTools,
		toolSnippets,
		toolGuidelines,
		promptGuidelines,
		appendSystemPrompt,
		sections: customSections,
		cwd,
		contextFiles,
		skills,
	} = options;

	for (const name of Object.keys(customSections)) {
		if (!SYSTEM_PROMPT_SECTION_NAME.test(name) || name === "preamble") {
			throw new Error(`Invalid system prompt section name: ${name}`);
		}
	}

	const declaredTools = selectedTools.filter((name) => !hiddenTools.includes(name));
	const promptParts: Record<string, SystemPromptPart> = {};
	const section = (name: string, text: string, source = "core") => {
		promptParts[name] = {
			id: name,
			label: (name[0].toUpperCase() + name.slice(1)).replaceAll("_", " "),
			source,
			section: name,
			text,
		};
	};
	if (customPrompt) {
		section("preamble", customPrompt, "configuration");
	} else {
		section(
			"preamble",
			"You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.",
		);
		const visibleTools = declaredTools.filter((name) => !!toolSnippets[name]);
		promptParts.tools = {
			id: "tools",
			label: "Tool descriptions",
			source: "core",
			section: "tools",
			separator: "\n\n",
			children: [
				visibleTools.length
					? {
							id: "tools/list",
							label: "Descriptions",
							source: "tools",
							separator: "\n",
							children: visibleTools.map((name) => ({
								id: `tools/${name}`,
								label: name,
								source: `tool:${name}`,
								text: `- ${name}: ${toolSnippets[name]}`,
							})),
						}
					: { id: "tools/list", label: "No descriptions", source: "tools", text: "(none)" },
				{
					id: "tools/note",
					label: "Additional tools note",
					source: "core",
					text: "In addition to the tools above, you may have access to other custom tools depending on the project.",
				},
			],
		};
		promptParts.rules = {
			id: "rules",
			label: "Rules",
			source: "core",
			section: "rules",
			separator: "\n",
			children: buildRules(declaredTools, toolGuidelines, promptGuidelines),
		};
		section(
			"docs",
			`Spicy reference:
- Project setup: ${getReadmePath()}
- For codemode scripts and non-LLM models such as classifiers and image models, read ${getDocsPath()}/codemode.md.`,
		);
	}

	if (appendSystemPrompt) section("addendum", appendSystemPrompt, "configuration");
	if (contextFiles.length > 0)
		promptParts.project_context = {
			id: "project_context",
			label: "Project context",
			source: "context",
			section: "project_context",
			separator: "\n\n",
			children: [
				{
					id: "project_context/heading",
					label: "Context heading",
					source: "core",
					text: "Project-specific instructions and guidelines:",
				},
				...contextFiles.map(({ path, content }, index) => ({
					id: `project_context/${encodeURIComponent(path)}/${contextFiles.slice(0, index).filter((file) => file.path === path).length}`,
					label: path,
					source: path,
					text: content,
					prefix: `<project_instructions path="${path}">\n`,
					suffix: "\n</project_instructions>",
				})),
			],
		};
	// A hidden reader is still reachable through another tool, so skills stay but the hint names no tool.
	const readers = ["read", "bash"] as const;
	const skillFileReadTool =
		readers.find((tool) => declaredTools.includes(tool)) ??
		(readers.some((tool) => selectedTools.includes(tool)) ? "indirect" : undefined);
	if (skillFileReadTool && skills.length > 0) {
		const skillsPrompt = formatSkillsForPrompt(skills, skillFileReadTool).trim();
		if (skillsPrompt) section("skills", skillsPrompt, "skills");
	}
	section("cwd", cwd.replace(/\\/g, "/"));
	for (const [name, content] of Object.entries(customSections)) {
		if (content) {
			const part = options.sectionParts?.[name];
			if (part && renderSystemPromptPart(part) === content) promptParts[name] = { ...part, id: name, section: name };
			else section(name, content, "extension");
		}
	}
	return {
		version: 1,
		parts: Object.values(promptParts),
		...(options.forceSystemPrompt !== undefined
			? {
					forced: {
						id: "forced",
						label: "Exact prompt replacement",
						source: "extension",
						text: options.forceSystemPrompt,
					},
				}
			: {}),
	};
}

/** Render the same ordered transcript sections used before structured composition. */
export function buildSystemPromptSections(input: BuildSystemPromptOptions): SystemPromptSections {
	return renderSystemPromptSections(buildSystemPromptDocument(input));
}

/**
 * The complete prompt state for `input`. A forced prompt is opaque and lives in `content`
 * with no sections; otherwise `content` is empty and the structured sections carry the prompt.
 */
export function buildSystemPromptState(input: BuildSystemPromptOptions): {
	content: string;
	sections?: SystemPromptSections;
} {
	if (input.forceSystemPrompt !== undefined)
		return renderSystemPromptDocument({
			version: 1,
			parts: [],
			forced: {
				id: "forced",
				label: "Exact prompt replacement",
				source: "extension",
				text: input.forceSystemPrompt,
			},
		});
	return renderSystemPromptDocument(buildSystemPromptDocument(input));
}

/** Build the system prompt text, rendered exactly as the transcript's system message replays it. */
export function buildSystemPrompt(input: BuildSystemPromptOptions): string {
	return getSystemMessageText({ role: "system", ...buildSystemPromptState(input), timestamp: 0 });
}

/** @deprecated Legacy comparison utility only. New runs never write prompt patches. */
export function diffSystemPromptSections(
	previous: Record<string, string | null>,
	current: SystemPromptSections,
): Record<string, string | null> | undefined {
	const changes: Record<string, string | null> = {};
	for (const [name, text] of Object.entries(current)) {
		if (previous[name] !== text) changes[name] = text;
	}
	for (const name of Object.keys(previous)) {
		if (current[name] === undefined) changes[name] = null;
	}
	return Object.keys(changes).length ? changes : undefined;
}
