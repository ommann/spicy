import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { getBinDir } from "../config.ts";

const TOOL_NAMES = { fd: ["fd", "fdfind"], rg: ["rg"] } as const;

// Use existing binaries only; never download or install tools.
export function getToolPath(tool: "fd" | "rg"): string | null {
	const localPath = join(getBinDir(), tool);
	if (existsSync(localPath)) return localPath;
	for (const name of TOOL_NAMES[tool]) {
		try {
			const result = spawnSync(name, ["--version"], { stdio: "pipe" });
			if (!result.error && result.status === 0) return name;
		} catch {
			// Try the next installed command name.
		}
	}
	return null;
}

export interface ToolStatus {
	type: "info" | "warning";
	message: string;
}

export async function ensureTool(
	tool: "fd" | "rg",
	onStatus?: (status: ToolStatus) => void,
): Promise<string | undefined> {
	const path = getToolPath(tool);
	if (path) return path;
	onStatus?.({ type: "warning", message: `${tool} not found. Install it locally and add it to PATH.` });
	return undefined;
}
