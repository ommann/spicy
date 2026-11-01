import { spawn } from "node:child_process";

/** Open a URL or file using the Linux desktop handler, without invoking a shell. */
export function openBrowser(target: string): void {
	// Opening a browser is best-effort; callers still display the URL.
	spawn("xdg-open", [target], { stdio: "ignore", detached: true })
		.on("error", () => {})
		.unref();
}
