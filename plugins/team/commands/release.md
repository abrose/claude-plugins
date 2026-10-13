---
description: Clear and close finished agents, running the overlay release check first. Refuses to release a working agent.
argument-hint: [name ...|all]
---
Release agents: $ARGUMENTS

Load the `team-orchestration` skill first. Run `/team:release all` (the end of
a session) in the envoy session. Run `/team:release <name>` in the orchestrator
session or in the envoy session. Release only agents that `team-status` lists. Never close the pane of the session you run in, and never the envoy's pane
(`envoy_session` and `envoy_tab` in `.team/config.json`), also for `all`. If
`team-status` fails, stop and report its error: do not pick panes by hand. For each
named agent (or every agent when `all`):

1. Check for its report file. If it is `working`, refuse to release it and say
   so.
2. If the overlay defines `release_check` in `.claude/team/project.yaml`, run it
   to catch orphan processes. It runs here, before the script, because the
   script is the same one the mod runs for the auto-release, and the mod never
   runs the overlay check.
3. Run `team-release <name>`. It does the rest as one unit: it takes the lock
   `.team/releasing/<name>`, finds the agent's pane by its session id at that
   moment (never a pane you looked up earlier: herdr reuses pane ids), sends
   `/clear` (the `agent_prompt_stalled` answer is expected, not a failure),
   closes the pane (closing the last pane closes the tab) and runs
   `team-forget <name>`, which deletes the session index entry and then the
   record. Read its result:
   - Exit 0: released. The line `no record: <name>` means the agent was gone
     already; that is no failure.
   - Exit 5: another release of this name holds the lock (the auto-release or a
     second `/team:release`). List it as busy and do not retry in a loop.
   - Exit 1: a step failed; stderr starts with `<step>: <reason>`. A `forget`
     refusal means herdr still lists the agent, so it is live: list it as
     refused.
   Never run `/clear`, `herdr pane close` or `team-forget` by hand for an
   agent you release; the script owns those steps and the lock.
4. When releasing `all`, also remove `.team/tabs.json`, `.team/watch-state.json`,
   `.team/layout-flags.json`, `.team/toasted.json`, `.team/next-action.json`,
   `.team/denials/` and `.team/last-relay.txt`, all under
   `${TEAM_SCRATCH:-scratchpad/current}`. Keep `.team/delivered.json`:
   its `_decision` mark stops the orchestrator from getting every DECISION line
   of the run again. The team mod stays active in the envoy session until
   `/team:init` starts another run.

Report which agents were released, which were refused and which were busy.

Where each rule is enforced:

- Refuse a `working` agent: step 1, in this command (the script does not read reports).
- Never close the own or the envoy pane: this command, through the `team-status` roster, which leaves out both. The mod excludes its own session and the exempt tabs before it calls the script.
- The overlay `release_check`: step 2, in this command. The mod never runs it.
- Pane found by session id, `/clear`, pane close, forget and the lock: `team-release`.
- `all` cleanup of the state files with `delivered.json` kept: step 4, in this command.
