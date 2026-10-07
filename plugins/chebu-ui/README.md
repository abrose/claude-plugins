# chebu-ui

Personal Claude Code UI tweaks, written as a mod (a plugin of function hooks).
Each tweak lives in its own file under `hooks/mod/` and is registered from
`hooks/mod/chebu-ui.tsx`.

## Install

```
/plugin marketplace add abrose/claude-plugins
/plugin install chebu-ui@abrose-plugins
```

## Tweaks

### Prompt style

Draws your own prompts (typed at the terminal, or sent from phone or web) in a
bold, framed style, so you can find them again in a long transcript. Messages
from background tasks, teammates and other agents keep the default look. Only
the drawing changes: the stored message and what the model reads stay as they
were.

`/prompt-style <name>` picks a style; `/prompt-style` with no argument cycles.

| Style    | Look                                                        |
| -------- | ----------------------------------------------------------- |
| `double` | Full-width green double frame (default)                     |
| `box`    | Rounded magenta frame                                       |
| `banner` | Full-width magenta background band, black text              |
| `gutter` | Yellow bar on the left, no frame                            |
| `label`  | Cyan ` YOU ` tag above the prompt                           |

The choice lasts for the session; new sessions start with `double`.

## Development

```
claude plugin validate plugins/chebu-ui
claude plugin test plugins/chebu-ui
```
