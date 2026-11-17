import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { assistantMsg } from "./utilities.ts";

it("uses the last user/assistant timestamp rather than storage update time", async () => {
 const directory = mkdtempSync(join(tmpdir(), "spicy-session-modified-"));
 try {
  const session = SessionManager.create(directory, directory);
  session.appendMessage({ role: "user", content: "hello", timestamp: 1000 });
  session.appendMessage({ ...assistantMsg("reply"), timestamp: 2000 });
  session.appendCustomEntry("later metadata", {});
  const sessions = await SessionManager.list(directory, directory);
  expect(sessions).toHaveLength(1);
  expect(sessions[0].path).toBe(session.getSessionFile());
  expect(sessions[0].modified.getTime()).toBe(2000);
 } finally {
  rmSync(directory, { recursive: true, force: true });
 }
});
