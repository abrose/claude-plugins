# Orchestrator handover {{ticket}}
Written at {{timestamp}} before `reset_self`. Overwrite this file at each reset.
Facts only. Name every file. A reader with an empty context must be able to continue from this file.

## Step now and next
- Now: <the orchestrator-level step that runs>
- Next: <the step after it>

## Agents in flight
One line each: `name (pane, session)` - topic - brief file - what it waits for.

## Last line acted on
- REPORT: <agent and topic>
- DECISION: <number>
- WATCH: <line>
- RELAY: <text>

## Open cards
One line each: `Q-<n>` - what it asks - the plan item it blocks.

## Intentions not yet done
- <for example: brief the tester after the impl REPORT>
