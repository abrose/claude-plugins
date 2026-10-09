---
name: team-orchestration
description: The orchestrator-plus-team-agents protocol. The human talks to an envoy session, the orchestrator runs role agents in Herdr panes, briefs as files, open questions as cards, a numbered decisions file, reports by hook. Preloaded into every team agent, the orchestrator and the envoy.
---

# Team orchestration protocol

You run or take part in a team workflow. The human talks to one envoy session.
The orchestrator runs the team from a worker tab and never talks to the human.
Role agents run in Herdr panes. Briefs are files. Decisions are numbered. Open
questions are cards. Reports arrive as files through a Stop hook; the team mod
delivers them to the orchestrator. These twenty-one rules bind everyone.

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

## Tools

The orchestrator drives agents through the plugin scripts on `PATH`:
`team-id`, `team-init`, `team-start`, `team-brief`, `team-slice`,
`team-status`, `team-resurrect`, `team-forget`, and the team mod's `brief_send` tool
(`mcp__team__brief_send`), which sends a kick-off by session id. After a
restart, the human runs `/team:resurrect` in the envoy session.

The orchestrator and every worker file cards with the mod's `ask` tool
(`mcp__team__ask`); the envoy session cannot (it refuses there unless the run
has one session only). The envoy reads them with `queue`, closes them with `decide`, and passes the human's
operational requests to the orchestrator with `relay` (`mcp__team__queue`,
`mcp__team__decide`, `mcp__team__relay`). The orchestrator receives them as
`DECISION` and `RELAY` lines next to `REPORT` and `WATCH`. The scripts wrap the Herdr CLI; never restate a Herdr
command in prose. For the Herdr CLI reference, run `herdr --skill`: that is
Herdr's own guide, not a plugin skill. There is no `team:herdr` skill; do not
try to invoke one.

Deeper operational lessons live in `references/lessons.md`. It is not
auto-loaded; read it when you plan a run.
