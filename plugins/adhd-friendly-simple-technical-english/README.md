# adhd-friendly-simple-technical-english

A Claude Code plugin that ships **one output style**. The style combines two ideas:

- **Simplified Technical English (STE):** short, direct, unambiguous sentences (ASD-STE100
  writing rules, in spirit).
- **ADHD-friendly shape:** lead with the action, number the steps, restate state, make wins
  visible, cut preamble and closers.

It keeps the teaching depth: the "why" behind each change. Code, commands, and quoted text are exempt.

## How it works

The plugin ships an output style at
[`output-styles/adhd-friendly-ste.md`](output-styles/adhd-friendly-ste.md). Unlike a hook,
an output style **changes the system prompt**. This style sets `keep-coding-instructions: true`.
On the full system prompt, Claude Code then keeps its software-engineering instructions and adds the shaping rules.
The field has no effect on the shorter system prompt. To rely on the field, set `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT` to `0`.

Precedence: the built-in Claude Code instructions outrank this style. This style tells Claude to
follow it over your `CLAUDE.md` when the two conflict, including a rule such as "sacrifice
grammar for concision".
At the first such conflict in a session, the style adds one warning line at the end of the reply.

Scope: the style shapes the main conversation and forks. Other subagents do not get it. A
session that starts with this style active gets it.

Dependency: the style asks for a status-bar line only if a rule in your `CLAUDE.md` requires one.
Without such a rule, the style adds no status line.

```
plugin enabled → style appears in /config → you select it → it shapes the main conversation and forks
```

## Select it

Only one output style is active at a time. Choose this one from the menu:

```
/config    → Output style → ADHD-friendly Simple Technical English
```

The new style applies from your next message (Claude Code v2.1.251 or later). If you edit the
style file, restart Claude Code. To go back, select **Default** in the same menu.

## Credit

- ADHD shape adapted from the MIT-licensed
  [`i-have-adhd`](https://github.com/ayghri/i-have-adhd) skill.
- Writing rules from ASD-STE100 Simplified Technical English, Issue 9. ASD-STE100 is a
  registered trademark of the AeroSpace, Security and Defence Industries Association of Europe
  (ASD). This plugin is not affiliated with or endorsed by ASD.

Licensed MIT - see [LICENSE](LICENSE).
