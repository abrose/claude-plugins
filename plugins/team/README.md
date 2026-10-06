# team

**Orchestrator-plus-team-agents workflow for Claude Code with Herdr.** One
session you talk to, role agents in panes, briefs as files, a numbered decisions
file, reports by hook. This plugin is the kernel: a project-agnostic process,
role definitions, templates, commands, a Claude Code mod, and glue scripts
around the Herdr CLI. Everything about a specific repository lives in that
repository's overlay.

Requires Claude Code 2.1.287 or newer (the team mod runs on its function hooks).

## How it works

- You run one **orchestrator** session. It plans, briefs, reads reports, and
  decides with you. It never does operational work itself - no investigating,
  testing, browsing, or editing. Every such task goes to an agent.
- Each **role agent** runs in its own Herdr pane, started with `team-start`.
  Every agent is addressed by its Claude **session id**, never by its herdr
  name: herdr does not restore names after a restart, session ids survive it.
- A **brief** is a file in `scratchpad/current/`, composed by `team-brief` from
  templates plus your project overlay. The orchestrator sends the one-line
  kick-off with the `brief_send` tool.
- The **decisions file** (`scratchpad/current/decisions-<ticket>.md`) is the single
  binding source. Every brief reads it first.
- When an agent stops, a **Stop hook** writes its last message to
  `scratchpad/current/reports/<name>-<topic>.md`.
- The **team mod** runs inside the orchestrator session. Every 15 s it picks up
  new `REPORT` lines, checks the agents, and sends what it found as one prompt.
  It draws the `Team` pane beside the transcript.

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
| `/team:init <ticket>` | Archive the previous run, write the decisions file and the plan file, write the first roster. The team mod then opens the overview. Agents are started on demand, not chosen up front. |
| `/team:brief <name> <topic>` | Compose a brief, fill its task section, send the kick-off with `brief_send`, report the status line. |
| `/team:status` | Read the roster, read idle agents that owe a report, flag anything that needs you. |
| `/team:release [name ...|all]` | Clear and close finished agents; refuse a working one. |
| `/team:resurrect` | After a restart, relaunch workers that came back without their team flags, resuming their sessions. |
| `/team-overview` | Hide or show the `Team` pane (a mod command; the choice is kept per team). |

## Scripts (`bin/`, on `PATH` when enabled)

| Script | Does |
|---|---|
| `team-id slug\|hash\|for` | Compute a team id: slug a ticket, or a random hash. |
| `team-init <ticket>` | Check the Claude Code version, archive the previous run to `scratchpad/.archive/` (refuses while its agents are live), write the team id and config with this session as `orchestrator_session`, seed the safe permission allowlist, record the orchestrator's tab, prune stale session index entries. |
| `team-start <name> <role>` | Start a role agent in a pane with a session id it assigns (`--session-id`), verify its status bar, record it under `.team/` with its launch flags, and write its session index entry. `--new-tab` opens a worker tab with the agent in its root pane. |
| `team-brief compose\|prepare` | Compose a brief from templates + overlay, or prepare its kick-off prompt (update the record, mirror into a worktree, print the prompt). |
| `team-slice <branch> <parent>` | Create a worktree (with the repo's own `worktree_cmd` from the overlay; refuses without one) and a Herdr tab for one slice. |
| `team-status` | Match `herdr agent list` to `.team/` records by session id into a roster. |
| `team-resurrect` | Relaunch workers a herdr restore marked as restored, with their saved flags. A marked worker `/clear`ed before it ran is adopted: the session its recorded pane runs, when no record claims it, becomes its identity. |

## Roles

| Role | Agent | Model | Default effort | Read-only |
|---|---|---|---|---|
| investigator | `team-investigator` | Opus 5.5 | medium | yes (tool filter) |
| implementer | `team-implementer` | Sonnet 5.5 | medium | no |
| tester | `team-tester` | Sonnet 5.5 | low | yes, except test files (by rule) |

The orchestrator overrides the defaults per job with `team-start --model
opus-5-5|sonnet-5-5|haiku-4-5` and `--effort low|medium|high|xhigh|max`. Any
other model is refused. Haiku starts in `accept-edits` mode, since it has no
auto mode.

Reviewer and post-notes work run on `team-investigator` with the `brief-review`
and `brief-post-notes` templates. Mechanical jobs run on `team-implementer`
with `--model haiku-4-5`.

## Multiple teams

`/team:init <ticket>` assigns the run a short team id (a slug of the ticket,
or a random hash when there is no ticket) and writes it to
`.team/config.json`. Every agent name becomes `<team_id>-<label>`. Init checks
the live `herdr agent list` and, if that name namespace is already taken (for
example by a prior run for the same ticket), disambiguates the team id
(`app-1`, then `app-1-2`, then a random hash). `team-start` likewise refuses a
`<team_id>-<label>` that a live agent already holds. A team's mod only ever
acts on the agents and tabs recorded under its own `.team/` directory.

## The team mod

`hooks/mod/` is a Claude Code mod in the same plugin. It loads in every
session with the plugin enabled and activates only in the session that
`.team/config.json` names as `orchestrator_session`. On `session.start` it sets
`TEAM_SESSION_ID`, which `team-init` reads. Every 15 s it:

- maps each record's `session` to a herdr agent and writes a moved pane id
  back to the record, so pane ids heal after a restart;
- picks up report files newer than its marks in `.team/delivered.json` and
  sends their `REPORT` lines (the first activation only sets the marks);
- sends a `WATCH` line for a transition into `blocked` (with the dialog's
  first line), and for an agent that has been quiet for 2 minutes without a
  report, once per quiet spell. Quiet means `idle` or `done` in herdr, or no
  new turn in its transcript since its last stop. A report counts only when the
  report file holds a `REPORT` line and is newer than the brief;
- closes an empty pane in a team-managed worker tab only when a team record
  names that pane and `team-start` has not marked it pending; never touches the
  orchestrator's own tab (the one herdr shows it in, and `orchestrator_tab` in
  the config, which `team-init` records);
