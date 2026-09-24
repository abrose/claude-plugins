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
| Toolchain | Alfred's environment, global | Herdr CLI (`herdr --skill` for its guide), git worktrees + machete, Claude Code | `herdr agent prompt --wait`, `git m update` guarded |
| Overlay | the project repository | `.claude/team/`, `.claude/skills/project-<role>/` | ports, tunnels, gate command, tracker hygiene, probe rules |
| Task | one ticket, ephemeral | `scratchpad/` (git-ignored) | decisions file, briefs, reports, open questions |

The kernel depends on the toolchain only through the Herdr CLI verbs
(`tab create`, `pane split`, `agent start`, `agent prompt --wait`,
`agent wait --until`, `agent read`, `agent list`, `agent send-keys`) and on
git. It never restates a Herdr command in prose; `herdr --skill` is the
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
   composes the team on demand - it starts an agent when a task needs one, and
   never asks up front which roles the run will use. It never does operational
   work itself: no investigating a question, no analysing
   code to answer one, no running tests, no driving a browser, no editing files,
   no running project or build commands. If a task is worth doing, it briefs an
   agent, even when the task looks quick. The only self-actions: talk to the
   human; read the decisions file, briefs, reports, and delivered files; run the
   `team-*` scripts; one read-only lookup to get a fact a brief needs or to
   verify one report claim; git fast-forward its own worktree. Reading to brief
   or verify is not a licence to investigate.
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
11. Reset an agent's context before every reuse; never stack a new task on an
    old context. `/clear` is the default - briefs and the decisions file carry
    the context. When the old context holds knowledge the next task needs,
    `/compact` instead. Confirm the reset landed before the next brief.
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
| investigator | `team-investigator` | Opus 4.8 | medium | auto | yes for code (Write scoped to scratchpad) | digests, analysis with numbered open questions, canvas, crit on own doc, code review, code health |
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
disallowedTools: Edit, MultiEdit, NotebookEdit
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

The Investigator's read-only guarantee for code holds through two halves:
`disallowedTools` blocks `Edit`/`MultiEdit`/`NotebookEdit` so it can never
change an existing file, and `Write` stays available but scoped by
`team-role-investigator`'s rule to creating new files under the scratchpad
only (so a long deliverable does not need a Bash heredoc, which can exceed
the shell parser limit and trip a permission dialog). A brief must not try to
lift either half. The Bash tool stays available to every role; destructive
commands are governed by the role skill and the plugin hook (see below), not
by removing Bash.

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
| `.team/<name>.json` | `team-start`, `team-brief` | `{role, topic, brief, pane, started, cwd}` |
| `.team/roster.md` | `team-status` | last rendered roster, for pasting into status messages |

### `team-start`

```
team-start <name> <role> (--pane <id> | --split <pane> right|down | --into-tab <tab_id> | --new-tab [--label <text>])
           [--effort low|medium|high]
           [--mode auto|accept-edits] [--cwd <dir>] [--dry-run]
```

1. Resolve `<role>` to the agent file and default effort from the role table.
   Namespace the name as `<team_id>-<label>` from `.team/config.json`, then
   refuse with exit 3 if the live `herdr agent list` already holds that name: a
   name a live agent owns is not restartable without seizing its pane.
2. Resolve `--cwd`. If it was not given: for `--pane`, read the pane's real
   cwd from `herdr pane get <id>` (`result.pane.cwd`), never this script's own
   `$PWD`; for every other placement, default to `$PWD` as before.

