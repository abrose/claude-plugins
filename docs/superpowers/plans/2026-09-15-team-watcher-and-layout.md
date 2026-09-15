# Team Watcher, Layout Hygiene, and Multi-Team Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the team plugin never sit blind: add a per-team watcher process that reports agent state changes, enforces pane/tab budgets, cleans up empty panes, and namespaces every agent by a team id so multiple teams run at once.

**Architecture:** A new `team-watch` poll loop runs in its own pane in the orchestrator tab. Each cycle it reads `herdr agent list` and `herdr pane list` once, diffs agent state against `watch-state.json`, pushes one `WATCH` line per change to the orchestrator, flags idle-without-report agents, and does layout hygiene scoped to team-managed tabs. A new `team-id` helper and `team-init` script give each team a short id; every agent name becomes `<teamid>-<label>`. The two pending CLI fixes land first as the foundation.

**Tech Stack:** Bash (`set -euo pipefail`) with `python3` for JSON. Herdr CLI. stdlib `unittest` against the `fake-herdr`/`fake-git` PATH shims already in `plugins/team/tests`.

## Global Constraints

- No em dash anywhere. Use a plain dash `-`. (Copy rule, verbatim.)
- No agent-attribution trailers in commits or MR bodies.
- Every script starts with `#!/usr/bin/env bash` and `set -euo pipefail`. Use `python3` for all JSON. No dependency beyond bash + python3. `chmod +x` every new script before it is committed.
- Herdr agent names match `^[a-z][a-z0-9_-]{0,31}$` and are at most 32 chars. Team id is at most 12 chars, so `<teamid>-<label>` always fits.
- Bundled paths use `${CLAUDE_PLUGIN_ROOT}`; never hardcode `~/.claude`.
- The kernel must run with an empty overlay (the Rust-repo test): every new behaviour degrades cleanly when no `.claude/team/` exists.
- Tests run with `python3 -m unittest discover -s plugins/team/tests` and MUST be pristine: no warnings, no stray output.
- **Commit only on Chebu's explicit go.** The `Commit` steps below mark the intended commit boundaries; at execution time, pause at each and commit only when Chebu says so. This overrides the writing-plans default of committing freely.
- Work in an isolated git worktree created via superpowers:using-git-worktrees at execution start.

## File structure

New files:
- `plugins/team/bin/team-id` - compute a team id: slug a ticket, or a random hash.
- `plugins/team/bin/team-init` - the mechanical half of `/team:init`: team id, config, allowlist, tab record.
- `plugins/team/bin/team-watch` - the supervision poll loop and layout hygiene.

Modified files:
- `plugins/team/bin/team-start` - prepend team id to the agent name; tab-aware placement.
- `plugins/team/bin/team-slice` - record the created tab; tab-aware placement note.
- `plugins/team/commands/init.md`, `status.md`, `release.md`, `brief.md` - wire team id, watcher start/stop, layout suggestions.
- `plugins/team/skills/team-orchestration/SKILL.md` - add watcher + budget rules; move deferred rules out.
- `plugins/team/skills/team-orchestration/references/lessons.md` - receive the deferred rules.
- `plugins/team/tests/fake-herdr` - add `pane list` and multi-state scenarios.
- `plugins/team/tests/test_team.py` - new test classes.
- `plugins/team/README.md`, `plugins/team/SPEC.md`, `plugins/team/.claude-plugin/plugin.json` - document the new pieces; bump version.

Task-scope files (created at run time under `$TEAM_SCRATCH/.team/`): `config.json` (now carries `team_id`), `tabs.json` (team-managed tab ids), `watch-state.json` (last-seen agent states + the watcher's own pane id), `watch.log`.

---

### Task 1: Land the two pending CLI fixes

**Files:**
- Modify: `plugins/team/bin/team-start`, `plugins/team/bin/team-brief`, `plugins/team/tests/test_team.py` (via cherry-pick)

**Interfaces:**
- Produces: a `team-start` whose status-bar check matches `cwd` by basename, and a `team-brief send` that passes the prompt as a positional before `--wait`. Later tasks build on these fixed scripts.

The fixes already exist as commits `12cd73f` (team-brief send positional prompt before --wait) and `dd83c27` (team-start match status bar cwd by basename) on branch `plugfix/team-cli-fixes`. Do NOT merge the whole branch: `main` has since added quota-statusline commits the branch lacks, and a merge would revert them. Cherry-pick only the two team commits.

- [ ] **Step 1: Confirm the two commits touch only the team plugin**

Run: `git show --stat 12cd73f 3737219 2>/dev/null; git show --stat dd83c27`
Expected: each diff touches only `plugins/team/` paths. If either touches quota-statusline, stop and ask Chebu.

- [ ] **Step 2: Cherry-pick both, oldest first**

Run: `git cherry-pick 12cd73f dd83c27`
Expected: both apply cleanly. On conflict, stop and ask Chebu.

- [ ] **Step 3: Run the existing tests, verify green**

Run: `python3 -m unittest discover -s plugins/team/tests`
Expected: OK, pristine output. The branch added `team-start`/`team-brief send` cases; they now pass on this line.

- [ ] **Step 4: (Commit boundary)** The cherry-picks are already commits. No new commit here. Continue.

---

### Task 2: `team-id` helper

**Files:**
- Create: `plugins/team/bin/team-id`
- Test: `plugins/team/tests/test_team.py` (new class `TeamId`)

**Interfaces:**
- Produces:
  - `team-id slug <ticket>` prints a lowercase slug of the ticket, at most 12 chars, matching `^[a-z][a-z0-9-]*$`.
  - `team-id hash` prints a random 6-char base36 id matching `^[a-z][a-z0-9]{5}$` (leading letter guaranteed).
  - `team-id for <ticket>` prints `slug <ticket>` when the ticket is non-empty, else `hash`.
  - Exit 2 on missing subcommand.

- [ ] **Step 1: Write the failing tests**

Add to `plugins/team/tests/test_team.py`:

```python
import re

class TeamId(Base):
    def test_slug_lowercases_and_dashes(self):
        p = self.run_script("team-id", "slug", "APP-5066")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.strip(), "app-5066")

    def test_slug_collapses_and_trims_and_caps_12(self):
        p = self.run_script("team-id", "slug", "  Feature/Big__Thing 42  ")
        self.assertEqual(p.returncode, 0, p.stderr)
        s = p.stdout.strip()
        self.assertTrue(re.match(r"^[a-z][a-z0-9-]*$", s), s)
        self.assertLessEqual(len(s), 12)
        self.assertFalse(s.endswith("-"))

    def test_hash_is_six_char_base36_letter_first(self):
        p = self.run_script("team-id", "hash")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertRegex(p.stdout.strip(), r"^[a-z][a-z0-9]{5}$")

    def test_for_uses_slug_when_ticket_present_else_hash(self):
        p = self.run_script("team-id", "for", "APP-1")
        self.assertEqual(p.stdout.strip(), "app-1")
        q = self.run_script("team-id", "for", "")
        self.assertRegex(q.stdout.strip(), r"^[a-z][a-z0-9]{5}$")

    def test_missing_subcommand_is_bad_args(self):
        p = self.run_script("team-id")
        self.assertEqual(p.returncode, 2)
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `python3 -m unittest plugins.team.tests.test_team.TeamId -v` (or `discover`)
Expected: FAIL - `team-id` does not exist.

- [ ] **Step 3: Write `plugins/team/bin/team-id`**

```bash
#!/usr/bin/env bash
# Compute a team id: slug a ticket, or a random base36 hash.
set -euo pipefail

usage() { echo "usage: team-id slug <ticket> | hash | for <ticket>" >&2; exit 2; }

slug() {
  python3 - "$1" <<'PY'
import sys, re
t = sys.argv[1].lower()
t = re.sub(r"[^a-z0-9]+", "-", t)
t = re.sub(r"-+", "-", t).strip("-")
t = t[:12].rstrip("-")
if not t or not t[0].isalpha():
    t = ("t" + t)[:12].rstrip("-")
print(t)
PY
}

hash_id() {
  python3 - <<'PY'
import random, string
first = random.choice(string.ascii_lowercase)
rest = "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(5))
print(first + rest)
PY
}

cmd="${1:-}"; shift || usage
case "$cmd" in
  slug) [ $# -ge 1 ] || usage; slug "$1" ;;
  hash) hash_id ;;
  for)  [ $# -ge 1 ] || usage; if [ -n "$1" ]; then slug "$1"; else hash_id; fi ;;
  *) usage ;;
