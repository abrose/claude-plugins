# adhd-explanatory-mode

A Claude Code plugin that reshapes **explanatory** output for an ADHD reader — without
throwing away the teaching. It keeps the "why", the before/after reasoning, and the
`★ Insight ─────` blocks; it only changes the *shape*: lead with the action, number the
steps, restate state across turns, make wins visible, cut preamble and closers.

## How it works

One `SessionStart` hook. At the start of every session it reads
[`instructions/adhd-explanatory-instructions.md`](instructions/adhd-explanatory-instructions.md)
and injects it as `additionalContext`. No new tools, no commands — just context.

```
SessionStart → session-start.sh → { hookSpecificOutput: { additionalContext: <rules> } }
```

## Toggle

Enabled plugin = mode **ON** every session (opt-out). To silence a single session:

```bash
CLAUDE_ADHD=0 claude
```

## Requirements

- `python3` on `PATH` (used by the handler for safe JSON escaping). Present by default on
  macOS and most Linux dev machines.

## Credit

Adapted from the MIT-licensed [`i-have-adhd`](https://github.com/ayghri/i-have-adhd) skill.
Licensed MIT — see [LICENSE](LICENSE).