3. Create the pane if `--split`, `--into-tab` or `--new-tab` was given; read
   `pane_id` from the JSON. `--new-tab` creates a tab and takes its root pane.
   `--into-tab` fills a tab's lone bare shell pane instead of splitting it. A
   created tab goes into the caller's live workspace (`herdr pane current
   --current`), never the spawn-time `$HERDR_WORKSPACE_ID`. Stamp `TEAM_NAME=<name>`
   and the absolute `TEAM_SCRATCH` onto the pane so the agent's Stop hook can
   identify itself and find the team dir from any cwd: `--env` on a pane/tab
   this step creates, or a
   `herdr pane run <pane> "export TEAM_NAME=<name> TEAM_SCRATCH=<abs>"` into a
   caller-provided `--pane`.
4. `herdr agent start <name> --kind claude --pane <pane> --timeout 90000 -- --agent team-<role> --effort <lvl> --permission-mode <mode> --name <name> --settings '{"crossSessionInbound":"accept"}'`.
   `--name` gives `claude` the same resolved name Herdr knows it by, so
   `ListAgents`/`SendMessage` reach it by that name. `--settings` accepts
   cross-session messages so a peer question is never held pending approval.
   Requires Claude Code v2.1.236 or later for `notify_when_idle` to work
   against this agent (see Increment 2026-09-24).
5. Pre-flight, in order: if start fails with `agent_not_ready` (an error on
   stderr, exit 1), the agent is at a startup dialog (folder trust, MCP
   servers). Never answer it: it is a security decision for the human. Abort
   with exit 3, the pane id and the `agent read --source detection` screen
   text; the human answers it, closes that pane and re-runs `team-start`. Any
   other start error -> exit 4. Then verify the status bar once: model, mode,
   cwd. Abort with exit 3 and the screen text if any of the three is wrong.
6. Write `.team/<name>.json` with role, pane, started, and the resolved
   `cwd` (absolute), so `team-brief send` can tell a worktree agent from a
   main-repo one.
7. Print one JSON line: `{"name","role","pane","session","model","mode"}`, where
   `session` is the first 8 chars of Herdr's `agent_session.value` (for the
   human-facing roster only; the hook does not use it).

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

`send` records `topic` and `brief` in `.team/<name>.json`. If the agent's
record `cwd` is set and differs from `send`'s own cwd (a worktree agent), it
first copies the brief and, when the team's `ticket` names one, the decisions
file into `<cwd>/scratchpad/`, so the agent never reads a path outside its
own working directory; the kick-off then names the brief relative to that
cwd instead of the orchestrator's path.

It then runs `herdr agent prompt <name> "Read <brief-ref> and execute it
fully. Report back as it describes. You are in execution mode; if your
session shows plan mode, say so immediately." --wait --until working --until
blocked` and maps the result: herdr's real contract is that plain `--wait`
waits for a fully settled state (idle/done/blocked), never `working`, so
`--until working` (repeated with `--until blocked`) is required to return as
soon as either is observed. `agent_status: working` (or any other non-blocked
settled state) -> exit 0 and print the status; `agent_status: blocked`
(matched mid-turn, returned as success, not an error) -> read the dialog text
with `agent read --source detection` and print it, exit 6; the error
`agent_prompt_stalled` -> read the pane, print the last 20 lines, exit 5
without re-sending (the orchestrator decides); the error `agent_blocked` (the
agent was already at a dialog before submission) -> print its `dialog` field,
exit 6.

### `team-slice`

```
team-slice <branch> <parent> --label "<Tn> <KEY> <slug>" [--ticket <KEY>] [--copy <dir> ...]
```

1. Create the worktree. The command comes from the overlay's `project.yaml`
   (`worktree_cmd`, with `{branch}` and `{parent}` placeholders); default
   `git worktree add -b {branch} scratchpad/wt-{branch} {parent}`, so the
   worktree lands inside the repo, not next to it. Resolve the worktree's real
   path to absolute before handing it to herdr as `--cwd`; a relative path
   resolves against herdr's own process, not this script's caller.
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

1. Read the hook payload from stdin (`transcript_path`, `cwd`).
2. Read `TEAM_NAME` and `TEAM_SCRATCH` from the environment (`team-start`
   stamps both onto the pane; `TEAM_SCRATCH` is absolute, so the agent's cwd
   does not matter). No `TEAM_NAME`, a malformed one, or no
   `$TEAM_SCRATCH/.team/<TEAM_NAME>.json` -> exit 0.
   This is how a session knows it is a team agent and which one.
3. Extract the last assistant message from the transcript. Write it to
   `reports/<name>-<topic>.md` with a header (name, topic, brief path,
   timestamp). Overwrite on every stop, so the file always holds the latest.
4. Push a line to the orchestrator pane on every stop, so it never waits on a
   worker that is already done: `herdr agent prompt <orchestrator> "<line>"`,
   where `<orchestrator>` comes from `.team/config.json` (default `orchestrator`).
   The `<line>` is the first line in the message that starts with `REPORT ` (found
   anywhere, not only at the start), or, when the message has none, a synthesized
   `REPORT <name> <topic>: stopped without a REPORT line - read <report path>`.
   Never push when `<name>` equals `<orchestrator>` (no self-ping).
5. Never block the stop; on any error exit 0 and append one line to
   `.team/hook.log`.

Resolved: Herdr's `agent_session.value` and Claude Code's `session_id` are
different identifiers, so a session-id match never fires. `team-start` stamps
`TEAM_NAME` onto the pane environment (`--env` on a pane/tab it creates, or a
`herdr pane run` export into a caller-provided `--pane`) and the hook identifies
itself from that.

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
End your final turn with this line as plain text, then stop:
REPORT {{name}} {{topic}}: <at most ten lines: verdict, files written, counts, blockers>
Do not run any command to send it. Stopping saves your whole message to the report
file and delivers the REPORT line to {{orchestrator}}.

## Rules
- Source-backed facts only; unknowns become numbered open questions.
- No em dashes. No agent-attribution trailers in commits.
- One thing at a time; stop after reporting.
- If your session shows plan mode, say so immediately instead of working.
```

