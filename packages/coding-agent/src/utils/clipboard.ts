import { getNativeClipboard } from "@earendil-works/pi-tui";
import { runClipboardCommand } from "./clipboard-command.ts";

const MAX_OSC52_ENCODED_LENGTH = 100_000;

function isRemoteSession(env: NodeJS.ProcessEnv): boolean {
	return Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.MOSH_CONNECTION || env.PI_CLIPBOARD_OSC52 === "1");
}

function emitOsc52(text: string): boolean {
	const encoded = Buffer.from(text).toString("base64");
	if (encoded.length > MAX_OSC52_ENCODED_LENGTH) return false;
	process.stdout.write(`\x1b]52;c;${encoded}\x07`);
	return true;
}

/** Read plain text from the system clipboard. */
export async function readClipboardText(): Promise<string | null> {
	const commands: [string, string[]][] = [];
	if (process.env.WAYLAND_DISPLAY) commands.push(["wl-paste", ["--no-newline", "--type", "text"]]);
	if (process.env.DISPLAY) {
		commands.push(["xclip", ["-selection", "clipboard", "-out"]], ["xsel", ["--clipboard", "--output"]]);
	}
	for (const [command, args] of commands) {
		const bytes = await runClipboardCommand(command, args, { timeoutMs: 5000 });
		if (bytes !== undefined) return bytes.toString("utf8") || null;
	}
	try {
		return (await getNativeClipboard()?.getText()) || null;
	} catch {
		return null;
	}
}

/** Read file paths from the native clipboard. */
export async function readClipboardFilePaths(): Promise<string[] | null> {
	const paths = await getNativeClipboard()?.getFilePaths?.();
	return paths?.length ? paths : null;
}

export async function copyToClipboard(text: string): Promise<void> {
	const env = process.env;
	let copied = false;
	const commands: [string, string[]][] = [];
	if (env.WAYLAND_DISPLAY) commands.push(["wl-copy", []]);
	if (env.DISPLAY) {
		commands.push(["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]);
	}
	// Direct writes precede OSC 52 so the terminal cannot race the clipboard owner.
	for (const [command, args] of commands) {
		if ((await runClipboardCommand(command, args, { input: text, timeoutMs: 5000 })) !== undefined) {
			copied = true;
			break;
		}
	}
	const headless = !env.DISPLAY && !env.WAYLAND_DISPLAY;
	let oversized = false;
	if (isRemoteSession(env) || (!copied && headless)) {
		if (emitOsc52(text)) copied = true;
		else oversized = true;
	}
	if (copied) return;
	if (oversized) throw new Error("Clipboard unavailable: text exceeds the OSC 52 size limit");
	if (env.WAYLAND_DISPLAY) {
		throw new Error("Clipboard unavailable: install `wl-clipboard` (`wl-copy`) or check Wayland access");
	}
	if (env.DISPLAY) {
		throw new Error("Clipboard unavailable: install `xclip` or `xsel`, or check X11 access");
	}
	throw new Error("Clipboard unavailable");
}
