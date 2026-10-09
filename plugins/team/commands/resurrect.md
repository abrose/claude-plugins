---
description: After a restart, relaunch the orchestrator and the team workers that came back without their team flags, resuming their sessions. Run it in the envoy session.
argument-hint:
---
Load the `team-orchestration` skill first. Run this command in the envoy session:
the human talks only to the envoy. After a restart it relaunches the orchestrator
and the workers from their records in `.team/`. It starts no agent that has no
record. Then:

1. Run `team-resurrect`. It prints one line per agent: `relaunched`,
   `healthy`, `missing`, or `could not stop`. An agent that was `/clear`ed
   after the restore and before this command shows as `relaunched ...,
   adopted session <id>`: its pane's new session became its identity.
2. Report the lines to the human. For a `missing` agent, say that its
   session is gone and that it needs a new `team-start` and a new brief.
3. Run `team-status` and report the roster.
