# claude-plugins

Alfred Brose's personal Claude Code **marketplace** (`abrose-plugins`). It ships three
output-shaping plugins. Two inject rules with a `SessionStart` hook. One ships a custom
output style.

| Plugin | Mechanism | What it does |
|--------|-----------|--------------|
| [`adhd-explanatory-mode`](plugins/adhd-explanatory-mode/) | SessionStart hook | Reshapes explanatory output for an ADHD reader: action-first, numbered, skimmable, no fluff — and keeps the depth (the "why" and the `★ Insight ─────` blocks). |
| [`simplified-technical-english`](plugins/simplified-technical-english/) | SessionStart hook | Writes all prose in Simplified Technical English (ASD-STE100): short sentences, active voice, imperative instructions, one meaning per word, consistent terms. Code is exempt. |
| [`adhd-friendly-simple-technical-english`](adhd-friendly-simple-technical-english/) | Output style | Combines STE short sentences with the ADHD action-first shape and keeps the insight blocks. Select it from `/config`. |

## Install

First add the marketplace, then install the plugins you want:

```
/plugin marketplace add abrose/claude-plugins
/plugin install adhd-explanatory-mode@abrose-plugins
/plugin install simplified-technical-english@abrose-plugins
/plugin install adhd-friendly-simple-technical-english@abrose-plugins
```

The `marketplace add` argument is the GitHub repo slug. The `install` argument is
`plugin@marketplace` (the plugin name, then `abrose-plugins`, this marketplace).

## Two mechanisms

- **Hook plugins** (`adhd-explanatory-mode`, `simplified-technical-english`) *append* their
  rules as `additionalContext` at `SessionStart`. Enabled = ON every session (opt-out).
  Silence one session with an env var:

  ```
  CLAUDE_ADHD=0 claude        # adhd-explanatory-mode
  CLAUDE_STE=0 claude         # simplified-technical-english
  ```

- **Output-style plugin** (`adhd-friendly-simple-technical-english`) *replaces* the system
  prompt (it keeps the coding instructions). Only one output style is active at a time. Select
  it from `/config` → Output style, then `/clear` or start a new session.

## Do not stack all three

The output-style plugin overlaps with the two hook plugins. If you run all three at once, the
same rules arrive more than one time. While you use the output style, disable the two hook
plugins (or start with `CLAUDE_ADHD=0 CLAUDE_STE=0`).

## Repo layout

```
.claude-plugin/marketplace.json                # this marketplace (lists three plugins)

plugins/adhd-explanatory-mode/                 # hook plugin
├── .claude-plugin/plugin.json                 # plugin manifest
├── hooks/hooks.json                           # registers the SessionStart hook
├── hooks-handlers/session-start.sh            # emits additionalContext JSON
├── instructions/                              # the injected ruleset (the payload)
├── README.md
└── LICENSE

plugins/simplified-technical-english/          # hook plugin (same shape as above)
├── .claude-plugin/plugin.json
├── hooks/hooks.json
├── hooks-handlers/session-start.sh
├── instructions/
├── README.md
└── LICENSE

adhd-friendly-simple-technical-english/        # output-style plugin
├── .claude-plugin/plugin.json                 # plugin manifest
├── output-styles/adhd-friendly-ste.md         # the output style (frontmatter + rules)
├── README.md
└── LICENSE
```

## License

MIT. The ADHD shape is adapted from the MIT-licensed
[`i-have-adhd`](https://github.com/ayghri/i-have-adhd) skill. The STE plugins apply the
writing rules of ASD-STE100 Simplified Technical English in spirit; ASD-STE100 is a registered
trademark of the AeroSpace, Security and Defence Industries Association of Europe (ASD), and
these plugins are not affiliated with or endorsed by ASD.