esac
```

Then: `chmod +x plugins/team/bin/team-id`

- [ ] **Step 4: Run the tests, verify they pass**

Run: `python3 -m unittest discover -s plugins/team/tests`
Expected: OK, pristine.

- [ ] **Step 5: (Commit boundary)** On Chebu's go:

```bash
git add plugins/team/bin/team-id plugins/team/tests/test_team.py
git commit -m "feat(team): add team-id helper for slug and hash ids"
```

---

### Task 3: `team-start` namespaces the agent name by team id

**Files:**
- Modify: `plugins/team/bin/team-start`
- Test: `plugins/team/tests/test_team.py` (`TeamStart`)

**Interfaces:**
- Consumes: `$TEAM_SCRATCH/.team/config.json` `team_id` (written by `team-init`, Task 4).
- Produces: when `config.json` has a non-empty `team_id`, the herdr agent name and the `.team/<name>.json` key are both `<team_id>-<label>`. With no `team_id`, the name stays the bare `<label>` (backward compatible, so single-team runs and all existing tests are unchanged).

- [ ] **Step 1: Write the failing tests**

Add to class `TeamStart`:

```python
def test_prefixes_name_with_team_id_from_config(self):
    d = os.path.join(self.proj, "scratchpad", ".team")
    os.makedirs(d, exist_ok=True)
    write_text(os.path.join(d, "config.json"),
               json.dumps({"team_id": "app-5066", "orchestrator": "app-5066-orch"}))
    p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                        "--cwd", self.proj, env_extra=self.bar_env("Opus 4.8"))
    self.assertEqual(p.returncode, 0, p.stderr)
    self.assertTrue(any(c.startswith("agent start app-5066-scout ") for c in self.herdr_calls()))
    self.assertTrue(os.path.exists(os.path.join(d, "app-5066-scout.json")))
    out = json.loads(p.stdout)
    self.assertEqual(out["name"], "app-5066-scout")

def test_no_team_id_keeps_bare_name(self):
    p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                        "--cwd", self.proj, env_extra=self.bar_env("Opus 4.8"))
    self.assertEqual(p.returncode, 0, p.stderr)
    self.assertTrue(any(c.startswith("agent start scout ") for c in self.herdr_calls()))
```

- [ ] **Step 2: Run the tests, verify the first fails**

Run: `python3 -m unittest discover -s plugins/team/tests`
Expected: `test_prefixes_name_with_team_id_from_config` FAILS (name is bare `scout`); `test_no_team_id_keeps_bare_name` already passes.

- [ ] **Step 3: Implement the prefix in `team-start`**

After the argument parse and the `name` validation block, before `pane` resolution, insert:

```bash
label="$name"
teamcfg="${TEAM_SCRATCH:-scratchpad}/.team/config.json"
if [ -f "$teamcfg" ]; then
  team_id="$(python3 -c "import sys,json;print(json.load(sys.stdin).get('team_id',''))" <"$teamcfg" 2>/dev/null || true)"
  if [ -n "${team_id:-}" ]; then
    name="${team_id}-${label}"
    [[ "$name" =~ ^[a-z][a-z0-9_-]{0,31}$ ]] || { echo "namespaced name too long: $name" >&2; exit 2; }
  fi