Role templates add sections: `brief-analysis.md` (digest, concept inventory
with code pointers, candidate split, open-questions file with options,
evidence `file:line`, trade-offs, one recommendation each);
`brief-implementation.md` (worktree, gate, unstaged deliverable, own-commit
invariant for stacks under an explicit go, re-verify pointers, gate greps,
spdd sync last);
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
2. `team-start` hands a startup dialog to the human (exit 3, no keys sent)
   and aborts with exit 3 on a wrong model in the status bar.
3. `team-brief compose` concatenates skeleton, overlay role fragment, env and
   gate in order; substitutes variables; refuses to overwrite.
4. `team-brief compose` with an empty overlay still produces a valid brief
   (the project-agnostic guarantee).
5. `team-brief send` maps a settled state (printed from
   `result.agent.agent_status`), `agent_prompt_stalled`, `agent_blocked` to
   exit 0, 5, 6 and never re-sends on a stall.
6. `team-slice` uses `worktree_cmd` from `project.yaml` when present, the git
   default otherwise, and runs `git m add` only when `stacked: true`.
7. `team-status` joins the roster and flags idle agents without a fresh
   report.
8. `stop-report.sh` exits 0 silently for a session with no `TEAM_NAME` or no
   record, writes the report file when it identifies its agent, and on every
   stop forwards the message's `REPORT ` line (found anywhere) or a fallback
   nudge, never to itself.
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
- Hook identity check: done. The session-id match never fires (Herdr and Claude
  Code use different identifiers), so the hook identifies its agent from the
  `TEAM_NAME` pane environment, recorded in the README.

## Decisions to confirm before building

1. Plugin name `team` (command namespace `/team:*`). Alternatives:
   `orchestrate`, `crew`.
2. Reviewer and Mechanic as briefs on existing roles in 1.0, own agent files
   later.
3. Hook identity via the `TEAM_NAME` pane environment (the session-id match was
   the original plan but the two ids differ, so it never fires).
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
agent names) and `--into-tab` tab-aware placement that tiles a worker tab as a
2-column, 3-row grid.

Budget rule: a worker tab holds at most 6 panes; a 7th agent in a worker tab
spills to a new tab. The orchestrator tab (the one holding the watcher's own
pane) is the human's workspace and is left alone: the watcher never closes or
budget-flags its panes, so a pane opened there by hand survives. Worker-tab
panes tile as a 2-column, 3-row grid: `team-start` reads the tab geometry
(`herdr pane layout`) and splits the correct pane so the grid stays even,
instead of stacking panes in one column. Empty panes in worker tabs are closed
automatically; the watcher's own pane, the orchestrator tab, and panes outside
team-managed tabs are never touched.

Watcher launch: `team-watch --spawn` splits its own pane off the orchestrator
pane (`--ratio 0.8`, so the orchestrator keeps most of the tab and the watcher
is a small strip) and runs the watcher there by absolute path with
`--own-pane <id>`, so the
watcher never resolves its own pane from `herdr pane current` (which returns the
focused pane, wrong for a `--no-focus` watcher pane). The "consider release"
flag fires only for a tab that holds a briefed agent, so a freshly spawned,
un-briefed agent is never flagged. `team-start` registers a spilled tab only
after its agent is live, so the watcher never closes a new tab's empty root
pane.

`--spawn` runs the watcher with `herdr pane run <pane_id> <cmd> <args>` (the
CLI's positional form; its trailing `COMMAND...` accepts the hyphenated
`--own-pane`/`--interval` flags without a `--` separator).

## Increment 2026-09-18

