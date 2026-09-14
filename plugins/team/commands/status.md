---
description: Read the roster, read idle agents that have not reported, and flag anything that needs attention.
argument-hint:
---
Load the `team-orchestration` skill first. Then:

1. Run `team-status --read-idle`. It writes the roster and reads every idle or
   done agent that has no report newer than its brief.
2. Print the roster block, then a two-line status per agent.
3. Flag anything that needs the human: a 401, a permission dialog, or a context
   above 70 percent.

Remember: idle is not done. An idle agent without a REPORT still owes one.