fi
```

The rest of the script already uses `$name` for the herdr call, the record path, and the printed JSON, so no other change is needed.

- [ ] **Step 4: Run the tests, verify all pass**

Run: `python3 -m unittest discover -s plugins/team/tests`
Expected: OK, pristine.

- [ ] **Step 5: (Commit boundary)** On Chebu's go:

```bash
git add plugins/team/bin/team-start plugins/team/tests/test_team.py
git commit -m "feat(team): namespace agent names by team id"
```

---

### Task 4: `team-init` writes team id, config, allowlist, and tab record

**Files:**
- Create: `plugins/team/bin/team-init`
- Modify: `plugins/team/commands/init.md`
- Test: `plugins/team/tests/test_team.py` (new class `TeamInit`)

**Interfaces:**
- Consumes: `team-id` (Task 2).
- Produces:
  - `team-init <ticket> [--orchestrator-pane <id>]` writes `$TEAM_SCRATCH/.team/config.json` = `{"team_id","ticket","orchestrator"}` where `orchestrator` is `<team_id>-orch`.
  - Appends the orchestrator's tab to `$TEAM_SCRATCH/.team/tabs.json` (a JSON list of team-managed tab ids), derived from the orchestrator pane's `tab_id`.
  - Ensures `.claude/settings.local.json` `permissions.allow` contains the safe baseline (adds any missing entries, never removes existing ones, never rewrites unrelated keys).
  - Prints the team id and config path. Refuses (exit 1) if `config.json` already exists.

- [ ] **Step 1: Write the failing tests**

```python
class TeamInit(Base):
    ALLOW = ["Read", "Bash(ls:*)", "Bash(grep:*)", "Bash(git status:*)"]

    def test_writes_config_with_team_id_and_orch(self):
        p = self.run_script("team-init", "APP-5066")
        self.assertEqual(p.returncode, 0, p.stderr)
        cfg = json.loads(read_text(os.path.join(self.proj, "scratchpad", ".team", "config.json")))
        self.assertEqual(cfg["team_id"], "app-5066")
        self.assertEqual(cfg["ticket"], "APP-5066")
        self.assertEqual(cfg["orchestrator"], "app-5066-orch")

    def test_refuses_second_init(self):
        self.run_script("team-init", "APP-1")
        p = self.run_script("team-init", "APP-1")
        self.assertEqual(p.returncode, 1)

    def test_seeds_allowlist_without_clobbering(self):
        d = os.path.join(self.proj, ".claude")
        os.makedirs(d)
        write_text(os.path.join(d, "settings.local.json"),
                   json.dumps({"permissions": {"allow": ["Bash(custom:*)"]}, "env": {"X": "1"}}))
        self.run_script("team-init", "APP-1")
        s = json.loads(read_text(os.path.join(d, "settings.local.json")))
        self.assertEqual(s["env"], {"X": "1"})
        self.assertIn("Bash(custom:*)", s["permissions"]["allow"])
        for a in self.ALLOW:
            self.assertIn(a, s["permissions"]["allow"])

    def test_records_orchestrator_tab(self):
        p = self.run_script("team-init", "APP-1", "--orchestrator-pane", "w1:p1",
                            scenario="pane_in_tab")
        self.assertEqual(p.returncode, 0, p.stderr)
        tabs = json.loads(read_text(os.path.join(self.proj, "scratchpad", ".team", "tabs.json")))
        self.assertIn("w1:t1", tabs)
```

Add a `pane_in_tab` branch to `fake-herdr` `pane get` (Step 3 below).

- [ ] **Step 2: Run the tests, verify they fail**

Run: `python3 -m unittest plugins.team.tests.test_team.TeamInit -v`
Expected: FAIL - `team-init` does not exist.

- [ ] **Step 3: Add the `pane get` scenario to `fake-herdr`**

Replace the `"agent get")` case's neighbour `"pane get"` (currently falls through to default) by adding, before the `*)` default:

```bash
  "pane get")
    emit '{"result":{"pane":{"pane_id":"w1:p1","tab_id":"w1:t1"}}}' ;;
```

- [ ] **Step 4: Write `plugins/team/bin/team-init`**

```bash
#!/usr/bin/env bash
# Establish a team: team id, config, allowlist baseline, orchestrator tab record.
# Exit codes: 0 ok, 1 refused (already initialised), 2 bad arguments, 4 herdr error.
set -euo pipefail

usage() { echo "usage: team-init <ticket> [--orchestrator-pane <id>]" >&2; exit 2; }

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
scratch="${TEAM_SCRATCH:-scratchpad}"
teamdir="$scratch/.team"

