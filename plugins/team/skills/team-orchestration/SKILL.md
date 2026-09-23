---
name: team-orchestration
description: The orchestrator-plus-team-agents protocol. One session you talk to, role agents in Herdr panes, briefs as files, a numbered decisions file, reports by hook. Preloaded into every team agent and the orchestrator.
---

# Team orchestration protocol

You run or take part in a team workflow. One orchestrator session talks to the
human. Role agents run in Herdr panes. Briefs are files. Decisions are numbered.
Reports arrive as files through a Stop hook, which also pings the orchestrator the
moment a worker stops. These fifteen rules bind everyone.

1. The orchestrator plans, briefs, reads reports, and decides with the human. It
   composes the team on demand: it starts an agent when a task needs one, and
   never asks the human up front which roles the run will use. It never does
   operational work itself. It never investigates a question, never
   analyses code to answer one, never runs a test, never drives a browser, never
   edits a file, never runs a project or build command. If a task is worth
   doing, it briefs an agent to do it, even when the task looks quick and even
   when no agent is running yet (start one). When you notice yourself about to do
   the work, stop and brief an agent instead.
   The orchestrator does only these things with its own hands: talk to the human;
   read the decisions file, briefs, reports, and delivered files; run the
   `team-*` scripts; read one file or run one read-only command to get a single
   fact a brief needs or to verify one claim of a report; git fast-forward its
   own worktree. Reading to brief or to verify is never a licence to start
   investigating - one read, then delegate.
2. The human decides. The orchestrator recommends with one sentence of reasoning
   and names the option it leans to.
3. Briefs are files in `scratchpad/`. Prompts are one line pointing at the brief.
   Revisions are new files (`-rev2`), never edits of the original.
4. The decisions file is the single binding source. Every brief reads it first.
   Every decision is numbered, including one-word answers. Amendments get a
   suffix (3a).
5. Agents report by name: `REPORT <name> <topic>: <summary>`. A worker writes that
   line as plain text and stops; the Stop hook delivers it to the orchestrator. The
   deliverable is always a file. The report is a summary of at most ten lines. The
   orchestrator reads the file before discussing.
6. Reports are discussed one at a time in arrival order. If a later report
   reframes an open one, say so and ask to combine.
7. Every mention of an agent to the human carries `name (pane, session)`. With
   more than two agents alive, every status message starts with the roster.
8. Idle is not done. An idle agent without a REPORT gets an `agent read` within a
   minute. A `done` wait without a REPORT means read the screen.
9. Only source-backed facts in every artifact. Unknowns become numbered open
   questions, never guesses. Verify one load-bearing claim of every report
   before relaying it.
10. Fix loops are capped at three rounds of test, fix, re-test. Say the round
    count in every status. A fourth round is the human's explicit exception.
    Behaviour-neutral tidy-ups do not count as rounds.
11. Reset an agent's context before every reuse. Never brief a new task on top
    of an old context: each reuse then stacks another layer, and the context
    grows every round for no gain. `/clear` is the default - the brief and the
    decisions file carry all the context a task needs. When the old context
    holds knowledge the next task needs, `/compact` instead, so that knowledge
    survives in condensed form. Confirm the reset landed (the agent reports a
    cleared or compacted context) before you send the next brief.
12. When the human is away, the orchestrator writes every own call to
    `scratchpad/orchestration-decisions.md` with context, so it can be audited.
    The human's decisions stay in the numbered file.
13. Anything an agent produces is a file. The chat carries summaries and
    decisions only.
14. A watcher runs per team in the orchestrator tab. It reports every state
    change, flags idle-without-report, and keeps the layout within budget.
    Never sit blind: act on `WATCH` lines.
15. Pane budgets: the orchestrator tab holds at most 2 panes (you and the
    watcher); a worker tab holds at most 6, tiled as a 2-column, 3-row grid. A
    7th agent goes to a new tab. Empty panes in team tabs are closed
    automatically. Open a worker tab only with `team-start --new-tab`, which
    puts the first agent in the tab's root pane in your own workspace; add more
    agents with `--into-tab`. Never create a tab with raw `herdr`.

## Tools

The orchestrator drives agents through the plugin scripts on `PATH`:
`team-id`, `team-init`, `team-start`, `team-brief`, `team-slice`, `team-watch`,
`team-status`. They wrap the Herdr CLI; never restate a Herdr command in
prose. For the Herdr CLI reference, run `herdr --skill`: that is Herdr's own
guide, not a plugin skill. There is no `team:herdr` skill; do not try to invoke
one.

Deeper operational lessons live in `references/lessons.md`. It is not
auto-loaded; read it when you plan a run.
