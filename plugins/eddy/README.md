# eddy

A spike: a copy of the team mod with card branches shown in the chat (fold) or in a pane, switchable.
It installs once from the `abrose-plugins` marketplace (see "Install eddy") and loads in every session. In a session that no eddy run names, eddy stays inert.
`SPEC.md` is the team spec under eddy names. The rest of this file is the team README under eddy names.

**Orchestrator-plus-team-agents workflow for Claude Code with Herdr.** One
envoy session you talk to, an orchestrator that runs the team, role agents in
panes, briefs as files, open questions as cards, a numbered decisions file,
reports by hook. This plugin is the kernel: a project-agnostic process,
role definitions, templates, commands, a Claude Code mod, and glue scripts
around the Herdr CLI. Everything about a specific repository lives in that
repository's overlay.

Requires Claude Code 2.1.292 or newer (the eddy mod runs on its function hooks;
the `Eddy` and `Eddy questions` tabs, the status line and the toast were checked on
that build, not on older ones).

## How it works

- You talk to one **envoy** session: the session where you run `/eddy:init`.
  It speaks when you speak to it, and when the eddy mod sends it a
  next-action message about a run change: a card or step that waits on you,
  the run idle on you for 2 minutes, a blocked worker, the run finished. A
  step done sends no message of its own, and the message tells only what
  changed. So when you come back, the pane already says where the run stands
  and what you do next. It shows the question queue, records your decisions with
  `decide`, and passes operational requests to the orchestrator with `relay`.
- `/eddy:init` starts an **orchestrator** in its own worker tab. It plans,
  briefs, reads reports, and acts on `DECISION` and `RELAY` lines. It never
  talks to you in chat: anything it needs from you becomes a card. It never
  does operational work itself - no investigating, testing, browsing, or
  editing. Every such task goes to an agent.
- Each **role agent** runs in its own Herdr pane, started with `eddy-start`.
  Every agent is addressed by its Claude **session id**, never by its herdr
  name: herdr does not restore names after a restart, session ids survive it.
- An open question is a **card** (`ask` tool): context, question, options with
  cost, a recommendation, what waits, and whether the door is one-way or
  two-way with an estimate of the rework. A worker parks a two-way card with
  about an hour of rework or less and continues; it waits on the others. The
  envoy shows cards grouped by tag, and `decide` closes one or several with one
  numbered decision. An urgent card shows as a status line and one toast in the
  envoy session, and its next-action message goes out at the next check,
  without the quiet wait.
- A **brief** is a file in `scratchpad/eddy/current/`, composed by `eddy-brief` from
  templates plus your project overlay. The orchestrator sends the one-line
  kick-off with the `brief_send` tool.
- The **decisions file** (`scratchpad/eddy/current/decisions-<ticket>.md`) is the single
  binding source. Every brief reads it first. `eddy-init` creates it; after that
  the envoy is its only writer, through `decide`.
- When an agent stops, a **Stop hook** writes its last message to
  `scratchpad/eddy/current/reports/<name>-<topic>.md`.
- The **eddy mod** runs inside the orchestrator session and the envoy session.
  Every 15 s the orchestrator half picks up new `REPORT` lines and new
  decisions, checks the agents, and sends what it found as one prompt. The
  envoy half draws the `Eddy` and `Eddy questions` tabs beside the transcript and
  keeps the urgent badge.

The full protocol is the `eddy-orchestration` skill. Operational lessons are in
its `references/lessons.md` (not auto-loaded).

## Install eddy

Eddy installs from the `abrose-plugins` marketplace on GitHub, where it has its own entry named `eddy`. It loads in every session. You need no flag and no alias.

1. Install it once, after the entry is pushed with `main`:

   ```
   claude plugin install eddy@abrose-plugins
   ```

2. Start a new session, or run `/reload-plugins` in a running one. If the eddy mod did not load, `eddy-init` refuses and tells you to do this.
3. A change reaches sessions by a version bump of `plugins/eddy/.claude-plugin/plugin.json` plus a push of `main`. A running session keeps the code it loaded until `/reload-plugins` or a new session.
4. To remove it:

   ```
   claude plugin uninstall eddy@abrose-plugins
   ```

