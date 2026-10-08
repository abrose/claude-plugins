---
description: Start a team run for a ticket in this session: this session becomes the envoy, the orchestrator starts in a worker tab.
argument-hint: <ticket>
---
Set up a team run for: $ARGUMENTS

Do these steps in order, and no operational work beyond them:

1. Load the `team-orchestration` and `team-role-envoy` skills.
2. Run `team-init <ticket> --envoy-pane <this pane id>`. It archives the previous
   run and every loose scratchpad entry to `scratchpad/.archive/`, then writes the
   decisions file and the plan file from the plugin templates, the team id, the
   config (with this session's id as `envoy_session`), the safe permission baseline,
   records this tab, and starts the orchestrator in a worker tab. Pass on any
   `worktree inside scratchpad` warning to the human. If it exits with any code
   except 4, report its stderr to the human, then stop: do not continue with the next
   steps. If it exits 4, the config and both files exist. Report its stderr to the
   human, then read it:
   - If it starts with `orchestrator started, tab lookup failed`, the orchestrator
     runs. Tell the human it runs without a recorded tab. Then continue with
     steps 3 and 4.
   - If it contains `is at a startup dialog`, the orchestrator did not start and its
     pane waits for the human. Tell the human to answer the dialog in that pane, close
     that pane, and run `/team:init` again. Never run `team-start` by hand: the config
     would not know that orchestrator. Then continue with step 3 and skip step 4.
   - Any other exit 4 means the orchestrator did not start. Tell the human so. Then
     continue with step 3 and skip step 4.
3. Run `team-status` to write the first roster. Tell the human the paths of the
   two files `team-init` wrote: `${TEAM_SCRATCH:-scratchpad/current}/decisions-<ticket>.md`
   and `${TEAM_SCRATCH:-scratchpad/current}/progress-<ticket>.md`.
4. Tell the human, in two sentences, that the team is up and that the `Team` and
   `Questions` tabs show it (`/team-overview` when the pane is too narrow). Ask what
   the orchestrator should start with, and send the answer with `relay`.