Report delivery is now the Stop hook's job on every worker stop, not a fragile
worker-run command. `stop-report.sh` writes the report file (unchanged) and then
pings the orchestrator every time a team worker stops: it forwards the first
`REPORT ` line found anywhere in the final message, or, when there is none, a
synthesized `REPORT <name> <topic>: stopped without a REPORT line - read <report
path>` nudge. It never pings when the worker name equals the orchestrator. The
brief's "Report back" section now tells the worker to end its turn with a plain
`REPORT` text line and stop; it no longer runs `herdr agent prompt` itself.

Name-uniqueness guard. `team-init` chooses a team id whose `<team_id>-*` name
namespace is free among live `herdr agent list` agents: the ticket slug, then
`-2`..`-9`, then random hashes. So a second team (for example a re-run of the
same ticket whose agents are still live) never shares names and cross-poisons
the first. `team-start` refuses with exit 3 when the resolved `<team_id>-<label>`
is already a live agent.

## Increment 2026-09-21

The orchestrator tab is now the human's workspace, exempt from the watcher's
pane hygiene. Layout hygiene (empty-pane closing and the over-budget flag) runs
on worker tabs only; the watcher skips the tab that holds its own pane. A pane
opened there by hand is no longer closed, and the tab is no longer nagged as
over budget. The worker-tab budget stays 6.

The Stop hook now identifies its agent from the `TEAM_NAME` pane environment,
not from a session-id match. On a real run the recorded `session` (Herdr's
`agent_session.value`) never equalled Claude Code's `session_id`, so the match
never fired: workers wrote their report line but the hook exited before writing
the report file or pinging, and the orchestrator waited forever. `team-start`
now stamps `TEAM_NAME=<name>` onto the agent's pane - with `--env` on a pane or
tab it creates, or a `herdr pane run` export into a caller-provided `--pane` -
and the hook reads it, loads `.team/<name>.json`, and pings as before. The
record no longer stores `session`.

## Increment 2026-09-23

Worker tabs are born with their first agent. `team-start --new-tab [--label
<text>]` creates a tab and starts the agent in its root pane, then registers the
tab once the agent is live. Before this, no script created a worker tab: the
orchestrator improvised a raw `herdr tab create`, and `--into-tab` then split
the tab's lone bare shell, leaving that shell empty beside the agent. The tab
was never registered, so the watcher never closed that pane. `--into-tab` now
also fills a lone bare shell pane instead of splitting it.

Every tab a script creates (`--new-tab`, a spill, `team-slice`) goes into the
caller's live workspace from `herdr pane current --current`. The pane
environment's `HERDR_WORKSPACE_ID` is a spawn-time snapshot that goes stale
after a pane move, and a raw `tab create` without `--workspace` follows the
UI-focused workspace; either put worker tabs in a workspace other than the
orchestrator's.

## Increment 2026-09-24

`team-start` now passes two extra arguments to `claude` after the `--` in
`herdr agent start`, and in the `--dry-run` echo: `--name <name>` (the same
`<team_id>-<label>` name Herdr resolved) and `--settings
'{"crossSessionInbound":"accept"}'`. Before this, the agent's Claude Code
session had no name of its own, so native `ListAgents`/`SendMessage` could
not address it by the name the roster and the Stop hook already use, and its
default cross-session inbound setting could hold a peer's message pending
human approval instead of delivering it.

`skills/team-orchestration/SKILL.md` gained rule 16: after `team-brief send`,
the orchestrator subscribes to the agent with `SendMessage`'s
`notify_when_idle` input, a second idle signal next to the Stop hook. The
Stop hook stays the report channel.

The three role skills (`skills/team-role-*/SKILL.md`) now allow an agent to
use `SendMessage` to ask another team agent or the orchestrator a question
mid-task, while the deliverable stays a file and REPORT stays the only
report channel.

This increment does not have the Stop hook post to the orchestrator's own
messaging socket: `CLAUDE_CODE_MESSAGING_SOCKET` names the posting session's
own socket, not a way to reach another session. The REPORT ping and brief
kick-off stay on Herdr.

