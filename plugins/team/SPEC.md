# Spec: `team` - orchestrator-plus-team-agents workflow as a Claude Code plugin

## Goal

Package the orchestration workflow practised on APP-5066 (one orchestrator
session Alfred talks to, role agents in Herdr panes, briefs as files, a
numbered decisions file) as a plugin in the `abrose-plugins` marketplace, so
that any project on any profile can run it with `/plugin install` plus a small
per-project overlay. The plugin is the **kernel**: project-agnostic process,
role definitions, templates, commands, and the glue scripts around the Herdr
CLI. Everything about a specific repository lives in that repository's overlay
and is never part of the plugin.

Companion: the workflow log `team-orchestration-workflow.md` (2026-09-10 to
2026-09-12) is the source for every rule here. It ships trimmed as
`skills/team-orchestration/references/lessons.md` and is never auto-loaded.

## Constraints from the plugin system (verified 2026-09-14)

- Plugin agents support `name`, `description`, `model`, `effort`, `maxTurns`,
  `tools`, `disallowedTools`, `skills`, `memory`, `background`, `isolation`.
  **Not** `hooks`, `mcpServers`, `permissionMode`, `initialPrompt`. So:
  - the report hook is a plugin-level hook in `hooks/hooks.json`, gated at
    runtime (see [Report hook](#report-hook));
  - permission mode and effort are start flags on the pane's `claude` process
    (`--permission-mode`, `--effort`), passed by `team-start`;
  - the kick-off prompt is sent by `team-brief send`, not by the agent file.
- `bin/` of an enabled plugin is on the Bash tool's `PATH`. The orchestrator
  calls `team-start`, `team-brief`, `team-slice`, `team-status` bare.
- Bundled files are referenced with `${CLAUDE_PLUGIN_ROOT}` (hooks, skills).
  Never hardcode `~/.claude/...`.
- Agent priority is project > user > plugin. A project may shadow a kernel
  role by shipping `.claude/agents/team-<role>.md`; the intended extension
  path is the `project-<role>` skill instead (see [Overlay contract](#overlay-contract)).

## Scopes

Four scopes, each with an owner. The test for a line in the kernel: still true
on a Rust repo with no Jira and no stacked branches.

| Scope | Owner | Where | Examples |
|---|---|---|---|
| Kernel | this plugin | `plugins/team/` | protocol, brief skeleton, role rules, commands, scripts |
| Toolchain | Alfred's environment, global | Herdr skill + CLI, git worktrees + machete, Claude Code | `herdr agent prompt --wait`, `git m update` guarded |
| Overlay | the project repository | `.claude/team/`, `.claude/skills/project-<role>/` | ports, tunnels, gate command, tracker hygiene, probe rules |
| Task | one ticket, ephemeral | `scratchpad/` (git-ignored) | decisions file, briefs, reports, open questions |

The kernel depends on the toolchain only through the Herdr CLI verbs
(`tab create`, `pane split`, `agent start`, `agent prompt --wait`,
`agent wait --until`, `agent read`, `agent list`, `agent send-keys`) and on
git. It never restates a Herdr command in prose; the Herdr skill is the
reference.

---

## Repo layout

```
claude-plugins/                          # marketplace repo (exists)
├── .claude-plugin/marketplace.json      # add one entry (below)
└── plugins/
    └── team/
        ├── .claude-plugin/plugin.json
        ├── SPEC.md                      # this file
        ├── README.md                    # install, overlay contract, quick start
        ├── LICENSE                      # MIT
        ├── skills/
        │   ├── team-orchestration/
        │   │   ├── SKILL.md             # the protocol, one page
        │   │   ├── references/lessons.md
        │   │   └── templates/
        │   │       ├── brief.md
        │   │       ├── brief-analysis.md
        │   │       ├── brief-implementation.md
        │   │       ├── brief-tester.md
        │   │       ├── brief-review.md
        │   │       ├── brief-post-notes.md
        │   │       ├── decisions.md
        │   │       └── report.md
        │   ├── team-role-investigator/SKILL.md
        │   ├── team-role-implementer/SKILL.md
        │   └── team-role-tester/SKILL.md
        ├── agents/
        │   ├── team-investigator.md
        │   ├── team-implementer.md
        │   └── team-tester.md
        ├── commands/
        │   ├── init.md                  # /team:init
        │   ├── brief.md                 # /team:brief
        │   ├── status.md                # /team:status
        │   └── release.md               # /team:release
        ├── hooks/
        │   ├── hooks.json
        │   └── handlers/stop-report.sh
        ├── bin/
        │   ├── team-start
        │   ├── team-brief
        │   ├── team-slice
        │   └── team-status
        └── tests/
            ├── test_team.py             # stdlib unittest, subprocess the scripts
            └── fake-herdr               # PATH shim that records calls, returns canned JSON
```

Scripts are bash with `set -euo pipefail`, and `python3` for JSON. No other
dependencies. `chmod +x` before commit.

---

## Protocol (content of `skills/team-orchestration/SKILL.md`)

Verbatim rules, kept to one page. Everything else is in `references/`.

1. The orchestrator plans, briefs, reads reports, and decides with Alfred. It
   does no operational work. Allowed exceptions: a one-off check that unblocks
   a brief, diff verification of a delivered artifact, git fast-forward of its
   own worktree.
2. The human decides. The orchestrator recommends with one sentence of
   reasoning and names the option it leans to.
3. Briefs are files in `scratchpad/`; prompts are one line pointing at the
   brief. Revisions are new files (`-rev2`), never edits of the original.
4. The decisions file is the single binding source. Every brief reads it
   first. Every decision is numbered, including one-word answers. Amendments
   get a suffix (3a). The file is mirrored into every active worktree's
   scratchpad after every append.
5. Agents report by name: `REPORT <name> <topic>: <summary>`. The deliverable
   is always a file; the report is a summary of at most ten lines. The
   orchestrator reads the file before discussing.
6. Reports are discussed one at a time in arrival order. If a later report
   reframes an open one, say so and ask to combine.
7. Every mention of an agent to Alfred carries `name (pane, session)`. With
   more than two agents alive, every status message starts with the roster.
8. Idle is not done. An idle agent without a REPORT gets an `agent read`
   within a minute. A `done` wait without a REPORT means read the screen.
9. Only source-backed facts in every artifact. Unknowns become numbered open
   questions, never guesses. Verify one load-bearing claim of every report
   before relaying it.
10. Fix loops are capped at three rounds of test, fix, re-test. Say the round
    count in every status. A fourth round is Alfred's explicit exception.
    Behaviour-neutral tidy-ups do not count as rounds.
11. After a REPORT closes a task, `/clear` the agent before reusing it.
    Briefs and the decisions file carry the context; a full context does not.
12. When Alfred is away, the orchestrator writes every own call to
    `scratchpad/orchestration-decisions.md` with context, so it can be
    audited. Alfred's decisions stay in the numbered file.
13. Anything an agent produces is a file; the chat carries summaries and
    decisions only.

---

## Roles

Fixed mapping. Never Opus 5 or Fable for a team agent. Effort is a start
flag; the defaults below are what `team-start` passes when `--effort` is
omitted.

| Role | Agent file | Model | Effort | Mode | Read-only | Used for |
|---|---|---|---|---|---|---|
| investigator | `team-investigator` | Opus 4.8 | medium | auto | yes | digests, analysis with numbered open questions, canvas, crit on own doc, code review, code health |
| implementer | `team-implementer` | Sonnet 5 | medium | auto | no | code in a worktree, fix rounds, MR creation on go, Jira writes on go |
| tester | `team-tester` | Sonnet 5 | low | auto | yes (except test files) | diff review + gate, live rounds, finding classification, manual-test partner |

Reviewer and Mechanic are not separate agent files in 1.0: a reviewer is
`team-investigator` with `brief-review.md`; mechanical jobs run on
`team-implementer` until a Haiku role earns its own file (Haiku has no auto
mode; `team-start` must then use accept-edits and budget an approval round).

### Agent frontmatter

```yaml
# agents/team-investigator.md
---
name: team-investigator
description: Read-only analysis, review and design-document agent for the team workflow. Started as a main session with --agent.
model: claude-opus-4-8
disallowedTools: Write, Edit, MultiEdit, NotebookEdit
skills:
  - team-orchestration
  - team-role-investigator
  - project-investigator        # overlay; skipped with a warning if absent
---
You are a team agent in Alfred's orchestration workflow. Your role rules are
in the preloaded skills. Wait for a kick-off prompt that names a brief file.
Read the decisions file it points to first, then the brief, then execute it
fully and report as the brief describes. Stop after reporting.
```

`team-implementer` allows writes, disallows nothing by tool, and carries
its rules in `team-role-implementer` (no tool installs, no deletes outside the
change, stop-and-report on anything destructive, re-verify every pointer,
run the gate greps before reporting, `/spdd-sync` last when the overlay flags
spdd). `team-tester` disallows `Edit`/`Write` outside `tests/` and scenario
files by rule (tool filters cannot express paths; the role skill states it).

The Investigator's read-only guarantee holds through `disallowedTools`; a
brief must not try to lift it. The Bash tool stays available to every role;
destructive commands are governed by the role skill and the plugin hook (see
below), not by removing Bash.

---

## Interface contract

### Task-scope files

All under `$TEAM_SCRATCH` (default `scratchpad/`, git-ignored). The kernel
creates and reads these; the overlay never does.

| File | Written by | Purpose |
|---|---|---|
| `decisions-<ticket>.md` | orchestrator | numbered, binding; header from `templates/decisions.md` |
| `orchestration-decisions.md` | orchestrator | own calls while Alfred is away |
| `brief-<name>-<topic>.md` | `team-brief compose` | the assignment; `-revN` for follow-ups |
| `reports/<name>-<topic>.md` | agent (via hook) | deliverable summary, deterministic path |
| `.team/<name>.json` | `team-start`, `team-brief` | `{role, topic, brief, pane, session, started}` |
| `.team/roster.md` | `team-status` | last rendered roster, for pasting into status messages |

### `team-start`

```
team-start <name> <role> (--pane <id> | --split <pane> right|down) [--effort low|medium|high]
           [--mode auto|accept-edits] [--cwd <dir>] [--dry-run]
```

1. Resolve `<role>` to the agent file and default effort from the role table.
2. Create the pane if `--split` was given; read `pane_id` from the JSON.
3. `herdr agent start <name> --kind claude --pane <pane> --timeout 90000 -- --agent team-<role> --effort <lvl> --permission-mode <mode>`.
4. Pre-flight, in order: if start returns `agent_not_ready`, `agent read
   --source detection`; if the screen is a first-run dialog (MCP server,
   workspace trust), answer the conservative default with `agent send-keys
   <name> enter` and retry once. Then verify the status bar once: model, mode,
   cwd. Abort with exit 3 and the screen text if any of the three is wrong.
5. Write `.team/<name>.json` with role, pane, session (first 8 chars of
   `agent_session.value`), started.
6. Print one JSON line: `{"name","role","pane","session","model","mode"}`.

Exit codes: 0 ok, 2 bad arguments, 3 pre-flight failed, 4 herdr error
(pass through the herdr message on stderr).

### `team-brief`

```
team-brief compose <name> <topic> [--template <t>] [--var key=value ...]
team-brief send <name> [--topic <topic>]
```

`compose` writes `brief-<name>-<topic>.md` by concatenating, in this order:

1. `templates/<t>.md` (default: the role's default template, e.g. tester ->
   `brief-tester.md`), with `{{ticket}}`, `{{decisions}}`, `{{name}}`,
   `{{topic}}`, `{{orchestrator}}` and any `--var` substituted;
2. the overlay's `roles/<role>.md` fragment if present;
3. the overlay's `env.md` and `gate.md` if present (as sections "Environment"
   and "Gate");
4. the fixed "Report back" and "Rules" sections from `templates/brief.md`.

It prints the path and exits 0. The orchestrator then edits the task section
with its own tools. `compose` refuses to overwrite an existing brief (use
`-rev2` via `--topic`).

`send` records `topic` and `brief` in `.team/<name>.json`, then runs
`herdr agent prompt <name> --wait "Read <brief> and execute it fully. Report
back as it describes. You are in execution mode; if your session shows plan
mode, say so immediately."` and maps the result: `working` -> exit 0 and print
the status; `agent_prompt_stalled` -> read the pane, print the last 20 lines,
exit 5 without re-sending (the orchestrator decides); `agent_blocked` ->
print the dialog text, exit 6.

### `team-slice`

```
team-slice <branch> <parent> --label "<Tn> <KEY> <slug>" [--ticket <KEY>] [--copy <dir> ...]
```

1. Create the worktree. The command comes from the overlay's `project.yaml`
   (`worktree_cmd`, with `{branch}` and `{parent}` placeholders); default
   `git worktree add -b {branch} ../{branch} {parent}`.
2. If `project.yaml` says `stacked: true`: `git m add {branch} --onto {parent}`
   in the new worktree.
3. Copy every `--copy` directory (design folder, decisions, mockups) into the
   new worktree's scratchpad. Warn about untracked spdd files that will not
   travel.
4. `herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd <worktree> --label "<label>" --no-focus`
   and one pane; print `{"worktree","tab","pane"}`.
5. Print the kick-off checklist from the overlay's `env.md` section
   "Slice kick-off" if present (which worktree runs the dev server, ports).

### `team-status`

```
team-status [--json] [--read-idle]
```

Merges `herdr agent list` with `.team/*.json` and prints one line per agent:
`name (pane, session) status role topic last-report-age`. With `--read-idle`,
every `idle`/`done` agent without a report file newer than its brief gets an
`agent read --source recent-unwrapped --lines 8` and the last line is
appended, so rule 8 is a glance. Writes `.team/roster.md`.

### Commands

Markdown files under `commands/`; each loads only the SKILL section it needs.

| Command | Does |
|---|---|
| `/team:init <ticket> [--label]` | Confirms tab label and roles needed (one question), creates the tab, writes `decisions-<ticket>.md` from the template, names the current pane `orchestrator`, writes the first roster. |
| `/team:brief <name> <topic> [--template]` | `team-brief compose`, then the orchestrator fills the task section (must name exact files and tool paths, per lessons), then `team-brief send`, then reports the status line to Alfred. |
| `/team:status` | `team-status --read-idle`, then the roster block plus a two-line status per agent and any 401, permission dialog, or context above 70 percent. |
| `/team:release [name ...|all]` | For each agent: check for a report, `agent prompt <name> "/clear"`, run the overlay's `release_check` command if defined (orphan processes), then close the pane; closing the last pane closes the tab. Refuses to release an agent that is `working`. |

### Report hook

`hooks/hooks.json` registers a `Stop` hook:

```json
{
  "hooks": {
    "Stop": [
      {"hooks": [{"type": "command",
                  "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/handlers/stop-report.sh\""}]}
    ]
  }
}
```

`stop-report.sh` runs in every session of every profile that has the plugin
enabled, so it must be silent and cheap when it does not apply:

1. Read the hook payload from stdin (`session_id`, `transcript_path`, `cwd`).
2. Find `$cwd/$TEAM_SCRATCH/.team/*.json` whose `session` matches the first 8
   chars of `session_id`. No match -> exit 0. (This is how a session knows it
   is a team agent; no environment variable is needed.)
3. Extract the last assistant message from the transcript. Write it to
   `reports/<name>-<topic>.md` with a header (name, topic, brief path,
   timestamp). Overwrite on every stop, so the file always holds the latest.
4. If the message begins with `REPORT `, push it to the orchestrator pane:
   `herdr agent prompt <orchestrator> "<first line>"`, where
   `<orchestrator>` comes from `.team/config.json` (default `orchestrator`).
   If the agent already ran the command itself, the duplicate is harmless:
   the orchestrator handles reports by file, not by message count.
5. Never block the stop; on any error exit 0 and append one line to
   `.team/hook.log`.

Open point to verify on the first run: that `agent_session.value` from
`herdr agent list` and Claude Code's `session_id` refer to the same
identifier. If not, `team-start` passes `TEAM_NAME` through the pane's
environment (`herdr pane run` with an `export` before `claude`) and the hook
uses that instead. Record the answer in the README.

---

## Overlay contract

A project provides zero or more of these. The kernel documents the contract in
README and warns once per session for each missing file it would have used.

| Path | Used by | Content |
|---|---|---|
| `.claude/team/project.yaml` | `team-slice`, `/team:release`, brief compose | `stacked`, `spdd`, `crit`, `tracker`, `worktree_cmd`, `release_check`, `gate_cmd` |
| `.claude/team/env.md` | brief compose (section "Environment") | how to run and test locally; which worktree runs the dev server; external dependencies and who owns their logins; what never to kill or restart; a "Slice kick-off" checklist |
| `.claude/team/gate.md` | brief compose (section "Gate") | test command, lint, the greps a delivery must pass (dash characters, decision numbers, ticket keys in comments), what is exempt |
| `.claude/team/tracker.md` | analysis and post-notes briefs | ticket system, hygiene rules, who may write, dry-run rule |
| `.claude/team/roles/<role>.md` | brief compose | extra brief sections for one role in this repo |
| `.claude/skills/project-<role>/SKILL.md` | agent preload | standing rules for one role in this repo (tester: probes, ports, login state, one probe per round, stop the driver last) |

Everything in the APP-5066 log that names agora, dpa-chat, dpa-mcp, stackit,
kubectl, gwa-bmds, nglab, acli, or a port number belongs in these files, not
in the plugin.

---

## Templates

`templates/brief.md`, the skeleton every brief follows:

```
# Brief: {{name}} / {{topic}}

## Role
You are {{name}}, a {{role}}. Planned by the orchestrator for {{ticket}}.
You must NOT: <role fragment fills this>.

## Inputs (read in this order)
1. {{decisions}}  - binds you; every numbered decision applies.
2. <task-specific files, one line why each>

## Skills to load
<ordered list>

## Task
<numbered steps; exact file paths, field names, tool paths; no "explore">

## Output
<exact paths and the section structure of each deliverable>

## Report back
Run exactly:
herdr agent prompt {{orchestrator}} "REPORT {{name}} {{topic}}: <at most ten lines: verdict, files written, counts, blockers>"
Then stop.

## Rules
- Source-backed facts only; unknowns become numbered open questions.
- No em dashes. No agent-attribution trailers in commits.
- One thing at a time; stop after reporting.
- If your session shows plan mode, say so immediately instead of working.
```

Role templates add sections: `brief-analysis.md` (digest, concept inventory
with code pointers, candidate split, open-questions file with options,
evidence `file:line`, trade-offs, one recommendation each);
`brief-implementation.md` (worktree, gate, small commits, own-commit
invariant for stacks, re-verify pointers, gate greps, spdd sync last);
`brief-tester.md` (environment table, scenarios, expected-vs-observed,
finding classes task bug / design question / out of scope / environment,
three-round cap, one probe per round, stop the driver last, report BLOCKED
with the port list instead of trying logins); `brief-review.md` (read-only,
diff against the named parent, "decision, not defect" class, questions with
evidence instead of verdicts, counts by severity plus top three `file:line`);
`brief-post-notes.md` (approved findings list in, tracker notes out, dry-run
one first, no summary verdict).

`templates/decisions.md`:

```
# Decisions {{ticket}}
Numbered, dated, one paragraph each. Amendments: 3a replaces 3, 5a amends 5.
Every brief reads this file first. Mirror to every active worktree after each append.

1. (YYYY-MM-DD) ...
```

`templates/report.md` is the header the hook writes; agents do not fill it.

---

## Tests

`tests/test_team.py`, stdlib `unittest`, run with
`python3 -m unittest discover -s plugins/team/tests`. The tests put
`tests/fake-herdr` first on `PATH`; it records every invocation to a file and
answers from canned JSON selected by `FAKE_HERDR_SCENARIO`. Cases, at minimum:

1. `team-start` builds the exact `herdr agent start` argument list for each
   role (model file, default effort, mode) and writes `.team/<name>.json`.
2. `team-start` answers a first-run dialog once and aborts with exit 3 on a
   wrong model in the status bar.
3. `team-brief compose` concatenates skeleton, overlay role fragment, env and
   gate in order; substitutes variables; refuses to overwrite.
4. `team-brief compose` with an empty overlay still produces a valid brief
   (the project-agnostic guarantee).
5. `team-brief send` maps `working`, `agent_prompt_stalled`, `agent_blocked`
   to exit 0, 5, 6 and never re-sends on a stall.
6. `team-slice` uses `worktree_cmd` from `project.yaml` when present, the git
   default otherwise, and runs `git m add` only when `stacked: true`.
7. `team-status` joins the roster and flags idle agents without a fresh
   report.
8. `stop-report.sh` exits 0 silently for a session with no `.team` match,
   writes the report file for a match, and forwards only messages that begin
   with `REPORT `.
9. A hook error (unreadable transcript) exits 0 and logs one line.

---

## Marketplace entry

```json
{
  "name": "team",
  "description": "Orchestrator-plus-team-agents workflow for Claude Code with Herdr: one session you talk to, role agents in panes, briefs as files, a numbered decisions file, reports by hook. Kernel only; each project adds a small overlay.",
  "source": "./plugins/team",
  "category": "productivity"
}
```

`plugin.json`: name `team`, starting at `0.1.0`, with point releases (e.g.
`0.2.0`) as increments land; `1.0.0` after two runs (the colleague MR review,
then one slice) complete without a template edit.

---

## Publish steps

1. Create the files above; `chmod +x plugins/team/bin/* plugins/team/hooks/handlers/*.sh`.
2. `python3 -m unittest discover -s plugins/team/tests` green.
3. Develop and run with `claude --plugin-dir plugins/team` from the
   orchestrator profile; no marketplace install until 1.0.0.
4. Add the marketplace entry and a README table row; update the root README
   ("lists one plugin" is stale) and remove `adhd-explanatory-plugin-spec.md`.
5. Commit when Alfred asks; no agent-attribution trailers.

## Verify

- Unit tests green with pristine output.
- Real run 1: colleague MR review. `team-slice` on the MR branch, `/team:init`,
  two investigators (review, code health) and one tester started with
  `team-start`, briefs via `/team:brief`, reports arrive as files without any
  agent typing a herdr command, `/team:release` closes the tab.
- Real run 2: one feature slice end to end, absent-owner loop included.
- The overlay test: run 2 with the ProcureAI overlay, then a dry `team-brief
  compose` in a repo with no `.claude/team/` at all; both must produce valid
  briefs.
- Hook identity check: confirm the session-id match, or switch to the
  environment fallback, and record which in the README.

## Decisions to confirm before building

1. Plugin name `team` (command namespace `/team:*`). Alternatives:
   `orchestrate`, `crew`.
2. Reviewer and Mechanic as briefs on existing roles in 1.0, own agent files
   later.
3. Hook identity via session id match, environment variable as fallback.
4. Templates under `skills/` (readable from Cursor sessions, symlinkable)
   rather than a top-level `templates/`.
5. MIT license, same as the siblings.

## Notes

- Commit only when Alfred asks; never add agent-attribution trailers.
- The kernel must run with an empty overlay. Any line that fails the Rust-repo
  test goes to `references/lessons.md` or to the ProcureAI overlay, not here.

## Increment 2026-09-15

Plan: `docs/superpowers/plans/2026-09-15-team-watcher-and-layout.md`. Adds a
per-team watcher, pane/tab layout hygiene, and a team id so multiple teams run
at once without name collisions.

New scripts: `team-id` (slug or hash a team id), `team-init` (team id,
config, allowlist baseline, orchestrator tab record), `team-watch` (poll
loop: state-diff reporting, block-dialog text, idle-without-report flag,
layout hygiene). `team-start` gained team-id namespacing (`<team_id>-<label>`
agent names) and `--into-tab` tab-aware placement.

Budget rule: a team-managed tab holds at most 2 panes for the orchestrator
tab (the orchestrator and its watcher) or 6 for a worker tab; a 7th agent in
a worker tab spills to a new tab. Empty panes in team-managed tabs are closed
automatically; the watcher's own pane and panes outside team-managed tabs are
never touched.

Watcher launch: `team-watch --spawn` splits its own pane off the orchestrator
pane and runs the watcher there by absolute path with `--own-pane <id>`, so the
watcher never resolves its own pane from `herdr pane current` (which returns the
focused pane, wrong for a `--no-focus` watcher pane). The "consider release"
flag fires only for a tab that holds a briefed agent, so a freshly spawned,
un-briefed agent is never flagged. `team-start` registers a spilled tab only
after its agent is live, so the watcher never closes a new tab's empty root
pane.

`--spawn` runs the watcher with `herdr pane run <pane_id> <cmd> <args>` (the
CLI's positional form; its trailing `COMMAND...` accepts the hyphenated
`--own-pane`/`--interval` flags without a `--` separator).
