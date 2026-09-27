# Design: team plugin - one scratchpad folder per run

Date: 2026-09-27
Status: agreed in brainstorm, pending spec review
Relates to: `plugins/team/SPEC.md`. This is an increment on that spec.

## Problem

Chebu runs different tasks in the same repository, one after another. A team
run writes briefs, reports, the decisions file, the plan file, `.team/` and
agent notes flat into `scratchpad/`. The scratchpad is git-ignored, so in a
branch repo it survives every `git switch` and grows over time. The next task
sees all of it: an agent that lists or globs `scratchpad/` reads old briefs
and reports, gets derailed, and spends context on them. Today only `.team/` is
archived (to `.team-<ticket>`); everything else stays in view.

A second problem surfaced on the way: `team-slice` creates worker worktrees at
`scratchpad/wt-<branch>` by default, and it runs whether or not the repo has
its own worktree tooling. That puts a `.git` inside the scratchpad and can
bypass a project's own worktree scripts (for example git machete setups).

## Decisions (this brainstorm)

1. Scope: the team plugin first, as the reference. A general convention for
   non-team tasks is a separate, later piece.
2. One active run per checkout directory. This covers both repo types: a
   branch repo has one checkout, and in a worktree repo every worktree is its
   own directory with its own scratchpad. The orchestrator may run in either
   the main checkout or a task worktree; the run belongs to the orchestrator's
   checkout.
3. Layout: a fixed folder `scratchpad/current/` holds the active run. It is
   the new default of `TEAM_SCRATCH`.
4. Old runs are archived out of sight to `scratchpad/.archive/`, never
   deleted.
5. Every `/team:init` also sweeps loose entries in `scratchpad/` into the
   archive, so stale ad-hoc files leave the view as well.
6. There must never be a `.git` in `scratchpad/` or any of its subfolders.
7. `team-slice` has no built-in worktree location. It refuses unless the
   repo's overlay says how that repo makes worktrees.

## Layout

```
scratchpad/
  current/                        <- TEAM_SCRATCH default: the active run
    .team/
    decisions-<ticket>.md
    progress-<ticket>.md
    brief-<name>-<topic>.md
    reports/
    (agent notes and analyses)
  .archive/
    <ticket>-<YYYY-MM-DD>/        <- an earlier run, same shape as current/
    loose-<YYYY-MM-DD>/           <- swept loose entries
```

File names inside `current/` stay as they are today (`decisions-<ticket>.md`,
`brief-<name>-<topic>.md`, ...), so an archived run and a mirrored file still
name their ticket.

The scratch root is `dirname(TEAM_SCRATCH)`. With the default it is
`scratchpad`.

## Default path

Every place that reads `${TEAM_SCRATCH:-scratchpad}` changes its default to
`scratchpad/current`:

- `bin/team-init`, `team-start`, `team-brief`, `team-watch`, `team-status`,
  `team-overview`;
