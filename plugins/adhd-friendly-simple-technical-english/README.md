# adhd-friendly-simple-technical-english

A Claude Code plugin that ships **one output style**. The style combines two ideas:

- **Simplified Technical English (STE):** short, direct, unambiguous sentences (ASD-STE100
  writing rules, in spirit).
- **ADHD-friendly shape:** lead with the action, number the steps, restate state, make wins
  visible, cut preamble and closers.

It keeps the `★ Insight` teaching blocks. Code, commands, and quoted text are exempt.

## How it works

The plugin ships an output style at
[`output-styles/adhd-friendly-ste.md`](output-styles/adhd-friendly-ste.md). Unlike a hook,
an output style **replaces the system prompt**. This style sets `keep-coding-instructions: true`,
so Claude Code keeps its software-engineering instructions and only adds the shaping rules.

```
plugin enabled → style appears in /config → you select it → it shapes the main conversation
```

## Select it

Only one output style is active at a time. Choose this one from the menu:

```
/config    → Output style → ADHD-friendly Simple Technical English
```

The change takes effect after `/clear` or in a new session (the system prompt is cached at
session start). To go back, select **Default** in the same menu.

## Credit

- ADHD shape adapted from the MIT-licensed
  [`i-have-adhd`](https://github.com/ayghri/i-have-adhd) skill.
- Writing rules from ASD-STE100 Simplified Technical English, Issue 9. ASD-STE100 is a
  registered trademark of the AeroSpace, Security and Defence Industries Association of Europe
  (ASD). This plugin is not affiliated with or endorsed by ASD.

Licensed MIT — see [LICENSE](LICENSE).
