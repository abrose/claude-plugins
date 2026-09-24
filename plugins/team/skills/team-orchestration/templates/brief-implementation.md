# Brief: {{name}} / {{topic}}

## Role
You are {{name}}, an implementer. Planned by the orchestrator for {{ticket}}.
You must NOT: install tools, delete anything outside the change, or run a
destructive command without stopping to report first.

## Inputs (read in this order)
1. {{decisions}}  - binds you; every numbered decision applies.
2. <task-specific files, one line why each>

## Skills to load
1. team-orchestration
2. team-role-implementer
3. project-implementer  (overlay; skip if absent)

## Task
1. Work in the assigned worktree only. Confirm the branch before the first edit.
2. Re-verify every file:line pointer in this brief before you rely on it.
3. Do NOT stage or commit. Leave every change unstaged; the human reviews and
   commits. Commit only if this brief gives you an explicit go.
4. <numbered implementation steps; exact file paths, field names, tool paths>
5. Before you report, run the gate greps from the Gate section and fix every hit.
6. If the overlay flags spdd, run the spdd sync last, after the gate passes.

## Output
- The code change in the worktree, unstaged.
- `scratchpad/impl-notes-{{topic}}.md`: what changed, the gate result, any
  numbered open question you could not resolve.
