---
description: After a restart, relaunch team workers that came back without their team flags, resuming their sessions.
argument-hint:
---
Load the `team-orchestration` skill first. Then:

1. Run `team-resurrect`. It prints one line per worker: `relaunched`,
   `healthy`, or `missing`.
2. Report the lines to the human. For a `missing` worker, say that its
   session is gone and that it needs a new `team-start` and a new brief.
3. Run `team-status` and report the roster.
