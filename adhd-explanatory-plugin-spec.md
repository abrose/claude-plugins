# Spec: `adhd-explanatory-mode` — a publishable Claude Code plugin

## Goal

Package the local SessionStart hook (Explanatory-ADHD output mode) as a Claude Code
**plugin distributed via a single-plugin marketplace repo on GitHub**, so it can be
installed on any Claude profile with two commands and toggled per session.

This mirrors the structure of Anthropic's own `explanatory-output-style` plugin, which is
nothing but a SessionStart hook that injects `additionalContext` — confirmed by reading its
files on disk.

## Source material to carry over

The working ruleset already lives at:
`~/.claude/hooks/adhd-explanatory-instructions.md` (~3,750 chars)

Copy that file verbatim into the plugin (path below). It is the payload.

---

## Repo layout

A GitHub repo that is BOTH a marketplace (so `/plugin marketplace add` works) and holds the
one plugin. Matches the official `claude-plugins-official` layout (marketplace at root,
plugins under `./plugins/<name>`).

```
adhd-explanatory-mode/                       # git repo root == the marketplace
├── .claude-plugin/
│   └── marketplace.json                     # lists the one plugin
├── plugins/
│   └── adhd-explanatory-mode/
│       ├── .claude-plugin/
│       │   └── plugin.json                  # the plugin manifest
│       ├── hooks/
│       │   └── hooks.json                   # registers the SessionStart hook
│       ├── hooks-handlers/
│       │   └── session-start.sh             # emits additionalContext JSON
│       ├── instructions/
│       │   └── adhd-explanatory-instructions.md   # <- copied from ~/.claude/hooks/
│       ├── README.md
│       └── LICENSE                          # MIT (skill it derives from is MIT)
└── README.md                                # install instructions
```

Why the nested `plugins/<name>/` instead of plugin-at-root: keeps room to add a second
plugin later and matches the reference layout exactly, so there is one known-good pattern to
copy. If you want the absolute minimum, plugin-at-root also works with
`"source": "."` in marketplace.json — noted as an alternative at the end.

---

## File contents

### `.claude-plugin/marketplace.json`

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "adhd-explanatory-mode",
  "description": "Explanatory output shaped for an ADHD reader — action-first, numbered, skimmable, no fluff.",
  "owner": {
    "name": "Alfred Brose"
  },
  "plugins": [
    {
      "name": "adhd-explanatory-mode",
      "description": "SessionStart hook that reshapes explanatory output for an ADHD reader: lead with the action, number steps, restate state, make wins visible, cut preamble/closers. Toggle per session.",
      "source": "./plugins/adhd-explanatory-mode",
      "category": "productivity"
    }
  ]
}
```

### `plugins/adhd-explanatory-mode/.claude-plugin/plugin.json`

```json
{
  "name": "adhd-explanatory-mode",
  "version": "1.0.0",
  "description": "Explanatory output, restructured for an ADHD reader. Injects action-first / numbered / skimmable output rules as SessionStart additionalContext.",
  "author": {
    "name": "Alfred Brose"
  }
}
```

### `plugins/adhd-explanatory-mode/hooks/hooks.json`

Note `${CLAUDE_PLUGIN_ROOT}` — Claude Code sets this to the installed plugin dir. This is the
only reliable way to reference bundled files; do NOT hardcode `~/.claude/...`.

```json
{
  "description": "Explanatory-ADHD mode: injects ADHD-shaped output rules at session start",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks-handlers/session-start.sh\""
          }
        ]
      }
    ]
  }
}
```

### `plugins/adhd-explanatory-mode/hooks-handlers/session-start.sh`

Reads the bundled instructions file (via `CLAUDE_PLUGIN_ROOT`) and wraps it in the
SessionStart JSON. Uses `python3` for safe JSON escaping so the instructions file can contain
quotes/newlines freely (the reference plugin inlines a pre-escaped heredoc; reading from a
file is nicer to maintain).

```bash
#!/usr/bin/env bash
set -euo pipefail

