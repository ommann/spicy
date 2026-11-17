import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findMostRecentSession, loadEntriesFromFile, SessionManager } from "../../src/core/session-manager.ts";
import { assistantMsg, userMsg } from "../utilities.ts";

describe("SQLite session persistence and discovery", () => {
 let directory: string;
 beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "spicy-session-storage-")); });
 afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

 function create(cwd = directory) {
  const session = SessionManager.create(cwd, directory);
  session.appendMessage(userMsg("first question"));
  return session;
 }

 it("returns no history for unknown paths or empty directories", () => {
  expect(loadEntriesFromFile(join(directory, "missing.jsonl"))).toEqual([]);
  expect(findMostRecentSession(directory)).toBeNull();
  expect(findMostRecentSession(join(directory, "missing"))).toBeNull();
 });

 it("ignores loose JSONL histories without modifying them", async () => {
  const path = join(directory, "legacy.jsonl");
  const content = JSON.stringify({ type: "session", version: 3, id: "legacy", cwd: directory, timestamp: new Date().toISOString() }) + "\n";
  writeFileSync(path, content);
  expect(loadEntriesFromFile(path)).toEqual([]);
  expect(findMostRecentSession(directory)).toBeNull();
  expect(await SessionManager.listAll(directory)).toEqual([]);
  expect(readFileSync(path, "utf8")).toBe(content);
 });

 it("persists setup entries with the first user message, even without an assistant reply", () => {
  const session = SessionManager.create(directory, directory);
  session.appendModelChange("anthropic", "test");
  session.appendThinkingLevelChange("off");
  const path = session.getSessionFile()!;
  expect(loadEntriesFromFile(path)).toEqual([]);
  session.appendMessage(userMsg("first question"));
  expect(loadEntriesFromFile(path).map(entry => entry.type)).toEqual(["session", "model_change", "thinking_level_change", "message"]);
  expect(SessionManager.open(path).buildSessionContext().messages).toHaveLength(1);
 });

 it("preserves earlier entries when appending and reopening", () => {
  const session = create();
  const path = session.getSessionFile()!;
  const original = loadEntriesFromFile(path);
  session.appendCustomEntry("preset-state", { name: "plan" });
  session.appendMessage(assistantMsg("answer"));
  expect(loadEntriesFromFile(path).slice(0, original.length)).toEqual(original);
  expect(SessionManager.open(path).getEntries()).toEqual(session.getEntries());
 });

 it("finds the most recently updated history and filters by cwd", async () => {
  const a = create(join(directory, "project-a"));
  await new Promise(resolve => setTimeout(resolve, 10));
  const b = create(join(directory, "project-b"));
  expect(findMostRecentSession(directory)).toBe(b.getSessionFile());
  expect(findMostRecentSession(directory, a.getCwd())).toBe(a.getSessionFile());
  expect((await SessionManager.list(a.getCwd(), directory)).map(s => s.path)).toEqual([a.getSessionFile()]);
  expect(new Set((await SessionManager.listAll(directory)).map(s => s.path))).toEqual(new Set([a.getSessionFile(), b.getSessionFile()]));
  expect(SessionManager.continueRecent(a.getCwd(), directory).getSessionFile()).toBe(a.getSessionFile());
 });

 it("rejects a cancelled session listing", async () => {
  create();
  const controller = new AbortController();
  const listing = SessionManager.listAll(directory, (_loaded, _total, partial) => {
   if (partial) controller.abort();
  }, controller.signal);
  await expect(listing).rejects.toMatchObject({ name: "AbortError" });
  await expect(SessionManager.listAll(undefined, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
 });
});