Version gate: `notify_when_idle` requires Claude Code v2.1.236 or later in
both the orchestrator's session and the agent's session
(code.claude.com/docs/en/cross-session-messaging, "Get a notice when another
session goes idle"). Without it, `SendMessage`'s `notify_when_idle` input is
refused; fall back to rule 8 (poll idle agents by hand) until every session
in the team is on a new enough version.

## Increment 2026-09-24 (defects)

Fixes for defects 4-7 and 9-12 found during the agent-teams-compare run
(`team-plugin-defects.md`). Defects 1-3 were already fixed or are
environment; defect 8 is environment.

**Defect 9** (`team-slice`, `team-start`): the default worktree now lands
inside the repo at `scratchpad/wt-{branch}`, not next to it at `../{branch}`;
`team-slice` resolves that path to absolute before handing it to herdr's
`--cwd`, since herdr resolves a relative one against its own process, not the
caller's. `team-start --pane <id>` with no `--cwd` now reads the pane's real
cwd from `herdr pane get <id>` (`result.pane.cwd`) instead of defaulting to
`team-start`'s own `$PWD`, so the pre-flight status-bar cwd check compares
against the right value. An earlier version of this fix used `herdr pane
process-info` and the last entry of its `foreground_processes` list; that
field's order is not guaranteed and a bare shell pane can have no foreground
process at all, so it was replaced with the pane's own `cwd` field.

**Defect 10** (`team-start`, `team-brief`): `team-start` now records the
agent's resolved, absolute `cwd` in `.team/<name>.json`. `team-brief send`
compares that cwd to its own; when they differ (a worktree agent), it copies
the brief and the decisions file (named from the team's `ticket`) into
`<cwd>/scratchpad/` before the kick-off, and names the brief in the kick-off
prompt by a path relative to that cwd. A worktree agent no longer reads a
path outside its own working directory, which used to trip
`blockReadsOutsideWorkingDirectories` into a dialog.

**Defect 4** (`team-brief send`): reproduced against `herdr agent prompt
--help`. Plain `--wait` waits for a fully settled state (idle, done, or
blocked); it never returns while the agent is `working`, which is why `send`
used to run for the length of the whole task. `--until <STATUS>` is
repeatable and changes which state ends the wait, so `send` now calls
`herdr agent prompt <name> "<text>" --wait --until working --until blocked`:
it returns at once when the agent starts working, matching SPEC.md, and also
when a dialog appears mid-turn. A `blocked` result reached this way is a
success, not the `agent_blocked` error (that error is only the pre-check for
an agent already blocked before submission); `send` reads the dialog text
with `agent read --source detection` in both cases before exiting 6, instead
of printing the raw error JSON. `tests/fake-herdr` models both paths
(`prompt_working`, `prompt_blocked_midrun`, and the existing pre-check
`prompt_blocked`). No numbered open question was needed: the SPEC's
`working -> exit 0` contract is reachable with `--until`.

**Defect 7** (`team-init`): a leftover `.team/config.json` from a finished
team no longer refuses `team-init` outright. If none of that team's agents
(`<team_id>-*`) is live in `herdr agent list`, `team-init` moves `.team` to
`.team-<old ticket>` (or `.team-<old ticket>-2`, etc. if that name is taken)
and continues with the new team. If any agent is still live, it refuses as
before and now names the live agents in the error.

**Defect 6** (`/team:release`): `commands/release.md` now tells the
orchestrator that `/clear` always returns `agent_prompt_stalled` (it never
starts a turn), and to confirm the reset from the agent's context gauge
reading 0 percent instead of the prompt's exit code.

**Defect 5**: `Write` is no longer in `team-investigator`'s
`disallowedTools`; `Edit`, `MultiEdit`, and `NotebookEdit` stay blocked.
`team-role-investigator/SKILL.md` binds `Write` to creating new files under
the scratchpad only, never to creating or overwriting a file elsewhere in
the repository, so the read-only guarantee for code now rests on that rule
plus `Edit` being blocked, not on `Write` being blocked. SPEC.md's "Agent
frontmatter" section and the roles table are updated to match. This removes
the failure mode where a long investigator deliverable, written through a
Bash heredoc, exceeded the shell parser limit and tripped a permission
dialog.

**Defect 11**: `team-role-implementer/SKILL.md` and
`templates/brief-implementation.md` said the deliverable was the committed
change; both now say the deliverable is the unstaged change plus a notes
file, and that the agent commits only under an explicit go in the brief. This
matches the standing rule that the human reviews and commits.

**Defect 12**: all three role skills
(`skills/team-role-*/SKILL.md`) now state the same rule: read files with the
Read tool, never a Bash `cat`/`find`/heredoc; create and change files with
Write/Edit only (Write scoped to scratchpad for the investigator, to test and
scenario files for the tester); never read, search, or write outside your
own worktree.
