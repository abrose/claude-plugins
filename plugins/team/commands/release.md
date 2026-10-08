---
description: Clear and close finished agents, running the overlay release check first. Refuses to release a working agent.
argument-hint: [name ...|all]
---
Release agents: $ARGUMENTS

Load the `team-orchestration` skill first. Release only agents that `team-status`
lists. Never close the pane of the session you run in, and never the envoy's pane
(`envoy_session` and `envoy_tab` in `.team/config.json`), also for `all`. If
`team-status` fails, stop and report its error: do not pick panes by hand. For each
named agent (or every agent when `all`):

1. Check for its report file. If it is `working`, refuse to release it and say
   so.
2. Find its pane with `team-status` (agents are matched by session id, not by
   herdr name). Send it `/clear` with `herdr agent prompt <pane> "/clear" --wait`.
   `/clear` never starts a turn, so this always returns `agent_prompt_stalled`;
   that is expected here, not a failure. Confirm the reset landed by reading the
   agent's status bar and checking the context gauge reads 0 percent, not by
   the prompt's exit code.
3. If the overlay defines `release_check` in `.claude/team/project.yaml`, run it
   to catch orphan processes.
4. Close its pane with `herdr pane close <pane>`. Closing the last pane closes
   the tab. Delete its session index entry:
   `rm -f "${TEAM_INDEX_DIR:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/team/sessions}/<session>.json"`, with
   `<session>` from its record.
5. When releasing `all`, also remove `.team/tabs.json`, `.team/watch-state.json`,
   `.team/layout-flags.json` and `.team/delivered.json`, all under
   `${TEAM_SCRATCH:-scratchpad/current}`. The team mod stays active in this
   session until `/team:init` starts another run.

Report which agents were released and which were refused.
