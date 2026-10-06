---
description: Start a team run for a ticket - create the numbered decisions file, the plan file, and the first roster; the team mod opens the overview.
argument-hint: <ticket>
---
Set up a team run for: $ARGUMENTS

Load the `team-orchestration` skill first. Then, doing no operational work
beyond these steps:

1. Do not ask which roles the run needs: start agents on demand, when a task
   reveals the need for one.
2. Run `team-init <ticket> --orchestrator-pane <this pane id>`. It archives the
   previous run and every loose scratchpad entry to `scratchpad/.archive/`,
   then writes the team id, the config (with this session's id as
   `orchestrator_session`), the safe permission baseline, and records this tab.
   Pass on any `worktree inside scratchpad` warning to the human. If it exits
   non-zero, stop and report its stderr to the human; do not write any file or
   continue with the next steps.
3. Write the decisions file from
   `${CLAUDE_PLUGIN_ROOT}/skills/team-orchestration/templates/decisions.md`
   into `${TEAM_SCRATCH:-scratchpad/current}/decisions-<ticket>.md`. Refuse to overwrite.
4. Write the plan file from
   `${CLAUDE_PLUGIN_ROOT}/skills/team-orchestration/templates/progress.md`
   into `${TEAM_SCRATCH:-scratchpad/current}/progress-<ticket>.md`. Refuse to overwrite.
   In both files, replace `{{ticket}}` with the ticket. Read the templates with
   the Read tool, not a shell command.
5. Run `team-status` to write the first roster.

The team mod in this session activates within 15 s: it opens the `Team`
overview pane beside the transcript (`/team-overview` hides or shows it),
watches the agents, and delivers their REPORT lines and WATCH flags as
prompts.

Report the team id, the decisions file path, the plan file path, and the
roster to the human.
