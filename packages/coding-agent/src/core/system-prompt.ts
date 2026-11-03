/**
 * System prompt construction and project context loading
 */

import { getSystemMessageText } from "@earendil-works/pi-ai";
import { undent } from "../utils/undent.ts";
import {getDocsPath, getReadmePath} from "../config.ts";
import {formatSkillsForPrompt, type Skill} from "./skills.ts";
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

const DEFAULT_PREAMBLE =
	"You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";
const ADDITIONAL_TOOLS_NOTE =
	"In addition to the tools above, you may have access to other custom tools depending on the project.";
const PROJECT_CONTEXT_HEADING = "Project-specific instructions and guidelines:";

function textSection(name: string, text: string, source = "core"): SystemPromptPart {
	return {
		id: name,
		label: (name[0].toUpperCase() + name.slice(1)).replaceAll("_", " "),
		source,
		section: name,
		text,
	};
}

function exactPrompt(text: string): SystemPromptPart {
	return { id: "forced", label: "Exact prompt replacement", source: "extension", text };
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
	const visibleTools = declaredTools.filter((name) => !!toolSnippets[name]);
	const preamble = textSection("preamble", customPrompt || DEFAULT_PREAMBLE, customPrompt ? "configuration" : "core");
	const tools: SystemPromptPart = {
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
			{ id: "tools/note", label: "Additional tools note", source: "core", text: ADDITIONAL_TOOLS_NOTE },
		],
	};
	const rules: SystemPromptPart = {
		id: "rules",
		label: "Rules",
		source: "core",
		section: "rules",
		separator: "\n",
		children: buildRules(declaredTools, toolGuidelines, promptGuidelines),
	};
	const docs = textSection(
		"docs",
		`Spicy reference:
- Project setup: ${getReadmePath()}
- For codemode scripts and non-LLM models such as classifiers and image models, read ${getDocsPath()}/codemode.md.`,
	);
	const addendum = appendSystemPrompt ? textSection("addendum", appendSystemPrompt, "configuration") : undefined;
	const projectContext: SystemPromptPart | undefined = contextFiles.length
		? {
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
						text: PROJECT_CONTEXT_HEADING,
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
			}
		: undefined;
	// A hidden reader is still reachable through another tool, so skills stay but the hint names no tool.
	const readers = ["read", "bash"] as const;
	const skillFileReadTool =
		readers.find((tool) => declaredTools.includes(tool)) ??
		(readers.some((tool) => selectedTools.includes(tool)) ? "indirect" : undefined);
	const skillsText = skillFileReadTool && skills.length ? formatSkillsForPrompt(skills, skillFileReadTool).trim() : "";
	const skillInstructions = skillsText ? textSection("skills", skillsText, "skills") : undefined;
	const workingDirectory = textSection("cwd", cwd.replace(/\\/g, "/"));
	const extensionSections = Object.entries(customSections)
		.filter(([, text]) => text)
		.map(([name, text]) => {
			const part = options.sectionParts?.[name];
			return part && renderSystemPromptPart(part) === text
				? { ...part, id: name, section: name }
				: textSection(name, text, "extension");
		});

	const parts = [
		preamble,
		...(!customPrompt ? [tools, rules, docs] : []),
		addendum,
		projectContext,
		skillInstructions,
		workingDirectory,
		...extensionSections,
	].filter((part): part is SystemPromptPart => part !== undefined);
	return {
		version: 1,
		parts: [...new Map(parts.map((part) => [part.id, part])).values()],
		...(options.forceSystemPrompt !== undefined ? { forced: exactPrompt(options.forceSystemPrompt) } : {}),
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
			forced: exactPrompt(input.forceSystemPrompt),
		});
	return renderSystemPromptDocument(buildSystemPromptDocument(input));
}

/** Build the system prompt text, rendered exactly as the transcript's system message replays it. */
export function buildSystemPrompt(input: BuildSystemPromptOptions): string {
	if (input.forceSystemPrompt !== undefined) return input.forceSystemPrompt;
	const sections = buildSystemPromptSections(input);
	const { preamble, tools, rules, docs, cwd, ...remaining } = sections;
	const { addendum, project_context, skills, ...extensions } = remaining;
	const templateOrder = ["preamble", "tools", "rules", "docs", "addendum", "project_context", "skills", "cwd", ...Object.keys(extensions)]
		.filter(name => name in sections);
	// Extensions may supply their own ordering. Keep it outside the fixed template.
	if (JSON.stringify(Object.keys(sections)) !== JSON.stringify(templateOrder)) {
		return getSystemMessageText({ role: "system", content: "", sections, timestamp: 0 });
	}
	const paragraph = (text: string | undefined) => text ? `\n\n${text}` : "";
	const addedInstructions = addendum || undefined;
	const projectInstructions = project_context || undefined;
	const skillInstructions = skills || undefined;
	const extensionInstructions = Object.values(extensions).filter(Boolean).join("\n\n") || undefined;
	const customInstructions = paragraph(Object.entries(sections)
		.filter(([name]) => name !== "preamble").map(([, text]) => text).filter(Boolean).join("\n\n"));

	if (input.customPrompt) return `${preamble}${customInstructions}`;
	return systemPromptTemplate({
		preamble, tools, rules, docs,
		addedInstructions, projectInstructions, skillInstructions,
		cwd, extensionInstructions,
	});
}

function systemPromptTemplate({preamble, tools, rules, docs, addedInstructions, projectInstructions, skillInstructions, cwd, extensionInstructions}: Record<string, string | undefined>): string {
	return undent`
		${preamble}

		${tools}

		${rules}

		${docs}

		${addedInstructions}

		${projectInstructions}

		${skillInstructions}

		${cwd}

		${extensionInstructions}`;
}
