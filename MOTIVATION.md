# Motivation

I hate the fact that Pi invalidates the cache with unattended prefix changes.

This project is called Spicy. It combines this Pi fork with my frontend from
`/home/olli/Development/ollim`. I want control over the LLM and harness process,
not more patches around Pi's behavior.

The MCP work burned me out. Leave it aside for now. Start from ollim commit
`348b353329ebfb983583dff892c9ec348aed44e5`, before MCP Apps was added.
Keep the original ollim checkout and its uncommitted work untouched.

First steps:
- Bring that frontend into `apps/web/` here.
- Replace the npm-bundled backend with this fork's local source.
- Keep the existing UI. Removing Pi's TUI is not a priority.
- Consolidate the workspace instead of bolting another standalone project onto it.

Work started, not finished:
- The pre-MCP frontend snapshot is copied into `apps/web/`.
- Its bridge and package scripts were changed to use this fork's source resolver.
- Root `package.json` was renamed to `spicy` and given a web dev command.
- Dependency installation, lockfile refresh, testing, and checks are still pending.
- The imported package manifest still needs proper workspace consolidation.

Keep work and conversation small. Targeted reads and edits, short output.
No broad scans, huge file dumps, unsolicited rewrites, or elaborate prose.
