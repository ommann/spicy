import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { normalizePath, resolvePath } from "../../utils/paths.ts";

export async function pathExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

export function expandPath(filePath: string): string {
	return normalizePath(filePath, { normalizeUnicodeSpaces: true, stripAtPrefix: true });
}

/** Resolve a path relative to cwd, including ~ expansion and absolute paths. */
export function resolveToCwd(filePath: string, cwd: string): string {
	return resolvePath(filePath, cwd, { normalizeUnicodeSpaces: true, stripAtPrefix: true });
}

export function resolveReadPath(filePath: string, cwd: string): string {
	return resolveToCwd(filePath, cwd);
}

export async function resolveReadPathAsync(filePath: string, cwd: string): Promise<string> {
	return resolveToCwd(filePath, cwd);
}