In a session that no eddy run names, eddy stays inert. It opens no pane, sends no message and writes no file. Its tools, commands, skills and agents are all named `eddy`, so they cannot clash with the team plugin.

To work on eddy itself, load a checkout for one session with `claude --plugin-dir plugins/eddy`. Workers started from that checkout get the same flag. Normal use needs neither.

## Commands

| Command | Does |
|---|---|
| `/eddy:init <ticket>` | Run it in the session you talk to: that session becomes the envoy. Archives the previous run, writes the decisions file and the plan file (`eddy-init` does it; a ticket must be a plain name such as `ABC-123`), starts the orchestrator in a worker tab, writes the first roster. The eddy mod then opens the `Eddy` and `Eddy questions` tabs. Agents are started on demand, not chosen up front. |
| `/eddy:brief <name> <topic>` | The orchestrator runs it: compose a brief, fill its task section, send the kick-off with `brief_send`, note the status line in the plan file. |
| `/eddy:status` | Run it in the envoy session. Read the roster (the orchestrator and the workers), read idle agents that owe a report, flag anything that needs you. |
| `/eddy:release [name ...|all]` | `all` (the end of a session) runs in the envoy session; `<name>` runs in the orchestrator or the envoy session. Clear and close finished agents, then forget their records and index entries; refuse a working one. Never closes the envoy's pane or the pane of the session it runs in. `all` also clears the mod's state files, but keeps `delivered.json` so the orchestrator gets no old `DECISION` line again. |
| `/eddy:resurrect` | Run it in the envoy session. After a restart, relaunch the orchestrator and the workers that came back without their team flags, resuming their sessions. It starts no agent that has no record. |
| `/eddy-overview` | Hide or show the `Eddy` and `Eddy questions` tabs (a mod command; the choice is kept per team). In a herdr pane narrower than 144 columns the tabs wait undrawn; the first call draws them. |
| `/eddy-envoy` | Run it in a fresh session you talk to, to make it the envoy of the live run (a mod command). The `Eddy` and `Eddy questions` tabs, the status line and the envoy tools move to this session. If the orchestrator's session is gone, it starts a new orchestrator from zero and says so; a live one is left alone. Without a run it refuses and names `/eddy:init`. |

In the `Eddy` pane, click an agent row to jump to its herdr pane. With the keyboard: `ctrl+x tab` focuses the pane, then `1`-`9` jumps to that agent.

## Scripts (`bin/`, on `PATH` when enabled)

