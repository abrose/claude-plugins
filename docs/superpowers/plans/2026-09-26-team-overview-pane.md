# Team Overview Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pane right of the orchestrator that shows the orchestrator's plan (DONE / RUNNING / NEXT) and a live AGENTS list.

**Architecture:** The orchestrator edits a markdown checklist `scratchpad/progress-<ticket>.md`. A new script `bin/team-overview` renders that file plus live agent rows (from `herdr agent list` and `.team/*.json`, via `teamlib`) into one frame. It redraws only on change. The pure rendering lives in a new `lib/overview.py`. `/team:init` spawns the overview before the watcher, so the overview spans the full tab height.

**Tech Stack:** bash + python3 stdlib (same as every `bin/` script), stdlib `unittest`, `tests/fake-herdr`.

**Spec:** `docs/superpowers/specs/2026-09-25-team-overview-pane-design.md`

## Global Constraints

- Plan file: `${TEAM_SCRATCH:-scratchpad}/progress-<ticket>.md`; ticket from `.team/config.json` key `ticket`.
- Item markers: `[x]` done, `[>]` running, `[ ]` next. Human actions start with `you:`.
- Split: `herdr pane split --pane <orchestrator pane> --direction right --ratio 0.72 --cwd "$PWD" --no-focus`.
- Default refresh interval: 5 s.
- `/team:init` order: decisions file, plan file, `team-init`, `team-overview --spawn`, `team-watch --spawn`, `team-status`.
- Report age format is the one `team-status` uses: `Nm` / `Nh` / `Nd`, `-` when there is no report.
- No mocks. Tests run scripts as subprocesses against `tests/fake-herdr`.
- Test output must be pristine: assert `stderr == ""` where a script should be silent.
- Never use the em dash in any file. Never stage or commit: Chebu reviews and commits.
- Run the suite with `python3 -m unittest discover -s plugins/team/tests` from the repo root.

## Review Focus

1. The orchestrator writes the checklist in its own style (`* ` bullets, `[X]`, `## Done`, prose notes between items). The pane should still show the items and drop the prose. Test: Task 1, `test_lenient_markdown_still_renders`.
2. A plan file that lacks a section or a title. The pane should show empty headings and no stray `=` line. Test: Task 1, `test_lenient_markdown_still_renders` and `test_plan_without_title_has_no_underline`.
3. Agents from another team, a nameless pane, and the orchestrator itself in `herdr agent list`. None of them may appear in AGENTS. Test: Task 1, `test_renders_plan_and_live_agents` (exact-frame equality over the `overview` scenario that contains all three).
4. A pane so short that even RUNNING + NEXT + AGENTS do not fit. DONE shows its heading only, and nothing crashes. Test: Task 1, `test_tiny_pane_keeps_only_the_done_heading`.
5. The loop redraws when nothing changed, so the pane flickers every 5 s. Test: Task 2, `test_loop_redraws_only_when_the_frame_changes`.

## File Structure

- Create `plugins/team/lib/overview.py`: pure rendering (parse the plan, build AGENTS lines, fit height and width). No I/O.
- Create `plugins/team/bin/team-overview`: argument parsing, `--spawn`, and the I/O loop (config, plan file, herdr).
- Modify `plugins/team/lib/teamlib.py`: add `report_age` (moved from `team-status`).
- Modify `plugins/team/bin/team-status`: use `teamlib.report_age`.
- Modify `plugins/team/tests/fake-herdr`: `agent list` scenarios `overview` and `list_fails`.
- Modify `plugins/team/tests/test_team.py`: new class `TeamOverview`.
- Create `plugins/team/skills/team-orchestration/templates/progress.md`.
- Modify `plugins/team/commands/init.md`, `plugins/team/skills/team-orchestration/SKILL.md`, `plugins/team/README.md`, `plugins/team/SPEC.md`.

---

### Task 1: `team-overview --once` renders one frame

**Files:**
- Create: `plugins/team/lib/overview.py`
- Create: `plugins/team/bin/team-overview` (chmod +x)
- Modify: `plugins/team/lib/teamlib.py` (add `report_age`)
- Modify: `plugins/team/bin/team-status:31-40,54` (use `report_age` from `teamlib`)
- Modify: `plugins/team/tests/fake-herdr` (`agent list` case)
- Test: `plugins/team/tests/test_team.py` (new class `TeamOverview`, after class `TeamStatus`)

