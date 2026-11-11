import test from 'node:test';
import assert from 'node:assert/strict';
import { prettifyCommand } from '../src/prettify-command.mjs';

test('prettifies multiple Node heredocs without changing surrounding shell', async () => {
  const command = "node <<'JS'\nconst x={a:1};console.log(x);\nJS\necho untouched\nnode <<'NODE'\nconst y=[1,2];\nNODE";
  const formatted = await prettifyCommand(command);
  assert.ok(formatted.includes('const x = { a: 1 };\nconsole.log(x);'));
  assert.ok(formatted.includes("JS\necho untouched\nnode <<'NODE'\n"));
  assert.ok(formatted.endsWith('const y = [1, 2];\nNODE'));
});

test('invalid, incomplete, and Python heredocs stay unchanged', async () => {
  for (const command of ["node <<'JS'\nconst = ;\nJS", "node <<'JS'\nconst x=1;", "python3 <<'PY'\nprint('hi')\nPY"]) {
    assert.equal(await prettifyCommand(command), null);
  }
});