- flags a tab over its pane budget, and a worker tab whose agents are all idle
  or done with fresh reports, as a release candidate;
- sends one `WATCH herdr unreachable: <reason>` while herdr is down.

All lines of one tick go out as one prompt (`REPORT` lines first), which waits
until the orchestrator is idle and never touches a draft you are typing.

The `brief_send` tool (`mcp__team__brief_send`) sends a kick-off by session id.
It works only in the session that runs the team; elsewhere (a worker, another
repo) it refuses.
Auto mode reviews that send as a `SendMessage` with no user request behind it,
so its classifier gives no verdict; `team-init` therefore adds `SendMessage` to
`permissions.allow` in `.claude/settings.local.json`, which decides it without
the classifier. Remove that entry if you want to approve each send yourself.
When the agent got a brief in its current session and was neither cleared nor
compacted since, it waits up to 6 s for a `/clear` or `/compact` to land, then
refuses.

### Upgrading from 0.4.x

A team started before 0.5.0 has no `orchestrator_session` in its config, so
the mod stays inactive for it and nothing delivers its REPORT lines;
`team-status` warns about it. Finish such a run by reading `reports/` by hand,
or start a new run with `/team:init`.

## Overlay contract

A project provides zero or more of these under its own repository. The kernel
runs with an empty overlay; a missing file it would have used produces one
warning.

| Path | Used by | Content |
|---|---|---|
| `.claude/team/project.yaml` | `team-slice`, `/team:release`, brief compose | `stacked`, `spdd`, `worktree_cmd` (required by `team-slice`), `worktree_dir` (required by `team-slice`), `release_check`, `gate_cmd` |
| `.claude/team/env.md` | brief compose ("Environment") | how to run and test locally; a "Slice kick-off" checklist |
| `.claude/team/gate.md` | brief compose ("Gate") | test command, lint, the greps a delivery must pass |
| `.claude/team/tracker.md` | analysis and post-notes briefs | ticket system and hygiene rules |
| `.claude/team/roles/<role>.md` | brief compose | extra brief sections for one role in this repo |
| `.claude/skills/project-<role>/SKILL.md` | agent preload | standing rules for one role in this repo |

## Task-scope files

All under `$TEAM_SCRATCH` (default `scratchpad/current/`, git-ignored). `/team:init`
archives the previous run and loose scratchpad entries to `scratchpad/.archive/`.
`decisions-<ticket>.md`, `progress-<ticket>.md`, `orchestration-decisions.md`,
`brief-<name>-<topic>.md`, `reports/<name>-<topic>.md`, `.team/<name>.json`,
`.team/config.json`, `.team/tabs.json`, `.team/watch-state.json`,
`.team/layout-flags.json`, `.team/delivered.json`, `.team/stops/`,
`.team/restored/`, `.team/roster.md`.

One file lives outside the run dir: the session index,
`${TEAM_INDEX_DIR:-${CLAUDE_CONFIG_DIR:-~/.claude}/team/sessions}/<session>.json`
(`{ "scratch", "name" }` per agent). It follows the Claude Code profile, and
`team-start` passes the orchestrator's `CLAUDE_CONFIG_DIR` to every worker
pane, so a team runs in one profile.

## Hook identity

The Stop hook finds its agent in this order:

1. `TEAM_NAME` and an absolute `TEAM_SCRATCH` in its own environment.
   `team-start` stamps both onto the agent's pane; they survive `/clear` but
   not a restart.
2. Else the payload's `session_id` through the session index, then the record,
   whose `session` must match.

Neither: the hook exits silently (any non-team session). A `SessionStart` hook
keeps the identity current: on `/clear` (a new session id in the same process)
it moves the record's `session` and the index entry to the new id; on a resume
without `TEAM_NAME` (a herdr restore) it marks the worker in `.team/restored/`
for `/team:resurrect`. The orchestrator's mod follows its own `/clear` the same
way, through `session.end`.

## Tests

```
python3 -m unittest discover -s plugins/team/tests
claude plugin test plugins/team
```

The bash tests put a shim directory on `PATH` that exposes `tests/fake-herdr`
as `herdr`, `tests/fake-git` as `git` and `tests/fake-claude` as `claude`. They
record every invocation and answer with canned output, so the scripts run
against a real (fake) CLI, never a mock. The mod tests (`tests/mod/`) answer
each engine call the mod makes from an in-memory world (`tests/mod/world.ts`):
files, herdr output, store, env, clock.

## License

MIT. See `LICENSE`.
