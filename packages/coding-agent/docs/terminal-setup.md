# Configure your terminal

Most modern terminals work with Pi without additional setup. Use this page when modified keys, scrolling, links, images, colors, or input-method editor (IME) positioning do not behave as expected.

Pi uses extended-key protocols so terminals can distinguish combinations such as `Shift+Enter` and `Alt+Enter` from plain `Enter`. Terminal proxies, multiplexers, and built-in IDE terminals can change or discard that information.

## Troubleshooting

| Symptom | Start here |
|---|---|
| `Shift+Enter` submits instead of inserting a line | Your terminal's section below; for tmux, see [Run Pi in tmux](tmux.md) |
| Links work but show no hover preview | [Ghostty](#ghostty) |
| Inline images or colors are not detected | [Override detected capabilities](#override-detected-capabilities) |
| An IME candidate window appears in the wrong place | [WezTerm](#wezterm) or [IntelliJ IDEA](#intellij-idea-integrated-terminal) |
| Modified keys fail only inside tmux | [Run Pi in tmux](tmux.md) |

Use `/hotkeys` to inspect Pi's active shortcuts. See [Keybindings](keybindings.md) to change them.

## Kitty

Kitty supports the required keyboard protocol without additional configuration.

## Ghostty

Add this mapping to Ghostty's configuration if `Alt+Backspace` does not work:

```text
keybind = alt+backspace=text:\x1b\x7f
```

The configuration file is `~/.config/ghostty/config`.

Older Claude Code configurations may contain:

```text
keybind = shift+enter=text:\n
```

This sends a raw linefeed, which Pi cannot distinguish from `Ctrl+J`. Remove the mapping if an older Claude Code installation is the only reason you added it. Pi already binds `Ctrl+J` as a newline alternative, so the mapping may appear to work while still preventing Pi and tmux from receiving a real `Shift+Enter` event.

### Open links in fullscreen mode

Links remain clickable in fullscreen mode, but Ghostty does not show its normal hover underline or URL preview while Pi captures mouse input. Hold `Shift+Ctrl` to use Ghostty's native link handling.

## WezTerm

WezTerm normally reports `Shift+Enter` through xterm extended keys. To enable the Kitty keyboard protocol explicitly, create `~/.wezterm.lua`:

```lua
local wezterm = require 'wezterm'
local config = wezterm.config_builder()
config.enable_kitty_keyboard = true
return config
```

### Position an IME candidate window

If CJK IME candidates do not follow Pi's text cursor, show the hardware cursor:

```bash
export PI_HARDWARE_CURSOR=1
pi
```

You can instead set `showHardwareCursor` to `true` in Pi settings.

## Alacritty

Alacritty normally reports `Shift+Enter`. Use a version with extended-key support for modified Enter shortcuts.

## VS Code integrated terminal

VS Code 1.109.5 and newer enable the Kitty keyboard protocol in the integrated terminal by default.

For an older version, add a `Shift+Enter` terminal binding to `keybindings.json`:

```json
{
  "key": "shift+enter",
  "command": "workbench.action.terminal.sendSequence",
  "args": { "text": "\u001b[13;2u" },
  "when": "terminalFocus"
}
```

The user `keybindings.json` file is normally located at `~/.config/Code/User/keybindings.json`.

## Zed integrated terminal

Add these bindings to Zed's `keymap.json`:

```json
{
  "context": "Terminal",
  "bindings": {
    "shift-enter": ["terminal::SendText", "\u001b[13;2u"],
    "ctrl--": ["terminal::SendText", "\u001b[45;5u"],
    "ctrl-alt-]": ["terminal::SendText", "\u001b[93;7u"]
  }
}
```

## xfce4-terminal and Terminator

These terminals cannot reliably distinguish modified Enter keys from plain `Enter`. Custom bindings such as `Ctrl+Enter` or `Shift+Enter` therefore may not work.

Use a terminal with modern extended-key support when you need those shortcuts, such as Kitty, Ghostty, WezTerm, or a compatible Alacritty build.

## IntelliJ IDEA integrated terminal

IntelliJ IDEA's built-in terminal cannot reliably distinguish `Shift+Enter` from plain `Enter`. Use `Ctrl+J` for a newline or run Pi in a terminal with modern extended-key support.

If an IME candidate window does not follow the text cursor, show the hardware cursor:

```bash
export PI_HARDWARE_CURSOR=1
pi
```

## Override detected capabilities

Pi automatically detects OSC 8 hyperlinks, inline image protocols, and truecolor support. A terminal proxy or multiplexer can make that detection inaccurate.

| Capability | Environment variable | Setting |
|---|---|---|
| Hyperlinks | `PI_HYPERLINKS=1\|0\|auto` | `terminal.hyperlinks: true\|false\|"auto"` |
| Inline images | `PI_IMAGE_PROTOCOL=kitty\|iterm2\|none\|auto` | `terminal.images: "kitty"\|"iterm2"\|false\|"auto"` |
| Truecolor | `PI_TRUE_COLOR=1\|0\|auto` | `terminal.trueColor: true\|false\|"auto"` |

Settings take precedence over environment variables. An unset value or `auto` preserves automatic detection.

Only force a capability supported by the complete terminal path. Unsupported escape sequences can corrupt rendering. See [Environment Variables](environment-variables.md#pi-process-configuration) and [Settings](settings.md) for the canonical value definitions.

## Program status

Pi reports its state with the [Program Status Protocol (OSC 7501)](https://www.superlogical.com/rex/docs/build/program-status), so terminals and agent dashboards can show whether it is working, waiting for you, done, or failed:

| State | When |
|---|---|
| `working` | An agent run or compaction is in progress. The message is the session name. |
| `blocked` | An extension dialog or login waits for you. The message is the dialog title. |
| `done` | A run finished. The message is the session name. |
| `error` | A run ended with an error that is not retried. The message is the first line of the error. |
| `idle` | Pi started, or you cancelled the run. |

Reports never contain prompts or model output. Pi sends them only after the terminal answers the protocol's support query; tmux and screen do not forward them. Set `PI_PROGRAM_STATUS=1` to send reports without asking, or `PI_PROGRAM_STATUS=0` to turn them off.
