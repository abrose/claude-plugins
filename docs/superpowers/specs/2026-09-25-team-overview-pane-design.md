# Design: team plugin - overview pane

Date: 2026-09-25
Status: agreed in brainstorm, pending spec review
Relates to: `plugins/team/SPEC.md`. This is an increment on that spec.

## Problem

During a run the human loses track of where the run stands at the
orchestrator level: what is done, what runs now, what comes next, and what the
human must do. On the BUG-3127 run the orchestrator kept a hand-written status
file and a `while true; clear; cat ...; sleep 5` loop in a pane right of the
orchestrator showed it. That worked, but it is improvised on every run and the
agent lines in it went stale between edits.

## Decisions (this brainstorm)

1. The overview shows **orchestrator-level progress only**. Worker
   sub-progress is out of scope. Workers write nothing new.
2. The pane has two parts:
   - a **plan part** (DONE / RUNNING / NEXT), written only by the
     orchestrator;
   - an **AGENTS part**, generated live by the plugin from `herdr agent list`
     and `.team/*.json`. Nobody writes it.
3. The plan part lives in `${TEAM_SCRATCH:-scratchpad}/progress-<ticket>.md`,
   next to the decisions file, as a plain markdown checklist. The orchestrator
   edits it with the Edit tool. There is no CLI for plan items.
4. The overview runs in **its own pane, right of the orchestrator**, full tab
   height. The watcher strip stays below the orchestrator as before.
5. `/team:init` starts the overview automatically, before the watcher.

## Plan file format

Created by `/team:init` from `skills/team-orchestration/templates/progress.md`:

```markdown
# {{ticket}}

## DONE

## RUNNING

## NEXT
```

Items are list lines with a marker:

- `- [x] <text>` done
- `- [>] <text>` running
- `- [ ] <text>` next

Convention: name the role in parentheses, `fix round 2 (impl)`. An action for
the human starts with `you:`, `- [ ] you: manual test on staging`. The
orchestrator may change the title line, for example to add the round
(`# BUG-3127 round 2`).

## Protocol rule

New rule in `skills/team-orchestration/SKILL.md`: the orchestrator updates the
plan file

- after every REPORT (move the item to DONE, add follow-ups to NEXT);
- before every `team-brief send` (move the item to RUNNING);
- every time it asks the human to act (add a `you:` item to NEXT; move it to
  DONE when the human confirms).

## `bin/team-overview`

One job: render the pane. Same shape as `team-watch`.

```
team-overview [--once] [--interval <s>]
team-overview --spawn
```

- `--spawn` splits a pane off the orchestrator pane with
  `herdr pane split --pane <orchestrator pane> --direction right --ratio 0.72
  --cwd "$PWD" --no-focus`, then runs `team-overview --interval <s>` there by
  absolute path with `herdr pane run`. It prints the new pane id and exits.
  There is no `--own-pane`: unlike the watcher, the overview closes no panes,
  so it never needs to know its own.
  The orchestrator pane is resolved the same way `team-watch --spawn` resolves
  its anchor.
- `--once` renders one frame to stdout and exits. Tests use it.
- The loop renders every `--interval` seconds (default 5). It clears the
  screen and prints only when the frame differs from the previous one, so the
  pane does not flicker.
- It reads the ticket from `.team/config.json`. Without a config it prints
  `no team: run /team:init` and, in loop mode, keeps polling.

### Frame

```
BUG-3127 round 2
================
DONE (+4 earlier)
 [x] fix round 1 (impl)
 [x] review round 1 (rev)
RUNNING
 [>] fix round 2 (impl)
NEXT
 [ ] review round 2 (rev)
 [ ] you: manual test
AGENTS
 impl  p8V  working  2m
 rev   p92  idle     -
```

- **Title**: the plan file's `#` line, underlined with `=` to its length.
- **Sections**: DONE, RUNNING, NEXT in that order, from the plan file's `##`
  sections. Item lines render as ` [x] text`, dropping the leading `- `. Lines
  that are not items are dropped. An empty section still shows its heading.
