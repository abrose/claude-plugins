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
3. Run `team-brief send <name> --topic <topic>`. Map its exit code:
   - 0: it prints the agent state; report it.
   - 5: the prompt stalled. Do not re-send. Read the pane and decide.
   - 6: the agent is blocked at a dialog. Inspect it and ask the human.
4. Report the status line to the human as `name (pane, session) ...`.

Agent names are `<team_id>-<label>`. Pass the full name to `team-brief`, not
the bare label.