**Interfaces:**
- Produces: `teamlib.report_age(scratch: str, name: str, topic: str, now: int) -> tuple[str, bool]`. It returns the age string and `stale` (True when there is no report or the report is older than the brief).
- Produces: `overview.frame(plan: str | None, plan_path: str, agents: list[tuple[str, str, str, str]] | None, width: int, height: int) -> str`. An `agents` row is `(label, pane_id, state, report_age)`. `None` means herdr failed.
- Produces: `bin/team-overview` with `--once` and `--interval <s>`. Task 2 adds `--spawn` and the loop.

- [ ] **Step 1: Add the fake-herdr scenarios**

In `plugins/team/tests/fake-herdr`, inside the `"agent list")` case, add these two branches before the `*)` default:

```bash
      overview)
        emit '{"result":{"agents":[
          {"name":"app-1-orch","pane_id":"w2:p1","agent_status":"working","agent_session":{"value":"oooo0000dddd"}},
          {"name":"app-1-impl","pane_id":"w2:p3","agent_status":"working","agent_session":{"value":"33333333aaaa"}},
          {"name":"app-1-rev","pane_id":"w2:p4","agent_status":"idle","agent_session":{"value":"44444444bbbb"}},
          {"name":"app-2-maker","pane_id":"w3:p2","agent_status":"working","agent_session":{"value":"55555555cccc"}},
          {"pane_id":"w2:pB","agent_status":"idle","agent_session":{"value":"c23a1be5eeee"}}
        ]}}' ;;
      list_fails)
        fail '{"error":{"code":"server_unavailable"}}' ;;
```

- [ ] **Step 2: Write the failing acceptance tests**

In `plugins/team/tests/test_team.py`, add `import signal` to the imports (alphabetical, after `import shutil`). Then add this class after class `TeamStatus`:

