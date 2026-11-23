import { test } from 'vitest';
import assert from 'node:assert/strict';
import { prettyShell } from '../src/pretty-shell.ts';

test('lays out the Bash chain, long options, redirects, and status handling', async () => {
  const expected = [
    'git diff --check &&',
    '    nix develop -c cargo build \\',
    '        --manifest-path bevy-host/Cargo.toml \\',
    '        >/tmp/wibeout-native-rumble-build.log 2>&1 &&',
    '    nix develop -c bash tools/replay-session.sh \\',
    '        --require-match captures/sessions/20261123T041436Z-cVuTcU \\',
    '        >/tmp/wibeout-native-rumble-replay.log 2>&1 &&',
    '    git add bevy-host/src/race_control.rs &&',
    "    git commit -m 'Compute Bevy gamepad rumble from typed motor envelopes'",
    '',
    'rc=$?',
    'tail -4 /tmp/wibeout-native-rumble-build.log',
    'tail -5 /tmp/wibeout-native-rumble-replay.log',
    'exit "$rc"',
  ].join('\n');
  const oneLiner = expected.replace(/ \\\n +|(?<=&&)\n +/g, ' ').replace(/\n+/g, '; ');
  assert.equal(await prettyShell(oneLiner), expected);
});

test('splits real pipes without touching operators inside words', async () => {
  assert.equal(await prettyShell(`printf '%s' 'é && | ;' | cat && echo "$(true; echo ok)"`),
    `printf '%s' 'é && | ;' |\n    cat &&\n    echo "$(true; echo ok)"`);
});

test('adds a blank line after a multiline command before the next command', async () => {
  assert.equal(await prettyShell('echo a | cat; echo b; echo c'), 'echo a |\n    cat\n\necho b\necho c');
});

test('leaves unsupported input unchanged', async () => {
  for (const source of ['echo a &&', 'echo a; # comment\necho b', "cat <<'EOF'\na && b\nEOF", 'if true; then echo yes; fi']) {
    assert.equal(await prettyShell(source), null);
  }
});
