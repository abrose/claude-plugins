# Design: team plugin - orchestrator mod, session-id identity, resurrect

Date: 2026-10-05
Status: agreed in brainstorm, pending spec review
Relates to: `plugins/team/SPEC.md`. This is an increment on that spec.

## Problem

1. After a Mac or herdr restart, an interrupted team comes back, but the
   workers cannot report to the orchestrator. herdr restores each pane's
   cwd, label and Claude session id (`agent_session.value` in
   `~/.config/herdr/sessions/<session>/session.json`). It does not restore
   agent names (`herdr agent rename`, `herdr agent start <name>`) or pane env
   (`TEAM_NAME`, `TEAM_SCRATCH`). Every message to the orchestrator goes out by
   herdr name, and the worker Stop hook exits silently without `TEAM_NAME`.
2. The watcher and the overview are two extra herdr panes per team, with their
   own bookkeeping (`own_pane`, `overview.json`, self-close guards, release
   cleanup). Claude Code 2.1.287 can run both inside the orchestrator session
   as a mod.

## Decisions (this brainstorm)

1. One spec, two increments: the orchestrator mod, then session-id identity
   plus resurrect.
2. Identity is the Claude session id everywhere. herdr names stop mattering.
   herdr stays for panes only: spawn, agent states, close.
3. REPORT lines reach the orchestrator by pull: the mod reads report files on
   a 15 s tick and submits them with `$.prompt.submit`. Workers push nothing.
4. Briefs go out through a mod tool with `$.session.send({ to: { sessionId } })`.
   herdr is not in the message path.
5. The bash watcher, the bash overview and `team-deliver` are deleted, not
   kept as a fallback. A pinned minimum Claude Code version guards the mod API.
6. A command toggles the overview pane. The choice persists per team.
7. Interval: one 15 s tick drives REPORT pickup, WATCH checks and the overview
   refresh.
8. Identity follows a session through `/clear`. `/clear` starts a new
   transcript and so a new session id in the same process. A `SessionStart`
   command hook (workers) and a `session.end` mod hook (orchestrator) write
   the new id where the old one stood. Pane env (`TEAM_NAME`,
   `TEAM_SCRATCH`) stays as the in-process carrier; only a restart loses it,
   and by then the session index holds the latest id.

## Probe results (2026-10-05, Claude Code 2.1.287)

Throwaway probe in `scratchpad/team-probe/`, loaded with `--plugin-dir`:

- A mod loads from a plugin folder; installed plugins load modules too
  (provenance `<name>@<marketplace>`).
- `session.start` + `$.clock.every` runs a loop for the session's life.
- `$.process.run([herdr, "agent", "list"])` works from the mod.
- `$.ui.open` docks a pane beside the transcript; it opened unasked in a herdr
  pane, at 89 body columns.
- `Markdown` breaks task lists (`- [x] 1. a` draws as `-` then `a.`). The plan
  is drawn as `Text` rows instead.
- `$.prompt.submit` starts its own turn once the session is idle and leaves
  the human's draft in the prompt box untouched.
- A cross-session message to an idle session with
  `crossSessionInbound: accept` starts a turn there without approval.
- The model's `SendMessage` tool addresses by `--name` or `[ref]`, not by
  session id. Only the mod API takes `{ sessionId }`.
- herdr's `agent_session.value` equals the Claude session id.
- Saving a `--plugin-dir` folder did not hot-reload the probe; a restart did.
- `$.session.id()` is "the transcript file's name"; `session.start` input
  carries no id. A `/clear` raises `session.end` with `reason: 'clear'` and
  no `session.start` after it.
- Mod command names take letters, digits, `_` and `-` only: no `:`.
- In `claude plugin test`, every `$` call the mod makes is an event the test
  answers through its own `on` (the bottom hook throws). Tests run the mod in
  an in-memory world: files, herdr output, store, env, clock.

## Identity

| Who | Session id comes from | Stored in |
|---|---|---|
| Worker | `team-start` generates a uuid and starts `claude --session-id <uuid>` | `.team/<name>.json` as `session` (full id) |
| Orchestrator | the mod sets `TEAM_SESSION_ID` from `$.session.id()` with `$.env.set` on `session.start`; Bash children inherit it | `.team/config.json` as `orchestrator_session`, written by `team-init` |

### Session index

`team-start` writes `~/.claude/team/sessions/<session>.json`:

```json
{ "scratch": "/abs/path/to/scratchpad/current", "name": "<team_id>-<label>" }
```

