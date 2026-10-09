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
- The `decide` tool does not mirror the decisions file. `team-brief prepare`
  copies the decisions file into the worktree of each agent it briefs, and the
  orchestrator passes each DECISION line on to the waiting worker (rule 6), so
  an agent in a worktree reads the same truth.
- For a review or diff run, pin the exact range in the decisions file up front:
  `parent = merge-base = <sha>, head = <sha>`. Every report then cites the same
  parent, so you never reconcile "origin/main" against a merge-base label.

## Agents

- Idle is not done. An agent that stays quiet without a REPORT until the
  team mod flags it gets an `agent read` of its pane. Silence is not success. A short idle
  is not silence: a worker that waits on its own subagents ends a turn each
  time one reports back.
- Reset an agent before every new task. Never brief a new task on an un-reset
  context: each reuse stacks another layer and the context grows every round.
  `/clear` when the new task is unrelated to the current one (the brief and
  the decisions file carry the context), `/compact` for every other new task.
  A stale, un-reset context poisons the next brief and wastes tokens.
- Do not `/clear` an agent until its deliverable file is confirmed on disk.
- A worker writes its REPORT line as plain text and stops; the Stop hook saves
  the whole message to the report file, and the team mod delivers the REPORT
  line to the orchestrator. The
  REPORT summary never goes into the deliverable file. An agent that writes its
  closing summary to the deliverable path overwrites the deliverable. The summary
  can look healthy while the file holds 21 lines of a 587-line catalogue.
- Reference every agent in a card as `name (pane, session)` so the human can
  find it.
- `team-status` lists only the agents whose session ids your `.team/` records
  hold, so agents from other sessions on this machine never show up there.
- Names are unique by construction. `team-init` skips a `<team_id>-*` namespace
  that live agents already hold, so a re-run for the same ticket gets a fresh id
  (`app-1` then `app-1-2`), never the old team's names. `team-start` refuses a
  label whose namespaced name is already a live agent. Trust the id init prints.

## Fan-out

- `brief_send` returns as soon as the kick-off is queued at the agent. To fan
  out N independent agents, call it once per agent; their REPORT lines come back
  through the team mod, several of one tick in one prompt.

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

## Team mod

- The watcher is the team mod in the orchestrator session and in the envoy
  session: nothing to start or restart. The overview and the `Questions` pane
  show in the envoy session. The mod activates within 15 s of `/team:init`,
  and again by itself when a session comes back after a restart. The `Team`
  pane's footer shows the last tick; a tick older than a minute means the mod
  is not running (check the Claude Code version, and that the plugin is
  enabled).
- `/team-overview` hides or shows both the `Team` and the `Questions` pane.
  Closing one with ✕ or Esc hides it too; the choice is kept per team.
- The mod flags a tab "consider release" only when the tab holds a briefed
  agent. A freshly spawned, un-briefed agent looks idle but is not a release
  candidate.
- `team-start` marks a pane it creates as pending until its agent is live, and
  registers a spilled tab only after that. The mod never closes a pending pane
  or an empty root pane of a fresh tab.
- The envoy tab is the human's own workspace, and the orchestrator runs in its
  own worker tab. The mod never closes or budget-flags panes in either tab.
  Pane hygiene applies to the other worker tabs only.

## Restarts

- herdr restores panes and resumes each Claude session with the same session
  id, but not herdr names, pane env, or the team launch flags. Agents are
  addressed by session id, so reports and briefs keep flowing. After a restart,
  the human runs `/team:resurrect` in the envoy session. It relaunches the
  orchestrator and the workers that came back without their flags (otherwise
  briefs may wait for approval at the worker).
- The human runs `/team:resurrect` before you `/clear` a restored worker. If you
  cleared it first, resurrect adopts the session its pane now runs; check the
  `adopted session` line before the next brief.

## The absent human

- When the human is away, log every own call to
  `scratchpad/current/orchestration-decisions.md` with its context. The human's own
  decisions stay in the numbered file. The two files never mix.

## Deferred features

These stay supported but sit off the default path; the minimal run does not
use them.

- Stacked branches: `project.yaml`'s `stacked: true` and the machete-based
  worktree chain (`git m add`, `git m update`). For a stacked branch, an
  implementer keeps the own-commit invariant described in
  `templates/brief-implementation.md` and `team-role-implementer/SKILL.md`:
  it commits only what it is responsible for on its own branch, never
  reaching up or down the stack. Carrying every decision to each worktree
  (see "Decisions" above) matters most here, where more than one worktree is
  live at once.
- Reviewer and post-notes work: briefs on `team-investigator` using the
  `brief-review.md` and `brief-post-notes.md` templates.
- The `spdd`, `crit`, and `tracker` keys in `project.yaml` and their
  matching overlay files (`.claude/team/tracker.md`, spdd sync steps in
  `brief-implementation.md`).
