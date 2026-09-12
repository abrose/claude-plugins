# claude-plugins

Alfred Brose's personal Claude Code **marketplace** (`abrose-plugins`).

| Plugin | Mechanism | What it does |
|--------|-----------|--------------|
| [`adhd-friendly-simple-technical-english`](plugins/adhd-friendly-simple-technical-english/) | Output style | Combines Simplified Technical English (ASD-STE100) short, direct sentences with an ADHD action-first shape — numbered, skimmable, no fluff — and keeps the depth (the "why" and the `★ Insight ─────` blocks). Code is exempt. Select it from `/config`. |
| [`quota-statusline`](plugins/quota-statusline/) | `bin/` executable | A quota-spend projection engine (`quota-statusline`). Reads the Claude Code rate-limit payload, logs a rolling per-profile usage sample, and prints a JSON verdict per window (5h/7d): on pace to blow the limit before it resets, or coasting under it? The weekly projection counts active hours, not 24/7. Bring your own rendering. |

## Install

First add the marketplace, then install the plugin:

```
/plugin marketplace add abrose/claude-plugins
/plugin install adhd-friendly-simple-technical-english@abrose-plugins
```

The `marketplace add` argument is the GitHub repo slug. The `install` argument is
`plugin@marketplace` (the plugin name, then `abrose-plugins`, this marketplace).

## How it works

The plugin ships an **output style**. Unlike a hook, an output style *replaces* the system
prompt. This style sets `keep-coding-instructions: true`, so Claude Code keeps its
software-engineering instructions and only adds the shaping rules. Only one output style is
active at a time. Select it from `/config` → Output style, then `/clear` or start a new
session.

## Repo layout

```
.claude-plugin/marketplace.json                # this marketplace (lists one plugin)

plugins/adhd-friendly-simple-technical-english/ # output-style plugin
├── .claude-plugin/plugin.json                  # plugin manifest
├── output-styles/adhd-friendly-ste.md          # the output style (frontmatter + rules)
├── README.md
└── LICENSE

plugins/quota-statusline/                        # bin/ executable plugin
├── .claude-plugin/plugin.json                  # plugin manifest
├── bin/quota-statusline                         # the projection engine (python3)
├── tests/test_cquota.py                         # unit + behaviour tests
├── README.md
└── LICENSE
```

## License

MIT. The ADHD shape is adapted from the MIT-licensed
[`i-have-adhd`](https://github.com/ayghri/i-have-adhd) skill. The output style applies the
writing rules of ASD-STE100 Simplified Technical English in spirit; ASD-STE100 is a registered
trademark of the AeroSpace, Security and Defence Industries Association of Europe (ASD), and
this plugin is not affiliated with or endorsed by ASD.