```python
class TeamOverview(Base):
    NOW = 1800000000
    PLAN = ("# APP-1 round 2\n\n"
            "## DONE\n- [x] design (inv)\n\n"
            "## RUNNING\n- [>] fix round 2 (impl)\n\n"
            "## NEXT\n- [ ] review round 2 (rev)\n- [ ] you: manual test\n")
    AGENTS = ["AGENTS", " impl  w2:p3  working  2m", " rev   w2:p4  idle     -"]

    def cfg(self):
        d = os.path.join(self.proj, "scratchpad", ".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "config.json"),
                   json.dumps({"team_id": "app-1", "ticket": "APP-1", "orchestrator": "app-1-orch"}))

    def plan(self, text):
        write_text(os.path.join(self.proj, "scratchpad", "progress-APP-1.md"), text)

    def team(self):
        # impl reported 2 minutes ago; rev has no report.
        self.cfg()
        self.write_record("app-1-impl", "implementer", topic="fix")
        self.write_record("app-1-rev", "tester", topic="review")
        reports = os.path.join(self.proj, "scratchpad", "reports")
        os.makedirs(reports)
        report = os.path.join(reports, "app-1-impl-fix.md")
        write_text(report, "done")
        os.utime(report, (self.NOW - 120, self.NOW - 120))

    def overview(self, columns=40, lines=40, scenario="overview"):
        return self.run_script("team-overview", "--once", scenario=scenario,
                               env_extra={"COLUMNS": str(columns), "LINES": str(lines),
                                          "TEAM_NOW": str(self.NOW)})

    def test_renders_plan_and_live_agents(self):
        # The orchestrator, another team's agent and a nameless pane are in the
        # herdr list; only this team's role agents appear, without the team id.
        self.team()
        self.plan(self.PLAN)
        p = self.overview()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stderr, "")
        self.assertEqual(p.stdout.splitlines(), [
            "APP-1 round 2", "=============",
            "DONE", " [x] design (inv)",
            "RUNNING", " [>] fix round 2 (impl)",
            "NEXT", " [ ] review round 2 (rev)", " [ ] you: manual test",
        ] + self.AGENTS)

    def test_without_plan_file_says_where_it_goes_and_still_lists_agents(self):
        self.team()
        p = self.overview()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.splitlines(),
                         ["no plan yet: scratchpad/progress-APP-1.md"] + self.AGENTS)

    def test_without_team_config_asks_for_init(self):
        p = self.overview()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.splitlines(), ["no team: run /team:init"])

    def test_herdr_failure_keeps_the_plan(self):
        self.team()
        self.plan(self.PLAN)
        p = self.overview(scenario="list_fails")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stderr, "")
        lines = p.stdout.splitlines()
        self.assertEqual(lines[0], "APP-1 round 2")
        self.assertEqual(lines[-2:], ["AGENTS", " herdr unavailable"])

    def test_no_role_agents_yet(self):
        self.cfg()
        self.plan(self.PLAN)
        p = self.overview()
        self.assertEqual(p.stdout.splitlines()[-2:], ["AGENTS", " (none)"])

    def six_done(self):
        return self.PLAN.replace("- [x] design (inv)\n",
                                 "".join("- [x] d%d\n" % i for i in range(1, 7)))

    def test_short_pane_keeps_the_newest_done_items(self):
        # Fixed part: title 2 + DONE heading 1 + RUNNING 2 + NEXT 3 + AGENTS 3 = 11.
        self.team()
        self.plan(self.six_done())
        p = self.overview(lines=13)
        self.assertEqual(p.stdout.splitlines()[:7], [
            "APP-1 round 2", "=============",
            "DONE (+4 earlier)", " [x] d5", " [x] d6",
            "RUNNING", " [>] fix round 2 (impl)",
        ])

    def test_tiny_pane_keeps_only_the_done_heading(self):
        self.team()
        self.plan(self.six_done())
        p = self.overview(lines=5)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.splitlines(), [
            "APP-1 round 2", "=============", "DONE (+6 earlier)",
            "RUNNING", " [>] fix round 2 (impl)",
            "NEXT", " [ ] review round 2 (rev)", " [ ] you: manual test",
        ] + self.AGENTS)

    def test_narrow_pane_cuts_long_lines(self):
        self.team()
        self.plan(self.PLAN)
        p = self.overview(columns=20)
        lines = p.stdout.splitlines()
        self.assertIn(" [>] fix round 2 (i…", lines)
        self.assertIn(" impl  w2:p3  worki…", lines)
        self.assertTrue(all(len(l) <= 20 for l in lines), lines)

    def test_lenient_markdown_still_renders(self):
        self.cfg()
        self.plan("#  APP-1\n## Done\n* [X] design\nnotes here\n## next\n- [ ] ship\n")
        p = self.overview()
        self.assertEqual(p.stdout.splitlines(), [
            "APP-1", "=====", "DONE", " [X] design", "RUNNING", "NEXT", " [ ] ship",
            "AGENTS", " (none)",
        ])

    def test_plan_without_title_has_no_underline(self):
        self.cfg()
        self.plan("## NEXT\n- [ ] ship\n")
        p = self.overview()
        self.assertEqual(p.stdout.splitlines(), [
            "DONE", "RUNNING", "NEXT", " [ ] ship", "AGENTS", " (none)",
        ])
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `python3 -m unittest discover -s plugins/team/tests -k TeamOverview`
Expected: FAIL. `bin/team-overview` does not exist, so every test errors with `FileNotFoundError`.

- [ ] **Step 4: Move `report_age` into `teamlib`**

In `plugins/team/lib/teamlib.py`, add after `fresh_report`:

```python
def report_age(scratch, name, topic, now):
    """The agent's report age as 5m / 3h / 2d, "-" without a report, and
    whether the report is missing or older than the agent's brief."""
    report = os.path.join(scratch, "reports", "%s-%s.md" % (name, topic))
    brief = os.path.join(scratch, "brief-%s-%s.md" % (name, topic))
    if not os.path.exists(report):
        return "-", True
    r_mtime = os.path.getmtime(report)
    s = int(now - r_mtime)
    age = "%dm" % (s // 60) if s < 3600 else "%dh" % (s // 3600) if s < 86400 else "%dd" % (s // 86400)
    stale = os.path.exists(brief) and r_mtime < os.path.getmtime(brief)
    return age, stale
```

In `plugins/team/bin/team-status`:
- Change the import line to `from teamlib import agent_state, records, report_age, team_agents`.
- Delete the local `def report_age(name, topic):` function (lines 31-40).
- Change the call to `age, stale = report_age(scratch, name, topic, now)`.

Run: `python3 -m unittest discover -s plugins/team/tests -k TeamStatus`
Expected: PASS (4 tests). The move changes no behavior.

- [ ] **Step 5: Write `lib/overview.py`**

```python
"""Render the overview pane: the orchestrator's plan file plus live agents.
Pure text in, text out; team-overview does the I/O."""
import re

SECTIONS = ("DONE", "RUNNING", "NEXT")
ITEM = re.compile(r"^\s*[-*]\s+(\[[xX> ]\].*?)\s*$")


def parse_plan(text):
    """The title and the item lines per section of a plan file. Headings match
    in any case; lines that are not items are dropped."""
    title, items, section = "", {s: [] for s in SECTIONS}, None
    for line in text.splitlines():
        if line.startswith("# ") and not title:
            title = line[2:].strip()
        elif line.startswith("## "):
            section = line[3:].strip().upper()
        else:
            m = ITEM.match(line)
            if m and section in items:
                items[section].append(" " + m.group(1))
    return title, items


def agent_lines(agents):
    if agents is None:
        return ["AGENTS", " herdr unavailable"]
    if not agents:
        return ["AGENTS", " (none)"]
    widths = [max(len(row[i]) for row in agents) for i in range(3)]
    return ["AGENTS"] + [" " + "  ".join([c.ljust(w) for c, w in zip(row, widths)] + [row[3]])
                         for row in agents]


def cut(line, width):
    return line if len(line) <= width else line[:width - 1] + "…"


def frame(plan, plan_path, agents, width, height):
    """The pane text. When it is taller than `height`, DONE gives up its oldest
    items first; nothing else is dropped. Every line is cut to `width`."""
    tail = agent_lines(agents)
    if plan is None:
        lines = ["no plan yet: %s" % plan_path] + tail
    else:
        title, items = parse_plan(plan)
        head = [title, "=" * len(title)] if title else []
        middle = ["RUNNING"] + items["RUNNING"] + ["NEXT"] + items["NEXT"]
        done = items["DONE"]
        room = max(height - len(head) - 1 - len(middle) - len(tail), 0)
        shown = done[len(done) - room:] if room < len(done) else done
        heading = "DONE" if len(shown) == len(done) else "DONE (+%d earlier)" % (len(done) - len(shown))
        lines = head + [heading] + shown + middle + tail
    return "\n".join(cut(l, width) for l in lines)
```

- [ ] **Step 6: Write `bin/team-overview` (once mode)**

Create `plugins/team/bin/team-overview` and run `chmod +x plugins/team/bin/team-overview`:

```bash
#!/usr/bin/env bash
# Show the run's overview: the orchestrator's plan file (DONE, RUNNING, NEXT)
# and a live AGENTS list. --once renders one frame (for tests); default loops.
set -euo pipefail

scratch="${TEAM_SCRATCH:-scratchpad}"
interval=5; once=""
lib="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)"
while [ $# -gt 0 ]; do
  case "$1" in
    --once) once=1; shift ;;
    --interval) interval="${2:?}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

