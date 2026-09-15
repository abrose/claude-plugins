---
description: Start a team run for a ticket - create the tab, the numbered decisions file, and the first roster.
argument-hint: <ticket> [--label "<tab label>"]
---
Set up a team run for: $ARGUMENTS

Load the `team-orchestration` skill first. Then, doing no operational work
beyond these steps:

1. Ask the human ONE question with AskUserQuestion: confirm the tab label
   (default derived from the ticket) and which roles this run needs.
2. Write the decisions file from
   `${CLAUDE_PLUGIN_ROOT}/skills/team-orchestration/templates/decisions.md`
   into `${TEAM_SCRATCH:-scratchpad}/decisions-<ticket>.md`. Refuse to overwrite.
3. Run `team-init <ticket> --orchestrator-pane <this pane id>`. It writes the
   team id, the config, the safe permission baseline, and records this tab.
4. Rename this pane's agent to the `orchestrator` name from
   `${TEAM_SCRATCH:-scratchpad}/.team/config.json` (`<team_id>-orch`).
5. Split one small pane in this tab and start the watcher there:
   `team-watch` (it reads config for the orchestrator name). This tab now holds
   exactly two panes: you and the watcher.
6. Run `team-status` to write the first roster.

Report the team id, the decisions file path, and the roster to the human.
