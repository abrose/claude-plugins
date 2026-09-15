# Lessons

Hard-won operational lessons for the team workflow. Not auto-loaded. Read it
when you plan a run. Everything project-specific belongs in a project overlay,
never here.

## Briefs

- A brief names exact files, field names, and tool paths. It never says
  "explore" or "look into". Vague briefs produce vague work.
- Re-verify every `file:line` pointer before you rely on it. Pointers rot.
- A revision is a new file (`-rev2`), so the original brief and the decision
  trail stay intact.

## Decisions

- The numbered decisions file is the only binding source. If it is not written
  down and numbered, it did not happen.
- Number one-word answers too. "Yes" to a numbered question is itself a
  decision and gets its own number.
- Mirror the decisions file into each active worktree after every append, so an
  agent in a worktree reads the same truth.

## Agents

- Idle is not done. An agent that goes quiet without a REPORT gets an
  `agent read`. Silence is not success.
- After a task closes, `/clear` before reuse. A stale context poisons the next
  brief. The brief and the decisions file carry all the context that is needed.
- Reference every agent as `name (pane, session)` so the human can find it.

## Loops and limits

- Cap fix loops at three rounds. Say the round number in every status. A fourth
  round needs the human's explicit go.
- Behaviour-neutral tidy-ups do not count as rounds.

## Testing and verification

- Verify one load-bearing claim of every report before you relay it.
- A tester runs one probe per round and stops the driver last, after every
  observation is recorded.
- A blocked login or a missing port is a BLOCKED report with the port list, not
  a reason to start guessing credentials.

## The absent human

- When the human is away, log every own call to
  `scratchpad/orchestration-decisions.md` with its context. The human's own
  decisions stay in the numbered file. The two files never mix.

## Deferred features

These stay supported but sit off the default path; the minimal run does not
use them.

- Stacked branches: `project.yaml`'s `stacked: true` and the machete-based
  worktree chain (`git m add`, `git m update`). For a stacked branch, an
  implementer keeps the own-commit invariant described in
  `templates/brief-implementation.md` and `team-role-implementer/SKILL.md`:
  it commits only what it is responsible for on its own branch, never
  reaching up or down the stack. Mirroring the decisions file into every
  active worktree (see "Decisions" above) matters most here, where more than
  one worktree is live at once.
- Reviewer and post-notes work: briefs on `team-investigator` using the
  `brief-review.md` and `brief-post-notes.md` templates.
- The `spdd`, `crit`, and `tracker` keys in `project.yaml` and their
  matching overlay files (`.claude/team/tracker.md`, spdd sync steps in
  `brief-implementation.md`).