| Script | Does |
|---|---|
| `eddy-id slug\|hash\|for` | Compute a team id: slug a ticket, or a random hash. |
| `eddy-init <ticket> [--envoy-pane <id>]` | Refuse a ticket that is not a plain name (exit 2), check the Claude Code version, archive the previous run to `scratchpad/eddy/.archive/` (refuses while its agents are live), write `decisions-<ticket>.md` and `progress-<ticket>.md` from the templates (never overwrites), write the team id and config with this session as `envoy_session`, seed the safe permission allowlist, record the envoy's tab, start the orchestrator in a worker tab and record its session and tab (`eddy-orch-start`), prune stale session index entries. |
| `eddy-orch-start` | Start the run's orchestrator in a new worker tab of the current directory and write its `orchestrator_session` and `orchestrator_tab` into the config. `eddy-init` and `/eddy-envoy` both use it. |
| `eddy-start <name> <role>` | Start a role agent (`investigator`, `implementer`, `tester` or `orchestrator`) in a pane with a session id it assigns (`--session-id`), verify its status bar, record it under `.eddy/` with its launch flags, and write its session index entry. The new `claude` loads the plugin this script came from (`--plugin-dir`), unless that is an installed copy. `--new-tab` opens a worker tab with the agent in its root pane. |
| `eddy-brief compose\|prepare` | Compose a brief from templates + overlay, or prepare its kick-off prompt (update the record, mirror into a worktree, print the prompt). |
| `eddy-slice <branch> <parent>` | Create a worktree (with the repo's own `worktree_cmd` from the overlay; refuses without one) and a Herdr tab for one slice. |
| `eddy-status` | Match `herdr agent list` to `.eddy/` records by session id into a roster. Each session appears once; the envoy and the calling session never do. |
| `eddy-resurrect` | Relaunch the orchestrator and the workers a herdr restore marked as restored, with their saved flags and the same `--plugin-dir` rule as `eddy-start`. A marked agent `/clear`ed before it ran is adopted: the session its recorded pane runs, when no record claims it, becomes its identity. |
| `eddy-forget <name> ...` | Delete the session index entry and the record `.eddy/<name>.json` of each named agent, once its pane is closed (`eddy-release` runs it). Keeps both for an agent herdr still lists, and accepts only plain names and plain session ids. |
| `eddy-release <name>` | Release one agent: take the lock `.eddy/releasing/<name>` (a held lock exits 5), find its pane by session id now, `/clear`, close the pane, `eddy-forget`. `/eddy:release` and the mod's auto-release both run it. A failed step exits 1 with `<step>: <reason>` on stderr. |

## Roles

| Role | Agent | Model | Default effort | Read-only |
|---|---|---|---|---|
| investigator | `eddy-investigator` | Opus 5.5 | medium | yes (tool filter) |
| implementer | `eddy-implementer` | Sonnet 5.5 | medium | no |
| tester | `eddy-tester` | Sonnet 5.5 | low | yes, except test files (by rule) |
| orchestrator | `eddy-orchestrator` | Opus 5.5 | medium | by rule (never edits, never investigates); started by `eddy-init` |
| envoy | `eddy-envoy` | Opus 5.5 (fresh session only) | - | In a fresh session started with `claude --agent eddy-envoy`: yes (`Edit`, `Write` blocked). In your own session after `/eddy:init`: no. It keeps every tool and its own model; the prose rule of `eddy-role-envoy` is its only guard |

The orchestrator overrides the defaults per job with `eddy-start --model
opus-5-5|sonnet-5-5|haiku-5-5` and `--effort low|medium|high|xhigh|max`. Any
other model is refused. Without `--effort`, `haiku-5-5` runs at effort `high`.

Reviewer and post-notes work run on `eddy-investigator` with the `brief-review`
and `brief-post-notes` templates. Mechanical jobs run on `eddy-implementer`
with `--model haiku-5-5`.

## Multiple teams

`/eddy:init <ticket>` assigns the run a short team id (a slug of the ticket)
and writes it to `.eddy/config.json`. Every agent name becomes
`<team_id>-<label>`; the orchestrator is `<team_id>-orch`. Init checks
the live `herdr agent list` and, if that name namespace is already taken (for
example by a prior run for the same ticket), disambiguates the team id
(`app-1`, then `app-1-2`, then a random hash). `eddy-start` likewise refuses a
`<team_id>-<label>` that a live agent already holds. A team's mod only ever
acts on the agents and tabs recorded under its own `.eddy/` directory.

## The eddy mod

`hooks/mod/` is a Claude Code mod in the same plugin. It loads in every
session with the plugin enabled and activates per role: the orchestrator half
in the session that `.eddy/config.json` names as `orchestrator_session`, the
envoy half in the one it names as `envoy_session`. A config without
`envoy_session` (an older run) runs both halves in the orchestrator session. On
`session.start` it sets `EDDY_SESSION_ID`, which `eddy-init` reads.

Every 15 s the **envoy half** reads the plan, the cards and the agent rows for
the `Eddy` and `Eddy questions` tabs, sets the status line to `<n> urgent: ...` while
an urgent card waits, and toasts each new urgent card once. It also sets the
line to `run waits on you: <k> open (Q-a, ...)`, with one toast per episode
(every toast stays 30 s), when an open card is all the team waits on for 2 minutes (every worker idle with
a fresh report, the orchestrator idle; an urgent badge or a `prompt not sent`
line wins the line). The `Eddy questions` tab draws a waiting urgent card with a red
`!`. It also lists each
idle worker tab in the `Eddy` tab as `tab <id> idle, consider release (<pane>
<status>, ...)`. It sends no prompt.

Every 15 s the **orchestrator half**:

- maps each record's `session` to a herdr agent and writes a moved pane id
  back to the record, so pane ids heal after a restart;
- picks up report files newer than its marks in `.eddy/delivered.json` and
  sends their `REPORT` lines (the first activation only sets the marks), and
  sends a `DECISION` line for each new decision the envoy recorded;
- sends a `WATCH` line for a transition into `blocked` (with the dialog's
  first line), and for an agent that has been quiet for 2 minutes without a
  report, once per quiet spell. Quiet means `idle` or `done` in herdr, or no
  new turn in its transcript since its last stop. A report counts only when the
  report file holds a `REPORT` line and is newer than the brief;
- closes an empty pane in a team-managed worker tab only when a team record
  names that pane and `eddy-start` has not marked it pending; never touches the
  orchestrator's own tab (the one herdr shows it in, and `orchestrator_tab` in
  the config) or the envoy's (`envoy_tab`), which `eddy-init` records;
