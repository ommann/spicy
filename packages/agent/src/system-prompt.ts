import {
	getCurrentTools,
	getSystemMessageText,
	getCurrentSystemMessage as readLegacySystemMessage,
} from "@earendil-works/pi-ai";
import type { SystemMessage } from "@earendil-works/pi-ai/compat";
import type { AgentMessage } from "./types.ts";

export interface SystemPromptSnapshot {
	content: string;
	sections: Record<string, string>;
	key?: string;
}

type SnapshotMessage = SystemMessage & { systemPromptSnapshot: true; systemPromptKey?: string };

/** A complete prompt, never a patch to earlier instructions. Tools are independent. */
export function createSystemPromptSnapshot(prompt: SystemPromptSnapshot): SnapshotMessage {
	return {
		role: "system",
		content: prompt.content,
		sections: { ...prompt.sections },
		systemPromptSnapshot: true,
		...(prompt.key !== undefined ? { systemPromptKey: prompt.key } : {}),
		timestamp: Date.now(),
	};
}

/** The latest complete prompt wins. Earlier chat messages and tool declarations survive. */
export function projectSystemPromptSnapshots(messages: AgentMessage[]): AgentMessage[] {
	const index = messages.findLastIndex(
		(message) => message.role === "system" && (message as Partial<SnapshotMessage>).systemPromptSnapshot === true,
	);
	// Read old session files as they were recorded; all new prompt writes are snapshots.
	if (index < 0) return messages;
	const snapshot = messages[index] as SnapshotMessage;
	const tools = getCurrentTools(messages.slice(0, index + 1));
	const head: SystemMessage = {
		role: "system",
		content: snapshot.content,
		sections: snapshot.sections,
		...(tools.length ? { toolsAdded: tools } : {}),
		timestamp: snapshot.timestamp,
	};
	return [head, ...messages.filter((message, i) => (i < index ? message.role !== "system" : i > index))];
}

/** Also reads legacy session files without migrating or rewriting them. */
export function getCurrentSystemMessage(messages: AgentMessage[]): SystemMessage | undefined {
	return readLegacySystemMessage(projectSystemPromptSnapshots(messages));
}

export function getCurrentSystemPrompt(messages: AgentMessage[]): string {
	const message = getCurrentSystemMessage(messages);
	return message ? getSystemMessageText(message) : "";
}
