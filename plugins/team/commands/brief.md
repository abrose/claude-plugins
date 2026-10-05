---
description: Compose a brief for an agent, fill its task section, send the kick-off, and report the status line.
argument-hint: <name> <topic> [--template <t>]
---
Brief an agent: $ARGUMENTS

Load the `team-orchestration` skill first. Then:

1. Run `team-brief compose <name> <topic> [--template <t>]`. It prints the brief
   path.
2. Edit the brief's `## Task` and `## Output` sections yourself. Name the exact
   files, field names, and tool paths. Never leave "explore" or a vague step. A
   vague brief produces vague work.
3. Call the `mcp__team__brief_send` tool with `{ name, topic }`. It sends the
   kick-off to the agent's Claude session and returns `<name>: <state>`. An
   error result names the reason (no record, not cleared since its last brief,
   not delivered); report it to the human and do not re-send. A `blocked`
   state means a dialog: inspect it and ask the human.
4. Report the status line to the human as `name (pane, session) ...`.

Agent names are `<team_id>-<label>`. Pass the full name to `team-brief`, not
the bare label.
