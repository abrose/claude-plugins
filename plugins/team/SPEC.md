# Spec: `team` - orchestrator-plus-team-agents workflow as a Claude Code plugin

## Goal

Package the orchestration workflow practised on APP-5066 (one orchestrator
session Alfred talks to, role agents in Herdr panes, briefs as files, a
numbered decisions file) as a plugin in the `abrose-plugins` marketplace, so
that any project on any profile can run it with `/plugin install` plus a small
per-project overlay. Since 0.6.0 the human talks to an envoy session and the
orchestrator never speaks to the human; open questions are cards. The plugin is the **kernel**: project-agnostic process,
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
  - model, permission mode and effort are start flags on the pane's `claude`
    process (`--model`, `--permission-mode`, `--effort`), passed by
    `team-start`; the agent file's `model` only matches the role default;
  - the kick-off prompt is sent by the team mod's `brief_send` tool, not by the
    agent file.
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
| Task | one ticket, ephemeral | `scratchpad/current/` (git-ignored) | decisions file, briefs, reports, open questions |

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
        │   │       ├── progress.md
        │   │       └── report.md
        │   ├── team-role-investigator/SKILL.md
        │   ├── team-role-implementer/SKILL.md
        │   ├── team-role-tester/SKILL.md
        │   └── team-role-envoy/SKILL.md
        ├── agents/
        │   ├── team-investigator.md
        │   ├── team-implementer.md
        │   ├── team-tester.md
        │   ├── team-orchestrator.md
        │   └── team-envoy.md
        ├── commands/
        │   ├── init.md                  # /team:init
        │   ├── brief.md                 # /team:brief
        │   ├── status.md                # /team:status
        │   ├── release.md               # /team:release
        │   └── resurrect.md             # /team:resurrect
        ├── hooks/
        │   ├── hooks.json               # command hooks + the mod module
        │   ├── handlers/stop-report.sh
        │   ├── handlers/session-start.sh
        │   └── mod/                     # the team mod (Claude Code function hooks)
        │       ├── team.tsx             # register: every hook, and the Io built over $
        │       ├── io.ts, paths.ts, activation.ts, herdr.ts, tick.ts, facts.ts, brief.ts
        │       ├── cards.ts, questions.ts, decide.ts, decisions.ts, relay.ts, badge.ts
        │       └── plan.ts, pane.tsx, watch.ts, layout.ts, reports.ts   # pure
        ├── types/index.d.ts             # the mod's state contract
        ├── bin/
        │   ├── team-id
        │   ├── team-init
        │   ├── team-start
        │   ├── team-brief
        │   ├── team-slice
        │   ├── team-status
        │   ├── team-resurrect
        │   └── team-forget
        ├── lib/
        │   ├── teamlib.py               # records and agent state, shared by bin/
        │   └── plugin-dir.sh            # --plugin-dir for team-start and team-resurrect
        └── tests/
            ├── test_team.py             # stdlib unittest, subprocess the scripts
            ├── fake-herdr               # PATH shim that records calls, returns canned JSON
            ├── fake-git                 # PATH shim that records git calls
            ├── fake-claude              # PATH shim that answers claude --version
            └── mod/                     # claude plugin test: world.ts + *.test.ts
