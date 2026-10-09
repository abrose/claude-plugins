---
description: Compose a brief for an agent, fill its task section, send the kick-off, and note the status line in the plan file.
argument-hint: <name> <topic> [--template <t>]
---
Brief an agent: $ARGUMENTS

Load the `team-orchestration` skill first. Then:

0. If the agent already worked on a task, reset its context first (rule 11):
   `/clear` when this task is unrelated to its last one, `/compact` otherwise.
   Send it with `herdr agent prompt <pane> "/clear" --wait` (or `"/compact"`)
   and confirm the reset landed on its status bar.
1. Run `team-brief compose <name> <topic> [--template <t>]`. It prints the brief
   path.
2. Edit the brief's `## Task` and `## Output` sections yourself. Name the exact
   files, field names, and tool paths. Never leave "explore" or a vague step. A
   vague brief produces vague work.
3. Call the `mcp__team__brief_send` tool with `{ name, topic }`. It sends the
   kick-off to the agent's Claude session and returns `<name>: <state>`. An
   error result names the reason (no record, not cleared or compacted since its last brief,
   not delivered); do not re-send. Fix the cause, or file a card via `ask` if
   only the human can fix it. A `blocked` state means a dialog: inspect it, and
   file a card via `ask` if only the human can answer it.
4. Note the status line in `progress-<ticket>.md` as `name (pane, session) ...`
   (rule 17). The orchestrator never speaks to the human (rule 16).

Agent names are `<team_id>-<label>`. Pass the full name to `team-brief`, not
the bare label.
