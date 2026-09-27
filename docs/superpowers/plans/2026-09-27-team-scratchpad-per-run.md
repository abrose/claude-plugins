# Team Scratchpad Per Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every team run lives in `scratchpad/current/`. `/team:init` archives the previous run and all loose scratchpad entries to `scratchpad/.archive/`, and `team-slice` stops choosing worktree locations itself.

**Architecture:** All scripts already locate their files through `TEAM_SCRATCH`, so the core change is its default: `scratchpad` becomes `scratchpad/current`. `team-init` gains an archive-and-sweep step before it writes the new config. Worktree mirroring targets `<wt>/scratchpad/current/`. `team-slice` refuses without an overlay. The spawned overview and watcher panes get an absolute `TEAM_SCRATCH`.

**Tech Stack:** bash + python3 stdlib (the pattern of every `bin/` script), stdlib `unittest`, `tests/fake-herdr` and `tests/fake-git`.

**Spec:** `docs/superpowers/specs/2026-09-27-team-scratchpad-per-run-design.md`

## Global Constraints

- New default: `TEAM_SCRATCH` unset means `scratchpad/current`. An explicitly set `TEAM_SCRATCH` is used as is.
- Scratch root = `dirname(TEAM_SCRATCH)` after normalising (no trailing slash). The archive lives at `<scratch root>/.archive/`.
- Run archive name: `<ticket>-<YYYY-MM-DD>`, or `run-<YYYY-MM-DD>` without a config ticket. On a clash, append `-2`, `-3`, and so on.
- Loose archive name: `loose-<YYYY-MM-DD>`, with the same clash rule.
- Only sweep when the basename of the scratch root is `scratchpad`.
- Never move anything that holds a `.git` (file or dir, at any depth). Warning text: `❗️ worktree inside scratchpad: <path> - move it out with git worktree move`.
- `team-slice` without `worktree_cmd`: exit 2 with `no worktree_cmd in .claude/team/project.yaml - ask the human how this repo makes worktrees`. Without `worktree_dir`: exit 2 with `no worktree_dir in .claude/team/project.yaml - ask the human how this repo makes worktrees`.
- Date override for tests: env `TEAM_TODAY` (ISO date). Otherwise use the local date.
- No mocks. Tests run scripts as subprocesses against the fakes. Test output must be pristine.
- Use Write/Edit for file changes and Bash only to run commands. Never use the em dash. Never stage or commit: Chebu reviews and commits.
- Suite: `python3 -m unittest discover -s plugins/team/tests`, run from the repo root. Baseline: 142 tests OK.

## Review Focus

