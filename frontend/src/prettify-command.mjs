// Format only direct Node heredocs; leave shell commands and delimiters untouched.
export async function prettifyCommand(command) {
  const [{ format }, babel, estree] = await Promise.all([
    import('prettier/standalone'), import('prettier/plugins/babel'), import('prettier/plugins/estree'),
  ]);
  const lines = command.match(/[^\n]*\n|[^\n]+$/g) || [];
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const header = /(?:^|[;&|]\s*)\s*node(?:js)?(?:[ \t]+--input-type=module)?[ \t]+<<[ \t]*(?:'([A-Za-z_]\w*)'|"([A-Za-z_]\w*)"|([A-Za-z_]\w*))[ \t]*\r?\n$/.exec(lines[i]);
    if (!header) continue;
    const marker = header[1] || header[2] || header[3];
    let end = i + 1;
    while (end < lines.length && lines[end].replace(/\r?\n$/, '') !== marker) end++;
    if (end === lines.length) continue;
    const body = lines.slice(i + 1, end).join('');
    try {
      const formatted = await format(body, { parser: 'babel', plugins: [babel.default, estree.default] });
      // Do not introduce a premature heredoc terminator.
      if (formatted.split('\n').includes(marker)) continue;
      if (formatted !== body) changed = true;
      lines.splice(i + 1, end - i - 1, formatted);
      i += 2;
    } catch { i = end; /* Invalid or unsupported code stays exactly as recorded. */ }
  }
  return changed ? lines.join('') : null;
}

export const canPrettifyCommand = command => /(?:^|[;&|]\s*)\s*node(?:js)?(?:[ \t]+--input-type=module)?[ \t]+<<[ \t]*['"]?[A-Za-z_]\w*/m.test(command);