```

Scripts are bash with `set -euo pipefail`, and `python3` for JSON. No other
dependencies. `chmod +x` before commit.

---

## Protocol (content of `skills/team-orchestration/SKILL.md`)

Verbatim rules, kept to one page. Everything else is in `references/`.

1. The orchestrator plans, briefs, reads reports, and decides with the human
   through cards and the envoy, never in chat. It
   composes the team on demand: it starts an agent when a task needs one, and
   never asks the human up front which roles the run will use. It fits
   `team-start --model` and `--effort` to each job: `opus-5-5` for deep
   analysis and review, `sonnet-5-5` for code and tests, `haiku-5-5` at
   effort `high` for mechanical jobs such as Jira writes. Omit a flag only when the role default fits the job; a
   human or project rule for a kind of job wins. It never does
   operational work itself. It never investigates a question, never
   analyses code to answer one, never runs a test, never drives a browser, never
   edits a file, never runs a project or build command. If a task is worth
   doing, it briefs an agent to do it, even when the task looks quick and even
   when no agent is running yet (start one). When you notice yourself about to do
   the work, stop and brief an agent instead.
   The orchestrator does only these things with its own hands: file cards with
   `ask`; act on RELAY lines;
   read the decisions file, briefs, reports, and delivered files; run the
   `team-*` scripts; read one file or run one read-only command to get a single
   fact a brief needs or to verify one claim of a report; git fast-forward its
   own worktree. Reading to brief or to verify is never a licence to start
   investigating - one read, then delegate.
2. The human decides, through the envoy. A card recommends one option with one
   sentence of reasoning.
3. Briefs are files in `scratchpad/current/`. Prompts are one line pointing at the brief.
   Revisions are new files (`-rev2`), never edits of the original.
4. The decisions file is the single binding source. Every brief reads it first.
   Every decision is numbered, including one-word answers. Amendments get a
   suffix (3a). After `team-init` creates the file, the envoy is its only
   writer, through the `decide` tool; nobody edits it by hand.
5. Agents report by name: `REPORT <name> <topic>: <summary>`. A REPORT names the
   cards its agent filed: `REPORT tester fixtures: 2 questions open (Q-12, Q-13)`.
   A worker writes that
   line as plain text and stops; the Stop hook writes the report file and the
   team mod in the orchestrator session delivers the line to the orchestrator
   within 15 s. The
   deliverable is always a file. The report is a summary of at most ten lines. The
   orchestrator reads the file before discussing.
6. Reports reach the human only as cards. The envoy presents one group of cards
   at a time, chosen by the human or proposed by the envoy. A DECISION line tells
   the orchestrator what was decided; it passes the answer to the waiting worker
   and schedules any rework an overridden assumption causes.
7. Every mention of an agent in a card carries `name (pane, session)`.
8. Idle is not done. A worker that goes idle without a REPORT is often waiting
   on its own subagents: leave it alone. When the team mod flags
   `idle, no report`, `agent read` that worker's pane. A `done` wait without a REPORT
   means read the screen.
9. Only source-backed facts in every artifact. An unknown stays a numbered open
   question, never a guess; one that only the human can answer also becomes a
   card via `ask` (rule 21). Verify one load-bearing claim of every report
   before relaying it.
10. Fix loops are capped at three rounds of test, fix, re-test. Say the round
    count in every status. A fourth round is the human's explicit exception.
    Behaviour-neutral tidy-ups do not count as rounds.
11. Reset an agent's context before every new task. Never brief a new task on
    top of an old context: each reuse then stacks another layer, and the
    context grows every round for no gain. When the new task is unrelated to
    the current one, `/clear` - the brief and the decisions file carry all the
    context it needs. Every other new task (a follow-up, a fix round, the next
    step of the same work) gets `/compact`, so what the agent learned survives
    in condensed form. Confirm the reset landed (the agent reports a cleared or
    compacted context) before you send the next brief. A `/clear` gives the
    agent a new session id and the hooks follow it; a `/compact` keeps the id
    and the hooks lift its brief mark. `brief_send` refuses an agent that was
    neither cleared nor compacted since its last brief.
12. When the human is away, the orchestrator writes every own call to
    `scratchpad/current/orchestration-decisions.md` with context, so it can be audited.
    The human's decisions stay in the numbered file.
13. Anything an agent produces is a file. The chat carries summaries and
    decisions only.
14. The team mod runs in the orchestrator's session and in the envoy's. Every 15 s it flags an agent that
    turns blocked or stays quiet for 2 minutes without a REPORT, and keeps the
    layout within budget. Other state changes show only in the `Team` pane.
    Never sit blind: act on `WATCH` lines.
15. Pane budgets: the human's tab is the envoy's (the `Team` and `Questions`
    tabs are panes inside the envoy session, not herdr panes); the orchestrator
    runs in its own worker tab, which layout hygiene leaves alone; any other
    worker tab holds at most 6, tiled as a
    2-column, 3-row grid. A 7th agent goes to a new tab. In a team tab, an
    empty pane closes automatically only when a team record names it (an
    agent that exited); a pane no record names, such as one a human opened by
    hand, is left alone. Open a worker tab only with `team-start --new-tab`,
    which puts the first agent in the tab's root pane in the caller's workspace;
    add more agents with `--into-tab`. Never create a tab with raw `herdr`.
16. The orchestrator never speaks to the human. The envoy speaks only when the
    human pulls; urgent cards show as a status line and a toast in the envoy
    session, never as a turn.
17. Keep the plan file `progress-<ticket>.md` current; the overview pane shows
    it to the human. Orchestrator-level steps only, never a worker's
    sub-steps. Markers: `- [x]` done, `- [>]` running, `- [ ]` next; name the
    role in parentheses, `fix round 2 (impl)`. The mark alone sets where the
    pane shows an item: flip the mark in place, never move lines between the
    DONE, RUNNING and NEXT headings. Update it after every REPORT, before
    every `brief_send`, and whenever a card asks the human to act.
18. The run's files live only in `scratchpad/current/`. Never read, list or
    search `scratchpad/.archive/` unless the human asks about an earlier run.
19. Create a worktree only with `team-slice`, which uses the repo's own
    worktree tooling from `.claude/team/project.yaml`. If it refuses for lack
    of an overlay, ask the human how this repo makes worktrees. Never run
    `git worktree add` yourself, and never put a worktree inside `scratchpad/`.
20. Shell discipline: one simple command per Bash call. No `$VAR` or
    `${...}` expansions, no `$(...)`, no `<(...)`, no `;`, `&&`, pipes or
    `2>&1`. Read files
    with the Read tool; search with a dedicated search tool when the session
    has one, otherwise one plain `grep -n <literal> <file>` per call (an em
    dash can be typed literally), including em dash scans. If a command still
    prompts, find a simpler form instead of waiting. Such commands trigger
    permission prompts that stall the run.
21. Every card states door (one-way or two-way) and rework (a concrete
    estimate). Park a two-way card with about an hour of rework or less: file it
    with `parked: true`, record the assumption in your work, and continue. Wait
    on every other card; its `blocks` field names what waits.

---

## Roles

Model and effort are start flags. The defaults below are what `team-start`
passes when `--model` or `--effort` is omitted. The orchestrator picks
another model or effort per job with `--model` and `--effort`. The model
allowlist is `opus-5-5`, `sonnet-5-5`, `haiku-5-5`. Every other model,
Fable included, is refused with exit 2. When `--effort` is omitted,
`haiku-5-5` defaults to effort `high` whatever the role; the other models
follow the role default.

| Role | Agent file | Model | Effort | Mode | Read-only | Used for |
|---|---|---|---|---|---|---|
| investigator | `team-investigator` | Opus 5.5 | medium | auto | yes for code (Write scoped to `scratchpad/current/`) | digests, analysis with numbered open questions, canvas, crit on own doc, code review, code health |
| implementer | `team-implementer` | Sonnet 5.5 | medium | auto | no | code in a worktree, fix rounds, MR creation on go, Jira writes on go |
| tester | `team-tester` | Sonnet 5.5 | low | auto | yes (except test files) | diff review + gate, live rounds, finding classification, manual-test partner |
| orchestrator | `team-orchestrator` | Opus 5.5 | medium | auto | by rule 1 (no tool filter) | runs the team from a worker tab: briefs, reads reports, acts on RELAY and DECISION lines; started by `team-init`, never talks to the human |
| envoy | `team-envoy` | Opus 5.5 in a fresh `claude --agent team-envoy` session; the human's own model otherwise | - | the session's own | In a fresh `claude --agent team-envoy` session: yes (`Edit`, `MultiEdit`, `NotebookEdit`, `Write` blocked). In the human's own session after `/team:init`: no, it keeps every tool and only the prose rule of `team-role-envoy` guards it | the human's session after `/team:init` (it only loads the `team-orchestration` and `team-role-envoy` skills), or a fresh session started with `claude --agent team-envoy`; presents cards, records decisions, relays requests |

Reviewer and Mechanic are not separate agent files: a reviewer is
`team-investigator` with `brief-review.md`; a mechanical job runs on
`team-implementer` with `--model haiku-5-5`. Haiku 5.5 supports auto mode
and starts in `auto` like the other models.

### Agent frontmatter

```yaml
# agents/team-investigator.md
---
name: team-investigator
description: Read-only analysis, review and design-document agent for the team workflow. Started as a main session with --agent.
model: claude-opus-5-5
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

`team-orchestrator` preloads only `team-orchestration`; its prompt says it never
talks to the human in chat, files anything it needs from the human with `ask`,
and acts on RELAY, REPORT, DECISION and WATCH lines. `team-envoy` preloads
`team-orchestration` and `team-role-envoy` and blocks `Edit`, `MultiEdit`,
`NotebookEdit` and `Write`: it records decisions with the `decide` tool, never
by editing the decisions file. `team-start` knows the roles `investigator`,
`implementer`, `tester` and `orchestrator`; the envoy is never started by it.

The Investigator's read-only guarantee for code holds through two halves:
`disallowedTools` blocks `Edit`/`MultiEdit`/`NotebookEdit` so it can never
change an existing file, and `Write` stays available but scoped by
`team-role-investigator`'s rule to creating new files under `scratchpad/current/`
only (so a long deliverable does not need a Bash heredoc, which can exceed
the shell parser limit and trip a permission dialog). A brief must not try to
lift either half. The Bash tool stays available to every role; destructive
commands are governed by the role skill and the plugin hook (see below), not
by removing Bash.

---

## Interface contract

### Task-scope files

All under `$TEAM_SCRATCH` (default `scratchpad/current/`, git-ignored). The kernel
creates and reads these; the overlay never does.