1. An old-style explicit `TEAM_SCRATCH=scratchpad` (left in someone's env) would make init archive the whole scratchpad, including old `wt-*` worktrees. Expected: init refuses when the run dir holds a `.git`, and moves nothing. Test: Task 2, `test_refuses_to_archive_a_run_dir_holding_a_worktree`.
2. A ticket containing `/` (for example `team/ABC-1`) becomes the archive name. Expected: the `/` is replaced with `-`, and the archive stays inside `.archive/`. Test: Task 2, `test_ticket_with_slash_is_archived_under_a_flat_name`.
3. `TEAM_SCRATCH` given with a trailing slash (`scratchpad/current/`). Expected: the same behaviour as without the slash, never "archive the run dir into itself". Test: Task 2, `test_trailing_slash_in_team_scratch_is_normalised`.
4. A symlink in `scratchpad/` that points at a directory with a `.git` somewhere else. Expected: the link itself is moved, and init never walks into the target. Test: Task 2, `test_symlink_is_swept_without_following_it`.
5. The first init in a repo with no `scratchpad/` at all. Expected: `scratchpad/current/.team/config.json` is created, with no error and no archive. Test: Task 1, `test_init_with_default_path_creates_current` (existing init tests also cover it).

---

### Task 1: Default path `scratchpad/current`

**Files:**
- Modify: `plugins/team/tests/test_team.py` (the `Base` harness, every hard-coded run path, new default tests)
- Modify: `plugins/team/bin/team-init:9`, `bin/team-start:61,95,191,225`, `bin/team-brief:16`, `bin/team-watch:8`, `bin/team-status:7`, `bin/team-overview:8`
- Modify: `plugins/team/hooks/handlers/stop-report.sh:17,27,95`
- Modify: `plugins/team/commands/init.md:15,18`, `plugins/team/commands/release.md:21-22`

**Interfaces:**
- Produces: test module constant `SCRATCH = os.path.join("scratchpad", "current")`.
- Produces: `Base.sp(self, *parts) -> str`, which returns `os.path.join(self.proj, SCRATCH, *parts)`.
- Produces: `Base.env(...)` drops every key whose value is `None`. So `env_extra={"TEAM_SCRATCH": None}` runs a script with `TEAM_SCRATCH` unset.

- [ ] **Step 1: Move the harness to the run dir**

In `tests/test_team.py`, after `BIN = os.path.join(ROOT, "bin")` add:

```python
SCRATCH = os.path.join("scratchpad", "current")
```

In `Base.env`, change `e["TEAM_SCRATCH"] = "scratchpad"` to `e["TEAM_SCRATCH"] = SCRATCH`. After `e.update(extra)` add:

```python
        for k in [k for k, v in e.items() if v is None]:
            del e[k]
```

Add to `Base` (after `herdr_calls`):

```python
    def sp(self, *parts):
        return os.path.join(self.proj, SCRATCH, *parts)
```

Replace every `os.path.join(self.proj, "scratchpad", <rest>)` with `self.sp(<rest>)`, and `os.path.join(self.proj, "scratchpad")` with `self.sp()`. Keep these lines as they are, because later tasks rewrite them:
- `TeamBriefSend.test_mirrors_brief_and_decisions_into_worktree_scratch`: the lines that build paths under `wt` (the worktree side) and the `"Read scratchpad/brief-scout-digest.md "` assertion in that test.
- `TeamSlice`: all of it.

Update these string assertions to the new relative path:
- `test_no_mirroring_when_cwd_is_the_main_repo`: `"Read scratchpad/current/brief-scout-digest.md "`.
- `TeamOverview.test_without_plan_file_says_where_it_goes_and_still_lists_agents`: `"no plan yet: scratchpad/current/progress-APP-1.md"`.
- The Stop hook fallback test (around line 1193): `"scratchpad/current/reports/scout-digest.md"`.
- The two `brief="scratchpad/brief-app-1-scout-digest.md"` record values (around lines 1567, 1578): `brief="scratchpad/current/brief-app-1-scout-digest.md"`.

Run: `python3 -m unittest discover -s plugins/team/tests`
Expected: 142 tests OK. The scripts honour an explicit `TEAM_SCRATCH`, so moving the harness changes no behaviour. If a test fails, it still hard-codes the old path: fix the test, not a script.

- [ ] **Step 2: Write the failing default-path tests**

Add a new class after `TeamStatus`:

```python
class DefaultScratch(Base):
    """With TEAM_SCRATCH unset, every run file lives in scratchpad/current/."""
    UNSET = {"TEAM_SCRATCH": None}

    def cfg(self):
        d = self.sp(".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "config.json"),
                   json.dumps({"team_id": "app-1", "ticket": "APP-1", "orchestrator": "app-1-orch"}))

    def test_init_with_default_path_creates_current(self):
        p = self.run_script("team-init", "APP-1", env_extra=self.UNSET)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.sp(".team", "config.json")))

    def test_status_writes_roster_under_current(self):
        self.cfg()
        p = self.run_script("team-status", scenario="status_two_teams", env_extra=self.UNSET)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.sp(".team", "roster.md")))

    def test_watch_writes_state_under_current(self):
        self.cfg()
        p = self.run_script("team-watch", "--once", scenario="watch_idle", env_extra=self.UNSET)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.sp(".team", "watch-state.json")))

    def test_overview_reads_plan_under_current(self):
        self.cfg()
        write_text(self.sp("progress-APP-1.md"), "# APP-1\n")
        p = self.run_script("team-overview", "--once",
                            env_extra={**self.UNSET, "COLUMNS": "60", "LINES": "40"})
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.splitlines()[0], "APP-1")

    def test_stop_hook_writes_report_under_current(self):
        self.write_record("scout", "investigator", topic="digest")
        tr = os.path.join(self.proj, "t.jsonl")
        write_text(tr, json.dumps({"type": "assistant", "message": {"role": "assistant",
                   "content": [{"type": "text", "text": "REPORT scout digest: done"}]}}) + "\n")
        env = self.env(TEAM_NAME="scout", TEAM_SCRATCH=None)
        p = subprocess.run([os.path.join(ROOT, "hooks", "handlers", "stop-report.sh")],
                           input=json.dumps({"session_id": "s", "transcript_path": tr, "cwd": self.proj}),
                           capture_output=True, text=True, env=env, cwd=self.proj)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.sp("reports", "scout-digest.md")))
```

Before you write the hook test, read `StopHook.run_hook` in `test_team.py`. If it runs the handler differently (for example with a different path or with stdin handling), copy its exact invocation instead of the `subprocess.run` above.

- [ ] **Step 3: Run them to see them fail**

Run: `python3 -m unittest discover -s plugins/team/tests -k DefaultScratch`
Expected: 5 FAIL. The files land in `scratchpad/`, not `scratchpad/current/`.

- [ ] **Step 4: Change every default**

Replace `${TEAM_SCRATCH:-scratchpad}` with `${TEAM_SCRATCH:-scratchpad/current}` in these files:
- `bin/team-init`, `bin/team-start` (4 places), `bin/team-brief`, `bin/team-watch`, `bin/team-status`, `bin/team-overview`;
- `commands/init.md`, `commands/release.md`.

In `hooks/handlers/stop-report.sh`, replace the 3 occurrences of `os.environ.get("TEAM_SCRATCH", "scratchpad")` with `os.environ.get("TEAM_SCRATCH", "scratchpad/current")`.

Then grep to confirm that no default is left:

Run: `grep -rn 'TEAM_SCRATCH:-scratchpad}\|"TEAM_SCRATCH", "scratchpad")' plugins/team`
Expected: no output.

- [ ] **Step 5: Run the tests**

Run: `python3 -m unittest discover -s plugins/team/tests`
Expected: 147 tests OK (142 + 5), pristine output.

- [ ] **Step 6: Stop for review.** Do not stage or commit.

---

### Task 2: `team-init` archives the run and sweeps loose entries

**Files:**
- Modify: `plugins/team/bin/team-init:24-54`
- Test: `plugins/team/tests/test_team.py`, class `TeamInit` (replace the two `.team-APP-1` archive tests, add new ones)

**Interfaces:**
- Consumes: `Base.sp()`, `SCRATCH`, and the `None`-drops-key rule in `Base.env` (Task 1).
- Produces: after `team-init`, `<TEAM_SCRATCH>/.team/config.json` is fresh, and earlier content is under `<scratch root>/.archive/`.

- [ ] **Step 1: Write the failing tests**

In class `TeamInit`, delete `test_archives_finished_team_and_continues` and `test_archives_with_a_suffix_when_archive_name_taken`. Add:

```python
    TODAY = "2026-01-02"

    def init(self, ticket="APP-2", scenario="ok", **env):
        return self.run_script("team-init", ticket, scenario=scenario,
                               env_extra={"TEAM_TODAY": self.TODAY, **env})

    def old_run(self, ticket="APP-1"):
        d = self.sp(".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "config.json"),
                   json.dumps({"team_id": "app-1", "ticket": ticket, "orchestrator": "app-1-orch"}))
        write_text(self.sp("brief-scout-digest.md"), "old brief\n")

    def archive(self, *parts):
        return os.path.join(self.proj, "scratchpad", ".archive", *parts)

    def test_archives_the_finished_run_and_starts_fresh(self):
        self.old_run()
        p = self.init()
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(read_text(self.archive("APP-1-2026-01-02", "brief-scout-digest.md")), "old brief\n")
        self.assertEqual(sorted(os.listdir(self.sp())), [".team"])
        self.assertEqual(json.loads(read_text(self.sp(".team", "config.json")))["ticket"], "APP-2")

    def test_archive_name_gets_a_suffix_when_taken(self):
        self.old_run()
        os.makedirs(self.archive("APP-1-2026-01-02"))
        p = self.init()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.archive("APP-1-2026-01-02-2", "brief-scout-digest.md")))

    def test_run_without_config_archives_as_run(self):
        os.makedirs(self.sp())
        write_text(self.sp("notes.md"), "ad hoc\n")
        p = self.init()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.archive("run-2026-01-02", "notes.md")))

    def test_sweeps_loose_entries_out_of_sight(self):
        root = os.path.join(self.proj, "scratchpad")
        os.makedirs(os.path.join(root, "reports"))
        write_text(os.path.join(root, "decisions-OLD.md"), "old\n")
        write_text(os.path.join(root, "reports", "x.md"), "old\n")
        p = self.init()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(sorted(os.listdir(root)), [".archive", "current"])
        self.assertTrue(os.path.exists(self.archive("loose-2026-01-02", "decisions-OLD.md")))
        self.assertTrue(os.path.exists(self.archive("loose-2026-01-02", "reports", "x.md")))

    def test_never_moves_a_worktree_and_warns(self):
        wt = os.path.join(self.proj, "scratchpad", "wt-feat")
        os.makedirs(os.path.join(wt, "src"))
        write_text(os.path.join(wt, ".git"), "gitdir: /elsewhere\n")
        nested = os.path.join(self.proj, "scratchpad", "deep", "a")
        os.makedirs(os.path.join(nested, ".git"))
        p = self.init()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(os.path.join(wt, ".git")))
        self.assertTrue(os.path.exists(os.path.join(nested, ".git")))
        self.assertIn("❗️ worktree inside scratchpad: scratchpad/wt-feat - move it out with git worktree move", p.stderr)
        self.assertIn("❗️ worktree inside scratchpad: scratchpad/deep - move it out with git worktree move", p.stderr)

    def test_live_agents_block_init_and_nothing_moves(self):
        self.old_run()
        write_text(os.path.join(self.proj, "scratchpad", "loose.md"), "x\n")
        p = self.init(scenario="names_app1_taken")
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertIn("app-1-scout", p.stderr)
        self.assertTrue(os.path.exists(self.sp("brief-scout-digest.md")))
        self.assertTrue(os.path.exists(os.path.join(self.proj, "scratchpad", "loose.md")))
        self.assertFalse(os.path.exists(self.archive()))

    def test_custom_scratch_archives_next_to_it_and_never_sweeps(self):
        run = os.path.join(self.proj, "work", "run")
        os.makedirs(os.path.join(run, ".team"))
        write_text(os.path.join(run, ".team", "config.json"), json.dumps({"team_id": "app-1", "ticket": "APP-1"}))
        write_text(os.path.join(self.proj, "work", "keep.md"), "mine\n")
        p = self.init(TEAM_SCRATCH=os.path.join("work", "run"))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(os.path.join(self.proj, "work", ".archive", "APP-1-2026-01-02", ".team")))
        self.assertTrue(os.path.exists(os.path.join(self.proj, "work", "keep.md")))

    def test_refuses_to_archive_a_run_dir_holding_a_worktree(self):
        # An old-style TEAM_SCRATCH=scratchpad points at the whole scratchpad,
        # worktrees included. Moving it would break them.
        root = os.path.join(self.proj, "scratchpad")
        os.makedirs(os.path.join(root, "wt-feat"))
        write_text(os.path.join(root, "wt-feat", ".git"), "gitdir: /elsewhere\n")
        p = self.init(TEAM_SCRATCH="scratchpad")
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertIn("scratchpad/wt-feat", p.stderr)
        self.assertTrue(os.path.exists(os.path.join(root, "wt-feat", ".git")))

    def test_ticket_with_slash_is_archived_under_a_flat_name(self):
        self.old_run(ticket="team/ABC-1")
        p = self.init()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.archive("team-ABC-1-2026-01-02", "brief-scout-digest.md")))

    def test_trailing_slash_in_team_scratch_is_normalised(self):
        self.old_run()
        p = self.init(TEAM_SCRATCH=SCRATCH + "/")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.archive("APP-1-2026-01-02", "brief-scout-digest.md")))

    def test_symlink_is_swept_without_following_it(self):
        target = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(target, ".git"))
            os.makedirs(os.path.join(self.proj, "scratchpad"))
            os.symlink(target, os.path.join(self.proj, "scratchpad", "link"))
            p = self.init()
            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertTrue(os.path.islink(self.archive("loose-2026-01-02", "link")))
            self.assertTrue(os.path.exists(os.path.join(target, ".git")))
        finally:
            shutil.rmtree(target, ignore_errors=True)
```

The warning path in the assertions is the entry as `team-init` sees it: `<scratch root>/<entry>`, relative, because `TEAM_SCRATCH` is relative.

- [ ] **Step 2: Run them to see them fail**

Run: `python3 -m unittest discover -s plugins/team/tests -k TeamInit`
Expected: the 11 new tests FAIL (no archive dir, nothing swept, no warning). The other `TeamInit` tests still pass.

- [ ] **Step 3: Implement**

In `bin/team-init`, right after `scratch="${TEAM_SCRATCH:-scratchpad/current}"`, normalise the value:

```bash
scratch="${scratch%/}"
```

Delete line 24 (`mkdir -p "$teamdir"`). Replace the block from the comment `# A previous team's dir is still here.` through its closing `fi` (old lines 26-54) with the following. It keeps the live guard unchanged, then archives and sweeps, then creates the fresh dir:

```bash
# A previous team whose agents are still live needs its files: refuse and name
# them. Otherwise the previous run and every loose scratchpad entry move to
# .archive/, out of sight of the new run.
if [ -e "$teamdir/config.json" ]; then
  old_team_id="$(json_get team_id <"$teamdir/config.json")"
  live="$(OLD_TEAM_ID="$old_team_id" python3 -c "
import json, os, subprocess
tid = os.environ['OLD_TEAM_ID']
try:
    out = subprocess.run(['herdr', 'agent', 'list'], capture_output=True, text=True)
    d = json.loads(out.stdout)
    names = [a.get('name') for a in d.get('result', {}).get('agents', []) if a.get('name')]
except Exception:
    names = []
live = [n for n in names if tid and (n == tid or n.startswith(tid + '-'))]
print(' '.join(live))
")"
  if [ -n "$live" ]; then
    echo "already initialised: $teamdir/config.json (live agents: $live)" >&2
    exit 1
  fi
fi

SCRATCH="$scratch" python3 - <<'PY' || exit 1
import datetime, json, os, shutil, sys

scratch = os.environ["SCRATCH"]
root = os.path.dirname(scratch) or "."
archive = os.path.join(root, ".archive")
today = os.environ.get("TEAM_TODAY") or datetime.date.today().isoformat()

def holds_git(path):
    if os.path.islink(path) or not os.path.isdir(path):
        return os.path.basename(path) == ".git"
    for _, dirs, files in os.walk(path):
        if ".git" in dirs or ".git" in files:
            return True
    return False

def free_name(base):
    path, n = os.path.join(archive, base), 2
    while os.path.lexists(path):
        path, n = os.path.join(archive, "%s-%d" % (base, n)), n + 1
    return path

def move(src, dst):
    try:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.move(src, dst)
    except OSError as e:
        sys.exit("cannot archive %s: %s" % (src, e))

if os.path.isdir(scratch) and os.listdir(scratch):
    if holds_git(scratch):
        sys.exit("refusing to archive %s: it holds a git worktree; set TEAM_SCRATCH to a run dir such as scratchpad/current" % scratch)
    try:
        with open(os.path.join(scratch, ".team", "config.json")) as fh:
            ticket = json.load(fh).get("ticket") or ""
    except (OSError, ValueError):
        ticket = ""
    move(scratch, free_name("%s-%s" % (ticket.replace("/", "-") or "run", today)))

if os.path.basename(os.path.abspath(root)) == "scratchpad":
    keep = {os.path.basename(scratch), ".archive"}
    loose = None
    for entry in sorted(os.listdir(root)):
        src = os.path.join(root, entry)
        if entry in keep:
            continue
        if holds_git(src):
            print("❗️ worktree inside scratchpad: %s - move it out with git worktree move" % src,
                  file=sys.stderr)
            continue
        loose = loose or free_name("loose-%s" % today)
        move(src, os.path.join(loose, entry))
PY

mkdir -p "$teamdir"
```

Note: `old_ticket` is no longer used in bash (python reads the ticket), so it is removed together with the old archive lines. `holds_git` returns False for a symlink to a directory, so a link is moved as a link and never followed. For the refusal test, `holds_git` on the whole run dir finds `wt-feat/.git`, and the message names `scratchpad`. The test checks that `scratchpad/wt-feat` appears in stderr, so name the offending entry in that message. Change the refusal line to find the first entry that holds a `.git`:

```python
    if holds_git(scratch):
        bad = next(os.path.join(scratch, e) for e in sorted(os.listdir(scratch)) if holds_git(os.path.join(scratch, e)))
        sys.exit("refusing to archive %s: %s holds a git worktree; set TEAM_SCRATCH to a run dir such as scratchpad/current" % (scratch, bad))
```

- [ ] **Step 4: Run the tests**

Run: `python3 -m unittest discover -s plugins/team/tests -k TeamInit`
Expected: all `TeamInit` tests PASS, with no output beyond the unittest summary.

Run: `python3 -m unittest discover -s plugins/team/tests`
Expected: 156 tests OK (147 - 2 + 11), pristine.

- [ ] **Step 5: Stop for review.** Do not stage or commit.

---

### Task 3: Worktrees: `team-slice` without a default, mirroring into `current/`

**Files:**
- Modify: `plugins/team/bin/team-slice:49-67`
- Modify: `plugins/team/bin/team-brief:142-163`
- Test: `plugins/team/tests/test_team.py`, classes `TeamSlice` and `TeamBriefSend`

**Interfaces:**
- Consumes: `Base.sp()` (Task 1).
- Produces: a worktree agent's files arrive in `<agent cwd>/scratchpad/current/`, and the kick-off names `scratchpad/current/<brief file>`.

- [ ] **Step 1: Write the failing tests**

In `TeamBriefSend.test_mirrors_brief_and_decisions_into_worktree_scratch`, change the three worktree-side expectations to:

```python
            self.assertEqual(read_text(os.path.join(wt, "scratchpad", "current", "brief-scout-digest.md")), "brief body\n")
            self.assertEqual(read_text(os.path.join(wt, "scratchpad", "current", "decisions-APP-1.md")), "1. decision\n")
            ...
            self.assertIn("Read scratchpad/current/brief-scout-digest.md ", prompts[0])
```

Replace class `TeamSlice` with:

```python
class TeamSlice(Base):
    WS = {"HERDR_WORKSPACE_ID": "w1"}

    def overlay(self, text):
        d = os.path.join(self.proj, ".claude", "team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "project.yaml"), text)

    def slice(self, *extra):
        return self.run_script("team-slice", "feat", "main", "--label", "T1 APP-1 slug", *extra,
                               env_extra=self.WS)

    def test_without_overlay_refuses_and_touches_nothing(self):
        p = self.slice()
        self.assertEqual(p.returncode, 2)
        self.assertIn("no worktree_cmd in .claude/team/project.yaml - ask the human how this repo makes worktrees",
                      p.stderr)
        self.assertEqual(self.git_calls(), [])
        self.assertEqual(self.herdr_calls(), [])

    def test_without_worktree_dir_refuses(self):
        self.overlay('worktree_cmd: "git worktree add {branch} {parent}"\n')
        p = self.slice()
        self.assertEqual(p.returncode, 2)
        self.assertIn("no worktree_dir in .claude/team/project.yaml - ask the human how this repo makes worktrees",
                      p.stderr)
        self.assertEqual(self.git_calls(), [])

    def test_uses_the_repos_own_worktree_command(self):
        self.overlay('stacked: true\nworktree_cmd: "git worktree add {branch} {parent}"\nworktree_dir: "{branch}"\n')
        p = self.slice()
        self.assertEqual(p.returncode, 0, p.stderr)
        git = self.git_calls()
        self.assertIn("worktree add feat main", git)
        self.assertIn("m add feat --onto main", git)

    def test_herdr_gets_the_absolute_worktree_cwd(self):
        self.overlay('worktree_cmd: "git worktree add {branch} {parent}"\nworktree_dir: "{branch}"\n')
        os.makedirs(os.path.join(self.proj, "feat"))
        p = self.slice()
        self.assertEqual(p.returncode, 0, p.stderr)
        creates = [c for c in self.herdr_calls() if c.startswith("tab create")]
        expect_abs = os.path.join(os.path.realpath(self.proj), "feat")
        self.assertTrue(any(("--cwd %s " % expect_abs) in c for c in creates), creates)

    def test_tab_goes_to_the_callers_live_workspace(self):
        self.overlay('worktree_cmd: "git worktree add {branch} {parent}"\nworktree_dir: "{branch}"\n')
        p = self.run_script("team-slice", "feat", "main", "--label", "T1 APP-1 slug",
                            env_extra={"HERDR_WORKSPACE_ID": "w7"})
        self.assertEqual(p.returncode, 0, p.stderr)
        creates = [c for c in self.herdr_calls() if c.startswith("tab create")]
        self.assertTrue(creates and all("--workspace w1 " in c for c in creates), creates)

    def test_copy_lands_in_the_worktrees_run_dir(self):
        self.overlay('worktree_cmd: "git worktree add {branch} {parent}"\nworktree_dir: "{branch}"\n')
        os.makedirs(os.path.join(self.proj, "feat"))
        os.makedirs(os.path.join(self.proj, "specs"))
        write_text(os.path.join(self.proj, "specs", "a.md"), "spec\n")
        p = self.slice("--copy", "specs")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(read_text(os.path.join(self.proj, "feat", "scratchpad", "current", "specs", "a.md")), "spec\n")

    def test_rejects_unsafe_git_ref(self):
        p = self.run_script("team-slice", "evil;rm -rf x", "main", "--label", "T1 X y", env_extra=self.WS)
        self.assertEqual(p.returncode, 2)
        self.assertEqual(self.git_calls(), [])
```

Before you finalise these, read `tests/fake-git`. It must accept `worktree add feat main` and `m add ...` (the existing custom test already used them). If `fake-git` does not create the worktree dir, the tests above create `feat/` themselves, as shown.

- [ ] **Step 2: Run them to see them fail**

Run: `python3 -m unittest discover -s plugins/team/tests -k TeamSlice`
Then: `python3 -m unittest discover -s plugins/team/tests -k test_mirrors_brief`
Expected: the refusal tests FAIL (the default still runs), the copy test FAILS (the file lands in `feat/scratchpad/specs`), and the mirror test FAILS (the files land in `wt/scratchpad/`).

- [ ] **Step 3: Implement `team-slice`**

Replace:

```bash
worktree_cmd="$(yget worktree_cmd)"
[ -n "$worktree_cmd" ] || worktree_cmd='git worktree add -b {branch} scratchpad/wt-{branch} {parent}'
worktree_dir="$(yget worktree_dir)"
[ -n "$worktree_dir" ] || worktree_dir="scratchpad/wt-$branch"
```

with:

```bash
# The plugin never picks where a worktree goes: each repo says how it makes
# worktrees, and a repo with its own tooling keeps using it.
worktree_cmd="$(yget worktree_cmd)"
[ -n "$worktree_cmd" ] || { echo "no worktree_cmd in $project - ask the human how this repo makes worktrees" >&2; exit 2; }
worktree_dir="$(yget worktree_dir)"
[ -n "$worktree_dir" ] || { echo "no worktree_dir in $project - ask the human how this repo makes worktrees" >&2; exit 2; }
```

`$project` is `.claude/team/project.yaml` when `TEAM_OVERLAY` is unset, which matches the message the tests expect.

Replace the copy block's two lines:

```bash
  mkdir -p "$wt/scratchpad"
  for d in "${copies[@]}"; do cp -R "$d" "$wt/scratchpad/"; done
```

with:

```bash
  mkdir -p "$wt/scratchpad/current"
  for d in "${copies[@]}"; do cp -R "$d" "$wt/scratchpad/current/"; done
```

- [ ] **Step 4: Implement the `team-brief` mirror**

In `bin/team-brief`, change `target_scratch="$agent_cwd_abs/scratchpad"` to `target_scratch="$agent_cwd_abs/scratchpad/current"`, and `brief_ref="scratchpad/$(basename "$brief")"` to `brief_ref="scratchpad/current/$(basename "$brief")"`. In the comment above that block, change "into the worktree's own scratchpad" to "into the worktree's own run dir (scratchpad/current)".

- [ ] **Step 5: Run the tests**

Run: `python3 -m unittest discover -s plugins/team/tests`
Expected: 158 tests OK. `TeamSlice` goes from 5 to 7 tests (+2), and the other counts stay the same. Output must be pristine.

- [ ] **Step 6: Stop for review.** Do not stage or commit.

---

### Task 4: Spawned panes get an absolute `TEAM_SCRATCH`

**Files:**
- Modify: `plugins/team/bin/team-overview` (`spawn_overview`)
- Modify: `plugins/team/bin/team-watch` (`spawn_watcher`)
- Test: `plugins/team/tests/test_team.py`, classes `TeamOverview` and `TeamWatch`

**Interfaces:**
- Consumes: the `pane split` log line format of fake-herdr (`pane split --pane <id> ...`).
- Produces: both `pane split` calls carry `--env TEAM_SCRATCH=<absolute run dir>`.

- [ ] **Step 1: Write the failing tests**

Add to `TeamOverview`:

```python
    def test_spawn_passes_an_absolute_team_scratch(self):
        self.cfg()
        p = self.run_script("team-overview", "--spawn")
        self.assertEqual(p.returncode, 0, p.stderr)
        split = [c for c in self.herdr_calls() if c.startswith("pane split")]
        self.assertIn("--env TEAM_SCRATCH=%s " % os.path.realpath(self.sp()), split[0] + " ")
```

Add to `TeamWatch`:

```python
    def test_spawn_passes_an_absolute_team_scratch(self):
        self.cfg()
        p = self.run_script("team-watch", "--spawn")
        self.assertEqual(p.returncode, 0, p.stderr)
        split = [c for c in self.herdr_calls() if c.startswith("pane split")]
        self.assertIn("--env TEAM_SCRATCH=%s " % os.path.realpath(self.sp()), split[0] + " ")
```

`os.path.realpath` of a dir that does not exist yet still resolves its existing parents (for example `/private/var/...` on macOS), and the script uses the same Python call, so the two strings match.

- [ ] **Step 2: Run them to see them fail**

Run: `python3 -m unittest discover -s plugins/team/tests -k test_spawn_passes_an_absolute_team_scratch`
Expected: 2 FAIL (no `--env` in the split call).

- [ ] **Step 3: Implement**

In both `spawn_overview` (`bin/team-overview`) and `spawn_watcher` (`bin/team-watch`), add before the `herdr pane split` line:

```bash
  scratch_abs="$(python3 -c "import os,sys;print(os.path.realpath(sys.argv[1]))" "$scratch")"
```

Declare `scratch_abs` in the function's `local` line. Add `--env "TEAM_SCRATCH=$scratch_abs"` to the `herdr pane split` call, right before `--no-focus`. `team-start` already passes `--env` to `pane split` the same way.

- [ ] **Step 4: Run the tests**

Run: `python3 -m unittest discover -s plugins/team/tests`
Expected: 160 tests OK, pristine.

- [ ] **Step 5: Stop for review.** Do not stage or commit.

---

### Task 5: Docs, skills and templates

**Files:**
- Modify: `plugins/team/commands/init.md` (step order)
- Modify: `plugins/team/skills/team-orchestration/SKILL.md` (rules 3, 12, new 18 and 19)
- Modify: `plugins/team/skills/team-role-investigator/SKILL.md:11-14`
- Modify: the scratchpad output paths in `plugins/team/skills/team-orchestration/templates/brief-*.md`
- Modify: `plugins/team/skills/team-orchestration/references/lessons.md:101` and its worktree lines
- Modify: `plugins/team/README.md:15,18,21,59,123,132,147`
- Modify: `plugins/team/SPEC.md` (append an increment)

**Interfaces:**
- Consumes: the behaviour from Tasks 1-4.

- [ ] **Step 1: `commands/init.md` order**

Rewrite the numbered steps so that `team-init` runs before any file is written:

```markdown
1. Derive the tab label from the ticket, or use the `--label` argument if given.
   Do not ask which roles the run needs: start agents on demand, when a task
   reveals the need for one.
2. Run `team-init <ticket> --orchestrator-pane <this pane id>`. It archives the
   previous run and every loose scratchpad entry to `scratchpad/.archive/`,
   then writes the team id, the config, the safe permission baseline, records
   this tab, and renames this pane's agent to `<team_id>-orch`. Pass on any
   `worktree inside scratchpad` warning to the human.
3. Write the decisions file from
   `${CLAUDE_PLUGIN_ROOT}/skills/team-orchestration/templates/decisions.md`
   into `${TEAM_SCRATCH:-scratchpad/current}/decisions-<ticket>.md`. Refuse to overwrite.
4. Write the plan file from
   `${CLAUDE_PLUGIN_ROOT}/skills/team-orchestration/templates/progress.md`
   into `${TEAM_SCRATCH:-scratchpad/current}/progress-<ticket>.md`. Refuse to overwrite.
5. Start the overview: `team-overview --spawn`. (keep the existing text of this step)
6. Start the watcher: `team-watch --spawn`. (keep the existing text of this step)
7. Run `team-status` to write the first roster.
```

Keep the existing wording of the overview and watcher steps. Replace only their numbers. Keep the final "Report the team id ..." line.

- [ ] **Step 2: `SKILL.md`**

- Rule 3: `Briefs are files in \`scratchpad/\`.` becomes `Briefs are files in \`scratchpad/current/\`.`
- Rule 12: `scratchpad/orchestration-decisions.md` becomes `scratchpad/current/orchestration-decisions.md`.
- Append after rule 17:

```markdown
18. The run's files live only in `scratchpad/current/`. Never read, list or
    search `scratchpad/.archive/` unless the human asks about an earlier run.
19. Create a worktree only with `team-slice`, which uses the repo's own
    worktree tooling from `.claude/team/project.yaml`. If it refuses for lack
    of an overlay, ask the human how this repo makes worktrees. Never run
    `git worktree add` yourself, and never put a worktree inside `scratchpad/`.
```

- [ ] **Step 3: Role skill and templates**

- `team-role-investigator/SKILL.md`: "create new files under the scratchpad" becomes "create new files under `scratchpad/current/`", and "`Write` bound to the scratchpad" becomes "`Write` bound to `scratchpad/current/`". Add one sentence in the same paragraph: "Never read `scratchpad/.archive/`."
- In each `templates/brief-*.md`, change every output path `scratchpad/<file>` to `scratchpad/current/<file>`.
- Read `team-role-implementer/SKILL.md` and `team-role-tester/SKILL.md`. If either names a scratchpad path or scope, change it to `scratchpad/current/` in the same way.

- [ ] **Step 4: `README.md` and `lessons.md`**

- README lines 15, 18 and 21: `scratchpad/` becomes `scratchpad/current/` in the three concept bullets.
- README line 59, the `team-slice` row: "Create a worktree (with the repo's own `worktree_cmd` from the overlay; refuses without one) and a Herdr tab for one slice."
- README line 123, the overlay table: mark `worktree_cmd` and `worktree_dir` as required by `team-slice`.
- README line 132: `All under \`$TEAM_SCRATCH\` (default \`scratchpad/current/\`, git-ignored). \`/team:init\` archives the previous run and loose scratchpad entries to \`scratchpad/.archive/\`.`
- README line 147: `into \`scratchpad/\`` becomes `into \`scratchpad/current/\``.
- `lessons.md:101`: `scratchpad/orchestration-decisions.md` becomes `scratchpad/current/orchestration-decisions.md`. Any lesson line that says worktrees go under `scratchpad/wt-*` now says worktrees come from the repo's own tooling via the overlay, never inside `scratchpad/`.

- [ ] **Step 5: SPEC increment**

Append to `plugins/team/SPEC.md`:

```markdown
## Increment 2026-09-27

Design: `docs/superpowers/specs/2026-09-27-team-scratchpad-per-run-design.md`.
Every run lives in one folder so a new task never sees an earlier task's
files.

`TEAM_SCRATCH` now defaults to `scratchpad/current`. `team-init` first keeps
the live-agent guard, then moves a non-empty run dir to
`<scratch root>/.archive/<ticket>-<YYYY-MM-DD>/` (`run-<date>` without a
ticket, `-2`, `-3` on a clash) and, when the scratch root is named
`scratchpad`, sweeps every other entry except `.archive` into
`.archive/loose-<date>/`. Nothing that holds a `.git` is ever moved: a loose
one is skipped with a warning, and a run dir that holds one makes init refuse.
`/team:init` now runs `team-init` before it writes the decisions and plan
files. Worktree agents get their brief and decisions file in
`<worktree>/scratchpad/current/`. `team-slice` no longer has a built-in
worktree location: without `worktree_cmd` and `worktree_dir` in the overlay
it refuses, so a repo's own worktree tooling is always used. The overview and
watcher panes now receive an absolute `TEAM_SCRATCH` like agent panes do.
```

- [ ] **Step 6: Checks**

Run: `grep -rn "scratchpad/wt-\|TEAM_SCRATCH:-scratchpad}" plugins/team`
Expected: no output.

Run: `grep -rn $'\xe2\x80\x94' plugins/team docs/superpowers/specs/2026-09-27-team-scratchpad-per-run-design.md docs/superpowers/plans/2026-09-27-team-scratchpad-per-run.md`
Expected: no output.

Run: `python3 -m unittest discover -s plugins/team/tests`
Expected: 160 tests OK, pristine.

- [ ] **Step 7: Stop for review.** Do not stage or commit. The version bump (0.2.9 -> 0.3.0) happens only when Chebu asks for the commit.

---

### Task 6: Manual verification in real herdr (with Chebu)

- [ ] **Step 1:** In this repo, which is a branch repo, put two loose files in `scratchpad/`. Chebu starts a fresh Claude session with `--plugin-dir` and runs `/team:init X-1`. Expected:
  - the loose files are in `scratchpad/.archive/loose-<date>/`;
  - `scratchpad/current/` holds `.team`, `decisions-X-1.md` and `progress-X-1.md`;
  - the overview shows `X-1`.
- [ ] **Step 2:** Chebu releases the run and runs `/team:init X-2`. Expected: `scratchpad/.archive/X-1-<date>/` holds the X-1 files, and `current/` holds only X-2.
- [ ] **Step 3:** In that session, ask the orchestrator to run `team-slice feat main --label "T1 X-2 test"`. Expected: it refuses with the overlay message and asks Chebu how this repo makes worktrees.
- [ ] **Step 4:** Clean up the `X-*` files and the archive entries from this test after Chebu confirms.
