import { existsSync } from "node:fs";
import { delimiter } from "node:path";
import { spawnSync } from "child_process";
import { getBinDir } from "../config.ts";

export interface ShellConfig {
	shell: string;
	args: string[];
}

/** Resolve an explicit shell, /bin/bash, bash on PATH, or sh. */
export function getShellConfig(customShellPath?: string): ShellConfig {
	if (customShellPath) {
		if (!existsSync(customShellPath)) throw new Error(`Custom shell path not found: ${customShellPath}`);
		return { shell: customShellPath, args: ["-c"] };
	}
	if (existsSync("/bin/bash")) return { shell: "/bin/bash", args: ["-c"] };
	try {
		const result = spawnSync("which", ["bash"], { encoding: "utf-8", timeout: 5000 });
		const shell = result.stdout?.trim().split("\n")[0];
		if (result.status === 0 && shell) return { shell, args: ["-c"] };
	} catch {
		// Fall back to the POSIX shell.
	}
	return { shell: "sh", args: ["-c"] };
}

export function getShellEnv(): NodeJS.ProcessEnv {
	const binDir = getBinDir();
	const currentPath = process.env.PATH ?? "";
	const pathEntries = currentPath.split(delimiter).filter(Boolean);
	return {
		...process.env,
		PATH: pathEntries.includes(binDir) ? currentPath : [binDir, currentPath].filter(Boolean).join(delimiter),
	};
}

/** Strip binary control characters that cannot safely be displayed. */
export function sanitizeBinaryOutput(str: string): string {
	return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFF9-\uFFFB]/g, "");
}

const trackedDetachedChildPids = new Set<number>();

export function trackDetachedChildPid(pid: number): void {
	trackedDetachedChildPids.add(pid);
}

export function untrackDetachedChildPid(pid: number): void {
	trackedDetachedChildPids.delete(pid);
}

export function killTrackedDetachedChildren(): void {
	for (const pid of trackedDetachedChildPids) killProcessTree(pid);
	trackedDetachedChildPids.clear();
}

/** Kill the process group, falling back to the individual child. */
export function killProcessTree(pid: number): void {
	try {
		process.kill(-pid, "SIGKILL");
	} catch {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// Process already exited.
		}
	}
}