PYTHONPATH="$lib" SCRATCH="$scratch" ONCE="$once" INTERVAL="$interval" python3 - <<'PY'
import json, os, shutil, subprocess, sys, time
from overview import frame
from teamlib import agent_state, records, report_age, role_agents

scratch = os.environ["SCRATCH"]
teamdir = os.path.join(scratch, ".team")

def config():
    try:
        with open(os.path.join(teamdir, "config.json")) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None

def agent_rows(team_id):
    listed = subprocess.run(["herdr", "agent", "list"], capture_output=True, text=True)
    if listed.returncode != 0:
        return None
    try:
        agents = json.loads(listed.stdout).get("result", {}).get("agents", [])
    except ValueError:
        return None
    now = int(os.environ.get("TEAM_NOW", int(time.time())))
    recs = records(teamdir)
    prefix = team_id + "-"
    rows = []
    for a in role_agents(agents, teamdir):
        name = a["name"]
        label = name[len(prefix):] if name.startswith(prefix) else name
        age, _ = report_age(scratch, name, recs[name].get("topic", ""), now)
        rows.append((label, a.get("pane_id", ""), agent_state(a), age))
    return rows

def render():
    cfg = config()
    if cfg is None:
        return "no team: run /team:init"
    path = os.path.join(scratch, "progress-%s.md" % cfg.get("ticket", ""))
    try:
        with open(path) as fh:
            plan = fh.read()
    except OSError:
        plan = None
    size = shutil.get_terminal_size()
    return frame(plan, path, agent_rows(cfg.get("team_id", "")), size.columns, size.lines)