| File | Written by | Purpose |
|---|---|---|
| `decisions-<ticket>.md` | `team-init` (header from `templates/decisions.md`), then the `decide` tool | numbered, binding; one paragraph per decision `<n>. (<date>) <answer> Why: <rationale> Cards: <ids>.` |
| `progress-<ticket>.md` | `team-init` (from `templates/progress.md`), then the orchestrator | the plan the `Team` pane shows |
| `orchestration-decisions.md` | orchestrator | own calls while the human is away (rule 12; whether cards replace it is a follow-up, decision 55) |
| `brief-<name>-<topic>.md` | `team-brief compose` | the assignment; `-revN` for follow-ups |
| `reports/<name>-<topic>.md` | agent (via hook) | deliverable summary, deterministic path |
| `.team/config.json` | `team-init` | `{team_id, ticket, orchestrator, envoy_session, envoy_tab, orchestrator_session, orchestrator_tab}`; `envoy_tab` only with `--envoy-pane`; `orchestrator_session` and `orchestrator_tab` once the orchestrator is up. The team mod also rewrites `orchestrator_session` or `envoy_session` when that session runs `/clear` (`hooks/mod/activation.ts`); nothing else follows a new session id |
| `.team/<name>.json` | `team-start`, `team-brief`, `brief_send`; deleted by `team-forget` | `{role, topic, brief, pane, started, cwd, session, model, effort, mode}`; `brief_send` adds `brief_sent_session` (the `SessionStart` hook removes it on `/compact`) |
| `.team/roster.md` | `team-status` | last rendered roster, which the envoy shows on `/team:status` |
| `.team/questions/Q-<n>.json` | the `ask` tool | one card |
| `.team/questions/claims/<n>` | the `ask` tool | a directory per claimed card number |
| `.team/decisions/<n>.json` | the `decide` tool | the ledger the orchestrator's tick reads, one entry per decision |
| `.team/delivered.json` | the orchestrator's tick | marks of delivered reports; `_decision` holds the last delivered decision number |
| `.team/toasted.json` | the envoy's tick | ids of urgent cards seen or toasted |
| `.team/last-relay.txt` | the `relay` tool | the orchestrator session on the first line, then the last `RELAY` text sent to it |

### `team-start`

```
team-start <name> <role> (--pane <id> | --split <pane> right|down | --into-tab <tab_id> | --new-tab [--label <text>])
           [--model opus-5-5|sonnet-5-5|haiku-5-5] [--effort low|medium|high|xhigh|max]
           [--mode auto|accept-edits] [--cwd <dir>] [--dry-run]
```

1. Resolve `<role>` (`investigator`, `implementer`, `tester` or `orchestrator`)
   to the agent file, default model and default effort from
   the role table. Refuse with exit 2 a model outside the allowlist, an
   effort claude does not know. The mode defaults to `auto` for every model.
   `accept-edits` goes to claude as `--permission-mode acceptEdits`.
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
   caller-provided `--pane`. When the caller has `CLAUDE_CONFIG_DIR` (a Claude
   Code profile), stamp it the same way: a pane's shell takes its env from the
   herdr server, so without it the worker runs in the default profile.
   `team-resurrect` adds it to its export too.
4. `herdr agent start <name> --kind claude --pane <pane> --timeout 90000 -- --agent team-<role> --session-id <uuid> --model <model id> --effort <lvl> --permission-mode <mode> --name <name> --settings '{"crossSessionInbound":"accept"}' [--plugin-dir <plugin root>]`.
   `--name` gives `claude` the same resolved name Herdr knows it by, so
   `ListAgents`/`SendMessage` reach it by that name. `--settings` accepts
   cross-session messages so a peer question is never held pending approval.
   `--plugin-dir` (from `lib/plugin-dir.sh`, which `team-resurrect` sources
   too) hands the new `claude` the plugin this script came from: a `claude` that
   Herdr starts in a pane loads only the installed plugin, which may lack this
   version's `agents/team-<role>.md` and mod, and then `--agent` fails and
   `herdr agent start` times out. The flag is left out when the script runs from
   an installed copy (a path under `<profile>/plugins/cache/`), which loads by
   itself. The `--dry-run` echo shows it.