- **AGENTS**: one line per role agent from `teamlib.role_agents`, in
  `herdr agent list` order: the label (agent name without the `<team_id>-`
  prefix), the pane id, the herdr state (`teamlib.agent_state`), and the report
  age in the same format as `team-status` (`-` when there is no report). The
  orchestrator is not listed. With no role agents the section shows ` (none)`.
- **No plan file**: the plan part is replaced by
  `no plan yet: <scratch>/progress-<ticket>.md`. AGENTS still renders.
- **herdr error**: AGENTS shows ` herdr unavailable`. The plan part still
  renders. The loop keeps running.
- **Width**: lines longer than the pane width are cut, ending in `…`.
- **Height**: when the frame is taller than the pane, DONE keeps only its
  newest items (the last lines of the section) and its heading becomes
  `DONE (+N earlier)`. If that is not enough, DONE shows the heading only.
  Title, RUNNING, NEXT and AGENTS are never cut. Pane size comes from
  `shutil.get_terminal_size`, so tests set it with `COLUMNS` and `LINES`.

Report age moves from `team-status` into `teamlib` (`report_age`) so both
scripts share it.

## Layout

The overview must split **before** the watcher. A right split of the
orchestrator pane is as tall as that pane. If the watcher splits first, the
orchestrator is already shortened and the overview is too. With the overview
first, the result is:

```
+----------------------+---------+
|                      | overview|
|    orchestrator      |         |
|                      |         |
+----------------------+         |
| watcher strip        |         |
+----------------------+---------+
```

The overview is in the orchestrator tab, which the watcher's layout hygiene
never touches, so the watcher needs no change. The orchestrator tab now holds
three panes; `commands/init.md` step text that says "exactly two panes" is
updated.

## `/team:init` changes

1. Write the decisions file (unchanged).
2. Write the plan file from `templates/progress.md` into
   `${TEAM_SCRATCH:-scratchpad}/progress-<ticket>.md`. Refuse to overwrite.
3. `team-init` (unchanged).
4. `team-overview --spawn`.
5. `team-watch --spawn`.
6. `team-status` (unchanged).

Report the plan file path with the decisions file path.

## Testing

ATDD against `tests/fake-herdr` and real files, no mocks. Acceptance tests in
`tests/test_team.py`, class `TeamOverview`:

1. `--once` renders title, sections and items from a plan file, and AGENTS
   lines from fake-herdr's agent list plus `.team` records.
2. The orchestrator is not in AGENTS; the label drops the team id prefix.
3. Report age shows `-` without a report and an age with one.
4. No plan file: the `no plan yet` line, AGENTS still shown.
5. No `.team/config.json`: `no team: run /team:init`.
6. herdr fails: ` herdr unavailable`, plan still shown.
7. Short pane (`LINES`): DONE shrinks to newest items with `(+N earlier)`;
   RUNNING, NEXT, AGENTS intact.
8. Narrow pane (`COLUMNS`): long lines cut with `…`.
9. `--spawn` calls `pane split --direction right --ratio 0.72` on the
   orchestrator pane and `pane run <new id>` with the script's absolute path.
10. `team-status` output is unchanged after `report_age` moves to `teamlib`
    (existing tests).

The redraw-only-on-change loop is checked by hand in a real pane (see
Verify), since the loop never exits.

## Verify (manual, real herdr)

1. `/team:init TEST-1` in a fresh tab: the overview is on the right, full
   height; the watcher strip is below the orchestrator only.
2. Edit the plan file: the pane updates within 5s and does not flicker when
   nothing changes.
3. Start one agent: it appears in AGENTS within 5s with its state.

## Out of scope

- Worker sub-progress.
- A CLI for plan items.
- Colour.
- Restarting the overview pane after the human closes it (rerun
  `team-overview --spawn`).
