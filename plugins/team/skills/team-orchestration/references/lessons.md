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
- Cite only a `file:line` you opened yourself. If an agent sub-delegates, it
  re-opens and re-verifies every anchor before the anchor enters its report,
  or marks the anchor as unverified. Second-hand anchors dilute a read-only
  investigator's guarantee.

## Decisions

- The numbered decisions file is the only binding source. If it is not written
  down and numbered, it did not happen.
- Number one-word answers too. "Yes" to a numbered question is itself a
  decision and gets its own number.
- Mirror the decisions file into each active worktree after every append, so an
  agent in a worktree reads the same truth.
- For a review or diff run, pin the exact range in the decisions file up front:
  `parent = merge-base = <sha>, head = <sha>`. Every report then cites the same
  parent, so you never reconcile "origin/main" against a merge-base label.

## Agents

- Idle is not done. An agent that goes quiet without a REPORT gets an
  `agent read`. Silence is not success.
- After a task closes, `/clear` before reuse. A stale context poisons the next
  brief. The brief and the decisions file carry all the context that is needed.
- Do not `/clear` an agent until its deliverable file is confirmed on disk.
- A REPORT line goes to the orchestrator by `herdr agent prompt`, never to the
  deliverable file. An agent that writes its closing summary to the deliverable
  path overwrites the deliverable. The summary can look healthy while the file
  holds 21 lines of a 587-line catalogue.
- Reference every agent as `name (pane, session)` so the human can find it.
- `team-status` may list herdr agents from other sessions on this machine. Your
  team's agents are the `<team_id>-*` names; read those.

## Fan-out

- `team-brief send --wait` blocks until the agent's whole turn completes, not
  until it starts. To fan out N independent agents in parallel, background each
  send. Do not wait on one before you start the next.

## Loops and limits

- Cap fix loops at three rounds. Say the round number in every status. A fourth
  round needs the human's explicit go.
- Behaviour-neutral tidy-ups do not count as rounds.

## Testing and verification

- Verify one load-bearing claim of every report before you relay it.
- Verify a report's size claim against the file. "Report says 587 lines, file
  has 21" is a one-line check that catches a clobbered deliverable.
- A tester runs one probe per round and stops the driver last, after every
  observation is recorded.
- A blocked login or a missing port is a BLOCKED report with the port list, not
  a reason to start guessing credentials.

## Watcher

- Start the watcher with `team-watch --spawn`. It splits its own pane off the
  orchestrator pane, runs by absolute path, and passes that pane's id as
  `--own-pane`. Do not start `team-watch` by hand in a `--no-focus` pane:
  `herdr pane current` returns the focused pane, not the watcher's, so a
  hand-started watcher can record the wrong own-pane and close its real pane.
- The watcher flags a tab "consider release" only when the tab holds a briefed
  agent. A freshly spawned, un-briefed agent looks idle but is not a release
  candidate, so it no longer triggers the flag.
- `team-start` registers a spilled tab only after its agent is live. The watcher
  never sees a registered tab with an empty root pane, so it never closes one.

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