The Stop hook finds its agent in this order:

1. `TEAM_NAME` and `TEAM_SCRATCH` from the env (set by `team-start`, kept
   through `/clear`, lost on a restart);
2. else the payload's `session_id` through the index, then the record
   `<scratch>/.team/<name>.json`, whose `session` must match.

Neither: exit 0, silently.

### Following `/clear`

- Worker: a `SessionStart` command hook in `hooks/handlers/` runs on
  `source: clear`. With `TEAM_NAME` set and a record for it, it writes the
  payload's `session_id` into the record's `session`, writes the new index
  file and deletes the old one.
- Orchestrator: the mod hooks `session.end` with `reason: 'clear'`. When the
  old id equals `orchestrator_session`, it writes `$.session.id()` (the new
  id) into `config.json` and sets `TEAM_SESSION_ID` again.

`/team:release` deletes the agent's index file. `team-init` deletes index
files whose `scratch` no longer holds a matching record.

## Components

### Mod `team` (in `plugins/team/hooks/`)

`hooks/hooks.json` keeps its command `hooks` and adds
`"modules": ["./team.tsx"]`. The module is split into small files by
purpose: plan parsing, watch rules, report pickup, herdr adapter, pane, tool,
commands.

Activation: on `session.start` and on every tick, the mod reads
`./scratchpad/current/.team/config.json` (relative to the session cwd). It is
active only while `orchestrator_session` equals its own session id. Inactive,
a tick does nothing more than this read. `/team:init` in a running session
therefore activates it on the next tick.

Tick (every 15 s, while active):

1. `herdr agent list`. Map each record's `session` to its herdr agent
   (`agent_session.value`). Write a changed pane id back to the record.
2. Compute WATCH lines with today's rules (`team-watch` and
   `lib/teamlib.py`, ported):
   - an agent turns `blocked` (with the first line of the dialog);
   - an agent stays idle or quiet after its stop for 120 s without a fresh
     report (`fresh_report`, `quiet_since_stop`, stale-brief rule);
   - tab over budget (6 panes); idle tab with fresh reports: consider release.
   Flags are debounced as today; the debounce state lives in
   `.team/watch-state.json` (agents, flagged, idle-since; no `own_pane`).
3. Close empty panes that a record names, as today, using the healed pane id.
4. Report pickup: for each record, a report file newer than its mark in
   `.team/delivered.json` that holds a REPORT line yields that line. Update
   the mark after the submit resolves.
5. If step 2 or 4 yielded lines, send them in one `$.prompt.submit`, REPORT
   lines first.
6. Refresh `$.state` for the pane: agents (name, state, pane), the plan file,
   the tick time, the last error.

herdr unreachable: the pane shows the error; one WATCH line
`herdr unreachable: <reason>` goes out once until a tick succeeds again.

### Overview pane

Pane id `team-overview`, title `Team`. Drawn from `$.state` only:

- plan title, then `DONE`, `RUNNING`, `NEXT`; items as `Text` rows with
  `✓` (green, dim) for `[x]`, `▶` (yellow) for `[>]`, `○` for `[ ]`,
  `wrap="truncate-end"`; DONE gives up its oldest items first when the pane
  is short (today's `frame` rule);
- agents: state, name, pane;
- footer: tick time and last error.

### Toggle command

`/team-overview` (mod command names take no `:`). It closes the pane when open, opens it when closed, and
answers one line. The choice is kept in `$.store` under the team id as
`overviewHidden`. A `ui.close` with origin `person` (✕, Esc) sets it too. On
activation the mod opens the pane unless `overviewHidden`.

### Tool `brief_send`

Listed as `mcp__team__brief_send`, input `{ name, topic }`. It reads the
record, checks that `topic` matches, and sends the kickoff text of today's
`team-brief send` with `$.session.send({ to: { sessionId: record.session } })`.
It returns the agent's herdr state. A rejected send returns the reason as an
error result.

When the record's `brief_sent_session` equals its `session` (the worker got
a brief in this session and was not cleared since), the tool waits up to
6 s for `session` to change, so a `/clear` sent just before has landed. (A
hook gets 10 s and a clock wait counts against it; amended after review.)
Still unchanged: error `<name> was not cleared since its last brief`. After a
send it writes `brief_sent_session`.

### Bash, kept and changed

