/** Resolve only the supplied ancestry, never unrelated branches. */
export function getDiscussionTitle(entries: readonly any[]): string | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		const message = entry.message;
		if (message?.role === "toolResult" && message.toolName === "set_title" && !message.isError &&
			typeof message.details?.title === "string") return message.details.title;
		if (entry.type === "compaction" && typeof entry.details?.inheritedTitle === "string") {
			return entry.details.inheritedTitle;
		}
	}
	return undefined;
}
