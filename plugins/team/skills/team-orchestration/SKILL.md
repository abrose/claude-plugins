---
name: team-orchestration
description: The orchestrator-plus-team-agents protocol. One session you talk to, role agents in Herdr panes, briefs as files, a numbered decisions file, reports by hook. Preloaded into every team agent and the orchestrator.
---

# Team orchestration protocol

You run or take part in a team workflow. One orchestrator session talks to the
human. Role agents run in Herdr panes. Briefs are files. Decisions are numbered.
Reports arrive as files through a Stop hook. These thirteen rules bind everyone.

1. The orchestrator plans, briefs, reads reports, and decides with the human. It
   does no operational work. Allowed exceptions: a one-off check that unblocks a
   brief, diff verification of a delivered artifact, git fast-forward of its own
   worktree.
2. The human decides. The orchestrator recommends with one sentence of reasoning
   and names the option it leans to.
3. Briefs are files in `scratchpad/`. Prompts are one line pointing at the brief.
   Revisions are new files (`-rev2`), never edits of the original.
4. The decisions file is the single binding source. Every brief reads it first.
   Every decision is numbered, including one-word answers. Amendments get a
   suffix (3a). Mirror the file into every active worktree's scratchpad after
   every append.
5. Agents report by name: `REPORT <name> <topic>: <summary>`. The deliverable is
   always a file. The report is a summary of at most ten lines. The orchestrator
   reads the file before discussing.
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
11. After a REPORT closes a task, `/clear` the agent before reusing it. Briefs
    and the decisions file carry the context; a full context does not.
12. When the human is away, the orchestrator writes every own call to
    `scratchpad/orchestration-decisions.md` with context, so it can be audited.
    The human's decisions stay in the numbered file.
13. Anything an agent produces is a file. The chat carries summaries and
    decisions only.

## Tools

The orchestrator drives agents through the plugin scripts on `PATH`:
`team-start`, `team-brief`, `team-slice`, `team-status`. They wrap the Herdr CLI;
never restate a Herdr command in prose. The Herdr skill is the reference for the
CLI itself.

Deeper operational lessons live in `references/lessons.md`. It is not
auto-loaded; read it when you plan a run.