| Script | Change |
|---|---|
| `team-start` | generates the session id, passes `--session-id`, writes `session`, `model`, `effort`, `mode` into the record, writes the session index; keeps stamping `TEAM_NAME` / `TEAM_SCRATCH` |
| `team-init` | checks the minimum Claude Code version; writes `orchestrator_session` from `TEAM_SESSION_ID` (refuses without it); no `herdr agent rename`; prunes stale index files |
| `team-brief` | `compose` stays; `send` is removed (the tool replaces it) |
| `team-status` | maps records to herdr agents by session id |
| `stop-report.sh` | identity by env, else by `session_id` through the index; writes report and stop record; never forwards |
| `session-start.sh` (new) | follows a worker through `/clear` (above) |
| `/team:release` | sends `/clear` with `herdr agent prompt <pane>`, the pane found by session id; a cross-session message would arrive as text, not as a command |

### Deleted

`team-watch`, `team-overview`, `lib/overview.py`, `team-deliver`, the
watcher and overview panes, `overview.json`, `own_pane`, the release step that
stops those panes, the `herdr agent rename` of the orchestrator.

## Resurrect

After a restart, with the design above:

- the orchestrator's mod activates again (`orchestrator_session` matches);
- worker Stop hooks find their records by session id;
- briefs reach workers by session id;
- pane ids heal on the first tick.

Open risk: herdr may restore a worker as `claude --resume <sid>` without the
launch flags (`--agent team-<role>`, `--model`, `--effort`,
`--permission-mode`, `--settings '{"crossSessionInbound":"accept"}'`).
Without the last one, briefs wait for the human's approval.

`/team:resurrect`:

1. For each record, find the pane by session id.
2. Where Claude runs without the team flags, exit it and run
   `claude --resume <sid>` with the saved flags in the same pane.
3. Report what it relaunched, what was healthy, and what it could not find.

Implementation starts with a real restart repro that records what herdr
passes on restore. If herdr keeps the flags, `/team:resurrect` is a health
check only.

## Error handling

| Case | Behaviour |
|---|---|
| Claude Code older than the pinned minimum | `team-init` stops with the version it found and the one it needs |
| `TEAM_SESSION_ID` unset in `team-init` | stop: the mod did not load; name the likely cause (version, plugin disabled) |
| herdr unreachable on a tick | pane shows the error; one WATCH line until a tick succeeds |
| `session.send` rejects | `brief_send` returns the reason |
| No index entry in the Stop hook | exit 0 silently |
| `prompt.submit` while the orchestrator is busy | the engine queues it until idle |
| Stale index files | release deletes its own; init prunes the rest |

## Testing

Acceptance tests first.

| Layer | Tool | Covers |
|---|---|---|
| Acceptance, mod | `claude plugin test`, an in-memory world answering the mod's `$` events (files, `herdr` output, store, env, clock) | activation only for `orchestrator_session`; one tick, one submit with all lines; no re-delivery after reload; `brief_send` targets the record's session and waits for a `/clear`; following the orchestrator's `/clear`; toggle and its persistence; pane-id healing |
| Unit, mod | same kit | plan parsing; WATCH rules |
| Acceptance, bash | `tests/test_team.py`, `fake-herdr` | Stop hook by env and by `session_id`; `session-start.sh` follows `/clear`; `team-start` session id, index, launch flags; `team-init` `orchestrator_session` and version check; `/team:resurrect` relaunch |
| E2E | live herdr run, Chebu present | init, start, brief, REPORT arrives; `/clear` then brief again; real restart repro, including a `/clear` before the restart |

No mocking library. Bash tests use `fake-herdr`, the existing fake binary.
Mod tests use the kit's own way: hooks beneath the plugin answer each `$`
event from an in-memory world, the way a nullable answers from configured
responses; the kit's clock drives the tick.

## Delivery

- `SPEC.md` increment, `README.md`, `commands/*.md`, the orchestration skill
  (briefs via `brief_send`).
- Version 0.5.0 (breaking: panes removed, minimum Claude Code version).

## Verify (manual, real herdr)

1. `/team:init`, start one worker, brief it, see the REPORT arrive within one
   tick.
2. Toggle the overview off and on; restart the orchestrator; the choice holds.
3. Quit herdr, restore, run `/team:resurrect`, brief the worker again, see
   the REPORT arrive.

## Out of scope

- Moving the worker Stop hook into a mod.
- Replacing herdr for pane spawning or agent states.
- Desktop, VS Code and mobile surfaces (the pane is tested on terminal only).
