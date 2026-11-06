# Styling and theme boundaries

## Ownership

- `src/theme.css`: all default palette values, organized by semantic role.
- `src/chat/style.css`: document typography and base chat primitives.
- `src/chat/tree.css`: conversation columns, cards, navigation, diffs and codemode.
- `src/chat/markdown.css`: source syntax token selectors (no HTML rendering).
- `src/style.css`: import entry point, shared scroll areas, app shell and dialogs.

The `chat` directory contains inherited application styles, not a third-party
library. Keep these boundaries while editing; don't create a second component
implementation just to style an empty state. Empty chats use branch-draft cards.

## Colors

Define literal colors only in `theme.css`. Components consume semantic custom
properties (`--status-error`, `--diff-add-background`, etc.), never hex values,
named palette colors or RGB literals. `transparent`, `currentColor` and inherited
values are intentional CSS behavior, not theme palette entries.

Reuse a token when its *meaning* matches, not merely because its current hex
value matches. For example, success status and syntax literals can vary
independently even if the default theme gives them the same color.

For a later theme picker, override the same properties on the document root;
components should not need theme-specific selectors or JavaScript color maps.
Override `color-scheme` too when supplying a light theme. No theme picker or
persistence is implemented yet.

ANSI's standard 16 colors resolve to `--ansi-*` tokens. Explicit 256-color and
true-color output retains the terminal-specified RGB values; those are input
data, not application theme defaults. Source and diff highlighting share the
lowlight tokenizer and `.hljs-*` CSS rules.

## Layout and shared controls

Use `ScrollArea`/`ScrollBar` and `ScrollableTextarea`; don't introduce native
scrollbars or hand-built alternatives. Inline styles are for runtime geometry
and parsed ANSI input, not hardcoded application colors. Keep actual source
whitespace distinct from gutters, padding and other presentation.

Use component classes for component rules. Avoid more-specific overrides when
a rule can be changed at its owner. Consolidate repeated selectors within a
file; do not add `!important` to resolve ordinary cascade conflicts.

## Checks

`npm run lint` includes Stylelint. It rejects literal colors outside the theme,
invalid hex values, duplicate selectors and duplicate declarations.
`npm test` verifies CSS variable defaults/fallbacks and the ANSI theme contract.
Both run through `validate`.

These checks protect palette ownership, not every aspect of cascade design.
The inherited stylesheet split still has cross-file overrides; review those
before changing specificity or moving rules between files.
