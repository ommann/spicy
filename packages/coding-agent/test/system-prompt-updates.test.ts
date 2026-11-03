import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
	fauxAssistantMessage,
	fauxToolCall,
	getCurrentSystemMessage,
	getCurrentSystemPrompt,
	getSystemMessageText,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { describe, expect, test } from "vitest";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import {
	buildSystemPromptSections,
	buildSystemPromptState,
} from "../src/core/system-prompt.ts";
import type { SystemPromptCandidate, SystemPromptPolicy } from "../src/core/system-prompt-policy.ts";
import type { ExtensionFactory } from "../src/index.ts";
import { createHarness } from "./suite/harness.ts";

describe("system prompt updates", () => {
	test("editor can read all parts after a chat starts without changing the chat or tools", async () => {
		let hooks = 0;
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("before_agent_start", (event) => {
						hooks++;
						return { systemPrompt: event.systemPrompt };
					});
				},
			],
		});
		try {
			harness.setResponses([() => fauxAssistantMessage("done")]);
			await harness.session.prompt("hello");
			const entries = [...harness.sessionManager.getEntries()];
			const tools = harness.session.agent.state.tools;
			const source = harness.session.getSystemPromptDocument();
			expect(source.document.parts.length).toBeGreaterThan(1);
			expect(source.document.forced).toBeDefined();
			expect(harness.session.getSystemPromptDocument()).toEqual(source);
			expect(hooks).toBe(1);
			expect(harness.sessionManager.getEntries()).toEqual(entries);
			expect(harness.session.agent.state.tools).toBe(tools);
		} finally {
			harness.cleanup();
		}
	});
	test("web candidates can be cancelled, retained for one submission, and explicitly adopted", async () => {
		let instruction = "Accepted instructions.";
		const extension: ExtensionFactory = (pi) => {
			pi.on("before_agent_start", (event) => {
				event.systemPromptOptions.sections.project = instruction;
			});
		};
		const harness = await createHarness({ extensionFactories: [extension] });
		let candidate: SystemPromptCandidate | undefined;
		let decision: "accept" | "current" | "cancel" = "cancel";
		const policy: SystemPromptPolicy = {
			decide: (value) => {
				candidate = value;
				return decision;
			},
		};
		try {
			harness.setResponses([
				fauxAssistantMessage("one"),
				fauxAssistantMessage("two"),
				fauxAssistantMessage("three"),
				fauxAssistantMessage("four"),
			]);
			await harness.session.prompt("one", { systemPromptPolicy: policy });
			expect(candidate).toBeUndefined();
			const entries = [...harness.sessionManager.getEntries()];
			const messages = [...harness.session.messages];
			const tools = harness.session.agent.state.tools;
			instruction = "Candidate instructions.";
			await harness.session.prompt("cancel me", { systemPromptPolicy: policy });
			expect(harness.sessionManager.getEntries()).toEqual(entries);
			expect(harness.session.messages).toEqual(messages);
			expect(harness.session.agent.state.tools).toBe(tools);
			expect(candidate?.sections.project).toContain("Candidate instructions.");
			const key = candidate!.key;
			decision = "current";
			await harness.session.prompt("two", { systemPromptPolicy: policy });
			expect(getCurrentSystemPrompt(harness.session.messages)).toContain("Accepted instructions.");
			expect(getCurrentSystemPrompt(harness.session.messages)).not.toContain("Candidate instructions.");
			candidate = undefined;
			await harness.session.prompt("three", { systemPromptPolicy: policy });
			expect((candidate as SystemPromptCandidate | undefined)?.key).toBe(key); // Use-current does not ignore or accept the revision.
			decision = "accept";
			await harness.session.prompt("four", { systemPromptPolicy: policy });
			expect(getCurrentSystemPrompt(harness.session.messages)).toContain("Candidate instructions.");
		} finally {
			harness.cleanup();
		}
	});

	test("web tool activation is priority, without adopting unrelated instructions", async () => {
		let instruction = "Accepted instructions.";
		const extension: ExtensionFactory = (pi) => {
			for (const name of ["first", "second"])
				pi.registerTool({
					name,
					label: name,
					description: name,
					promptSnippet: `${name} snippet`,
					promptGuidelines: [`Use ${name} carefully.`],
					parameters: Type.Object({}),
					execute: async () => ({ content: [{ type: "text", text: name }], details: {} }),
				});
			pi.on("before_agent_start", (event) => {
				event.systemPromptOptions.sections.project = instruction;
			});
		};
		const harness = await createHarness({ extensionFactories: [extension], initialActiveToolNames: ["first"] });
		let calls = 0;
		harness.session.setActiveToolsByName(["first"]);
		const policy: SystemPromptPolicy = {
			decide: () => {
				calls++;
				return "current";
			},
		};
		try {
			harness.setResponses([
				fauxAssistantMessage("one"),
				fauxAssistantMessage("two"),
				fauxAssistantMessage("three"),
			]);
			await harness.session.prompt("one", { systemPromptPolicy: policy });
			harness.session.setActiveToolsByName(["first", "second"]);
			await harness.session.prompt("two", { systemPromptPolicy: policy });
			expect(calls).toBe(0);
			expect(getCurrentSystemMessage(harness.session.messages)?.toolsAdded?.map((tool) => tool.name)).toContain(
				"second",
			);
			const accepted = getCurrentSystemPrompt(harness.session.messages);
			harness.session.setActiveToolsByName(["second"]);
			instruction = "Unapproved instructions.";
			await harness.session.prompt("three", { systemPromptPolicy: policy });
			expect(calls).toBe(1);
			const current = getCurrentSystemPrompt(harness.session.messages);
			expect(current).toBe(accepted); // Retain the complete accepted revision, not a synthetic hybrid.
			expect(current).toContain("second snippet");
			expect(current).not.toContain("Unapproved instructions.");
		} finally {
			harness.cleanup();
		}
	});

	test("web preserves the original forced-prompt projection and structured history", async () => {
		let forced: string | undefined;
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("before_agent_start", () => (forced === undefined ? undefined : { systemPrompt: forced }));
				},
			],
		});
		try {
			const requests: TranscriptContext[] = [];
			harness.setResponses(
				["one", "two", "three"].map((text) => (context: TranscriptContext) => {
					requests.push(context);
					return fauxAssistantMessage(text);
				}),
			);
			await harness.session.prompt("one", { systemPromptPolicy: { decide: () => "accept" } });
			const originalSections = getCurrentSystemMessage(harness.session.messages)?.sections;
			forced = "Exact replacement instructions.";
			await harness.session.prompt("two", { systemPromptPolicy: { decide: () => "current" } });
			expect(getCurrentSystemPrompt(harness.session.messages)).not.toContain(forced);
			await harness.session.prompt("three", { systemPromptPolicy: { decide: () => "accept" } });
			expect(getCurrentSystemPrompt(requests[1]!.messages)).toBe(forced);
			expect(getCurrentSystemPrompt(requests[2]!.messages)).toBe(forced);
			expect(getCurrentSystemMessage(harness.session.messages)?.sections).toEqual(originalSections);
		} finally {
			harness.cleanup();
		}
	});

	test("a passive MCP description is a complete candidate, not a priority tool-definition change", async () => {
		let description = "";
		let expected: Record<string, string> = {};
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("before_agent_start", (event) => {
						event.systemPromptOptions.sections.mcp_servers = `MCP servers whose tools are not declared to you.\n- mcp__rea (tool_search)${description}`;
						expected = buildSystemPromptSections(event.systemPromptOptions);
					});
				},
			],
		});
		let approvals = 0;
		let candidate: SystemPromptCandidate | undefined;
		const policy: SystemPromptPolicy = {
			decide: (value) => {
				approvals++;
				candidate = value;
				return "cancel";
			},
		};
		try {
			harness.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
			await harness.session.prompt("one", { systemPromptPolicy: policy });
			expect(getCurrentSystemMessage(harness.session.messages)?.sections).toEqual(expected);
			const entries = [...harness.sessionManager.getEntries()];
			const accepted = getCurrentSystemPrompt(harness.session.messages);
			description = ": REA provides reverse-engineering tools.";
			await harness.session.prompt("two", { systemPromptPolicy: policy });
			expect(approvals).toBe(1);
			expect(candidate?.sections).toEqual(expected);
			expect(harness.sessionManager.getEntries()).toEqual(entries);
			expect(getCurrentSystemPrompt(harness.session.messages)).toBe(accepted);
			await harness.session.prompt("two", { systemPromptPolicy: { decide: () => "accept" } });
			expect(getCurrentSystemMessage(harness.session.messages)?.sections).toEqual(expected);
			expect(getCurrentSystemPrompt(harness.session.messages)).toContain("<mcp_servers>\n");
			expect(getCurrentSystemPrompt(harness.session.messages)).toContain(description);
		} finally {
			harness.cleanup();
		}
	});

	test("declares the prompt and tools once and reuses them across resume", async () => {
		const harness = await createHarness();
		try {
			harness.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);
			await harness.session.prompt("one");
			await harness.session.prompt("two");
			const systemEntries = harness.sessionManager
				.getEntries()
				.filter((entry) => entry.type === "message" && entry.message.role === "system");
			expect(systemEntries).toHaveLength(1);
			expect(harness.session.messages.map((message) => message.role)).toEqual([
				"system",
				"user",
				"assistant",
				"user",
				"assistant",
			]);
			const head = harness.session.messages[0];
			if (head?.role !== "system") throw new Error("expected system message");
			expect(head.content).toBe("");
			expect(Object.keys(head.sections ?? {})).toEqual(["preamble", "tools", "rules", "docs", "cwd"]);
			expect(head.toolsAdded?.map((tool) => tool.name)).toEqual(["read", "bash", "edit", "write"]);
			expect(getSystemMessageText(head)).toBe(harness.session.systemPrompt);
		} finally {
			harness.cleanup();
		}
	});

	test("opens a transcript without a system message and declares the prompt on the first request", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pi-system-prompt-migration-"));
		try {
			const sessionManager = SessionManager.inMemory(tempDir);
			sessionManager.appendMessage({ role: "user", content: "existing", timestamp: 1 });
			const created = await createAgentSession({
				cwd: tempDir,
				agentDir: join(tempDir, "agent"),
				model: getModel("anthropic", "claude-sonnet-4-5")!,
				settingsManager: SettingsManager.inMemory(),
				sessionManager,
				noTools: "all",
			});
			try {
				// Nothing is synthesized or persisted until a request needs it.
				expect(created.session.messages.map((message) => message.role)).toEqual(["user"]);
				expect(sessionManager.buildSessionContext().messages.map((message) => message.role)).toEqual(["user"]);
				expect(getCurrentSystemMessage(created.session.messages)).toBeUndefined();
			} finally {
				created.session.dispose();
			}
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test("keeps the preamble untagged and replaces it like any section", () => {
		const previous = buildSystemPromptSections({ customPrompt: "You are A.", cwd: "/tmp" });
		const current = buildSystemPromptSections({ customPrompt: "You are B.", cwd: "/tmp" });
		expect(previous.preamble).toBe("You are A.");
		expect(current.preamble).toBe("You are B.");

		expect(buildSystemPromptState({ forceSystemPrompt: "Exact prompt.", cwd: "/tmp" })).toEqual({
			content: "Exact prompt.",
		});
		expect(buildSystemPromptState({ cwd: "/tmp" })).toEqual({
			content: "",
			sections: buildSystemPromptSections({ cwd: "/tmp" }),
		});
		expect(() => buildSystemPromptSections({ cwd: "/tmp", sections: { preamble: "x" } })).toThrow(
			"Invalid system prompt section name",
		);
	});

	test("a forced prompt is sent as the leading prompt for the run and never recorded", async () => {
		let turn = 0;
		const extension: ExtensionFactory = (pi) => {
			pi.on("before_agent_start", (event) => {
				if (++turn === 3) event.systemPromptOptions.sections.plan_mode = "Plan only.";
				return turn === 2 || turn === 3 ? { systemPrompt: "Exact prompt." } : undefined;
			});
		};
		const harness = await createHarness({ extensionFactories: [extension] });
		try {
			const requests: TranscriptContext[] = [];
			harness.setResponses(
				["one", "two", "three", "four"].map((text) => (providerContext: TranscriptContext) => {
					requests.push(providerContext);
					return fauxAssistantMessage(text);
				}),
			);
			for (const text of ["one", "two", "three", "four"]) await harness.session.prompt(text);
			const systemMessages = requests.map((request) =>
				request.messages.filter((message) => message.role === "system"),
			);
			// Forced turns collapse to one leading message; the unforced fourth turn passes the
			// recorded head and both plan_mode patches through.
			expect(systemMessages.map((messages) => messages.length)).toEqual([1, 1, 1, 3]);

			const forced = systemMessages[1]?.at(-1);
			expect(forced).toEqual({
				role: "system",
				content: "Exact prompt.",
				toolsAdded: systemMessages[0]?.[0]?.toolsAdded,
				timestamp: systemMessages[0]?.[0]?.timestamp,
			});
			expect(systemMessages[2]?.at(-1)).toEqual(forced);
			expect(getCurrentSystemPrompt(requests[2]!.messages)).toBe("Exact prompt.");
			expect(requests[2]!.messages.map((message) => message.role)).toEqual([
				"system",
				"user",
				"assistant",
				"user",
				"assistant",
				"user",
			]);

			// The transcript only records the structured sections, never the forced text.
			const recorded = harness.session.messages.flatMap((message) =>
				message.role === "system" ? [message.sections] : [],
			);
			expect(recorded).toEqual([
				systemMessages[0]?.[0]?.sections,
				{ plan_mode: "<plan_mode>\nPlan only.\n</plan_mode>" },
				{ plan_mode: null },
			]);
			expect(getCurrentSystemPrompt(harness.session.messages)).toBe(harness.session.systemPrompt);
		} finally {
			harness.cleanup();
		}
	});

	test("setActiveTools emits prompt sections and tool changes before the next request", async () => {
		const extension: ExtensionFactory = (pi) => {
			for (const name of ["first", "second"]) {
				pi.registerTool({
					name,
					label: name,
					description: `${name} description`,
					promptSnippet: `${name} prompt snippet`,
					promptGuidelines: [`Use ${name} carefully.`],
					parameters: Type.Object({}),
					execute: async () => ({ content: [{ type: "text", text: name }], details: {} }),
				});
			}
		};
		const harness = await createHarness({ extensionFactories: [extension], initialActiveToolNames: ["first"] });
		try {
			// Faux response callbacks swallow thrown assertions, so capture and assert afterwards.
			const requests: TranscriptContext[] = [];
			harness.setResponses([
				(providerContext) => {
					requests.push(providerContext);
					return fauxAssistantMessage("first");
				},
				(providerContext) => {
					requests.push(providerContext);
					return fauxAssistantMessage([fauxToolCall("first", {})], { stopReason: "toolUse" });
				},
				(providerContext) => {
					requests.push(providerContext);
					return fauxAssistantMessage("second");
				},
			]);
			await harness.session.prompt("first");
			harness.session.setActiveToolsByName(["second"]);
			await harness.session.prompt("second");
			expect(requests).toHaveLength(3);

			expect(Object.keys(requests[0] ?? {})).toEqual(["messages"]);
			const initial = requests[0]?.messages[0];
			if (initial?.role !== "system") throw new Error("expected initial system message");
			expect(initial.toolsAdded?.map((value) => value.name)).toEqual(["first", "second"]);
			expect(initial.sections?.tools).toContain("first prompt snippet");

			const update = requests[1]?.messages.filter((message) => message.role === "system").at(-1);
			expect(update).toEqual({
				role: "system",
				content: "",
				sections: { tools: expect.stringContaining("second prompt snippet"), rules: expect.any(String) },
				toolsRemoved: [{ name: "first" }],
				timestamp: expect.any(Number),
			});
			expect(update?.sections?.tools).not.toContain("first prompt snippet");
			expect(update?.sections?.rules).not.toContain("Use first carefully.");

			const result = requests[2]?.messages.filter((message) => message.role === "toolResult").at(-1);
			expect(result).toMatchObject({ role: "toolResult", toolName: "first", isError: true });

			const current = getCurrentSystemMessage(harness.session.messages);
			expect(current?.toolsAdded?.map((value) => value.name)).toEqual(["second"]);
			expect(getSystemMessageText(current!)).toBe(harness.session.systemPrompt);
		} finally {
			harness.cleanup();
		}
	});

	test("setActiveTools in before_agent_start controls the same request", async () => {
		const extension: ExtensionFactory = (pi) => {
			for (const name of ["first", "second"]) {
				pi.registerTool({
					name,
					label: name,
					description: `${name} description`,
					parameters: Type.Object({}),
					execute: async () => ({ content: [{ type: "text", text: name }], details: {} }),
				});
			}
			let turn = 0;
			pi.on("before_agent_start", () => {
				if (turn++ === 1) pi.setActiveTools(["second"]);
			});
		};
		const harness = await createHarness({ extensionFactories: [extension], initialActiveToolNames: ["first"] });
		try {
			const requests: TranscriptContext[] = [];
			harness.setResponses([
				(providerContext) => {
					requests.push(providerContext);
					return fauxAssistantMessage("first");
				},
				(providerContext) => {
					requests.push(providerContext);
					return fauxAssistantMessage("second");
				},
			]);
			await harness.session.prompt("first");
			await harness.session.prompt("second");
			expect(requests).toHaveLength(2);
			const update = requests[1]?.messages.filter((message) => message.role === "system").at(-1);
			expect(update?.toolsRemoved).toEqual([{ name: "first" }]);
			expect(update?.toolsAdded).toBeUndefined();
			expect(harness.session.getActiveToolNames()).toEqual(["second"]);
		} finally {
			harness.cleanup();
		}
	});

	test("keeps tool declarations stable across a session JSON round-trip", async () => {
		const executableTool: AgentTool = {
			name: "plain",
			label: "Plain",
			description: "Plain tool",
			parameters: Type.Object({}),
			execute: async () => ({ content: [], details: {} }),
		};
		const harness = await createHarness({ tools: [executableTool], initialActiveToolNames: ["plain"] });
		try {
			harness.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);
			await harness.session.prompt("one");
			const head = harness.session.messages[0];
			if (head?.role !== "system") throw new Error("expected system message");
			const declaration = head.toolsAdded?.[0];
			if (!declaration) throw new Error("expected tool declaration");
			expect(Object.hasOwn(declaration, "constrainedSampling")).toBe(false);
			expect(Object.hasOwn(declaration, "execute")).toBe(false);

			// Simulate a resume: the persisted JSON must replay to the same declarations.
			harness.session.agent.state.messages = JSON.parse(JSON.stringify(harness.session.messages));
			await harness.session.prompt("two");
			expect(harness.session.messages.filter((message) => message.role === "system")).toHaveLength(1);
		} finally {
			harness.cleanup();
		}
	});
});
