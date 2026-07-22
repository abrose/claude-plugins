# claude-plugins

Alfred Brose's personal Claude Code **marketplace** (`abrose-plugins`). Currently ships one plugin,
[`adhd-explanatory-mode`](plugins/adhd-explanatory-mode/), which reshapes explanatory
output for an ADHD reader: action-first, numbered, skimmable, no fluff — while keeping the
explanatory depth (the "why" and the `★ Insight ─────` blocks).

## Install

```
/plugin marketplace add abrose/claude-plugins
/plugin install adhd-explanatory-mode@abrose-plugins
```

The `marketplace add` argument is the GitHub repo slug; the `install` argument is
`plugin@marketplace` (`adhd-explanatory-mode` is the plugin, `abrose-plugins` is this
marketplace). Start a fresh session and the hook fires at SessionStart.

## What it does

Enabled = mode ON every session (opt-out). Silence one session with `CLAUDE_ADHD=0 claude`.
See the [plugin README](plugins/adhd-explanatory-mode/README.md) for details.

## Repo layout

```
.claude-plugin/marketplace.json          # this marketplace (lists the one plugin)
plugins/adhd-explanatory-mode/           # the plugin
├── .claude-plugin/plugin.json           # plugin manifest
├── hooks/hooks.json                     # registers the SessionStart hook
├── hooks-handlers/session-start.sh      # emits additionalContext JSON
├── instructions/                        # the injected ruleset (the payload)
├── README.md
└── LICENSE                              # MIT
```

## License

MIT. Adapted from the MIT-licensed
[`i-have-adhd`](https://github.com/ayghri/i-have-adhd) skill.
