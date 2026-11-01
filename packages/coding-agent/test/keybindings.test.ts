import { describe, expect, it } from "vitest";
import { KEYBINDINGS } from "../src/core/keybindings.ts";

describe("Linux keybinding defaults", () => {
	it("keeps terminal editing and application shortcuts distinct", () => {
		expect(KEYBINDINGS["app.clipboard.pasteImage"].defaultKeys).toBe("ctrl+v");
		expect(KEYBINDINGS["tui.altScreen.search"].defaultKeys).toBe("ctrl+shift+f");
		expect(KEYBINDINGS["app.message.followUp"].defaultKeys).toBe("alt+enter");
		expect(KEYBINDINGS["app.model.cycleBackward"].defaultKeys).toBe("shift+ctrl+p");
		expect(KEYBINDINGS["tui.editor.undo"].defaultKeys).toBe("ctrl+-");
		expect(KEYBINDINGS["tui.altScreen.previousPrompt"].defaultKeys).toEqual(["ctrl+shift+up", "ctrl+up"]);
		expect(KEYBINDINGS["tui.altScreen.nextPrompt"].defaultKeys).toEqual(["ctrl+shift+down", "ctrl+down"]);
		expect(KEYBINDINGS["app.message.dequeue"].defaultKeys).toBe("alt+up");
	});
});
