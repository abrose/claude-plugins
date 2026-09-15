# Design: team plugin - active supervision, safe permissions, layout hygiene

Date: 2026-09-15
Status: agreed in brainstorm, pending spec review
Relates to: `plugins/team/SPEC.md` (the original kernel spec). This document is
an increment on that spec, not a rewrite. Nothing here deletes a working
feature; cuts are deferrals that move rules to `references/lessons.md`.

## Problem

The first real run of the team plugin felt bad. Three failures:

1. Spawned agents got stuck at permission prompts and never recovered.
2. The investigator agent failed to spawn several times.
3. The orchestrator did not proactively check whether children needed input or
   had finished. It sat blind.

Root causes, after inspection:

- Failures 1 and 3 share one symptom (the orchestrator sits blind) but have two
  causes. The whole design is **push-based**: it assumes every agent reaches a
  clean Stop, and a Stop hook forwards the report. A blocked agent never stops,
  so the hook never fires, so no report arrives. There is no heartbeat, no poll,
  no timeout. Nothing observes an agent from outside its own turn.
- Failure 2 is mechanical. `team-start` compared the full `cwd` path in the
  status-bar pre-flight and aborted with exit 3. A second bug put the prompt
  after the `--wait` flag in `team-brief send`. Both are already fixed on the
  branch `plugfix/team-cli-fixes`, not yet merged.

## Decisions (this brainstorm)

1. The core goal of the cut-back version is **never sit blind**: the
   orchestrator always knows each agent's state and tells the human, even when
   an agent is blocked at a permission prompt.
2. The supervision mechanism is a **watcher process** (`team-watch`), not
   orchestrator self-polling and not trigger-only checks. It observes agents
   from outside the orchestrator's turn, so it survives a blocked agent.
3. Blocked agents are handled by **fewer prompts plus relay**: a safe
   permission allowlist removes routine prompts; the watcher relays any real
   block to the human with the exact dialog text; the human decides. Nothing
   auto-decides a permission prompt.
4. The watcher runs in **its own pane, in the orchestrator's tab**.
5. Scope cuts are accepted **for now**, to be revisited later. Cuts are
   deferrals (rules move to `lessons.md`), never deletions of working code.
6. Pane and tab budgets: the orchestrator tab holds **at most 2 panes**
   (orchestrator + watcher); a worker tab holds **at most 6 panes**. A pane
   with no place triggers a new tab.
7. The watcher auto-closes empty (agent-less) panes **only inside team-managed
   tabs**, without confirmation. It never touches panes in tabs the workflow
   did not create.
8. Multiple teams may run at once on different repositories. Every agent name
   is namespaced by a **team id**: `<teamid>-<role>` (e.g.
   `app-5066-investigator`, `app-5066-orch`). The team id is the slug of the
   ticket when `/team:init` receives one, otherwise a short random base36 hash.
   The team id is capped so `<teamid>-<role>` stays within Herdr's 32-char
   limit. It is stored in `.team/config.json`.

## Herdr facts this design relies on (verified 2026-09-15)

- `herdr agent list` reports a per-agent lifecycle state: `idle`, `working`,
  `blocked`, `done`, `unknown`. `blocked` means Herdr recognized an approval or
  question UI. So a blocked agent is detectable without scraping the screen.
- There is no native "subscribe to any state change" verb. `herdr agent wait`
  blocks on one target and one set of states. So the watcher polls
  `herdr agent list` and diffs. `herdr notification show` is only a UI toast.
- `herdr pane list` carries `pane_id`, `tab_id`, `workspace_id`, and
  `agent_status` per pane. One call gives pane-count-per-tab, empty-pane
  detection, and idle detection together.
- Primitives for hygiene exist: `herdr pane close`, `herdr tab close`,
  `herdr tab create`, `herdr pane split`.
- `claude --permission-mode` accepts `auto`. Auto approves safe operations but
  still prompts for risky ones, so occasional blocks are expected behaviour,
  not a bug. The allowlist plus the watcher is the right response.
- Herdr agent names must be unique among all live agents and match
  `[a-z][a-z0-9_-]{0,31}` (32 chars max). So role-only names collide across
  teams: a second team's `orchestrator` cannot start. Names must be namespaced.

## Design

### 1. `team-watch` - the supervision process

- Started at `/team:init`, in its own pane in the orchestrator's tab. Stopped by
  `/team:release all`.
- A poll loop, default interval ~5s. Each cycle:
  1. Run `herdr agent list` and `herdr pane list` once each.
  2. For each team agent (matched through `$TEAM_SCRATCH/.team/*.json`), read
     its state and diff against `$TEAM_SCRATCH/.team/watch-state.json`.
  3. On any state change, push one line to the orchestrator pane:
     `herdr agent prompt <orchestrator> "WATCH <name>: <old> -> <new>"`.
  4. For a transition into `blocked`, first read the dialog text
     (`herdr agent read <name> --source detection --lines 20`) and append its
     first line, so the orchestrator can show the human the exact prompt.
  5. For `done` or `idle` with no report file newer than the agent's brief,
     push `WATCH <name>: idle, no report` - this makes protocol rule 8 a
     mechanism, not a hope.
