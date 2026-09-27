---
description: Start a team run for a ticket - create the tab, the numbered decisions file, the plan file, the overview, and the first roster.
argument-hint: <ticket> [--label "<tab label>"]
---
Set up a team run for: $ARGUMENTS

Load the `team-orchestration` skill first. Then, doing no operational work
beyond these steps:

1. Derive the tab label from the ticket, or use the `--label` argument if given.
   Do not ask which roles the run needs: start agents on demand, when a task
   reveals the need for one.
2. Write the decisions file from
   `${CLAUDE_PLUGIN_ROOT}/skills/team-orchestration/templates/decisions.md`
   into `${TEAM_SCRATCH:-scratchpad}/decisions-<ticket>.md`. Refuse to overwrite.
3. Write the plan file from
   `${CLAUDE_PLUGIN_ROOT}/skills/team-orchestration/templates/progress.md`
   into `${TEAM_SCRATCH:-scratchpad}/progress-<ticket>.md`. Refuse to overwrite.
4. Run `team-init <ticket> --orchestrator-pane <this pane id>`. It writes the
   team id, the config, the safe permission baseline, records this tab, and
   renames this pane's agent to `<team_id>-orch`.
5. Start the overview: `team-overview --spawn`. It splits a pane right of this
   pane and shows the plan file and the live agents there. Run it before the
   watcher, so the overview spans the full tab height.
6. Start the watcher: `team-watch --spawn`. It splits one small pane off this
   pane, runs the watcher there by absolute path, and passes that pane's id as
   `--own-pane`, so the watcher never misreads its own pane. This tab now holds
   exactly three panes: you, the overview, and the watcher.
7. Run `team-status` to write the first roster.

Report the team id, the decisions file path, the plan file path, and the
roster to the human.