print(render())
PY
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `python3 -m unittest discover -s plugins/team/tests -k TeamOverview`
Expected: PASS (10 tests), no other output.

Run: `python3 -m unittest discover -s plugins/team/tests`
Expected: all tests PASS (the suite had 124 before this task; now 134). The output must be pristine.

- [ ] **Step 8: Stop for review**

Do not stage or commit. Chebu reviews and commits.

---

### Task 2: `--spawn` and the redraw loop

**Files:**
- Modify: `plugins/team/bin/team-overview`
- Test: `plugins/team/tests/test_team.py` (class `TeamOverview`)

**Interfaces:**
- Consumes: `bin/team-overview --once` and `render()` from Task 1.
- Produces: `team-overview --spawn`. It prints the new pane id on stdout and exits 0. It exits 4 on a herdr error. Default mode (no `--once`) loops and redraws only on change.

- [ ] **Step 1: Write the failing tests**

Add to class `TeamOverview`:

```python
    def test_spawn_splits_right_of_the_orchestrator_and_runs_the_loop_there(self):
        self.cfg()
        p = self.run_script("team-overview", "--spawn")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.strip(), "w1:p9")
        calls = self.herdr_calls()
        split = [c for c in calls if c.startswith("pane split")]
        self.assertEqual(len(split), 1, calls)
        self.assertIn("--pane w1:p1 --direction right --ratio 0.72", split[0])
        self.assertTrue(split[0].endswith("--no-focus"), split)
        self.assertTrue(any(c.startswith("pane run w1:p9 ")
                            and c.endswith("/bin/team-overview --interval 5") for c in calls), calls)
        # --spawn only launches; it renders nothing itself.
        self.assertFalse(any(c.startswith("agent list") for c in calls), calls)

    def test_loop_redraws_only_when_the_frame_changes(self):
        self.team()
        self.plan(self.PLAN)
        env = self.env(scenario="overview", COLUMNS="40", LINES="40", TEAM_NOW=str(self.NOW))
        loop = subprocess.Popen([os.path.join(BIN, "team-overview"), "--interval", "0.1"],
                                cwd=self.proj, env=env, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, start_new_session=True)
        time.sleep(0.6)
        self.plan(self.PLAN + "- [ ] ship\n")
        time.sleep(0.6)
        os.killpg(loop.pid, signal.SIGTERM)
        out, err = loop.communicate(timeout=5)
        self.assertEqual(out.count("\x1b[2J"), 2, out)
        self.assertIn(" [ ] ship", out)
        self.assertEqual(err, "")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m unittest discover -s plugins/team/tests -k TeamOverview`
Expected: 2 FAIL. `--spawn` exits 2 with `unknown argument: --spawn`. The loop test sees 0 clears, because the script prints one frame and exits.

- [ ] **Step 3: Add `--spawn`**

In `plugins/team/bin/team-overview`:

Change the header comment to:

```bash
# Show the run's overview: the orchestrator's plan file (DONE, RUNNING, NEXT)
# and a live AGENTS list. --spawn launches it in a pane right of the
# orchestrator; --once renders one frame (for tests); default loops and
# redraws only when the frame changes.
```

Change the variables line to `interval=5; once=""; spawn=""`, and add `--spawn) spawn=1; shift ;;` to the `case`.

After the argument loop, add:

