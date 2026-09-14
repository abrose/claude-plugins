---
description: Start a team run for a ticket - create the tab, the numbered decisions file, and the first roster.
argument-hint: <ticket> [--label "<tab label>"]
---
Set up a team run for: $ARGUMENTS

Load the `team-orchestration` skill first. Then, doing no operational work
beyond these steps:

1. Ask the human ONE question with AskUserQuestion: confirm the tab label
   (default derived from the ticket) and which roles this run needs
   (investigator, implementer, tester).
2. Write the decisions file. Render
   `${CLAUDE_PLUGIN_ROOT}/skills/team-orchestration/templates/decisions.md` with
   the ticket substituted into `${TEAM_SCRATCH:-scratchpad}/decisions-<ticket>.md`.
   Refuse to overwrite an existing one.
3. Write `${TEAM_SCRATCH:-scratchpad}/.team/config.json` as
   `{"orchestrator":"orchestrator","ticket":"<ticket>"}`. The Stop hook forwards
   reports to the `orchestrator` name; this pane's agent must carry that name.
4. Create the run's tab (Herdr skill for the CLI), keeping the human's focus.
5. Run `team-status` to write the first roster.

Report the decisions file path and the roster to the human.