- `hooks/handlers/stop-report.sh` (three places, including the fallback
  REPORT line's path);
- `commands/init.md`, `commands/release.md`.

An explicitly set `TEAM_SCRATCH` keeps working as before and is used as is.

## Start of a run: `team-init`

`team-init <ticket>` does these steps, in this order, before it writes the new
config:

1. **Live guard (unchanged).** If `current/.team/config.json` exists and any
   agent of that team (`<team_id>-*`) is live in `herdr agent list`, refuse
   with exit 1 and name the live agents. Nothing moves.
2. **Archive the old run.** If `current/` exists and is not empty, move it to
   `<scratch root>/.archive/<old ticket>-<YYYY-MM-DD>/`. The old ticket comes
   from `current/.team/config.json`; without one, the name is
   `run-<YYYY-MM-DD>`. If the name is taken, append `-2`, `-3`, and so on.
   This replaces the `.team-<ticket>` archive.
3. **Sweep loose entries.** Only when the scratch root's basename is
   `scratchpad` (so a custom `TEAM_SCRATCH` never sweeps an unrelated
   directory such as the repo root). Every entry of the scratch root except
   `current`, `.archive` and entries that hold a `.git` anywhere inside moves
   to `<scratch root>/.archive/loose-<YYYY-MM-DD>/` (again `-2`, `-3` on a
   clash). An entry that holds a `.git` is skipped and reported on stderr:
   `❗️ worktree inside scratchpad: <path> - move it out with git worktree move`.
   It is never moved, because a moved worktree breaks.
4. **Create** a fresh, empty `current/` and `current/.team/`.

Errors: the first failed move stops `team-init` with exit 1 and names the
path. Step 2 runs before step 3, so a failure never leaves a half-archived
run. The date is the local date at init time.

## `/team:init` order

`team-init` must run before the decisions file and the plan file are written;
otherwise they land in the old `current/` and are archived at once. New order:

1. Derive the tab label.
2. `team-init <ticket> --orchestrator-pane <this pane id>`.
3. Write `decisions-<ticket>.md` from the template into
   `${TEAM_SCRATCH:-scratchpad/current}/`. Refuse to overwrite.
4. Write `progress-<ticket>.md` the same way.
5. `team-overview --spawn`.
6. `team-watch --spawn`.
7. `team-status`.

## Worktree agents

- `team-brief send` mirrors the brief and the decisions file into
  `<agent cwd>/scratchpad/current/` (was `<agent cwd>/scratchpad/`), and the
  kick-off names the brief as `scratchpad/current/<brief file>`.
- `team-slice --copy <dir>` copies into `<worktree>/scratchpad/current/`.
- The Stop hook of a worktree agent keeps writing its report into the
  orchestrator's run through the absolute `TEAM_SCRATCH` that `team-start`
  stamps on the pane (unchanged mechanism).

## Spawned panes

`team-overview --spawn` and `team-watch --spawn` pass the absolute
`TEAM_SCRATCH` to the pane they start, the same way `team-start` does for
agents. A non-default `TEAM_SCRATCH` then reaches the overview and the
watcher.

## `team-slice` without a default

- With no `worktree_cmd` in `.claude/team/project.yaml`, `team-slice` exits 2
  and prints
  `no worktree_cmd in .claude/team/project.yaml - ask the human how this repo makes worktrees`.
  It runs no git command and creates no tab.
- With no `worktree_dir`, it exits 2 with the same kind of message naming
  `worktree_dir`.
- The built-in default `git worktree add -b {branch} scratchpad/wt-{branch}
  {parent}` is removed.
- `team-slice` never removes, moves or changes an existing worktree
  (unchanged).

## Agent rules

- `skills/team-orchestration/SKILL.md`:
  - rule 3: briefs are files in `scratchpad/current/`;
  - rule 12: the audit file is `scratchpad/current/orchestration-decisions.md`;
  - new rule 18: the run's files live only in `scratchpad/current/`; never
    read, list or search `scratchpad/.archive/` unless the human asks for an
    old run;
  - new rule 19: create a worktree only with `team-slice` (which uses the
    repo's own tooling); never run `git worktree add` yourself, and never put
    a worktree inside `scratchpad/`.
- The three role skills: every "scratchpad" scope becomes
  `scratchpad/current/` (the investigator's Write scope, the tester's, and the
  shared "never read outside your worktree" rule), plus the "never read
  `.archive/`" rule.
- README (task-scope files section, overlay table: `worktree_cmd` and
  `worktree_dir` are now required for `team-slice`), `references/lessons.md`
  (worktree lines), and a SPEC increment.

## Testing

ATDD against real files and `tests/fake-herdr`, no mocks.

`team-init`:

1. With a finished run in `current/` (config ticket `OLD-1`, no live agents),
   init moves it to `.archive/OLD-1-<today>/` and creates an empty
   `current/.team/` with the new config.
2. When `.archive/OLD-1-<today>/` exists, the archive is `OLD-1-<today>-2`.
3. `current/` without a config archives as `run-<today>`.
4. Loose files and dirs in `scratchpad/` move to `.archive/loose-<today>/`;
   `current/` and `.archive/` stay.
5. A loose dir that holds a `.git` (file or dir, at any depth) stays in place,
   and stderr carries the `worktree inside scratchpad` warning.
6. With a live agent of the old team, init exits 1, names the agent, and
   nothing moves.
7. With `TEAM_SCRATCH` set to a dir whose parent is not named `scratchpad`,
   init archives into that parent's `.archive/` and sweeps nothing.

Default path:

8. Each script writes under `scratchpad/current/` when `TEAM_SCRATCH` is
   unset (the existing tests move from `scratchpad` to `scratchpad/current`;
   add one test with `TEAM_SCRATCH` unset for each script that writes files:
   `team-init`, `team-brief`, `team-status`, `team-watch`).
9. The Stop hook with `TEAM_SCRATCH` unset writes the report to
   `<cwd>/scratchpad/current/reports/`.

Worktrees and panes:

10. `team-brief send` for an agent in another cwd mirrors into
    `<cwd>/scratchpad/current/` and names `scratchpad/current/<brief>`.
11. `team-slice` without an overlay exits 2 with the message and makes no git
    or herdr call; with `worktree_cmd` and `worktree_dir` set it runs that
    command and copies `--copy` dirs into `<wt>/scratchpad/current/`.
12. `team-overview --spawn` and `team-watch --spawn` pass an absolute
    `TEAM_SCRATCH` to `pane run`.

## Verify (manual, real herdr)

1. A branch repo with an old flat scratchpad: `/team:init X-1` archives the
   loose files, the run lives in `scratchpad/current/`, and the overview shows
   the new plan.
2. Finish that run, then `/team:init X-2`: `X-1` moves to
   `.archive/X-1-<date>/`.
3. A worktree repo with an overlay `worktree_cmd`: `team-slice` uses the
   repo's tooling; without an overlay it refuses.

## Out of scope

- Removing old worktrees (they need `git worktree remove`, their own
  lifecycle).
- Pruning `.archive/`.
- The general, non-team convention (a separate spec).
