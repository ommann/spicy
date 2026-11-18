import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRgPreview } from '../src/core/tools/rg-preview.ts';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function run(command: string) {
	const directory = await mkdtemp(join(tmpdir(), 'rg-preview-test-'));
	directories.push(directory);
	// Echo delta's JSON input to make the side channel deterministic without delta installed.
	await writeFile(join(directory, 'delta'), '#!/bin/sh\ncat\n');
	await chmod(join(directory, 'delta'), 0o755);
	await writeFile(join(directory, 'sample.ts'), 'const needle = 1;\nconst other = 2;\nconst needleAgain = 3;\n');
	const env = { ...process.env, PATH: `${directory}:${process.env.PATH}` };
	const original = spawnSync('bash', ['-c', command], { cwd: directory, env, encoding: 'utf8' });
	const preview = await createRgPreview();
	try {
		const wrapped = spawnSync('bash', ['-c', `${preview.prefix}\n${command}`], { cwd: directory, env, encoding: 'utf8' });
		expect(wrapped.status).toBe(original.status);
		expect(wrapped.stdout).toBe(original.stdout);
		expect(wrapped.stderr).toBe(original.stderr);
		expect(wrapped.status).toBe(original.status);
		const previews = await preview.finish();
		expect(await preview.finish()).toBe(previews);
		return previews;
	} finally { await preview.finish(); }
}

describe('rg search preview side channel', () => {
	it('preserves file search output and records JSON separately', async () => {
		const previews = await run("rg -n needle sample.ts");
		expect(previews).toHaveLength(1);
		expect(previews[0].output).toContain('"type":"match"');
	});
	it('preserves stdin and downstream filtering', async () => {
		const previews = await run("printf 'needle\\nother\\nneedle\\n' | rg -n needle | head -1");
		expect(previews).toHaveLength(1);
		expect(previews[0].output.match(/"type":"match"/g)).toHaveLength(2);
	});
	it('passes through filename listing without a preview', async () => {
		expect(await run('rg --files | sort')).toEqual([]);
	});
	it('preserves no-match exit status', async () => {
		const previews = await run('rg nonexistent sample.ts');
		expect(previews.every(preview => !preview.output.includes('"type":"match"'))).toBe(true);
	});
	it('preserves the end-of-options marker', async () => {
		expect(await run('rg -n -- needle sample.ts')).toHaveLength(1);
	});
});