- flags a tab over its pane budget;
- releases an agent that stayed `idle` or `done` with a fresh report for 30
  minutes (the timer resets on `working` or `blocked`), when it has no open or
  assumed card and its pane is in a team tab (one `eddy-start` made, listed in
  `tabs.json`) that is not the orchestrator's, the envoy's or the human's. It
  runs `eddy-release <name>` (the script `/eddy:release <name>` runs too:
  `/clear`, close the pane, `eddy-forget`), then sends `released <name> (<pane>) after 30 min idle`.
  A step that fails sends `WATCH <name>: auto-release failed at <step>: <reason>`
  and is not tried again until the agent worked, blocked or lost its report, or
  herdr was down (then after a fresh 30 minutes). An agent without a report
  is never released;
- sends one `WATCH herdr unreachable: <reason>` while herdr is down.

All lines of one tick go out as one prompt (`REPORT` lines first, then
`DECISION`, then `WATCH` and the `released` lines), which waits until the orchestrator is idle and never
touches a draft you are typing.

The `brief_send` tool (`mcp__eddy__brief_send`) sends a kick-off by session id.
It works only in the orchestrator session; elsewhere (a worker, the envoy,
another repo) it refuses.

The card tools are `ask`, `queue`, `decide` and `relay`:

| Tool | Where | Does |
|---|---|---|
| `ask` | orchestrator and workers (not the envoy, except in a run with one session) | File a card. Returns `Q-<n>`; the worker names it in its `REPORT`. |
| `queue` | envoy | List open and assumed cards grouped by tag, most pressing first. |
| `decide` | envoy | Close cards with one numbered decision (appended to the decisions file), or mark them obsolete. Lists in `overrides` the assumed cards the answer changes. |
| `relay` | envoy | Send an operational request to the orchestrator as a `RELAY` line. Refuses a text equal to the last one sent. |
Auto mode reviews that send as a `SendMessage` with no user request behind it,
so its classifier gives no verdict; `eddy-init` therefore adds `SendMessage` to
`permissions.allow` in `.claude/settings.local.json`, which decides it without
the classifier. Remove that entry if you want to approve each send yourself.
When the agent got a brief in its current session and was neither cleared nor
compacted since, it waits up to 6 s for a `/clear` or `/compact` to land, then
refuses.

### Upgrading from 0.5.x

A run started before 0.6.0 has no `envoy_session` in its config. It keeps
working: the orchestrator session holds both roles, shows the `Eddy` and
`Eddy questions` tabs, and can call `queue` and `decide` itself. `relay` refuses
there, because no separate envoy exists. Start the next run with `/eddy:init`
to get the envoy and the orchestrator in separate sessions.

### Upgrading from 0.4.x

A team started before 0.5.0 has no `orchestrator_session` in its config, so
the mod stays inactive for it and nothing delivers its REPORT lines;
`eddy-status` warns about it. Finish such a run by reading `reports/` by hand,
or start a new run with `/eddy:init`.

