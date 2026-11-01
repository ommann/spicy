import type { NativeClipboard } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { readClipboardImage } from "../src/utils/clipboard-image.ts";

const mocks = vi.hoisted(() => ({
	command: vi.fn<(command: string, args: string[], options?: unknown) => Promise<Buffer | undefined>>(),
	getImage: vi.fn<NativeClipboard["getImage"]>(),
	getNativeClipboard: vi.fn<() => NativeClipboard | undefined>(),
}));
vi.mock("../src/utils/clipboard-command.ts", () => ({ runClipboardCommand: mocks.command }));
vi.mock("@earendil-works/pi-tui", () => ({ getNativeClipboard: mocks.getNativeClipboard }));
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

describe("Linux clipboard images", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.command.mockResolvedValue(undefined);
		mocks.getImage.mockResolvedValue(png);
		mocks.getNativeClipboard.mockReturnValue({ getText: async () => null, getImage: mocks.getImage });
	});

	for (const [command, env] of [
		["wl-paste", { WAYLAND_DISPLAY: "1", DISPLAY: ":0" }],
		["xclip", { DISPLAY: ":0" }],
	] as const) {
		test.each([true, false])(`${command}: advertised image present=%s stops fallback`, async (present) => {
			mocks.command.mockImplementation(async (name, args) => {
				expect(name).toBe(command);
				const listing = args.includes("--list-types") || args.includes("TARGETS");
				return listing ? Buffer.from(present ? "text/plain\nimage/png\n" : "text/plain\n") : png;
			});
			expect(await readClipboardImage({ env })).toEqual(present ? { bytes: png, mimeType: "image/png" } : null);
			expect(mocks.command).toHaveBeenCalledTimes(present ? 2 : 1);
			expect(mocks.getNativeClipboard).not.toHaveBeenCalled();
		});
	}

	test("falls back from unavailable Wayland to X11", async () => {
		mocks.command.mockImplementation(async (name, args) => {
			if (name === "wl-paste") return undefined;
			return args.includes("TARGETS") ? Buffer.from("image/png\n") : png;
		});
		expect(await readClipboardImage({ env: { WAYLAND_DISPLAY: "1" } })).toEqual({
			bytes: png,
			mimeType: "image/png",
		});
		expect(mocks.getNativeClipboard).not.toHaveBeenCalled();
	});

	test("does not probe unadvertised image formats", async () => {
		mocks.getImage.mockResolvedValue(null);
		mocks.command.mockImplementation(async (_name, args) =>
			args.includes("TARGETS") ? Buffer.from("image/png\n") : undefined,
		);
		expect(await readClipboardImage({ env: { DISPLAY: ":0" } })).toBeNull();
		expect(mocks.command.mock.calls.map(([, args]) => args[3])).toEqual(["TARGETS", "image/png"]);
	});

	test.each([png, null, new Uint8Array()])("uses native X11 fallback: %j", async (bytes) => {
		mocks.getImage.mockResolvedValue(bytes);
		expect(await readClipboardImage({ env: {} })).toEqual(bytes?.length ? { bytes, mimeType: "image/png" } : null);
		expect(mocks.getImage).toHaveBeenCalledOnce();
	});

	test("returns null without a native helper", async () => {
		mocks.getNativeClipboard.mockReturnValue(undefined);
		expect(await readClipboardImage({ env: {} })).toBeNull();
	});

	test("propagates native transfer errors", async () => {
		const error = new Error("Native clipboard operation failed");
		mocks.getImage.mockRejectedValue(error);
		await expect(readClipboardImage({ env: { WAYLAND_DISPLAY: "1" } })).rejects.toBe(error);
		expect(mocks.command.mock.calls.map(([name]) => name)).toEqual(["wl-paste", "xclip"]);
	});
});
