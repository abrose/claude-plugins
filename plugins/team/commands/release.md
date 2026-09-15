---
description: Clear and close finished agents, running the overlay release check first. Refuses to release a working agent.
argument-hint: [name ...|all]
---
Release agents: $ARGUMENTS

Load the `team-orchestration` skill first. For each named agent (or every agent
when `all`):

1. Check for its report file. If it is `working`, refuse to release it and say
   so.
2. Send it `/clear`.
3. If the overlay defines `release_check` in `.claude/team/project.yaml`, run it
   to catch orphan processes.
4. Close its pane (Herdr skill for the CLI). Closing the last pane closes the
   tab.
5. When releasing `all`, also stop the watcher: send its pane Ctrl-C, then
   close it. Remove `${TEAM_SCRATCH:-scratchpad}/.team/watch-state.json` and
   `${TEAM_SCRATCH:-scratchpad}/.team/tabs.json`.

Report which agents were released and which were refused.