```bash
pane_id_of() { python3 -c "import sys,json;print(json.load(sys.stdin)['result']['pane']['pane_id'])"; }

# Split right of the orchestrator pane (the focused one). /team:init runs this
# before the watcher splits that pane down, so the overview spans the full tab
# height. --ratio is the fraction the orchestrator keeps.
spawn_overview() {
  local anchor new self
  anchor="$(herdr pane current | pane_id_of)" || { echo "cannot resolve orchestrator pane" >&2; exit 4; }
  new="$(herdr pane split --pane "$anchor" --direction right --ratio 0.72 --cwd "$PWD" --no-focus | pane_id_of)" || exit 4
  self="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  herdr pane run "$new" "$self" --interval "$interval" >/dev/null || exit 4
  echo "$new"
}

if [ -n "$spawn" ]; then spawn_overview; exit 0; fi
```

- [ ] **Step 4: Add the loop**

In the python heredoc, replace the final `print(render())` with:

```python
if os.environ["ONCE"]:
    print(render())
    sys.exit(0)

shown = None
while True:
    out = render()
    if out != shown:
        sys.stdout.write("\x1b[H\x1b[2J" + out)
        sys.stdout.flush()
        shown = out
    time.sleep(float(os.environ["INTERVAL"]))
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python3 -m unittest discover -s plugins/team/tests -k TeamOverview`
Expected: PASS (12 tests).

Run the class 5 times to check for flakiness in the timing test:
`for i in 1 2 3 4 5; do python3 -m unittest discover -s plugins/team/tests -k TeamOverview 2>&1 | tail -1; done`
Expected: `OK` five times.

Run: `python3 -m unittest discover -s plugins/team/tests`
Expected: all PASS (136), pristine output.

- [ ] **Step 6: Stop for review**

Do not stage or commit.

---

### Task 3: Wire it into the protocol and docs

**Files:**
- Create: `plugins/team/skills/team-orchestration/templates/progress.md`
- Modify: `plugins/team/commands/init.md`
- Modify: `plugins/team/skills/team-orchestration/SKILL.md` (rules 14-15, new rule 17, Tools list)
- Modify: `plugins/team/README.md` (scripts table)
- Modify: `plugins/team/SPEC.md` (new increment at the end)

**Interfaces:**
- Consumes: `team-overview --spawn` from Task 2.

- [ ] **Step 1: Create the template**

`plugins/team/skills/team-orchestration/templates/progress.md`:

```markdown
# {{ticket}}

## DONE

## RUNNING

## NEXT
```

- [ ] **Step 2: Update `commands/init.md`**

Change the frontmatter description to:
`Start a team run for a ticket - create the tab, the numbered decisions file, the plan file, the overview, and the first roster.`

Replace steps 2-5 with:

```markdown
2. Write the decisions file from
   `${CLAUDE_PLUGIN_ROOT}/skills/team-orchestration/templates/decisions.md`
   into `${TEAM_SCRATCH:-scratchpad}/decisions-<ticket>.md`. Refuse to overwrite.
3. Write the plan file from
   `${CLAUDE_PLUGIN_ROOT}/skills/team-orchestration/templates/progress.md`
   into `${TEAM_SCRATCH:-scratchpad}/progress-<ticket>.md`. Refuse to overwrite.
4. Run `team-init <ticket> --orchestrator-pane <this pane id>`. It writes the
   team id, the config, the safe permission baseline, records this tab, and
   renames this pane's agent to `<team_id>-orch`.
5. Start the overview: `team-overview --spawn`. It splits a pane right of this
   pane and shows the plan file and the live agents there. Run it before the
   watcher, so the overview spans the full tab height.
6. Start the watcher: `team-watch --spawn`. It splits one small pane off this
   pane, runs the watcher there by absolute path, and passes that pane's id as
   `--own-pane`, so the watcher never misreads its own pane. This tab now holds
   exactly three panes: you, the overview, and the watcher.
7. Run `team-status` to write the first roster.

Report the team id, the decisions file path, the plan file path, and the
roster to the human.
```

(Delete the old last line `Report the team id, the decisions file path, and the roster to the human.`)

- [ ] **Step 3: Update `SKILL.md`**

Rule 15: change `the orchestrator tab holds at most 2 panes (you and the watcher)` to `the orchestrator tab holds at most 3 panes (you, the overview, and the watcher)`.

