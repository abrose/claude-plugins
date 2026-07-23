# simplified-technical-english

A Claude Code plugin that writes **all prose** in the style of
[ASD-STE100 Simplified Technical English](https://www.asd-ste100.org/) (STE): short
sentences, active voice, imperative instructions, one meaning per word, and consistent
terminology. The goal is technical text that a reader understands on the first read.

It applies the standard's **writing rules** in spirit. It does *not* enforce the standard's
controlled ~900-word dictionary literally — that would make normal coding explanations
stilted. Instead it prefers short, common words while keeping correct technical terms.

## How it works

One `SessionStart` hook. At the start of every session it reads
[`instructions/ste-instructions.md`](instructions/ste-instructions.md) and injects it as
`additionalContext`. No new tools, no commands — just context.

```
SessionStart → session-start.sh → { hookSpecificOutput: { additionalContext: <rules> } }
```

## What it shapes

- **Shaped:** explanations, summaries, instructions, commit messages, PR descriptions, chat answers.
- **Exempt:** code, commands, file paths, identifiers, API names, error messages, log output,
  and quoted text. Their content is never altered to fit a word count.

## Toggle

Enabled plugin = mode **ON** every session (opt-out). To silence a single session:

```bash
CLAUDE_STE=0 claude
```

## Requirements

- `python3` on `PATH` (used by the handler for safe JSON escaping). Present by default on
  macOS and most Linux dev machines.

## Credit

Adapted from the writing rules of ASD-STE100 Simplified Technical English, Issue 9.
ASD-STE100 is a registered trademark of the AeroSpace, Security and Defence Industries
Association of Europe (ASD). This plugin is not affiliated with or endorsed by ASD.
Licensed MIT — see [LICENSE](LICENSE).
