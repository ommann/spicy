import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';

async function styles(directory = 'src') {
  const files = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(files.map(file => {
    const name = path.join(directory, file.name);
    return file.isDirectory() ? styles(name) : file.name.endsWith('.css') ? [name] : [];
  }))).flat();
}

test('CSS variables have defaults or explicit fallbacks', async () => {
  const roots = await Promise.all((await styles()).map(async file => postcss.parse(await readFile(file, 'utf8'), { from: file })));
  const defined = new Set();
  for (const root of roots) root.walkDecls(declaration => {
    if (declaration.prop.startsWith('--')) defined.add(declaration.prop);
  });
  for (const root of roots) root.walkDecls(declaration => {
    for (const match of declaration.value.matchAll(/var\((--[\w-]+)\s*([,)])/g)) {
      assert.ok(defined.has(match[1]) || match[2] === ',', `${declaration.source.input.file}: ${match[1]} needs a default or fallback`);
    }
  });
});

test('theme loads before component styles and defines the complete ANSI palette', async () => {
  const css = await readFile('src/style.css', 'utf8');
  assert.ok(css.startsWith('@import "./theme.css";'));
  const theme = postcss.parse(await readFile('src/theme.css', 'utf8'));
  const tokens = new Set();
  theme.walkDecls(declaration => tokens.add(declaration.prop));
  for (const name of ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']) {
    assert.ok(tokens.has(`--ansi-${name}`));
    assert.ok(tokens.has(`--ansi-bright-${name}`));
  }
});
