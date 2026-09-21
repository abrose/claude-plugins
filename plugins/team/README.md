# team

**Orchestrator-plus-team-agents workflow for Claude Code with Herdr.** One
session you talk to, role agents in panes, briefs as files, a numbered decisions
file, reports by hook. This plugin is the kernel: a project-agnostic process,
role definitions, templates, commands, and glue scripts around the Herdr CLI.
Everything about a specific repository lives in that repository's overlay.

## How it works

- You run one **orchestrator** session. It plans, briefs, reads reports, and
  decides with you. It never does operational work itself - no investigating,
  testing, browsing, or editing. Every such task goes to an agent.
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
| `/team:init <ticket>` | Create the tab, write the decisions file, start the watcher, write the first roster. Agents are started on demand, not chosen up front. |
| `/team:brief <name> <topic>` | Compose a brief, fill its task section, send the kick-off, report the status line. |
| `/team:status` | Read the roster, read idle agents that owe a report, flag anything that needs you. |
| `/team:release [name ...|all]` | Clear and close finished agents; refuse a working one. |

## Scripts (`bin/`, on `PATH` when enabled)

| Script | Does |
|---|---|
| `team-id slug\|hash\|for` | Compute a team id: slug a ticket, or a random hash. |
| `team-init <ticket>` | Write the team id and config, seed the safe permission allowlist, record the orchestrator's tab. |
| `team-start <name> <role>` | Start a role agent in a pane, verify its status bar, record it under `.team/`. |
| `team-brief compose\|send` | Compose a brief from templates + overlay, or send its kick-off prompt. |
| `team-slice <branch> <parent>` | Create a worktree and a Herdr tab for one slice. |
| `team-watch` | Poll each team's agents, push `WATCH` lines on state change, and keep the layout within budget. |
| `team-status` | Merge `herdr agent list` with `.team/` records into a roster. |

## Roles

| Role | Agent | Model | Default effort | Read-only |
|---|---|---|---|---|
| investigator | `team-investigator` | Opus 4.8 | medium | yes (tool filter) |
| implementer | `team-implementer` | Sonnet 5 | medium | no |
| tester | `team-tester` | Sonnet 5 | low | yes, except test files (by rule) |

Reviewer and post-notes work run on `team-investigator` with the `brief-review`
and `brief-post-notes` templates. Mechanical jobs run on `team-implementer`.

## Multiple teams

`/team:init <ticket>` assigns the run a short team id (a slug of the ticket,
or a random hash when there is no ticket) and writes it to
`.team/config.json`. Every agent name becomes `<team_id>-<label>`, including
the orchestrator itself (`<team_id>-orch`). Init checks the live `herdr agent
list` and, if that name namespace is already taken (for example by a prior run
for the same ticket), disambiguates the team id (`app-1`, then `app-1-2`, then
a random hash), so two teams never share names and cross-poison each other.
`team-start` likewise refuses a `<team_id>-<label>` that a live agent already
holds. A team's watcher and layout hygiene only ever act on the agents and
tabs recorded under its own `.team/` directory.

## Watcher

`/team:init` starts the watcher with `team-watch --spawn`, which splits a small
pane off the orchestrator pane (the orchestrator keeps most of the tab) and runs
the watcher there by absolute path, passing that pane's id as `--own-pane`. The
watcher never has to guess its own pane from the focused one, so it never closes
its own pane. Its pane logs each event plus a once-a-minute heartbeat, so you
can see it working. It polls
`herdr agent list` and `herdr pane list`, and on every pass:

- pushes one `WATCH <name>: <old> -> <new>` line to the orchestrator for
  every team agent whose state changed (a transition into `blocked` includes
  the dialog's first line);
- flags an agent that is `idle` or `done` with no report file newer than its
  brief, once per state;
- closes any pane in a team-managed tab that hosts no live agent (never its
  own pane);
- flags a tab that is over its pane budget, and a worker tab whose agents are
  all idle or done, and at least one was briefed, as a release candidate. A
  freshly spawned, un-briefed agent looks idle but is not flagged.

`/team:status` surfaces the latest `WATCH` lines; `/team:release all` stops
the watcher and removes its state files.

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
`.team/config.json`, `.team/tabs.json`, `.team/watch-state.json`,
`.team/roster.md`.

## Hook identity

The Stop hook learns which agent it is from `TEAM_NAME` in its own environment.
`team-start` stamps `TEAM_NAME=<name>` onto the agent's pane at start: with
`--env` when it creates the pane (a split or a spilled tab), or with a
`herdr pane run` export into a caller-provided `--pane`. The hook reads
`TEAM_NAME`, loads `.team/<name>.json`, and exits silently when the variable is
absent (any non-team session) or names no record.

Herdr's `agent_session.value` and Claude Code's `session_id` are **not** the
same identifier, so a session-id match never fires; the pane environment is the
reliable channel.

## Tests

```
python3 -m unittest discover -s plugins/team/tests
```

The tests put a shim directory on `PATH` that exposes `tests/fake-herdr` as
`herdr` and `tests/fake-git` as `git`. Both record every invocation and answer
with canned JSON, so the scripts run against a real (fake) CLI, never a mock.

## License

MIT. See `LICENSE`.