Append rule 17 after rule 16:

```markdown
17. Keep the plan file `progress-<ticket>.md` current; the overview pane shows
    it to the human. Orchestrator-level steps only, never a worker's
    sub-steps. Markers: `- [x]` done, `- [>]` running, `- [ ]` next; name the
    role in parentheses, `fix round 2 (impl)`. Update it after every REPORT,
    before every `team-brief send`, and whenever you ask the human to act (a
    `- [ ] you: <action>` item, moved to DONE when the human confirms).
```

Tools paragraph: change `` `team-slice`, `team-watch`, `` to `` `team-slice`, `team-watch`, `team-overview`, ``.

- [ ] **Step 4: Update `README.md`**

Read the scripts table in `plugins/team/README.md`. Add a row after the `team-watch` row, in the same column format as its neighbors:

`team-overview [--spawn]` | Shows the plan file (`progress-<ticket>.md`: DONE, RUNNING, NEXT) and the live agents in a pane right of the orchestrator; redraws when either changes.

- [ ] **Step 5: Add the SPEC increment**

Append to `plugins/team/SPEC.md`:

```markdown
## Increment 2026-09-26

Design: `docs/superpowers/specs/2026-09-25-team-overview-pane-design.md`.
Adds an overview pane right of the orchestrator that shows run progress at
the orchestrator level.

The orchestrator keeps a plan file, `progress-<ticket>.md` next to the
decisions file, as a markdown checklist under DONE, RUNNING and NEXT
(`[x]`, `[>]`, `[ ]`; human actions start with `you:`). `/team:init` creates
it from `templates/progress.md`, and SKILL.md rule 17 says when to update it.
Workers never write it.

New script `team-overview` renders the plan file plus a live AGENTS list
(label, pane, herdr state, report age) built from `herdr agent list` and the
`.team` records. Rendering is `lib/overview.py`, pure text; when the frame is
taller than the pane, DONE gives up its oldest items first. The loop redraws
only when the frame changes. `--spawn` splits right of the orchestrator pane
(`--ratio 0.72`); `/team:init` runs it before `team-watch --spawn`, so the
overview spans the full tab height and the orchestrator tab holds three
panes. `report_age` moved from `team-status` into `teamlib` so both scripts
share it.
```

- [ ] **Step 6: Check the docs**

Run: `grep -rn "exactly two panes\|at most 2 panes" plugins/team`
Expected: no output.

Run: `grep -rn $'\xe2\x80\x94' plugins/team docs/superpowers/specs/2026-09-25-team-overview-pane-design.md docs/superpowers/plans/2026-09-26-team-overview-pane.md`
Expected: no output (no em dashes).

Run: `python3 -m unittest discover -s plugins/team/tests`
Expected: all PASS (136), pristine output.

- [ ] **Step 7: Stop for review**

Do not stage or commit. A version bump (`plugins/team/.claude-plugin/plugin.json` 0.2.8 -> 0.2.9) happens only when Chebu asks for the commit.

---

### Task 4: Manual verification in real herdr (with Chebu)

No automated E2E is possible here: the layout and the live redraw need a real herdr session. Ask Chebu to run these steps while you read the panes with `herdr agent read` / `herdr pane layout`.

- [ ] **Step 1:** Chebu updates the plugin to the working copy and runs `/team:init TEST-1` in a fresh tab. Expected: the overview is on the right at full tab height, the watcher strip is below the orchestrator only, and the overview shows `TEST-1`, `=====`-underlined, with empty DONE/RUNNING/NEXT and `AGENTS (none)`.
- [ ] **Step 2:** Edit `scratchpad/progress-TEST-1.md` (add `- [>] probe (inv)` under RUNNING). Expected: the pane updates within 5 s, and it does not flicker in the next 15 s while nothing changes.
- [ ] **Step 3:** Start one agent with `team-start probe investigator --new-tab`. Expected: `probe` appears under AGENTS within 5 s with its pane id and state.
- [ ] **Step 4:** Release the test team, and remove `scratchpad/progress-TEST-1.md` and `scratchpad/decisions-TEST-1.md` only after Chebu confirms.
