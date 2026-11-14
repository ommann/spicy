import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import { userMsg } from "../utilities.ts";

const prompt = (content: string) => ({ role: "system" as const, content, timestamp: Date.now() });

describe("system prompt predecessors", () => {
	it("persists an explicit predecessor without changing message parent links", () => {
		const session = SessionManager.inMemory();
		const first = session.appendMessage(prompt("First"), null);
		const user = session.appendMessage(userMsg("Hello"));
		const second = session.appendMessage(prompt("Second"), first);
		expect(session.getEntry(first)).toMatchObject({ parentId: null, predecessorId: null });
		expect(session.getEntry(user)).not.toHaveProperty("predecessorId");
		expect(session.getEntry(second)).toMatchObject({ parentId: user, predecessorId: first });
	});

	it("preserves explicit links on separate branches", () => {
		const session = SessionManager.inMemory();
		const first = session.appendMessage(prompt("Shared"));
		const user = session.appendMessage(userMsg("Fork here"));
		const left = session.appendMessage(prompt("Left"), first);
		session.branch(user);
		const right = session.appendMessage(prompt("Right"), first);
		expect(session.getEntry(left)).toMatchObject({ predecessorId: first });
		expect(session.getEntry(right)).toMatchObject({ parentId: user, predecessorId: first });
	});

	it("does not assign a predecessor to a compaction copy", () => {
		const session = SessionManager.inMemory();
		const first = session.appendMessage(prompt("Instructions"));
		const user = session.appendMessage(userMsg("Hello"));
		const compacted = session.appendCompaction("Summary", user, 100);
		const next = session.appendMessage(prompt("Updated instructions"), first);
		expect(session.getEntry(compacted)).toMatchObject({ systemMessage: { role: "system" } });
		expect(session.getEntry(compacted)).not.toHaveProperty("predecessorId");
		expect(session.getEntry(next)).toMatchObject({ predecessorId: first });
	});

	it("does not assign predecessors to ordinary prompts or inherited compaction prompts", () => {
		const session = SessionManager.inMemory();
		session.appendMessage(prompt("Old branch"));
		const root = session.appendCompactionRoot("Summary", 100);
		const first = session.appendMessage(prompt("New branch"));
		expect(session.getEntry(root)).toMatchObject({ parentId: null });
		expect(session.getEntry(root)).not.toHaveProperty("predecessorId");
		expect(session.getEntry(first)).toMatchObject({ parentId: root });
		expect(session.getEntry(first)).not.toHaveProperty("predecessorId");
	});

	it("persists new links and can reference legacy prompts without rewriting them", () => {
		const dir = mkdtempSync(join(tmpdir(), "spicy-prompt-predecessor-"));
		try {
			const session = SessionManager.create(dir, dir);
			const first = session.appendMessage(prompt("Legacy instructions"));
			session.appendMessage(userMsg("Hello"));
			const file = join(dir, 'legacy.jsonl');
			const legacy = [session.getHeader(), ...session.getEntries()].map(entry => {
				if (entry && 'predecessorId' in entry) delete entry.predecessorId;
				return JSON.stringify(entry);
			}).join('\n') + '\n';
			writeFileSync(file, legacy);
			const loaded = SessionManager.open(file);
			const second = loaded.appendMessage(prompt("New instructions"), first);
			const reopened = SessionManager.open(file);
			expect(reopened.getEntry(first)).not.toHaveProperty("predecessorId");
			expect(reopened.getEntry(second)).toMatchObject({ predecessorId: first });
			expect(readFileSync(file, "utf8")).toBe(legacy);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
