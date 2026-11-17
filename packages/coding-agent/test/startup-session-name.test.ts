import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadEntriesFromFile } from '../src/core/session-manager.ts';
import { writeStoredHistory } from '../src/core/session-storage.ts';
import { ENV_AGENT_DIR } from "../src/config.ts";

const cliPath = resolve(__dirname, "../src/cli.ts");
// --import takes a module specifier, not a filesystem path.
const sourceResolverUrl = pathToFileURL(resolve(__dirname, "../src/experimental/source-resolver.ts")).href;
const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-startup-session-name-"));
	tempDirs.push(dir);
	return dir;
}

interface CliDirs {
	agentDir: string;
	projectDir: string;
	sessionFile: string;
}

interface CliResult {
	code: number | null;
	signal: NodeJS.Signals | null;
	stderr: string;
}

function createSessionFile(projectDir: string, sessionFile: string): void {
	const timestamp = new Date().toISOString();
	writeStoredHistory(sessionFile, [
		{ type: "session", version: 3, id: "existing-session", timestamp, cwd: projectDir },
		{
			type: "message",
			id: "user-1",
			parentId: null,
			timestamp,
			message: {
				role: "user",
				content: "hello",
				timestamp: Date.now(),
			},
		},
	]);
}

function readSessionInfoNames(sessionFile: string): string[] {
	return loadEntriesFromFile(sessionFile)
		.filter((entry) => entry.type === "session_info")
		.map((entry) => entry.name ?? "");
}

async function runCli(args: string[], dirs: CliDirs): Promise<CliResult> {
	let stderr = "";
	const child = spawn(process.execPath, ["--import", sourceResolverUrl, cliPath, ...args], {
		cwd: dirs.projectDir,
		env: {
			...process.env,
			[ENV_AGENT_DIR]: dirs.agentDir,
			PI_OFFLINE: "1",
		},
		stdio: ["ignore", "ignore", "pipe"],
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk.toString();
	});

	return new Promise((resolvePromise, reject) => {
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
		}, 10_000);
		child.on("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.on("close", (code, signal) => {
			clearTimeout(timeout);
			resolvePromise({ code, signal, stderr });
		});
	});
}

function setup(): CliDirs {
	const tempRoot = createTempDir();
	const dirs = {
		agentDir: join(tempRoot, "agent"),
		projectDir: join(tempRoot, "project"),
		sessionFile: join(tempRoot, "session.session"),
	};
	mkdirSync(dirs.agentDir, { recursive: true });
	mkdirSync(dirs.projectDir, { recursive: true });
	createSessionFile(dirs.projectDir, dirs.sessionFile);
	return dirs;
}

describe("startup session name", () => {
	it("sets --name on the selected session before runtime model validation", async () => {
		const dirs = setup();
		const result = await runCli(
			["--session", dirs.sessionFile, "--name", "  CLI Named Session  ", "--model", "missing-model", "-p", "hi"],
			dirs,
		);

		expect(result.code).toBe(1);
		expect(result.signal).toBeNull();
		expect(readSessionInfoNames(dirs.sessionFile)).toEqual(["CLI Named Session"]);
	});
});
