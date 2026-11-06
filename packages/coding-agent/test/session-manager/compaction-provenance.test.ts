import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import { assistantMsg, userMsg } from "../utilities.ts";

describe("compaction provenance", () => {
	it("persists inclusive source ranges without making them tree parents", () => {
		const dir = mkdtempSync(join(tmpdir(), "spicy-compaction-source-"));
		try {
			const session = SessionManager.create(dir, dir);
			const start = session.appendMessage(userMsg("Hello"));
			const end = session.appendMessage(assistantMsg("Hi"));
			const provenance = { sourceStartId: start, sourceEndId: end, procedureId: "test-summary-v1" };
			const root = session.appendCompactionRoot("Summary", 100, undefined, undefined, undefined, provenance);
			const reloaded = SessionManager.open(session.getSessionFile()!);
			expect(reloaded.getEntry(root)).toMatchObject({
				type: "compaction",
				parentId: null,
				firstKeptEntryId: root,
				...provenance,
			});
			expect(reloaded.getBranch(root).map((entry) => entry.id)).toEqual([root]);
			expect(reloaded.getEntry(end)?.parentId).toBe(start);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("can record an interior source range without including the rest of the branch", () => {
		const session = SessionManager.inMemory();
		session.appendMessage(userMsg("Before"));
		const start = session.appendMessage(userMsg("Start"));
		const end = session.appendMessage(userMsg("End"));
		session.appendMessage(userMsg("After"));
		const root = session.appendCompactionRoot("Partial summary", 100, undefined, undefined, undefined, {
			sourceStartId: start,
			sourceEndId: end,
			procedureId: "test-partial-v1",
		});
		expect(session.getEntry(root)).toMatchObject({ parentId: null, sourceStartId: start, sourceEndId: end });
	});

	it("keeps provenance optional for legacy callers and unknown procedures", () => {
		const session = SessionManager.inMemory();
		const root = session.appendCompactionRoot("Old-style summary", 100);
		expect(session.getEntry(root)).toMatchObject({ type: "compaction", parentId: null });
		expect(session.getEntry(root)).not.toHaveProperty("sourceEntryId");
		expect(session.getEntry(root)).toHaveProperty("procedureId", undefined);
	});
});
