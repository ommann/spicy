import type { NativeClipboard } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { copyToClipboard, readClipboardText } from "../src/utils/clipboard.ts";

const mocks = vi.hoisted(() => ({
	getText: vi.fn<NativeClipboard["getText"]>(),
	getNativeClipboard: vi.fn<() => NativeClipboard | undefined>(),
	command:
		vi.fn<
			(
				command: string,
				args: readonly string[],
				options?: { input?: string; timeoutMs?: number },
			) => Promise<Buffer | undefined>
		>(),
}));
vi.mock("@earendil-works/pi-tui", () => ({ getNativeClipboard: mocks.getNativeClipboard }));
vi.mock("../src/utils/clipboard-command.ts", () => ({ runClipboardCommand: mocks.command }));

let output: ReturnType<typeof vi.spyOn>;
let writes: string[];
beforeEach(() => {
	vi.resetAllMocks();
	for (const name of [
		"SSH_CONNECTION",
		"SSH_CLIENT",
		"MOSH_CONNECTION",
		"WAYLAND_DISPLAY",
		"DISPLAY",
		"PI_CLIPBOARD_OSC52",
	])
		vi.stubEnv(name, "");
	mocks.getNativeClipboard.mockReturnValue({ getText: mocks.getText, getImage: async () => null });
	mocks.getText.mockResolvedValue(null);
	mocks.command.mockResolvedValue(undefined);
	writes = [];
	const originalWrite = process.stdout.write.bind(process.stdout);
	output = vi.spyOn(process.stdout, "write").mockImplementation(((
		...args: Parameters<typeof process.stdout.write>
	) => {
		if (typeof args[0] === "string" && args[0].startsWith("\x1b]52;c;")) {
			writes.push(args[0]);
			return true;
		}
		return originalWrite(...args);
	}) as typeof process.stdout.write);
});
afterEach(() => {
	output.mockRestore();
	vi.unstubAllEnvs();
});

describe("Linux clipboard text", () => {
	test("uses native text and catches rejected reads", async () => {
		mocks.getText.mockResolvedValue("text");
		expect(await readClipboardText()).toBe("text");
		mocks.getText.mockRejectedValue(new Error("unavailable"));
		expect(await readClipboardText()).toBeNull();
	});

	for (const [env, command] of [
		["WAYLAND_DISPLAY", "wl-paste"],
		["DISPLAY", "xclip"],
		["DISPLAY", "xsel"],
	] as const) {
		test.each(["text", ""])(`${command}: result %j stops fallback`, async (text) => {
			vi.stubEnv(env, "1");
			mocks.command.mockImplementation(async (name) => (name === command ? Buffer.from(text) : undefined));
			expect(await readClipboardText()).toBe(text || null);
			expect(mocks.getNativeClipboard).not.toHaveBeenCalled();
		});
	}

	test("falls back from Wayland through X11 tools to native X11", async () => {
		vi.stubEnv("WAYLAND_DISPLAY", "1");
		vi.stubEnv("DISPLAY", ":0");
		mocks.getText.mockResolvedValue("native");
		expect(await readClipboardText()).toBe("native");
		expect(mocks.command.mock.calls.map(([name]) => name)).toEqual(["wl-paste", "xclip", "xsel"]);
	});
});

describe("Linux clipboard writes", () => {
	test("tries Wayland then X11 writers", async () => {
		vi.stubEnv("WAYLAND_DISPLAY", "1");
		vi.stubEnv("DISPLAY", ":0");
		mocks.command.mockImplementation(async (name) => (name === "xsel" ? Buffer.alloc(0) : undefined));
		await copyToClipboard("hello");
		expect(mocks.command.mock.calls.map(([name]) => name)).toEqual(["wl-copy", "xclip", "xsel"]);
		expect(writes).toHaveLength(0);
	});

	test("reports desktop clipboard failure rather than unverified OSC 52 success", async () => {
		vi.stubEnv("DISPLAY", ":0");
		await expect(copyToClipboard("hello")).rejects.toThrow("install `xclip` or `xsel`");
		expect(writes).toHaveLength(0);
	});

	test("reports Wayland clipboard failure", async () => {
		vi.stubEnv("WAYLAND_DISPLAY", "1");
		await expect(copyToClipboard("hello")).rejects.toThrow("install `wl-clipboard`");
	});

	test("headless sessions emit OSC 52", async () => {
		await copyToClipboard("hello");
		expect(writes).toEqual([`\x1b]52;c;${Buffer.from("hello").toString("base64")}\x07`]);
	});

	test.each(["SSH_CONNECTION", "SSH_CLIENT", "MOSH_CONNECTION", "PI_CLIPBOARD_OSC52"])(
		"%s emits OSC 52 after the desktop write",
		async (name) => {
			vi.stubEnv(name, "1");
			vi.stubEnv("DISPLAY", ":0");
			mocks.command.mockResolvedValue(Buffer.alloc(0));
			await copyToClipboard("hello");
			expect(mocks.command).toHaveBeenCalledWith("xclip", ["-selection", "clipboard"], {
				input: "hello",
				timeoutMs: 5000,
			});
			expect(writes).toHaveLength(1);
		},
	);

	test("rejects oversized headless clipboard writes", async () => {
		await expect(copyToClipboard("x".repeat(100_000))).rejects.toThrow("OSC 52 size limit");
		expect(writes).toHaveLength(0);
	});
});
