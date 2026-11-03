import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { SourceInfo } from "./source-info.ts";

/** Theme package data, without terminal rendering or capability detection. */
export interface ThemeResource {
	name: string;
	sourcePath: string;
	sourceInfo?: SourceInfo;
	[key: string]: unknown;
}

export function loadThemeFromPath(sourcePath: string): ThemeResource {
	const data: unknown = JSON.parse(readFileSync(sourcePath, "utf8"));
	if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid theme resource");
	const values = data as Record<string, unknown>;
	return {
		...values,
		name: typeof values.name === "string" ? values.name : basename(sourcePath, ".json"),
		sourcePath,
	};
}