## Overlay contract

A project provides zero or more of these under its own repository. The kernel
runs with an empty overlay; a missing file it would have used produces one
warning.

| Path | Used by | Content |
|---|---|---|
| `.claude/team/project.yaml` | `eddy-slice`, `/eddy:release`, brief compose | `stacked`, `spdd`, `worktree_cmd` (required by `eddy-slice`), `worktree_dir` (required by `eddy-slice`), `release_check`, `gate_cmd` |
| `.claude/team/env.md` | brief compose ("Environment") | how to run and test locally; a "Slice kick-off" checklist |
| `.claude/team/gate.md` | brief compose ("Gate") | test command, lint, the greps a delivery must pass |
| `.claude/team/tracker.md` | analysis and post-notes briefs | ticket system and hygiene rules |
| `.claude/team/roles/<role>.md` | brief compose | extra brief sections for one role in this repo |
| `.claude/skills/project-<role>/SKILL.md` | agent preload | standing rules for one role in this repo |

## Task-scope files

All under `$EDDY_SCRATCH` (default `scratchpad/eddy/current/`, git-ignored). `/eddy:init`
archives the previous run to `scratchpad/eddy/.archive/`.
`decisions-<ticket>.md`, `progress-<ticket>.md`, `orchestration-decisions.md`,
`brief-<name>-<topic>.md`, `reports/<name>-<topic>.md`, `.eddy/<name>.json`,
`.eddy/config.json`, `.eddy/tabs.json`, `.eddy/watch-state.json`,
`.eddy/layout-flags.json`, `.eddy/delivered.json`, `.eddy/toasted.json` (ids of
urgent cards seen or toasted, plus the `stall:` timer and `stall-toast:` marks of the stall flag), `.eddy/last-relay.txt` (the last relayed text and its
orchestrator session), `.eddy/next-action.json` (the marks of the next-action
message), `.eddy/denials/` (one `<name>.json` per agent with its last auto-mode
denial), `.eddy/questions/` (one `Q-<n>.json` per card, and
`claims/`), `.eddy/decisions/` (one `<n>.json` per decision, which the
orchestrator's tick reads), `.eddy/stops/`, `.eddy/restored/`, `.eddy/roster.md`.

One file lives outside the run dir: the session index,
`${EDDY_INDEX_DIR:-${CLAUDE_CONFIG_DIR:-~/.claude}/eddy/sessions}/<session>.json`
(`{ "scratch", "name" }` per agent). It follows the Claude Code profile, and
`eddy-start` passes its caller's `CLAUDE_CONFIG_DIR` to the agent's pane. The
envoy's `eddy-init` starts the orchestrator, and the orchestrator starts the
workers, so an eddy run stays in one profile.

## Hook identity

The Stop hook finds its agent in this order:

1. `EDDY_NAME` and an absolute `EDDY_SCRATCH` in its own environment.
   `eddy-start` stamps both onto the agent's pane; they survive `/clear` but
   not a restart.
2. Else the payload's `session_id` through the session index, then the record,
   whose `session` must match.

Neither: the hook exits silently (any non-team session). A `SessionStart` hook
keeps the identity current: on `/clear` (a new session id in the same process)
it moves the record's `session` and the index entry to the new id; on a resume
without `EDDY_NAME` (a herdr restore) it marks the worker in `.eddy/restored/`
for `/eddy:resurrect`. The mod follows the `/clear` of the orchestrator session and of the envoy
session the same way, through `session.end`.

## Tests

```
python3 -m unittest discover -s plugins/eddy/tests
claude plugin test plugins/eddy
```

The bash tests put a shim directory on `PATH` that exposes `tests/fake-herdr`
as `herdr`, `tests/fake-git` as `git` and `tests/fake-claude` as `claude`. They
record every invocation and answer with canned output, so the scripts run
against a real (fake) CLI, never a mock. The mod tests (`tests/mod/`) answer
each engine call the mod makes from an in-memory world (`tests/mod/world.ts`):
files, herdr output, store, env, clock.

## License

MIT. See `LICENSE`.
