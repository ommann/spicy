import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface SearchPreview { command: string; output: string }

/** A separate, UI-only channel. Never replay the surrounding shell command. */
export async function createRgPreview() {
	const directory = await mkdtemp(join(tmpdir(), 'pi-rg-preview-'));
	const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
	const prefix = `
rg() {
  local preview_dir preview_status preview_arg
  preview_dir=$(mktemp -d ${quote(directory)}/search.XXXXXXXX) || { command rg "$@"; return $?; }
  printf '%q ' rg "$@" > "$preview_dir/command"
  # Preserve ripgrep's automatic stdin detection for terminals and files.
  if [ -p /dev/stdin ] || [ -S /dev/stdin ]; then
    if command rg "$@" < <(head -c 1048577 | tee "$preview_dir/stdin"; cat); then
      preview_status=0
    else
      preview_status=$?
    fi
  else
    if command rg "$@"; then preview_status=0; else preview_status=$?; fi
    [ /dev/stdin -ef /dev/null ] || return "$preview_status"
    : > "$preview_dir/stdin"
  fi
  # Unsupported output modes pass through without a preview.
  for preview_arg in "$@"; do
    case "$preview_arg" in
      --) break ;;
      --files|--files-with-matches|--files-without-match|--count*|--quiet|--json|--help|--version|--pre*|--hostname-bin*|--replace*) return "$preview_status" ;;
      --*) ;;
      -?*) case "$preview_arg" in *[lcq0r]*) return "$preview_status" ;; esac ;;
    esac
  done
  if command -v delta >/dev/null 2>&1 && [ -f "$preview_dir/stdin" ] && [ "$(wc -c < "$preview_dir/stdin")" -le 1048576 ]; then
    # Isolate preview failures and shell options from the original command.
    (set +e; set +u; command rg --json "$@" < "$preview_dir/stdin" 2>/dev/null |
      head -c 2097152 | command delta --paging=never --width=10000 2>/dev/null |
      head -c 2097152 > "$preview_dir/output") || :
  fi
  return "$preview_status"
}
`;
	let finished: Promise<SearchPreview[]> | undefined;
	const collect = async (): Promise<SearchPreview[]> => {
			try {
				const previews: SearchPreview[] = [];
				for (const name of (await readdir(directory)).sort()) {
					try {
						const path = join(directory, name);
						const output = await readFile(join(path, 'output'), 'utf8');
						if (output) previews.push({ command: await readFile(join(path, 'command'), 'utf8'), output });
					} catch { /* Missing delta, unsupported modes, or no matches. */ }
				}
				return previews;
			} finally { await rm(directory, { recursive: true, force: true }); }
	};
	return { prefix, finish: () => finished ??= collect() };
}
