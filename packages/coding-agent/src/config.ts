import { existsSync, readFileSync } from "fs";
import { createRequire } from "module";
import { homedir } from "os";
import { basename, dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { normalizePath } from "./utils/paths.ts";
import { stripBom } from "./utils/text.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Find the package root, ignoring metadata copied into dist/. */
export function findNodePackageDir(startDir: string): string {
	let dir = startDir;
	while (dir !== dirname(dir)) {
		if (existsSync(join(dir, "package.json"))) {
			const parent = dirname(dir);
			if (basename(dir) === "dist" && existsSync(join(parent, "package.json"))) return parent;
			return dir;
		}
		dir = dirname(dir);
	}
	return startDir;
}

export function getPackageDir(): string {
	const envDir = process.env.PI_PACKAGE_DIR;
	if (envDir) return normalizePath(envDir);
	return findNodePackageDir(__dirname);
}

export function getThemesDir(): string {
	const packageDir = getPackageDir();
	const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
	return join(packageDir, srcOrDist, "modes", "interactive", "theme");
}

export function getPackageJsonPath(): string {
	return join(getPackageDir(), "package.json");
}

export function getReadmePath(): string {
	return resolve(join(getPackageDir(), "README.md"));
}

export function getDocsPath(): string {
	return resolve(join(getPackageDir(), "docs"));
}

let quickJSWasmPath: string | undefined;

export function getQuickJSWasmPath(): string {
	quickJSWasmPath ??= createRequire(import.meta.url).resolve("quickjs-wasi/quickjs.wasm");
	return quickJSWasmPath;
}

interface PackageJson {
	name?: string;
	version?: string;
	piConfig?: {
		name?: string;
		configDir?: string;
	};
}

let pkg: PackageJson = {};
try {
	pkg = JSON.parse(stripBom(readFileSync(getPackageJsonPath(), "utf-8"))) as PackageJson;
} catch (e: unknown) {
	const err = e as NodeJS.ErrnoException;
	if (err.code !== "ENOENT") throw e;
}

const piConfigName: string | undefined = pkg.piConfig?.name;
export const PACKAGE_NAME: string = pkg.name || "@earendil-works/pi-coding-agent";
export const APP_NAME: string = piConfigName || "pi";
export const APP_TITLE: string = piConfigName ? APP_NAME : "π";
export const CONFIG_DIR_NAME: string = pkg.piConfig?.configDir || ".pi";
export const VERSION: string = pkg.version || "0.0.0";
export const ENV_AGENT_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`;
export const ENV_SESSION_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_SESSION_DIR`;

export function expandTildePath(path: string): string {
	return normalizePath(path);
}

export function getAgentDir(): string {
	const envDir = process.env[ENV_AGENT_DIR];
	return envDir ? expandTildePath(envDir) : join(homedir(), CONFIG_DIR_NAME, "agent");
}

export function getCustomThemesDir(): string {
	return join(getAgentDir(), "themes");
}

export function getModelsPath(): string {
	return join(getAgentDir(), "models.json");
}

export function getAuthPath(): string {
	return join(getAgentDir(), "auth.json");
}

export function getSettingsPath(): string {
	return join(getAgentDir(), "settings.json");
}

export function getToolsDir(): string {
	return join(getAgentDir(), "tools");
}

export function getBinDir(): string {
	return join(getAgentDir(), "bin");
}

export function getPromptsDir(): string {
	return join(getAgentDir(), "prompts");
}

export function getSessionsDir(): string {
	return join(getAgentDir(), "sessions");
}

export function getDebugLogPath(): string {
	return join(getAgentDir(), `${APP_NAME}-debug.log`);
}
