import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";

describe("legacy keybindings loading", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("loads old key names in memory without rewriting the file", () => {
		const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-keybindings-test-"));
		tempDirs.push(agentDir);
		const content = `${JSON.stringify({ selectConfirm: "enter", interrupt: "ctrl+x" }, null, 2)}\n`;
		const configPath = path.join(agentDir, "keybindings.json");
		fs.writeFileSync(configPath, content, "utf-8");

		const keybindings = KeybindingsManager.create(agentDir);

		expect(keybindings.getUserBindings()).toEqual({
			"tui.select.confirm": "enter",
			"app.interrupt": "ctrl+x",
		});
		const effective = keybindings.getEffectiveConfig();
		expect(effective["tui.select.confirm"]).toBe("enter");
		expect(effective["app.interrupt"]).toBe("ctrl+x");
		expect(fs.readFileSync(configPath, "utf-8")).toBe(content);
	});
});
