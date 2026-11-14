import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readStoredHistory } from '../src/core/session-storage.ts';
import { SessionManager } from "../src/core/session-manager.ts";
import { createSessionUrlId, SESSION_URL_ID_ALPHABET } from "../src/core/session-url-id.ts";

describe("permanent session URL IDs", () => {
	let directory: string;
	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "pi-session-url-"));
	});
	afterEach(() => {
		rmSync(directory, { recursive: true, force: true });
	});

	it("uses eight characters from the agreed alphabet and retries collisions", () => {
		expect(SESSION_URL_ID_ALPHABET).toHaveLength(31);
		let calls = 0;
		const id = createSessionUrlId(new Set(["aaaaaaaa"]), () => (calls++ < 8 ? 0 : 1));
		expect(id).toBe("bbbbbbbb");
		expect(createSessionUrlId(new Set())).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);
	});

	it("persists a second ID without replacing the UUID, and gives forks fresh IDs", async () => {
		const session = SessionManager.create(directory, directory);
		const uuid = session.getSessionId();
		const urlId = session.getHeader()!.urlId;
		expect(urlId).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);
		expect(urlId).not.toBe(uuid);
		const entry = session.appendMessage({ role: "user", content: "Keep this message", timestamp: 1 });
		const file = session.getSessionFile()!;
		const original = readStoredHistory(file);
		const reopened = SessionManager.open(file, directory);
		expect(reopened.getSessionId()).toBe(uuid);
		expect(reopened.getHeader()!.urlId).toBe(urlId);
		expect(readStoredHistory(file)).toEqual(original);
		expect((await SessionManager.list(directory, directory))[0].urlId).toBe(urlId);
		reopened.createBranchedSession(entry);
		expect(reopened.getHeader()!.urlId).not.toBe(urlId);
		const fork = SessionManager.forkFrom(file, directory, directory);
		expect(fork.getHeader()!.urlId).not.toBe(urlId);
		expect(fork.getHeader()!.urlId).not.toBe(reopened.getHeader()!.urlId);
		expect(readStoredHistory(file)).toEqual(original);
	});

	it("backfills a legacy header once, preserving transcript bytes, ancestry and mtime", () => {
		const file = join(directory, "legacy.jsonl");
		const header = {
			type: "session",
			version: 3,
			id: "original-uuid",
			timestamp: "2026-01-01T00:00:00.000Z",
			cwd: directory,
			parentSession: "/parent.jsonl",
		};
		const transcript =
			'\n{ "type": "message", "id": "user-entry", "parentId": null, "timestamp": "2026-01-01T00:00:00.000Z", "message": {"role":"user","content":"Keep exact bytes","timestamp":1}}\n';
		writeFileSync(file, JSON.stringify(header) + "\n" + transcript);
		const mtime = statSync(file).mtimeMs;
		const session = SessionManager.open(file, directory);
		const updated = readFileSync(file, "utf8");
		expect(updated.slice(updated.indexOf("\n") + 1)).toBe(transcript);
		expect(session.getHeader()).toEqual({ ...header, urlId: session.getHeader()!.urlId });
		expect(session.getHeader()!.urlId).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);
		expect(Math.abs(statSync(file).mtimeMs - mtime)).toBeLessThan(1);
		expect(SessionManager.open(file, directory).getHeader()!.urlId).toBe(session.getHeader()!.urlId);
		expect(readFileSync(file, "utf8")).toBe(updated);
	});
});
