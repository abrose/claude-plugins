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

Each prompt also carries its number (`#3`) in this session. A prompt sent while
a turn runs shows in a dashed yellow frame with a `⏳ queued` tag until it
enters the conversation.

### Prompt list

`/prompts` opens a pane with every prompt you sent this session: number, send
time and text with its newlines, soft-wrapped, newest at the bottom. The pane
scrolls, and each new prompt brings it back to the end. A frame copied from a
terminal box (`│`) and trailing spaces are stripped. A prompt longer than five
rows (a pasted block) is folded to four rows and a `── N more lines hidden ──`
rule; press `▶` beside the time to unfold, and `▼` to fold again. Run
`/prompts` again to close the pane; behind another plugin's pane tab, it comes
to the front instead. A `[ p: prompts ]` button above the input does the same:
click it, or press `ctrl+x tab` and then `p`.

### Turn separator

Replaces the engine's `Worked for 3s` line with a gray rule after each turn,
with the time the turn ended: `── 10:26 · Worked for 3s ─────────`.

### Quiet tools

Draws each tool call as one dim line (`· Bash ls -la`). Bash output shows its
first three lines and counts the rest (`ctrl+o` shows all). Edits, writes,
questions, subagents and plan exits keep the engine's full row, and so does a
call that failed or was interrupted.

### Reply style

The answer shows as markdown in a round blue frame. Text that a tool call
followed in the same turn (narration such as "Let me read the file") shows dim
and italic instead, so the answer stands out. Replies from before the plugin
loaded show framed.

## Development

```
claude plugin validate plugins/chebu-ui
claude plugin test plugins/chebu-ui
```
