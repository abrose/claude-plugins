# claude-plugins

Alfred Brose's personal Claude Code **marketplace** (`abrose-plugins`).

| Plugin | Mechanism | What it does |
|--------|-----------|--------------|
| [`adhd-friendly-simple-technical-english`](plugins/adhd-friendly-simple-technical-english/) | Output style | Combines Simplified Technical English (ASD-STE100) short, direct sentences with an ADHD action-first shape (numbered, skimmable, no fluff) and keeps the depth (the "why"). Code is exempt. Select it from `/config`. |
| [`chebu-ui`](plugins/chebu-ui/) | Mod (function hooks) | Personal UI tweaks. Bold, numbered prompts (`/prompt-style`), a `/prompts` pane with a toggle button, a separator after each turn, quiet tool rows, dim narration and framed answers. |
| [`quota-statusline`](plugins/quota-statusline/) | `bin/` executable | A quota-spend projection engine (`quota-statusline`). Reads the Claude Code rate-limit payload, logs a rolling per-profile usage sample, and prints a JSON verdict per window (5h/7d): on pace to blow the limit before it resets, or coasting under it? The weekly projection counts active hours, not 24/7. Bring your own rendering. |
| [`team`](plugins/team/) | Skills + agents + commands + hook + `bin/` | Envoy-and-orchestrator workflow with Herdr. One envoy session you talk to, an orchestrator that runs role agents in panes, briefs as files, open questions as cards, a numbered decisions file, reports by a Stop hook. Kernel only; each project adds a small overlay. |

## Install

First add the marketplace, then install the plugin:

```
/plugin marketplace add abrose/claude-plugins
/plugin install adhd-friendly-simple-technical-english@abrose-plugins
```

The `marketplace add` argument is the GitHub repo slug. The `install` argument is
`plugin@marketplace` (the plugin name, then `abrose-plugins`, this marketplace).

## How it works

Each plugin uses a different mechanism; its own README has the details.

- **`adhd-friendly-simple-technical-english`** ships an **output style**. Unlike a hook, an
  output style *replaces* the system prompt. This style sets `keep-coding-instructions: true`,
  so Claude Code keeps its software-engineering instructions and only adds the shaping rules.
  Only one output style is active at a time. Select it from `/config` → Output style, then
  `/clear` or start a new session.
- **`chebu-ui`** ships a **mod**: a TypeScript module of function hooks. A `ui.render` hook on
  each transcript row (prompts, replies, tool calls, the turn line) redraws it; the stored
  messages stay as they were. One file, `notes.ts`, holds every state write.
- **`quota-statusline`** ships an executable. A plugin cannot register a `statusLine`, so you
  wire your own `statusLine.command` to call `bin/quota-statusline` and render its JSON.
- **`team`** ships skills, agents, commands, a Stop hook and `bin/` scripts that drive Herdr.
  Each project adds a small overlay under `.claude/team/`.

## Repo layout

```
.claude-plugin/marketplace.json                # this marketplace

plugins/adhd-friendly-simple-technical-english/ # output-style plugin
├── .claude-plugin/plugin.json                  # plugin manifest
├── output-styles/adhd-friendly-ste.md          # the output style (frontmatter + rules)
├── README.md
└── LICENSE

plugins/chebu-ui/                                # mod plugin
├── .claude-plugin/plugin.json                  # plugin manifest
├── hooks/hooks.json                             # names the mod module
├── hooks/mod/chebu-ui.tsx                       # registers each tweak
├── hooks/mod/notes.ts                           # every event hook that writes state
├── hooks/mod/prompt-style.tsx                   # prompt styles + /prompt-style
├── hooks/mod/prompt-log.tsx                     # /prompts pane + its band button
├── hooks/mod/turn-separator.tsx                 # rule after each turn
├── hooks/mod/quiet-tools.tsx                    # dim tool rows
├── hooks/mod/reply-style.tsx                    # framed answer, dim narration
├── types/index.d.ts                             # $.state contract
├── tests/mod/*.test.ts                          # claude plugin test
├── README.md
└── LICENSE

plugins/quota-statusline/                        # bin/ executable plugin
├── .claude-plugin/plugin.json                  # plugin manifest
├── bin/quota-statusline                         # the projection engine (python3)
├── tests/test_cquota.py                         # unit + behaviour tests
├── README.md
└── LICENSE

plugins/team/                                    # orchestration workflow plugin
├── .claude-plugin/plugin.json                  # plugin manifest
├── skills/                                      # protocol + role rules + templates
├── agents/                                      # team-envoy, -orchestrator, -investigator, -implementer, -tester
├── commands/                                     # /team:init, brief, status, release, resurrect
├── hooks/                                        # Stop and SessionStart hooks and the team mod (hooks/mod/)
├── bin/                                          # team-init, team-start, team-brief, team-status, team-forget, ...
├── lib/                                          # shared: teamlib.py, plugin-dir.sh
├── tests/test_team.py                            # behaviour tests against fake CLIs
├── README.md
└── LICENSE
```

## License

MIT. The ADHD shape is adapted from the MIT-licensed
[`i-have-adhd`](https://github.com/ayghri/i-have-adhd) skill. The output style applies the
writing rules of ASD-STE100 Simplified Technical English in spirit; ASD-STE100 is a registered
trademark of the AeroSpace, Security and Defence Industries Association of Europe (ASD), and
this plugin is not affiliated with or endorsed by ASD.