5. Pre-flight, in order: if start fails with `agent_not_ready` (an error on
   stderr, exit 1), the agent is at a startup dialog (folder trust, MCP
   servers). Never answer it: it is a security decision for the human. Abort
   with exit 3, the pane id and the `agent read --source detection` screen
   text; the human answers it, closes that pane and re-runs `team-start`. If
   start fails with `agent_pane_busy` on a pane this run created (`--split`,
   `--into-tab`, or `--new-tab`'s root pane), the pane's shell has not reached
   its interactive prompt yet: retry with a short backoff, bounded by a budget
   (90s by default; `TEAM_START_BUSY_BUDGET_MS` and `TEAM_START_BUSY_BACKOFF_MS`
   override it for tests). Any other start error, or `agent_pane_busy` past the
   budget or on a caller-provided `--pane`, -> exit 4, closing the pane this run
created first (never a caller-provided `--pane`), so no orphan empty shell is
left; the `agent_not_ready` exit 3 above leaves its pane open, since the
message above tells the human to answer the dialog there. Then verify the status
   bar once: model family (Opus, Sonnet, Haiku), mode (`auto` or
   `accept edits`), cwd. Abort with exit 3 and the screen text if any of the
   three is wrong; abort with exit 4 if the status bar cannot be read. Both
   aborts close the pane this run created (never a caller-provided `--pane`),
   because the agent is live and no record names its pane yet.
6. Write `.team/<name>.json` with role, pane, started, the resolved `cwd`
   (absolute, so `team-brief prepare` can tell a worktree agent from a
   main-repo one), `session` (the uuid passed as `--session-id`), and the
   launch flags `model`, `effort`, `mode` (for `/team:resurrect`). Write the
   session index entry `${TEAM_INDEX_DIR:-${CLAUDE_CONFIG_DIR:-~/.claude}/team/sessions}/<session>.json`
   = `{"scratch", "name"}`.
7. Print one JSON line: `{"name","role","pane","session","model","mode"}`, where
   `session` is the first 8 chars of the assigned session id.

Exit codes: 0 ok, 2 bad arguments, 3 pre-flight failed, 4 herdr error
(pass through the herdr message on stderr).

### `team-brief`

```
team-brief compose <name> <topic> [--template <t>] [--var key=value ...]
team-brief prepare <name> [--topic <topic>]
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

`prepare` records `topic` and `brief` in `.team/<name>.json`. If the agent's
record `cwd` is set and differs from `prepare`'s own cwd (a worktree agent), it
first copies the brief and, when the team's `ticket` names one, the decisions
file into `<cwd>/scratchpad/current/`, so the agent never reads a path outside its
own working directory; the kick-off then names the brief relative to that
cwd instead of the orchestrator's path.

It then prints the kick-off, "Read <brief-ref> and execute it fully. Report
back as it describes. You are in execution mode; if your session shows plan
mode, say so immediately.", and exits 0; a missing record or brief exits 2.
It calls no herdr. The team mod's `brief_send` tool runs `prepare` and sends
the printed line to the agent's session (see [The team mod](#the-team-mod)).

### `team-slice`

```
team-slice <branch> <parent> --label "<Tn> <KEY> <slug>" [--ticket <KEY>] [--copy <dir> ...]
```

1. Create the worktree. The plugin never picks where a worktree goes: both
   the command and its directory come from the overlay's `project.yaml`.
   `worktree_cmd` (with `{branch}` and `{parent}` placeholders) builds the
   shell command that creates it; `worktree_dir` (with `{branch}`) names
   where it lands. Without either key, the script prints `no worktree_cmd`
   (or `no worktree_dir`) `in <project.yaml path> - ask the human how this
   repo makes worktrees` and exits 2. Resolve the worktree's real path to
   absolute before handing it to herdr as `--cwd`; a relative path resolves
   against herdr's own process, not this script's caller.
2. If `project.yaml` says `stacked: true`: `git m add {branch} --onto {parent}`
   in the new worktree.
3. Copy every `--copy` directory (design folder, decisions, mockups) into the
   new worktree's `scratchpad/current/`. Warn about untracked spdd files that
   will not travel.
4. `herdr tab create --workspace <live workspace> --cwd <worktree> --label "<label>" --no-focus`
   and one pane, where the live workspace comes from `herdr pane current
   --current` (never the stale spawn-time `$HERDR_WORKSPACE_ID`); print
   `{"worktree","tab","pane"}`.
5. Print the kick-off checklist from the overlay's `env.md` section
   "Slice kick-off" if present (which worktree runs the dev server, ports).

### `team-status`

```
team-status [--json] [--read-idle]
```

Matches `herdr agent list` to `.team/*.json` by session id (`agent_session.value`
against each record's `session` and the config's `orchestrator_session`; herdr
names are not used) and prints one line per agent:
`name (pane, session) status role topic last-report-age`. With `--read-idle`,
every `idle`/`done` agent without a report file newer than its brief gets an
`agent read --source recent-unwrapped --lines 8` and the last line is
appended, so rule 8 is a glance. Writes `.team/roster.md`.

The roster lists each session at most once, and it leaves out two sessions: the
envoy (`envoy_session` in the config) and the session that runs the script
(`TEAM_SESSION_ID`, set by the team mod). `/team:release` closes the pane of
each agent it names (every agent on the roster with `all`), so it never closes
its own pane or the envoy's. An agent without a session id cannot match and is
skipped. The state files of the mod (`config.json`, `watch-state.json`,
`tabs.json`, `layout-flags.json`, `delivered.json`, `toasted.json`) are no
records, by name (`lib/teamlib.py`). A file under `.team/` that holds a JSON
list or scalar is state too, not a record. The
"before team 0.5.0" warning prints only for a config with neither
`orchestrator_session` nor `envoy_session`.

### `team-init`

```
team-init <ticket> [--envoy-pane <id>]
```

Runs in the human's session, which becomes the envoy. Needs `TEAM_SESSION_ID`
(set by the team mod) and Claude Code 2.1.292 or newer, else exit 1. In order:

1. Refuse a ticket that is not one plain file-name part (letters, digits, `.`,
   `_`, `-`, starting with a letter or digit; the rule `team-forget` uses for
   names) with exit 2. A ticket starting with `-` gets its own message. This
   comes before anything is archived, so a refused ticket leaves the previous
   run alone. `-h`/`--help` prints the usage and exits 0.
2. Refuse (exit 1) while a previous team's agents are live, naming them. Then
   archive the previous run and loose scratchpad entries to
   `scratchpad/.archive/` (see Increment 2026-09-27).
3. Choose a team id whose `<team_id>-*` name namespace is free among live
   agents (Increment 2026-09-18).
4. Write `decisions-<ticket>.md` and `progress-<ticket>.md` into the run dir
   from `templates/decisions.md` and `templates/progress.md` of the plugin root
   the script came from, with `{{ticket}}` replaced. Neither is ever
   overwritten: an existing file, an unreadable template or an unwritable path
   is exit 1. This comes before every step that can exit 4, so a run whose
   orchestrator did not start still has both files, and `/team:init` needs no
   template read of its own (a template outside the working directory is a
   permission dialog).
5. Write `.team/config.json` with `team_id`, `ticket`, `orchestrator`
   (`<team_id>-orch`) and `envoy_session` (this session), and seed the safe
   permission allowlist (`SendMessage` included).
6. With `--envoy-pane`, record that pane's tab in `.team/tabs.json` and as
   `envoy_tab` in the config.
7. Start the orchestrator: `team-start orch orchestrator --new-tab --label orch
   --cwd <current dir>` in a worker tab. If that fails, exit 4 with `orchestrator did not start:
   <reason>`, and, for a startup dialog, the advice to answer it, close that
   pane and run `/team:init` again. The config then holds `envoy_session`
   only: the envoy tools work, the orchestrator half stays off.
8. Write the orchestrator's session into the config as `orchestrator_session`,
   then look up its tab and write it as `orchestrator_tab`. If the lookup
   fails, exit 4 with `orchestrator started, tab lookup failed: <reason>`; the
   orchestrator runs, without a recorded tab.
9. Drop session index entries whose record is gone or names another session.
10. Print `team_id=<id> config=<path>`.

Exit codes: 0 ok, 1 refused (a failed `herdr agent list` in the live-agent
check of step 2 included), 2 bad arguments (a bad ticket included), 4 the
envoy pane lookup of step 6 failed or the orchestrator did not start (steps 7
and 8). Step 3 ignores a herdr error.

### `team-forget`

```
team-forget <name> [<name> ...]
```

Deletes the record `.team/<name>.json` of each named agent and its session
index entry `${TEAM_INDEX_DIR:-${CLAUDE_CONFIG_DIR:-~/.claude}/team/sessions}/<session>.json`
(session taken from the record), once its pane is closed. `/team:release` runs
it as the last step per agent. Only a plain name is accepted (the rule of
`team-init`'s ticket; the state files of the mod are no records), so only a
record of this run's `.team/` can go. Likewise only a plain session id names an
index entry; any other value skips the entry with a message, and the record
still goes. Every name is checked before one record goes. An agent whose
session `herdr agent list` still shows is live: both files stay and the exit is
1. The index entry goes first; if it cannot (a directory, a permission error),
the record stays so a retry finds both, exit 1. A symlink is removed, never
followed. A name with no record prints `no record: <name>`. Exit codes: 0 ok, 1
refused, 2 bad arguments, 4 herdr error.

### Commands

Markdown files under `commands/`; each loads only the SKILL section it needs.

| Command | Does |
|---|---|
| `/team:init <ticket>` | Runs in the session the human talks to, which becomes the envoy: loads the `team-orchestration` and `team-role-envoy` skills. Never asks which roles (agents start on demand). Runs `team-init <ticket> --envoy-pane <this pane>` (see [`team-init`](#team-init): it archives the previous run, writes `decisions-<ticket>.md` and `progress-<ticket>.md` from the templates, records this session as `envoy_session` and starts the orchestrator in a worker tab; a ticket that is not a plain name is refused with exit 2 before anything is archived; `--help` prints its usage). After exit 4 the command still tells the human the file paths, and it tells apart a failed tab lookup (the orchestrator runs: carry on), a startup dialog (answer it, close the pane, run `/team:init` again; never `team-start` by hand) and any other failed start. After a successful start, `team-status` writes the first roster, and the envoy asks the human what the orchestrator should start with and sends the answer with `relay`. After any exit 4 the command still runs `team-status`; after a failed start it skips the question and the `relay`. The `Team` and `Questions` tabs open on the mod's next tick. |
| `/team:brief <name> <topic> [--template]` | `team-brief compose`, then the orchestrator fills the task section (must name exact files and tool paths, per lessons), then the `brief_send` tool, then notes the status line in `progress-<ticket>.md`. The orchestrator runs it and never reports to the human (rule 16). |
| `/team:status` | Runs in the envoy session. `team-status --read-idle`, then the roster block plus a two-line status per agent and any 401, permission dialog, or context above 70 percent. The roster lists the orchestrator and the workers; it leaves out the envoy and the calling session. |
| `/team:release [name ...|all]` | `all` (the end of a session) runs in the envoy session; a named release runs in the orchestrator or the envoy session. For each agent `team-status` lists (never the envoy, never the session it runs in, also for `all`): check for a report, `agent prompt <pane> "/clear"` (pane found by session id), run the overlay's `release_check` command if defined (orphan processes), close the pane (closing the last pane closes the tab), then `team-forget <name>`, which deletes its session index entry and its record. With `all`, also removes `.team/tabs.json`, `watch-state.json`, `layout-flags.json`, `toasted.json` and `last-relay.txt`, and keeps `delivered.json` (its `_decision` mark stops the next orchestrator tick from sending every DECISION line of the run again). Refuses to release an agent that is `working`, and lists as refused an agent `team-forget` keeps because herdr still shows it. |
| `/team:resurrect` | Runs in the envoy session. `team-resurrect` relaunches the orchestrator and the workers whose `.team/restored/` mark the `SessionStart` hook set, then the command reports which it relaunched, which were healthy, and which are missing. It starts no agent that has no record. |
| `/team-overview` | A mod command: hides or shows both envoy tabs, `Team` and `Questions`; the choice is kept per team. |

### Report hook

`hooks/hooks.json` registers a `SessionStart` and a `Stop` command hook, and
the team mod module (`"modules": ["./mod/team.tsx"]`).

`stop-report.sh` runs in every session of every profile that has the plugin
enabled, so it must be silent and cheap when it does not apply:

1. Read the hook payload from stdin (`last_assistant_message`,
   `transcript_path`, `cwd`, `session_id`).
2. Find the agent: `TEAM_NAME` and `TEAM_SCRATCH` from the environment
   (`team-start` stamps both onto the pane; `TEAM_SCRATCH` is absolute; both
   survive `/clear`, not a restart), else the payload's `session_id` through the
   session index, then the record, whose `session` must match. Neither, a
   malformed name, or no record -> exit 0.
3. Take the last assistant message from the payload's
   `last_assistant_message`; only without it, extract it from the transcript,
   which may not hold the final message yet when the hook runs. Write it to
   `reports/<name>-<topic>.md` with a header (name, topic, brief path,
   timestamp). Overwrite on every stop, so the file always holds the latest.
   Also write `.team/stops/<name>.json` with the transcript path and the stop
   time (epoch seconds), for the team mod. It sits in a subdirectory because
   every top-level `*.json` in `.team/` is read as an agent record.
4. Forward nothing: the team mod picks the REPORT line up from the report file.
5. Never block the stop; on any error exit 0 and append one line to
   `.team/hook.log`.

`session-start.sh` keeps a worker's identity current. On `source: clear` with
`TEAM_NAME` set (a `/clear` starts a new session id in the same process), it
writes the payload's `session_id` into the record's `session`, writes the new
index entry and deletes the old one. On `source: compact` with `TEAM_NAME` set
and a record whose `session` is the payload's `session_id` (a `/compact` keeps
the id), it drops the record's `brief_sent_session`, so `brief_send` accepts
the next brief. On `source: resume` without `TEAM_NAME`
(a herdr restore) and an index entry whose record names this session, it
creates `.team/restored/<name>` for `/team:resurrect`. Anything else: exit 0,
silently.

### The team mod

`hooks/mod/` (TypeScript, Claude Code function hooks, Claude Code 2.1.292 or
newer). The engine follows `$` only into functions declared in the hooks
module file itself, so `team.tsx` holds every hook and builds one `Io` object
of closures over `$`; every other module takes `io` and never sees `$`.

- Activation, per role (`roleOf`): a session holds the **orchestrator** role
  when `.team/config.json`'s `orchestrator_session` is this session, and the
  **envoy** role when `envoy_session` is this session. A config without
  `envoy_session` (a run from before the envoy, kept for good) gives the
  orchestrator session both roles. The envoy role needs no
  `orchestrator_session`, so the envoy tools work also after a failed
  orchestrator start. On `session.start` the mod sets `TEAM_SESSION_ID` (which
  `team-init` writes into the config), registers the `team-overview` command and
  the tools below, and starts a 15 s tick. A tick is a no-op for a session with
  no role; a session that loses its role has its team status line cleared. On
  `session.end` with `reason: clear` it remembers the old id; the next tick (or
  a tool call or command right after the `/clear`) writes the new id into the
  config for whichever of `orchestrator_session` and `envoy_session` held the old
  one.
- Tick, orchestrator half: maps records to herdr agents by session id (writing
  moved pane ids back), runs the watch rules, closes empty record-named panes
  in worker tabs (never a pending one, never in the orchestrator's own tab: the
  tab herdr shows its session in, `orchestrator_tab` and `envoy_tab` from the
  config, which `team-init` records for the time herdr does not know the
  session yet), picks up new report files (marks in `.team/delivered.json`; a
  missing file is a baseline) and new decisions (the ledger under
  `.team/decisions/`, past the `_decision` mark in `delivered.json`, a missing
  mark being 0), and sends every REPORT line, then every DECISION line, then
  every WATCH line, as one `$.prompt.submit`. A record with role `orchestrator`
  is skipped by report pickup and the watch rules. herdr down -> one
  `WATCH herdr unreachable: <reason>` until it is back. Line formats:
  `REPORT <name> <topic>: <summary>`; `DECISION <n> (Q-12 tester/fixtures, Q-13
  tester/fixtures): <answer>`, with ` - overrides assumption Q-12` added when the
  envoy named assumed cards the answer changes; `RELAY <message>` (below). A
  failed submit shows as `prompt not sent: <reason>` in the `Team` pane's error
  line, and, when another session is the envoy and no pane shows it, in the
  session's status line until a submit succeeds.
- Tick, envoy half: reads the plan file, the cards and the agent rows the panes
  draw, and keeps the urgent badge (below). It sends no prompt, so in a
  separate envoy session the mod never starts a turn. (In the single-session
  fallback the orchestrator half of the same session still submits its lines.)
- Panes, in the envoy session. `team` (title `Team`): the plan (DONE, RUNNING,
  NEXT as glyph rows, bucketed by mark, not by heading, in file order; items
  count only under those three headings; DONE gives up its oldest items when
  short), the open questions (urgent cards first, then a row per tag with its
  open and assumed counts), agents, last error, tick time. `questions` (title
  `Questions`): the question log, every card of the run newest first, one row
  `Q-<n> <status> [#<decision>] <door> <from>/<tag>: <question>`. The engine
  draws the two as tabs in one frame; the person picks the shown tab, and an
  urgent card never switches it. Both open on the first activation of the envoy
  role unless hidden; `/team-overview` toggles both and keeps the choice in
  `$.store` under `overviewHidden:<team_id>`; a close of either tab by the
  person closes both and counts as hiding (a close by a plugin or on unload does
  not). In a herdr pane narrower than 144 columns an open waits undrawn;
  `/team-overview` is the way in. Each agent row is a Button: a click, or its
  hotkey `1`-`9` while the pane holds the focus (ctrl+x tab), runs `herdr agent
  focus <pane>`; a failure shows as `focus <name>: <reason>` until the next
  tick.
- Urgent badge, envoy half. The status line shows `<n> urgent: <oldest id>
  <from>: <question>` while an `urgent` card is open or assumed, and is cleared
  when none is. Each new urgent card gets one toast, `URGENT Q-<n> <from>:
  <question>`; the marks are in `.team/toasted.json`, and the first run only
  sets them (a baseline, no toast). Neither starts a model turn.
- Tool `brief_send` (`mcp__team__brief_send`, `{ name, topic }`): refuses
  outside the orchestrator session; runs
  `team-brief prepare`, sends the printed kick-off with
  `$.session.send({ to: { sessionId } })`, writes `brief_sent_session`, and
  returns `<name>: <state>`. When the record's `brief_sent_session` equals its
  `session`, it waits up to 6 s for a `/clear` or `/compact` to land (a new
  `session`, or a dropped `brief_sent_session`), then refuses (a hook
  gets 10 s, and a clock wait counts against it). Auto mode reviews the send as
  a `SendMessage` with no user request behind it and its classifier gives no
  verdict, so `team-init` seeds `SendMessage` into `permissions.allow`
  (`.claude/settings.local.json`); an allow rule decides it without the
  classifier.
- Tool `ask` (`mcp__team__ask`; an agent whose record names this session, or the
  orchestrator; the envoy session only in a run with one session). Input: `context`, `question`, `options`
  (each `{ option, cost }`), `recommendation`, `blocks`, `door` (`one-way` or
  `two-way`), `rework` (a concrete estimate), `parked`, and optionally `urgent`
  and `refs`. The mod fills `id`, `from` and `tag` (the agent's brief topic, or
  `general` when it has none, and for the orchestrator), writes one card to
  `.team/questions/Q-<n>.json` and returns `Q-<n>`. `parked: true` gives the card
  status `assumed`, else `open`. It refuses, with the field named: outside a
  team session; a missing text field; no option; a `door` that is neither value;
  a `parked` that is not a boolean; a one-way card that is parked; no free card
  number after 20 tries. Numbers are
  claimed by `mkdir` of `.team/questions/claims/<n>`, so two callers never get
  the same one.
- Tool `queue` (`mcp__team__queue`, `{ tag? }`, envoy role only): returns
  `{ "groups": [{ tag, count, cards }] }` for the open and assumed cards. Order
  inside a group: urgent, one-way, open before assumed, oldest first; the groups
  follow their first card. The optional `tag` keeps one group.
- Tool `decide` (`mcp__team__decide`, envoy role only). Input
  `{ cards, answer, rationale, overrides? }`, or `{ cards, obsolete: true,
  reason }`. It reads the decisions file, takes 1 + its highest number
  (amendments such as `3a` count under their number), appends
  `<n>. (<date>) <answer> Why: <rationale> Cards: <ids>.`, writes the ledger
  entry `.team/decisions/<n>.json`, marks each card `answered` with that number
  and returns `Decision <n>`. The writes are not atomic and run in that order;
  calls run one at a time. `overrides` lists the assumed cards the answer
  changes; the mod cannot judge that itself. The obsolete form marks the cards
  `obsolete` with the reason, writes no decision, and sends the orchestrator
  nothing. It refuses: outside the envoy role; an empty or malformed `cards`
  list; a missing `answer`, `rationale` or `reason`; a CR, LF, U+2028 or U+2029
  in `answer` or `rationale` (the paragraph must stay one line); a card that
  does not exist, is already answered or is already obsolete; an `overrides` id
  that is not an assumed card of this decision; an `overrides` entry that is
  not a `Q-<n>` id (`overrides must list Q-<n> ids`); a missing decisions file.
- Tool `relay` (`mcp__team__relay`, `{ message }`, envoy role only): sends
  `RELAY <message>` to `orchestrator_session` with `$.session.send` and returns
  `sent`. Line breaks in the message (CR, LF, U+2028, U+2029) become newlines
  and every line after the first is indented by two spaces, so no relayed line
  starts with `REPORT`, `DECISION` or `WATCH`. It refuses: a config without
  `envoy_session` (the session also runs the orchestrator); a config without
  `orchestrator_session`; an empty message; a text equal to the last text sent
  to this orchestrator session (`relay refused: same text as the last relay`,
  because Claude Code drops a peer message identical to the previous one yet
  reports it as sent); a message that was not delivered (`not delivered:
  <reason>`, and it does not count as the last one). The last text is kept in
  `.team/last-relay.txt`, with the orchestrator session on the first line, so it
  survives an envoy `/clear` and a mod reload, and a different orchestrator
  session never matches an old text.

Resolved: Herdr's `agent_session.value` is Claude Code's `session_id` (checked
2026-10-05 on Claude Code 2.1.287). `team-start` assigns it with
`--session-id`, so every script, hook and the mod address an agent by it.
`TEAM_NAME` stays as the in-process carrier until a restart.

---

## Overlay contract

A project provides zero or more of these. The kernel documents the contract in
README and warns once per session for each missing file it would have used.

| Path | Used by | Content |
|---|---|---|
| `.claude/team/project.yaml` | `team-slice`, `/team:release`, brief compose | `stacked`, `spdd`, `crit`, `tracker`, `worktree_cmd` (required by `team-slice`), `worktree_dir` (required by `team-slice`; `{branch}` placeholder), `release_check`, `gate_cmd` |
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
REPORT {{name}} {{topic}}: <at most ten lines: verdict, files written, counts, blockers, card ids>
Do not run any command to send it. Stopping saves your whole message to the report
file and delivers the REPORT line to {{orchestrator}}.

## Rules
- Shell discipline: see rule 20 of the team-orchestration skill.
- Source-backed facts only; an unknown stays a numbered open question, never a guess; one only the human can answer also becomes a card via `ask` (rule 21).
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
Every brief reads this file first. Only the envoy writes it, through the `decide` tool.
```

`team-init` writes the file with this header and no numbered line; the `decide`
tool appends every decision.

`templates/report.md` is the header the hook writes; agents do not fill it.

---

## Tests

`tests/test_team.py`, stdlib `unittest`, run with
`python3 -m unittest discover -s plugins/team/tests`. The tests put
`tests/fake-herdr` first on `PATH`; it records every invocation to a file and
answers from canned JSON selected by `FAKE_HERDR_SCENARIO`. Cases, at minimum:

1. `team-start` builds the exact `herdr agent start` argument list for each
   role (agent file, default model, default effort, mode) and for `--model`
   and `--effort` overrides, refuses a model outside the allowlist, and writes
   `.team/<name>.json`.
2. `team-start` hands a startup dialog to the human (exit 3, no keys sent)
   and aborts with exit 3 on a wrong model in the status bar.
3. `team-brief compose` concatenates skeleton, overlay role fragment, env and
   gate in order; substitutes variables; refuses to overwrite.
4. `team-brief compose` with an empty overlay still produces a valid brief
   (the project-agnostic guarantee).
5. `team-brief prepare` records topic and brief, mirrors into a worktree, and
   prints the kick-off without calling herdr.
6. `team-slice` uses `worktree_cmd` from `project.yaml` when present, the git
   default otherwise, and runs `git m add` only when `stacked: true`.
7. `team-status` matches agents by session id and flags idle agents without
   a fresh report.
8. `stop-report.sh` exits 0 silently for a session it cannot identify, finds
   its agent by `TEAM_NAME` or by `session_id` through the index, writes the
   report file, and forwards nothing.
8a. `session-start.sh` follows `/clear` and marks a restored worker;
   `team-resurrect` relaunches marked workers with their saved flags.
8b. The team mod (`claude plugin test plugins/team`, an in-memory world in
   `tests/mod/world.ts`): activation and following `/clear`, the pane and
   `/team-overview`, agent rows and pane healing, report pickup and the
   baseline, the watch and layout rules, `brief_send`, the roles
   (`roleOf`, activation per role), `ask`, `queue`, `decide` and `relay` with
   their refusals, the DECISION line and its mark, the urgent badge and toast.
8c. `team-init` (ticket rule, run files, `envoy_session`, orchestrator start and
   its exit 4 paths), `team-forget` (record, index entry, safety), `team-status`
   (one line per session, envoy and caller skipped), `--plugin-dir` in
   `team-start` and `team-resurrect`.
9. A hook error (unreadable transcript) exits 0 and logs one line.

---

## Marketplace entry

```json
{
  "name": "team",
  "description": "Envoy-and-orchestrator workflow for Claude Code with Herdr: one envoy session you talk to, an orchestrator that runs role agents in panes, briefs as files, open questions as cards, a numbered decisions file, reports by hook. Kernel only; each project adds a small overlay.",
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

## Increment 2026-09-26

Design: `docs/superpowers/specs/2026-09-25-team-overview-pane-design.md`.
Adds an overview pane right of the orchestrator that shows run progress at
the orchestrator level.

The orchestrator keeps a plan file, `progress-<ticket>.md` next to the
decisions file, as a markdown checklist under DONE, RUNNING and NEXT
(`[x]`, `[>]`, `[ ]`; human actions start with `you:`). `/team:init` creates
it from `templates/progress.md`, and SKILL.md rule 17 says when to update it.
Workers never write it.

New script `team-overview` renders the plan file plus a live AGENTS list
(label, pane, herdr state, report age) built from `herdr agent list` and the
`.team` records. Rendering is `lib/overview.py`, pure text; when the frame is
taller than the pane, DONE gives up its oldest items first. The loop redraws
only when the frame changes. `--spawn` splits right of the orchestrator pane
(`--ratio 0.72`); `/team:init` runs it before `team-watch --spawn`, so the
overview spans the full tab height and the orchestrator tab holds three
panes. `report_age` moved from `team-status` into `teamlib` so both scripts
share it.

## Increment 2026-09-27

Design: `docs/superpowers/specs/2026-09-27-team-scratchpad-per-run-design.md`.
Every run lives in one folder so a new task never sees an earlier task's
files.

`TEAM_SCRATCH` now defaults to `scratchpad/current`. `team-init` first keeps
the live-agent guard, then moves a non-empty run dir to
`<scratch root>/.archive/<ticket>-<YYYY-MM-DD>/` (`run-<date>` without a
ticket, `-2`, `-3` on a clash) and, when the scratch root is named
`scratchpad`, sweeps every other entry except `.archive` into
`.archive/loose-<date>/`. Nothing that holds a `.git` is ever moved: a loose
one is skipped with a warning, and a run dir that holds one makes init refuse.
The live-agent guard also checks a team left in the old flat layout
(`scratchpad/.team`), so upgrading mid-run never sweeps a live team's files.
`/team:init` now runs `team-init` before it writes the decisions and plan
files. Worktree agents get their brief and decisions file in
`<worktree>/scratchpad/current/`. `team-slice` no longer has a built-in
worktree location: without `worktree_cmd` and `worktree_dir` in the overlay
it refuses, so a repo's own worktree tooling is always used. The overview and
watcher panes now receive an absolute `TEAM_SCRATCH` like agent panes do.

## Increment 2026-09-28

Fixes `team-start` failing with `agent_pane_busy` ("target pane is not an
available shell") when `herdr agent start` ran before a freshly created
pane's shell reached its interactive prompt. `team-start` now retries only
that error code, only on a pane it created, with a short backoff bounded by
a budget (see the `team-start` contract above), and marks a created pane
`pending` immediately after creation so the watcher never closes it mid-setup.

Watcher pane cleanup narrowed: an empty pane in a team-managed tab closes
only when a team record (`.team/<name>.json`) names that pane, i.e. an agent
that exited. A pane no record names, such as one a human opened by hand in a
worker tab, is left alone. `team-start` now closes the pane it created itself
when a start fails outright (exit 4), so no orphan empty shell is left behind;
it leaves the pane open on the `agent_not_ready` exit 3, since its own message
tells the human to answer the dialog there and close it themselves.

Quiet orchestrator channel. A worker that waits on its own subagents ends a
turn each time one of them reports back, and each stop used to push a
synthesized `stopped without a REPORT line` nudge. The Stop hook now pushes
only a real REPORT line; a stop without one writes the report file and stays
quiet. `team-watch` covers a stuck worker instead: it flags `idle, no report -
read <report path>` once an agent without a REPORT has been quiet for
`--no-report-after` seconds (default 120, passed through `--spawn`). Quiet
means either herdr showed it idle or done for that long, or its last stop is
that old and its transcript holds no `user` or `assistant` entry newer than
the stop. The second test exists because herdr shows a worker `working` for
as long as it waits on background subagents or swarm teammates, even at an
empty prompt (seen live with both in the E2E runs). It reads turn timestamps, not the file's mtime: Claude Code keeps
appending metadata (`stop_hook_summary`, `turn_duration`, `cost-state`) after
a stop. A report
counts as present only when the report file holds a `REPORT ` line and is newer
than the brief, because the hook rewrites the file on every stop; the same rule
gates the `consider release` flag. A plain state change (such as
`working -> idle`) is now logged only in the watcher pane; the watcher pushes
to the orchestrator only a transition into `blocked`, the no-report flag, and
layout flags. Protocol rule 8 now says to leave a quiet worker alone until the
watcher flags it. Rule 16 no longer subscribes the orchestrator with
`notify_when_idle`, a second idle signal that fired on every pause; it now
holds the quiet-acks rule, which keeps notices that need nothing from the
human out of the conversation.

## Increment 2026-09-29

The orchestrator picks the model per job. `team-start --model
opus-5-5|sonnet-5-5|haiku-4-5` overrides the role default and always reaches
`claude` as `--model <id>`; any other model, Fable included, is refused with
exit 2. The role defaults move to Opus 5.5 (investigator) and Sonnet 5.5
(implementer, tester). `--effort` accepts every level `claude` knows (`low`
through `max`) and refuses the rest with exit 2. Haiku defaults to
`accept-edits` and refuses `--mode auto`, since it has no auto mode. Fixes
`--mode accept-edits`, which reached `claude` as the invalid
`--permission-mode accept-edits`; it now goes as `acceptEdits`, and the
status-bar check looks for `accept edits`.

## Increment 2026-09-30

Fixes a false `idle, no report` flag on a busy worker. The orchestrator
`/clear`s a worker before a new brief, which starts a new transcript, but the
worker's stop record still named the previous task's transcript. That file
no longer grows, so the watcher saw no turn since the stop and flagged the
worker while it worked. A stop older than the worker's current brief now
belongs to the previous task and never makes the worker count as quiet; the
next stop writes a fresh record with the new transcript.

## Increment 2026-10-01

Fixes `/team:release all` leaving the overview pane open. `team-overview
--spawn` now records its pane in `.team/overview.json` (`{"pane": <id>}`),
and `/team:release all` stops and closes that pane next to the watcher's,
then removes the file. `overview.json` joins the non-record files, so the
watcher never reads it as an agent record and closes the overview as an
exited agent's pane.

## Increment 2026-10-02

Fixes worker REPORT lines that never reach the orchestrator. Claude Code can
run the Stop hook before it writes the final message to the transcript, so
the hook read the message before it, found no REPORT line, and forwarded
nothing; the watcher then flagged the worker `idle, no report`. The hook now
takes the message from the payload's `last_assistant_message` and reads the
transcript only when the payload lacks it.

## Increment 2026-10-05

Design: `docs/superpowers/specs/2026-10-05-team-mod-and-resurrect-design.md`.
Plan: `docs/superpowers/plans/2026-10-05-team-mod-and-resurrect.md`.

The watcher and the overview run as a Claude Code mod in the orchestrator
session instead of two herdr panes. The mod activates in the session that
`config.json` names as `orchestrator_session`, ticks every 15 s, sends REPORT
and WATCH lines as one prompt, and draws the `Team` pane (`/team-overview`
toggles it). Agents are addressed by Claude session id, not herdr name:
`team-start` assigns `--session-id`, a `SessionStart` hook follows `/clear`,
the Stop hook finds its agent through the session index, and briefs
go out through the `brief_send` tool. `/team:resurrect` relaunches workers
that a herdr restore brought back without their flags. `team-watch`,
`team-overview`, `team-deliver` and `lib/overview.py` are gone. Requires
Claude Code 2.1.287.

## Increment 2026-10-06

Three fixes from the 0.5.0 review. `team-resurrect` adopts a restored worker
that was `/clear`ed before it ran (the hook could not follow the `/clear`
without `TEAM_NAME`): when the worker is marked, its recorded session is
gone, and its recorded pane runs a session no record claims, it resumes that
session and moves the record and the index entry to it. `brief_send` refuses
outside the session that runs the team, so a worker cannot brief a peer.
`team-init` records the orchestrator's tab as `orchestrator_tab` in the
config, and the mod exempts it from layout hygiene even while herdr does not
know the orchestrator's session yet (just after its `/clear`).

## Increment 2026-10-07

Design: `docs/superpowers/specs/2026-10-07-team-envoy-and-question-queue-design.md`.
Plan: `docs/superpowers/plans/2026-10-07-team-envoy-and-question-queue.md`.
Version 0.6.0. Requires Claude Code 2.1.292.

Open questions are cards in `.team/questions/`, filed by the orchestrator and
the workers (the envoy session cannot, except in a run with one session) with
the `ask` tool and closed by the `decide` tool, which numbers the
decision, appends it to the decisions file and keeps a ledger. The human's
session becomes the envoy: `team-init` records it as `envoy_session` and
starts the orchestrator as a worker in its own tab. The mod runs per role:
the orchestrator half sends REPORT, DECISION and WATCH lines; the envoy half
draws the `Team` and `Questions` tabs, keeps an urgent badge in the status
line, toasts each new urgent card, and serves `queue`, `decide` and `relay`.
A team dir without `envoy_session` runs both halves in the orchestrator
session.

Changes made after the plan, while the envoy was built and live-checked:

- `team-start` and `team-resurrect` pass `--plugin-dir <plugin root>` to the
  `claude` they launch in a pane (`lib/plugin-dir.sh`), unless the script runs
  from an installed copy. Before, the child loaded only the installed plugin,
  which could lack this version's agent file, and `herdr agent start` timed out.
- `team-start` closes the pane it created itself on its status bar exits (exit 3
  for a status bar mismatch, exit 4 for a status bar it cannot read), as it
  already did when `agent start` failed. The `agent_not_ready` exit 3 leaves the
  pane open on purpose, so the human can answer the dialog. A pane or name that was
  live before the call is never closed.
- `team-init` writes `decisions-<ticket>.md` and `progress-<ticket>.md` from the
  plugin templates itself and never overwrites them, so `/team:init` reads no
  template (a template outside the working directory is a permission dialog). It
  writes `orchestrator_session` before it looks up the orchestrator's tab. It
  refuses a ticket that is not one plain file-name part with exit 2, before the
  archive step.
- `relay` refuses a text equal to the last one it sent to the same orchestrator
  session (`.team/last-relay.txt`), because Claude Code drops such a message
  silently. Lines after the first of a relayed message are indented, and U+2028
  and U+2029 count as line breaks.
- `decide` refuses a CR, LF, U+2028 or U+2029 in `answer` and `rationale`.
- `team-status` lists each session once, never the envoy and never the calling
  session, skips an agent without a session id, and ignores a state file that
  is a JSON list or scalar (`toasted.json` was the file that crashed it; the
  named state files `tabs.json` and `layout-flags.json` were skipped already); the "before team 0.5.0" warning no longer fires
  for a run with an `envoy_session`. `/team:release` walks this roster, so it
  never closes the envoy's pane or its own.
- New script `team-forget`: it deletes an agent's record and session index
  entry once its pane is closed, and keeps both for an agent herdr still
  lists. `/team:release` runs it after it closes each pane, and with `all` it
  also removes `toasted.json` and `last-relay.txt`; it keeps `delivered.json`,
  so the `_decision` mark survives and the orchestrator gets no old DECISION
  line again.
- `brief_send` refuses outside the orchestrator session with a message that
  says so.
- The human talks only to the envoy, so `/team:resurrect`, `/team:status` and
  `/team:release all` run in the envoy session; `/team:release <name>` runs in
  the orchestrator or the envoy session.
- `/team-overview` counts a pane that is open but not placed (`isPlaced` false,
  a herdr pane narrower than 144 columns) as not open, so the first call shows
  the panes instead of hiding them.