[ $# -ge 1 ] || usage
ticket="$1"; shift
orch_pane=""
while [ $# -gt 0 ]; do
  case "$1" in
    --orchestrator-pane) orch_pane="${2:?}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done

mkdir -p "$teamdir"
[ -e "$teamdir/config.json" ] && { echo "already initialised: $teamdir/config.json" >&2; exit 1; }

team_id="$("$here/team-id" for "$ticket")"
orch="${team_id}-orch"

TICKET="$ticket" TEAM_ID="$team_id" ORCH="$orch" python3 - "$teamdir/config.json" <<'PY'
import os, json, sys
json.dump({"team_id": os.environ["TEAM_ID"], "ticket": os.environ["TICKET"],
           "orchestrator": os.environ["ORCH"]}, open(sys.argv[1], "w"))
PY

# Seed the safe permission allowlist, adding only what is missing.
python3 - <<'PY'
import json, os
path = os.path.join(".claude", "settings.local.json")
base = ["Read", "Bash(ls:*)", "Bash(grep:*)", "Bash(git status:*)"]
os.makedirs(".claude", exist_ok=True)
data = {}
if os.path.exists(path):
    try: data = json.load(open(path))
    except Exception: data = {}
perms = data.setdefault("permissions", {})
allow = perms.setdefault("allow", [])
for a in base:
    if a not in allow:
        allow.append(a)
json.dump(data, open(path, "w"), indent=2)
PY

# Record the orchestrator's tab as team-managed.
if [ -n "$orch_pane" ]; then
  tab="$(herdr pane get "$orch_pane" | python3 -c "import sys,json;print(json.load(sys.stdin)['result']['pane']['tab_id'])")" || exit 4
  TAB="$tab" python3 - "$teamdir/tabs.json" <<'PY'
import os, json, sys
path = sys.argv[1]
tabs = json.load(open(path)) if os.path.exists(path) else []
t = os.environ["TAB"]
if t not in tabs: tabs.append(t)
json.dump(tabs, open(path, "w"))
PY
fi

echo "team_id=$team_id config=$teamdir/config.json"
```

Then: `chmod +x plugins/team/bin/team-init`

- [ ] **Step 5: Run the tests, verify they pass**

Run: `python3 -m unittest discover -s plugins/team/tests`
Expected: OK, pristine.

- [ ] **Step 6: Update `commands/init.md`**

Replace steps 2-5 of the command body so the orchestrator calls `team-init` for the mechanical parts, then starts the watcher. New body:

```markdown
Load the `team-orchestration` skill first. Then, doing no operational work
beyond these steps:

1. Ask the human ONE question with AskUserQuestion: confirm the tab label
   (default derived from the ticket) and which roles this run needs.
2. Write the decisions file from
   `${CLAUDE_PLUGIN_ROOT}/skills/team-orchestration/templates/decisions.md`
   into `${TEAM_SCRATCH:-scratchpad}/decisions-<ticket>.md`. Refuse to overwrite.
3. Run `team-init <ticket> --orchestrator-pane <this pane id>`. It writes the
   team id, the config, the safe permission baseline, and records this tab.
4. Rename this pane's agent to the `orchestrator` name from
   `${TEAM_SCRATCH:-scratchpad}/.team/config.json` (`<team_id>-orch`).
5. Split one small pane in this tab and start the watcher there:
   `team-watch` (it reads config for the orchestrator name). This tab now holds
   exactly two panes: you and the watcher.
6. Run `team-status` to write the first roster.

Report the team id, the decisions file path, and the roster to the human.
```

- [ ] **Step 7: (Commit boundary)** On Chebu's go:

```bash
git add plugins/team/bin/team-init plugins/team/commands/init.md plugins/team/tests/test_team.py plugins/team/tests/fake-herdr
git commit -m "feat(team): add team-init for team id, config, allowlist, tab record"
```

---

### Task 5: `team-watch` core - state diff and report push

**Files:**
- Create: `plugins/team/bin/team-watch`
- Modify: `plugins/team/tests/fake-herdr`
- Test: `plugins/team/tests/test_team.py` (new class `TeamWatch`)

**Interfaces:**
- Consumes: `$TEAM_SCRATCH/.team/config.json` (`orchestrator`), `.team/<name>.json` records, `herdr agent list`.
- Produces:
  - `team-watch --once` runs one poll pass and exits 0. `team-watch` with no flag loops forever (interval from `--interval`, default 5).
  - On a first pass it records each team agent's state to `.team/watch-state.json` and pushes nothing (no prior baseline).
  - On a later pass, for each team agent whose state changed, it runs `herdr agent prompt <orchestrator> "WATCH <name>: <old> -> <new>"`.
  - It reacts ONLY to agents present in `.team/*.json`; other live agents are ignored.

- [ ] **Step 1: Add watch scenarios to `fake-herdr`**

Extend the `"agent list")` case with two scenarios that differ across calls, and add a `watch_two_teams` scenario. Insert before the existing `status_mixed` branch:

```bash
      watch_change)
        if [ "$same_before" -eq 0 ]; then
          emit '{"result":{"agents":[{"name":"app-1-scout","pane_id":"w1:p2","state":"working","agent_session":{"value":"aaaa1111"}}]}}'
        else
          emit '{"result":{"agents":[{"name":"app-1-scout","pane_id":"w1:p2","state":"blocked","agent_session":{"value":"aaaa1111"}}]}}'
        fi ;;
      watch_two_teams)
        emit '{"result":{"agents":[
          {"name":"app-1-scout","pane_id":"w1:p2","state":"blocked","agent_session":{"value":"aaaa1111"}},
          {"name":"app-2-maker","pane_id":"w2:p2","state":"working","agent_session":{"value":"bbbb2222"}}
        ]}}' ;;
```

- [ ] **Step 2: Write the failing tests**

```python
class TeamWatch(Base):
    def cfg(self, orch="app-1-orch", team_id="app-1"):
        d = os.path.join(self.proj, "scratchpad", ".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "config.json"),
                   json.dumps({"team_id": team_id, "orchestrator": orch}))
        return d

    def test_first_pass_records_state_and_pushes_nothing(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        p = self.run_script("team-watch", "--once", scenario="watch_change")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(any(c.startswith("agent prompt ") for c in self.herdr_calls()))
        state = json.loads(read_text(os.path.join(self.proj, "scratchpad", ".team", "watch-state.json")))
        self.assertEqual(state["agents"]["app-1-scout"], "working")

    def test_second_pass_pushes_watch_line_on_change(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        self.run_script("team-watch", "--once", scenario="watch_change")   # baseline: working
        self.run_script("team-watch", "--once", scenario="watch_change")   # now: blocked
        pushes = [c for c in self.herdr_calls() if c.startswith("agent prompt app-1-orch WATCH")]
        self.assertTrue(any("app-1-scout: working -> blocked" in c for c in pushes), self.herdr_calls())

    def test_ignores_agents_not_in_records(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        # app-2-maker is live but has no record here; must be ignored.
        self.run_script("team-watch", "--once", scenario="watch_two_teams")
        state = json.loads(read_text(os.path.join(self.proj, "scratchpad", ".team", "watch-state.json")))
        self.assertNotIn("app-2-maker", state["agents"])
```

- [ ] **Step 3: Run the tests, verify they fail**

Run: `python3 -m unittest plugins.team.tests.test_team.TeamWatch -v`
Expected: FAIL - `team-watch` does not exist.

- [ ] **Step 4: Write `plugins/team/bin/team-watch` (core only)**

```bash
#!/usr/bin/env bash
# Watch this team's agents. Push one WATCH line to the orchestrator on each
# state change. --once runs a single pass (for tests); default loops.
set -euo pipefail

scratch="${TEAM_SCRATCH:-scratchpad}"
teamdir="$scratch/.team"
interval=5; once=""
while [ $# -gt 0 ]; do
  case "$1" in
    --once) once=1; shift ;;
    --interval) interval="${2:?}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

orch() { python3 -c "import sys,json;print(json.load(sys.stdin).get('orchestrator','orchestrator'))" <"$teamdir/config.json" 2>/dev/null || echo orchestrator; }

pass() {
  local list orchestrator
  list="$(herdr agent list)" || return 0
  orchestrator="$(orch)"
  # Compute the WATCH lines to send; the python prints one shell-safe line per push.
  local lines
  lines="$(SCRATCH="$scratch" TEAMDIR="$teamdir" LIST="$list" python3 - <<'PY'
import os, json, glob
teamdir = os.environ["TEAMDIR"]
records = {}
for f in glob.glob(os.path.join(teamdir, "*.json")):
    if os.path.basename(f) in ("config.json", "watch-state.json", "tabs.json"):
        continue
    records[os.path.splitext(os.path.basename(f))[0]] = True
agents = json.loads(os.environ["LIST"]).get("result", {}).get("agents", [])
cur = {a["name"]: a.get("state", "unknown") for a in agents if a.get("name") in records}
sp = os.path.join(teamdir, "watch-state.json")
prev = json.load(open(sp)).get("agents", {}) if os.path.exists(sp) else {}
out = []
for name, state in cur.items():
    old = prev.get(name)
    if old is not None and old != state:
        out.append("%s: %s -> %s" % (name, old, state))
json.dump({"agents": cur}, open(sp, "w"))
for line in out:
    print(line)
PY
)"
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    herdr agent prompt "$orchestrator" "WATCH $line" >/dev/null 2>&1 || true
  done <<<"$lines"
}

if [ -n "$once" ]; then pass; exit 0; fi
while true; do pass; sleep "$interval"; done
```

Then: `chmod +x plugins/team/bin/team-watch`

- [ ] **Step 5: Run the tests, verify they pass**

Run: `python3 -m unittest discover -s plugins/team/tests`
Expected: OK, pristine.

- [ ] **Step 6: (Commit boundary)** On Chebu's go:

```bash
git add plugins/team/bin/team-watch plugins/team/tests/test_team.py plugins/team/tests/fake-herdr
git commit -m "feat(team): add team-watch core state-diff and report push"
```

---

### Task 6: `team-watch` reports the block dialog and flags idle-without-report

**Files:**
- Modify: `plugins/team/bin/team-watch`, `plugins/team/tests/test_team.py`

**Interfaces:**
- Produces: on a transition into `blocked`, the WATCH line gains the dialog's first line: `WATCH <name>: working -> blocked: <dialog first line>`. On a pass where a team agent is `idle` or `done` and has no report file newer than its brief, a `WATCH <name>: idle, no report` line is pushed once (not repeated until state changes).

- [ ] **Step 1: Write the failing tests**

```python
def test_blocked_line_includes_dialog(self):
    self.cfg()
    self.write_record("app-1-scout", "investigator", topic="digest")
    self.run_script("team-watch", "--once", scenario="watch_change")   # working
    self.run_script("team-watch", "--once", scenario="watch_change")   # blocked
    pushes = [c for c in self.herdr_calls() if "WATCH" in c]
    self.assertTrue(any("blocked:" in c for c in pushes), pushes)
    self.assertTrue(any("agent read app-1-scout" in c for c in self.herdr_calls()))

def test_idle_without_report_is_flagged_once(self):
    self.cfg()
    self.write_record("app-1-scout", "investigator", topic="digest")
    # default 'ok' agent list returns scout idle; no report file exists.
    self.run_script("team-watch", "--once")   # baseline, records idle
    self.run_script("team-watch", "--once")   # same state, but no report -> flag
    flags = [c for c in self.herdr_calls() if "no report" in c]
    self.assertGreaterEqual(len(flags), 1)
```

Note: the default `agent list` scenario returns `scout` idle, so give the record name `scout` OR adjust the default fake list to `app-1-scout`. To keep the default scenario shared, add a `watch_idle` scenario returning `app-1-scout` idle and use it here instead of the bare default.

Add to `fake-herdr` `agent list`:

```bash
      watch_idle)
        emit '{"result":{"agents":[{"name":"app-1-scout","pane_id":"w1:p2","state":"idle","agent_session":{"value":"aaaa1111"}}]}}' ;;
```

and use `scenario="watch_idle"` in `test_idle_without_report_is_flagged_once`. Also extend the `agent read` case so a blocked read returns dialog text under the watch scenarios (the existing default returns the status bar, which is fine as a first line).

- [ ] **Step 2: Run tests, verify they fail**

Run: `python3 -m unittest plugins.team.tests.test_team.TeamWatch -v`
Expected: FAIL - no `blocked:` detail, no `no report` flag.

- [ ] **Step 3: Extend `team-watch`**

In the python block, after computing `out`, add dialog lookup for blocked transitions and the idle-no-report check. Replace the `out` construction with:

```python
import time
scratch = os.environ["SCRATCH"]
def fresh_report(name):
    rec_path = os.path.join(teamdir, name + ".json")
    try:
        rec = json.load(open(rec_path))
    except Exception:
        return False
    topic = rec.get("topic", "")
    report = os.path.join(scratch, "reports", "%s-%s.md" % (name, topic))
    brief = os.path.join(scratch, "brief-%s-%s.md" % (name, topic))
    if not os.path.exists(report):
        return False
    if os.path.exists(brief) and os.path.getmtime(report) < os.path.getmtime(brief):
        return False
    return True

out = []
flag_prev = prev.get("_flagged", {}) if isinstance(prev, dict) else {}
flagged = {}
for name, state in cur.items():
    old = prev.get(name) if isinstance(prev, dict) else None
    if old is not None and old != state:
        if state == "blocked":
            out.append(("blocked", name, "%s: %s -> %s" % (name, old, state)))
        else:
            out.append(("change", name, "%s: %s -> %s" % (name, old, state)))
    if state in ("idle", "done") and not fresh_report(name):
        if not flag_prev.get(name):
            out.append(("noreport", name, "%s: idle, no report" % name))
        flagged[name] = True
```

Persist `{"agents": cur, "_flagged": flagged}` instead of `{"agents": cur}`. Change the trailing print loop to emit a tab-separated `kind\tname\tline` so the bash caller can fetch the dialog:

```python
for kind, name, line in out:
    print("%s\t%s\t%s" % (kind, name, line))
```

In the bash `while` loop, read three fields and, for `blocked`, prepend the dialog first line:

```bash
  while IFS=$'\t' read -r kind name line; do
    [ -n "$line" ] || continue
    if [ "$kind" = "blocked" ]; then
      dlg="$(herdr agent read "$name" --source detection --lines 20 2>/dev/null | awk 'NF{print; exit}')"
      line="$line: $dlg"
    fi
    herdr agent prompt "$orchestrator" "WATCH $line" >/dev/null 2>&1 || true
  done <<<"$lines"
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `python3 -m unittest discover -s plugins/team/tests`
Expected: OK, pristine.

- [ ] **Step 5: (Commit boundary)** On Chebu's go:

```bash
git add plugins/team/bin/team-watch plugins/team/tests/test_team.py plugins/team/tests/fake-herdr
git commit -m "feat(team): watch reports block dialog and idle-without-report"
```

---

### Task 7: `team-watch` layout hygiene

**Files:**
- Modify: `plugins/team/bin/team-watch`, `plugins/team/tests/fake-herdr`, `plugins/team/tests/test_team.py`

**Interfaces:**
- Consumes: `herdr pane list`, `.team/tabs.json` (team-managed tab ids), `.team/watch-state.json` (`own_pane`, the watcher's pane id, so it is never treated as empty).
- Produces, each pass:
  - Auto-close: any pane in a team-managed tab that hosts no live agent and is not the watcher's own pane is closed with `herdr pane close <pane>`.
  - Budget flag: a team-managed tab with more panes than its budget (2 for the orchestrator tab, 6 for a worker tab) pushes `WATCH layout: tab <tab> over budget (<n>/<max>)`.
  - Idle-tab suggest: a worker tab whose every team agent is idle or done pushes `WATCH layout: tab <tab> idle, consider release`.

- [ ] **Step 1: Add a `pane list` scenario to `fake-herdr`**

Add a `"pane list")` case (before the default `*)`), varying by scenario:

```bash
  "pane list")
    case "$scenario" in
      panes_empty)
        emit '{"result":{"panes":[
          {"pane_id":"w1:p2","tab_id":"w1:t2","agent_status":"idle"},
          {"pane_id":"w1:p3","tab_id":"w1:t2","agent_status":"unknown"}
        ]}}' ;;
      panes_overbudget)
        emit '{"result":{"panes":[
          {"pane_id":"w1:p2","tab_id":"w1:t2","agent_status":"working"},
          {"pane_id":"w1:p3","tab_id":"w1:t2","agent_status":"working"},
          {"pane_id":"w1:p4","tab_id":"w1:t2","agent_status":"working"},
          {"pane_id":"w1:p5","tab_id":"w1:t2","agent_status":"working"},
          {"pane_id":"w1:p6","tab_id":"w1:t2","agent_status":"working"},
          {"pane_id":"w1:p7","tab_id":"w1:t2","agent_status":"working"},
          {"pane_id":"w1:p8","tab_id":"w1:t2","agent_status":"working"}
        ]}}' ;;
      *)
        emit '{"result":{"panes":[]}}' ;;
    esac ;;
```

- [ ] **Step 2: Write the failing tests**

```python
def prep_tabs(self, tabs, own_pane="w1:p9"):
    d = os.path.join(self.proj, "scratchpad", ".team")
    os.makedirs(d, exist_ok=True)
    write_text(os.path.join(d, "tabs.json"), json.dumps(tabs))
    write_text(os.path.join(d, "watch-state.json"),
               json.dumps({"agents": {}, "_flagged": {}, "own_pane": own_pane}))

def test_closes_empty_pane_in_team_tab(self):
    self.cfg()
    self.prep_tabs(["w1:t2"])
    self.run_script("team-watch", "--once", scenario="panes_empty")
    self.assertTrue(any(c.startswith("pane close w1:p3") for c in self.herdr_calls()), self.herdr_calls())
    # p2 hosts an agent (idle status) -> not closed
    self.assertFalse(any(c.startswith("pane close w1:p2") for c in self.herdr_calls()))

def test_does_not_close_panes_in_foreign_tabs(self):
    self.cfg()
    self.prep_tabs(["w1:t9"])  # team owns t9, not t2
    self.run_script("team-watch", "--once", scenario="panes_empty")
    self.assertFalse(any(c.startswith("pane close") for c in self.herdr_calls()))

def test_flags_over_budget_worker_tab(self):
    self.cfg()
    self.prep_tabs(["w1:t2"])
    self.run_script("team-watch", "--once", scenario="panes_overbudget")
    self.assertTrue(any("over budget" in c for c in self.herdr_calls()), self.herdr_calls())
```

Note: `agent_status` in a pane record marks whether a pane hosts an agent. Treat `agent_status in ("idle","working","blocked","done")` as occupied; `unknown` or missing as empty.

- [ ] **Step 3: Run tests, verify they fail**

Run: `python3 -m unittest plugins.team.tests.test_team.TeamWatch -v`
Expected: FAIL - no `pane close`, no budget flag.

- [ ] **Step 4: Add hygiene to `team-watch`**

Add a second python block in `pass()` after the state push, reading `herdr pane list`:

```bash
  local panes
  panes="$(herdr pane list)" || return 0
  local hy
  hy="$(TEAMDIR="$teamdir" PANES="$panes" python3 - <<'PY'
import os, json
teamdir = os.environ["TEAMDIR"]
tabs_path = os.path.join(teamdir, "tabs.json")
team_tabs = set(json.load(open(tabs_path))) if os.path.exists(tabs_path) else set()
sp = os.path.join(teamdir, "watch-state.json")
own_pane = json.load(open(sp)).get("own_pane") if os.path.exists(sp) else None
cfg = os.path.join(teamdir, "config.json")
orch_tab = None  # the orchestrator tab is the one holding own_pane; budget 2 there, else 6
panes = json.loads(os.environ["PANES"]).get("result", {}).get("panes", [])
occupied = {"idle", "working", "blocked", "done"}
by_tab = {}
for p in panes:
    by_tab.setdefault(p.get("tab_id"), []).append(p)
    if p.get("pane_id") == own_pane:
        orch_tab = p.get("tab_id")
actions = []  # "close <pane>" or "flag <text>"
for tab, plist in by_tab.items():
    if tab not in team_tabs:
        continue
    budget = 2 if tab == orch_tab else 6
    if len(plist) > budget:
        actions.append("flag\tlayout: tab %s over budget (%d/%d)" % (tab, len(plist), budget))
    for p in plist:
        status = p.get("agent_status", "unknown")
        if p.get("pane_id") == own_pane:
            continue
        if status not in occupied:
            actions.append("close\t%s" % p.get("pane_id"))
for a in actions:
    print(a)
PY
)"
  while IFS=$'\t' read -r verb rest; do
    [ -n "$verb" ] || continue
    case "$verb" in
      close) herdr pane close "$rest" >/dev/null 2>&1 || true ;;
      flag)  herdr agent prompt "$orchestrator" "WATCH $rest" >/dev/null 2>&1 || true ;;
    esac
  done <<<"$hy"
```

The idle-tab suggestion reuses the per-agent state already computed; add it in the first python block: if every team agent in a worker tab is idle/done, print a `flag\tlayout: tab <tab> idle, consider release` line. (Map agent name -> pane -> tab via the pane list; keep it in the hygiene block for simplicity, comparing agent states already persisted in `watch-state.json`.)

- [ ] **Step 5: Record `own_pane` at watcher start**

So the watcher never closes its own pane, capture it on the first pass. At the top of `pass()`, before the state block, add:

```bash
  if [ ! -f "$teamdir/watch-state.json" ]; then
    op="$(herdr pane current | python3 -c "import sys,json;print(json.load(sys.stdin)['result']['pane']['pane_id'])" 2>/dev/null || true)"
    [ -n "$op" ] && printf '{"agents":{},"_flagged":{},"own_pane":"%s"}\n' "$op" >"$teamdir/watch-state.json"
  fi
```

Ensure the state-writing python preserves `own_pane` (read it, keep it in the dumped object).

- [ ] **Step 6: Run tests, verify they pass**

Run: `python3 -m unittest discover -s plugins/team/tests`
Expected: OK, pristine.

- [ ] **Step 7: (Commit boundary)** On Chebu's go:

```bash
git add plugins/team/bin/team-watch plugins/team/tests/test_team.py plugins/team/tests/fake-herdr
git commit -m "feat(team): watch enforces pane budgets and closes empty team panes"
```

---

### Task 8: Tab-aware placement in `team-start`

**Files:**
- Modify: `plugins/team/bin/team-start`, `plugins/team/tests/fake-herdr`, `plugins/team/tests/test_team.py`

**Interfaces:**
- Consumes: `herdr pane list` (pane count per tab), `.team/tabs.json`.
- Produces: a new form `team-start <label> <role> --into-tab <tab_id>`; if that tab already holds 6 panes, `team-start` creates a NEW tab (`herdr tab create`), records it in `.team/tabs.json`, and starts the agent in the new tab's root pane instead. The existing `--pane`/`--split` forms are unchanged.

- [ ] **Step 1: Write the failing test**

```python
def test_into_full_tab_spills_to_new_tab(self):
    d = os.path.join(self.proj, "scratchpad", ".team")
    os.makedirs(d, exist_ok=True)
    write_text(os.path.join(d, "tabs.json"), json.dumps(["w1:t2"]))
    p = self.run_script("team-start", "maker", "implementer", "--into-tab", "w1:t2",
                        "--cwd", self.proj, scenario="panes_overbudget",
                        env_extra={**self.bar_env("Sonnet 5"), "HERDR_WORKSPACE_ID": "w1"})
    self.assertEqual(p.returncode, 0, p.stderr)
    calls = self.herdr_calls()
    self.assertTrue(any(c.startswith("tab create") for c in calls), calls)
    self.assertTrue(any("agent start maker --kind claude --pane w1:p9" in c for c in calls))
    tabs = json.loads(read_text(os.path.join(d, "tabs.json")))
    self.assertIn("w1:t9", tabs)
```

(Reuses the `panes_overbudget` `pane list` scenario from Task 7 and the `tab create` fake that returns `w1:t9`/`w1:p9`.)

- [ ] **Step 2: Run the test, verify it fails**

Run: `python3 -m unittest plugins.team.tests.test_team.TeamStart.test_into_full_tab_spills_to_new_tab -v`
Expected: FAIL - `--into-tab` unknown argument.

- [ ] **Step 3: Implement `--into-tab` in `team-start`**

Add `--into-tab)` to the argument parser (`into_tab="${2:?}"; shift 2`). After team-id namespacing and before pane resolution, when `into_tab` is set and `pane`/`split` are not:

```bash
if [ -n "${into_tab:-}" ]; then
  count="$(herdr pane list | python3 -c "import sys,json;t='$into_tab';print(sum(1 for p in json.load(sys.stdin)['result']['panes'] if p.get('tab_id')==t))")"
  if [ "$count" -ge 6 ]; then
    out=$(herdr tab create --workspace "${HERDR_WORKSPACE_ID:?}" --cwd "$cwd" --no-focus) || exit 4
    new_tab=$(echo "$out" | json_get "d['result']['tab']['tab_id']")
    pane=$(echo "$out" | json_get "d['result']['root_pane']['pane_id']")
    TAB="$new_tab" python3 - "${TEAM_SCRATCH:-scratchpad}/.team/tabs.json" <<'PY'
import os, json, sys
path = sys.argv[1]
tabs = json.load(open(path)) if os.path.exists(path) else []
t = os.environ["TAB"]
if t not in tabs: tabs.append(t)
json.dump(tabs, open(path, "w"))
PY
  else
    out=$(herdr pane split --pane "$(herdr pane list | python3 -c "import sys,json;t='$into_tab';print([p['pane_id'] for p in json.load(sys.stdin)['result']['panes'] if p.get('tab_id')==t][0])")" --direction down --cwd "$cwd" --no-focus) || exit 4
    pane=$(echo "$out" | json_get "d['result']['pane']['pane_id']")
  fi
fi
```

Add `--into-tab` to the usage string. Guard: `--into-tab` is mutually exclusive with `--pane`/`--split`.

- [ ] **Step 4: Run tests, verify they pass**

Run: `python3 -m unittest discover -s plugins/team/tests`
Expected: OK, pristine.

- [ ] **Step 5: (Commit boundary)** On Chebu's go:

```bash
git add plugins/team/bin/team-start plugins/team/tests/test_team.py plugins/team/tests/fake-herdr
git commit -m "feat(team): tab-aware placement spills a full worker tab to a new tab"
```

---

### Task 9: Wire commands, protocol, and docs

**Files:**
- Modify: `plugins/team/commands/status.md`, `plugins/team/commands/release.md`, `plugins/team/commands/brief.md`
- Modify: `plugins/team/skills/team-orchestration/SKILL.md`, `plugins/team/skills/team-orchestration/references/lessons.md`
- Modify: `plugins/team/README.md`, `plugins/team/SPEC.md`, `plugins/team/.claude-plugin/plugin.json`

**Interfaces:** none (prose and docs). No test code; verified by review and by the full suite still passing.

- [ ] **Step 1: `commands/release.md` stops the watcher**

Add a final step: "When releasing `all`, also stop the watcher: send its pane a Ctrl-C and close it, then remove `${TEAM_SCRATCH:-scratchpad}/.team/watch-state.json` and `tabs.json`." Keep the refusal-on-`working` rule.

- [ ] **Step 2: `commands/status.md` surfaces watcher output**

Add: "Read the latest `WATCH` lines the watcher pushed; include any blocked agent with its dialog text, any over-budget tab, and any idle-tab release suggestion in the flags block."

- [ ] **Step 3: `commands/brief.md` uses full agent names**

Add a note: "Agent names are `<team_id>-<label>`; pass the full name to `team-brief`."

- [ ] **Step 4: `SKILL.md` - add the watcher and budget rules, move deferred rules out**

Add two rules to the numbered protocol:
- "14. A watcher runs per team in the orchestrator tab. It reports every state change, flags idle-without-report, and keeps the layout within budget. Never sit blind: act on WATCH lines."
- "15. Pane budgets: the orchestrator tab holds at most 2 panes (you and the watcher); a worker tab holds at most 6. A 7th agent goes to a new tab. Empty panes in team tabs are closed automatically."

Move these existing rules to `references/lessons.md` (they reference deferred features): the worktree-mirroring half of rule 4 and the stacked own-commit invariant references. Leave the decisions-file rule itself intact.

- [ ] **Step 5: `references/lessons.md` - receive the deferred rules**

Add a "Deferred features" section noting stacked branches (`stacked: true`, machete), reviewer/post-notes templates, and the `spdd`/`crit`/`tracker` overlay keys remain supported but are off the default path; the minimal run does not use them.

- [ ] **Step 6: `README.md` and `SPEC.md`**

- README: add `team-id`, `team-init`, `team-watch` to the scripts table; add a "Multiple teams" subsection (names are `<teamid>-<role>`); add a "Watcher" subsection.
- SPEC: add a short "Increment 2026-09-15" section pointing to `docs/superpowers/plans/2026-09-15-team-watcher-and-layout.md` and listing the new scripts and the budget rule. Do not rewrite the original spec body.

- [ ] **Step 7: Bump the version**

Edit `plugins/team/.claude-plugin/plugin.json`: `"version": "0.2.0"`.

- [ ] **Step 8: Run the full suite**

Run: `python3 -m unittest discover -s plugins/team/tests`
Expected: OK, pristine.

- [ ] **Step 9: (Commit boundary)** On Chebu's go:

```bash
git add plugins/team/commands plugins/team/skills plugins/team/README.md plugins/team/SPEC.md plugins/team/.claude-plugin/plugin.json
git commit -m "docs(team): wire watcher, budgets, and multi-team into commands and protocol"
```

---

## Verification (after all tasks)

- `python3 -m unittest discover -s plugins/team/tests` is green and pristine.
- One small real run in Herdr (manual, with Chebu):
  1. `/team:init APP-xxxx` - one investigator and one implementer, watcher pane appears in the orchestrator tab.
  2. Both agents spawn with `<teamid>-` names, no exit 3.
  3. The watcher reports a deliberate permission block with the dialog text; Chebu answers via the orchestrator; the agent proceeds.
  4. Reports arrive as files.
  5. A worker tab pushed to 6 panes forces the 7th agent into a new tab.
  6. An empty team pane is auto-closed; a personal pane elsewhere is untouched.
  7. A second `/team:init` on another repo spawns `<teamid2>-` agents with no collision; each watcher reacts only to its own team.
  8. `/team:release all` closes agents and stops the watcher cleanly.

## Self-review notes

- Spec coverage: decisions 1-8 each map to a task (1->T5/T6, 2->T5, 3->T4 allowlist + T6 relay, 4->T4 init, 5->T9 defer-not-delete, 6->T7/T8 budgets, 7->T7 team-tab scope, 8->T2/T3/T4 team id). The `never delete working code` reconciliation is honoured: no task deletes `team-slice` stacked support or templates.
- Placeholder scan: no TBD/TODO; every code step shows the code.
- Type/name consistency: `team-id for|slug|hash`, `team-init`, `team-watch --once/--interval`, `--into-tab`, config keys `team_id`/`orchestrator`, files `watch-state.json`/`tabs.json` are used identically across tasks.
