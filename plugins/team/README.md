# team

**Orchestrator-plus-team-agents workflow for Claude Code with Herdr.** One
session you talk to, role agents in panes, briefs as files, a numbered decisions
file, reports by hook. This plugin is the kernel: a project-agnostic process,
role definitions, templates, commands, and glue scripts around the Herdr CLI.
Everything about a specific repository lives in that repository's overlay.

## How it works

- You run one **orchestrator** session. It plans, briefs, reads reports, and
  decides with you. It does no operational work.
- Each **role agent** runs in its own Herdr pane, started with `team-start`.
- A **brief** is a file in `scratchpad/`, composed by `team-brief` from
  templates plus your project overlay. The kick-off prompt is one line pointing
  at the brief.
- The **decisions file** (`scratchpad/decisions-<ticket>.md`) is the single
  binding source. Every brief reads it first.
- When an agent stops, a **Stop hook** writes its last message to
  `scratchpad/reports/<name>-<topic>.md` and forwards a `REPORT` line to the
  orchestrator pane.

The full protocol is the `team-orchestration` skill. Operational lessons are in
its `references/lessons.md` (not auto-loaded).

## Install

Develop against a local checkout:

```
claude --plugin-dir plugins/team
```

Or install from the marketplace once published:

```
/plugin marketplace add abrose/claude-plugins
/plugin install team@abrose-plugins
```

## Commands

| Command | Does |
|---|---|
| `/team:init <ticket>` | Confirm the tab and roles, create the tab, write the decisions file, write the first roster. |
| `/team:brief <name> <topic>` | Compose a brief, fill its task section, send the kick-off, report the status line. |
| `/team:status` | Read the roster, read idle agents that owe a report, flag anything that needs you. |
| `/team:release [name ...|all]` | Clear and close finished agents; refuse a working one. |

## Scripts (`bin/`, on `PATH` when enabled)

| Script | Does |
|---|---|
| `team-start <name> <role>` | Start a role agent in a pane, verify its status bar, record it under `.team/`. |
| `team-brief compose\|send` | Compose a brief from templates + overlay, or send its kick-off prompt. |
| `team-slice <branch> <parent>` | Create a worktree and a Herdr tab for one slice. |
| `team-status` | Merge `herdr agent list` with `.team/` records into a roster. |

## Roles

| Role | Agent | Model | Default effort | Read-only |
|---|---|---|---|---|
| investigator | `team-investigator` | Opus 4.8 | medium | yes (tool filter) |
| implementer | `team-implementer` | Sonnet 5 | medium | no |
| tester | `team-tester` | Sonnet 5 | low | yes, except test files (by rule) |

Reviewer and post-notes work run on `team-investigator` with the `brief-review`
and `brief-post-notes` templates. Mechanical jobs run on `team-implementer`.

## Overlay contract

A project provides zero or more of these under its own repository. The kernel
runs with an empty overlay; a missing file it would have used produces one
warning.

| Path | Used by | Content |
|---|---|---|
| `.claude/team/project.yaml` | `team-slice`, `/team:release`, brief compose | `stacked`, `spdd`, `worktree_cmd`, `worktree_dir`, `release_check`, `gate_cmd` |
| `.claude/team/env.md` | brief compose ("Environment") | how to run and test locally; a "Slice kick-off" checklist |
| `.claude/team/gate.md` | brief compose ("Gate") | test command, lint, the greps a delivery must pass |
| `.claude/team/tracker.md` | analysis and post-notes briefs | ticket system and hygiene rules |
| `.claude/team/roles/<role>.md` | brief compose | extra brief sections for one role in this repo |
| `.claude/skills/project-<role>/SKILL.md` | agent preload | standing rules for one role in this repo |

## Task-scope files

All under `$TEAM_SCRATCH` (default `scratchpad/`, git-ignored):
`decisions-<ticket>.md`, `orchestration-decisions.md`,
`brief-<name>-<topic>.md`, `reports/<name>-<topic>.md`, `.team/<name>.json`,
`.team/config.json`, `.team/roster.md`.

## Hook identity

The Stop hook matches a session to a team agent by comparing the payload's
`session_id` (first 8 characters) against the `session` field that `team-start`
records. This assumes Herdr's `agent_session.value` and Claude Code's
`session_id` are the same identifier. Verify this on the first real run. If they
differ, pass the agent name through the pane environment at start and match on
that instead.

## Tests

```
python3 -m unittest discover -s plugins/team/tests
```

The tests put a shim directory on `PATH` that exposes `tests/fake-herdr` as
`herdr` and `tests/fake-git` as `git`. Both record every invocation and answer
with canned JSON, so the scripts run against a real (fake) CLI, never a mock.

## License

MIT. See `LICENSE`.
