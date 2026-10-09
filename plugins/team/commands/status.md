---
description: Read the roster, read idle agents that have not reported, and flag anything that needs attention. Run it in the envoy session.
argument-hint:
---
Load the `team-orchestration` skill first. Run this command in the envoy session:
the human talks only to the envoy. `team-status` skips the envoy and the session
it runs in, so the roster lists the orchestrator and the workers. Then:

1. Run `team-status --read-idle`. It writes the roster and reads every idle or
   done agent that has no report newer than its brief.
2. Print the roster block, then a two-line status per agent.
3. Flag anything that needs the human: a 401, a permission dialog, or a context
   above 70 percent.
4. Read the latest `WATCH` lines the team mod sent. Include any blocked
   agent with its dialog text, any over-budget tab, and any idle-tab release
   suggestion in the flags block. Pass on any warning `team-status` prints.

Remember: idle is not done. An idle agent without a REPORT still owes one.