# SessionStart hook for the adhd-explanatory-mode plugin.
# Injects Explanatory-ADHD output rules as additionalContext.
# Per-session toggle: set CLAUDE_ADHD=0 to silence for one session.

instructions="${CLAUDE_PLUGIN_ROOT}/instructions/adhd-explanatory-instructions.md"

[[ "${CLAUDE_ADHD:-}" == "0" ]] && exit 0
[[ -f "${instructions}" ]] || exit 0

python3 - "${instructions}" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    context = f.read()
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": context,
    }
}))
PY
```

Make it executable before committing: `chmod +x plugins/adhd-explanatory-mode/hooks-handlers/session-start.sh`

### `instructions/adhd-explanatory-instructions.md`

Copy `~/.claude/hooks/adhd-explanatory-instructions.md` here verbatim.

---

## Toggle design — one decision to make

The local version was **opt-in** (marker `~/.claude/.adhd-mode` had to exist). For a
*distributed* plugin, enabling the plugin via `/plugin` is already the deliberate opt-in, so
the natural default flips to **opt-out**:

- **Recommended (opt-out):** enabled plugin = mode ON every session. `CLAUDE_ADHD=0 claude`
  silences a single session. Simple, and "install → it works" matches user expectations. This
  is what the `session-start.sh` above implements.
- **Alternative (opt-in, matches local setup):** add back the marker gate — inject only when
  `~/.claude/.adhd-mode` exists or `CLAUDE_ADHD=1`. Use this if you want the plugin installed
  but dormant until you flip a marker. To do this, add before the python block:
  ```bash
  marker="${HOME}/.claude/.adhd-mode"
  [[ "${CLAUDE_ADHD:-}" == "1" || -f "${marker}" ]] || exit 0
  ```

Decide which before publishing; it only changes `session-start.sh`.

---

## Publish steps (run in the new repo dir)

1. `git init && git branch -M main`
2. Create the files above; `chmod +x` the handler.
3. `git add -A && git commit -m "feat: adhd-explanatory-mode plugin"`
4. `gh repo create adhd-explanatory-mode --public --source=. --push`
   (or create the repo in the GitHub UI and `git remote add origin ... && git push -u origin main`)

## Install on another profile

```
/plugin marketplace add abrose/adhd-explanatory-mode
/plugin install adhd-explanatory-mode@adhd-explanatory-mode
```

(First token = marketplace name, second = `plugin@marketplace`. Both are
`adhd-explanatory-mode` here.) Then start a new session — the hook fires at SessionStart.

## Verify

- `/plugin` → confirm it shows enabled.
- Start a fresh session; the injected rules appear as SessionStart additionalContext (you'll
  see the ADHD-shaped output style take effect).
- Silence test: `CLAUDE_ADHD=0 claude` → plain output, no injection.
- Local dry-run before pushing (simulates the hook):
  ```bash
  CLAUDE_PLUGIN_ROOT=plugins/adhd-explanatory-mode \
    bash plugins/adhd-explanatory-mode/hooks-handlers/session-start.sh \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print("ok:", len(d["hookSpecificOutput"]["additionalContext"]), "chars")'
  ```

---

## Alternative: plugin-at-root (minimum footprint)

If you don't want the `plugins/<name>/` nesting, put `plugin.json`, `hooks/`,
`hooks-handlers/`, `instructions/` at the repo root and set the marketplace entry
`"source": "."`. Fewer directories; slightly less like the official reference. Either works.

## Notes

- Keep the MIT `LICENSE` — the ruleset is adapted from the MIT-licensed
  `i-have-adhd` skill (github.com/ayghri/i-have-adhd). Credit line is already in the
  instructions file.
- `python3` is a runtime dependency of the handler. It's present by default on macOS and most
  Linux dev machines. If you want zero dependencies, pre-escape the instructions into an
  inlined heredoc like the reference `explanatory-output-style` plugin does (trades
  maintainability for no-python).
```