- Never blocks, never decides a permission prompt. It reports; the human and
  the orchestrator act.
- Writes a tail-able log to `$TEAM_SCRATCH/.team/watch.log`.

### 2. Safe permission allowlist

- A documented baseline the project adopts in its overlay `.claude/settings.json`
  `permissions.allow`: reads, `ls`, `grep`, `git status`, and the project gate
  command. Agents keep `--permission-mode auto`.
- The allowlist removes routine prompts. The watcher catches the rare real one
  and relays it. The human answers; the orchestrator sends the keystroke with
  `herdr agent send-keys`.

### 3. Merge the two CLI fixes

- Rebase / merge `plugfix/team-cli-fixes` (cwd basename match in `team-start`,
  prompt-before-`--wait` in `team-brief send`) into the line of work. Keep the
  tests that branch already added.

### 4. Layout budget and hygiene (owned by `team-watch`)

- Budgets enforced at placement time:
  - Orchestrator tab: 2 panes max (orchestrator + watcher). Worker agents never
    land here.
  - Worker tab: 6 panes max. `team-start` and `team-slice` gain tab-aware
    placement: count the target tab from `herdr pane list`; at budget, create a
    new tab and place the pane there.
- Each watch cycle, from the `herdr pane list` already read:
  - Auto-close empty panes (no live agent) inside team-managed tabs, no
    confirmation.
  - Flag idle / done agents and unused team tabs to the orchestrator. The
    orchestrator suggests closing them via `/team:release`. It never
    auto-releases a working agent, or an idle one whose report is unread.

### 5. Multi-team isolation

- `/team:init` establishes the **team id** (decision 8) and writes it to
  `.team/config.json` alongside `ticket` and `orchestrator`.
- Every name the workflow creates is `<teamid>-<role>`. `/team:init` renames the
  orchestrator pane's agent to `<teamid>-orch`; `team-start` builds
  `<teamid>-<role>`; `team-brief` and the Stop hook read the orchestrator name
  from `.team/config.json`, so reports route to the right team unchanged.
- `team-watch` scopes to its own team: it matches only the agents recorded in
  its team's `$TEAM_SCRATCH/.team/*.json`, and ignores every other live agent in
  `herdr agent list`. So one watcher per team never reacts to another team's
  agents.
- File isolation relies on each team having a distinct repo (distinct
  `$TEAM_SCRATCH`). Two teams in the **same** repo would share `.team/`; that is
  out of scope for now (see open questions).

## Scope cuts (deferred, not deleted)

Move the corresponding protocol rules to `references/lessons.md`.

1. `team-slice` stacked-branch machinery: `stacked: true`, `git m add` /
   machete, `--copy` dirs. Keep plain `git worktree add`.
2. Reviewer and post-notes brief templates (`brief-review.md`,
   `brief-post-notes.md`). Keep the three core templates.
3. Overlay keys beyond the essentials. Keep `worktree_cmd`, `gate_cmd` /
   `gate.md`, `env.md`, `release_check`. Defer `spdd`, `crit`, `tracker`.
4. Protocol rules that reference cut features (worktree mirroring, stacked
   own-commit invariant) move to `lessons.md`.

Kept, because these are basic orchestration: `team-start`, `team-brief`,
`team-status`, the Stop hook, the decisions file, the three roles.

## Verification

One small real run:

- One investigator and one implementer on a tiny real task.
- Prove:
  1. Both spawn with no exit 3.
  2. The watcher reports each state change, including a deliberate permission
     block, with the dialog text.
  3. The human answers the block via the orchestrator; the agent proceeds.
  4. Reports arrive as files.
  5. A worker tab at 6 panes forces the 7th agent into a new tab.
  6. An empty team pane is auto-closed; a personal pane elsewhere is untouched.
  7. `/team:release all` closes agents and stops the watcher cleanly.
  8. A second team started on a different repo spawns its own `<teamid>-*`
     agents with no name collision, and each watcher reacts only to its own
     team.
- Unit tests stay green with pristine output. Add tests for `team-watch` state
  diffing, empty-pane detection, and budget placement, against the existing
  fake-herdr PATH shim.

## Open questions

1. How does `team-watch` survive as a process - a background command in its own
   pane via `herdr pane run`, or a foreground loop the pane runs? Placement is
   decided (own pane, orchestrator tab); the exact launch mechanism is for the
   implementation plan.
2. Where does the baseline allowlist live - shipped by the plugin as a
   documented snippet the project copies, or generated into the overlay by
   `/team:init`? Decide in the plan.
3. Watcher poll interval (default ~5s) and whether it is configurable through
   `.team/config.json`.
4. Two teams in the **same** repo share one `$TEAM_SCRATCH/.team/`. Supporting
   that later means a per-team subdir (`.team/<teamid>/`) or a team-id-scoped
   `$TEAM_SCRATCH`. Out of scope now; revisit if the need appears.
5. Team-id length cap and slug rules: how to slugify a ticket, the truncation
   length, and the hash length/alphabet. Decide exact values in the plan.
