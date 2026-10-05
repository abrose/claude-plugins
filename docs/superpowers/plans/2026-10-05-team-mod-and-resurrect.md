# Team Mod and Resurrect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the team watcher and overview into a Claude Code mod in the orchestrator session, address every agent by Claude session id instead of herdr name, and add `/team:resurrect` so a team survives a restart.

**Architecture:** A TypeScript hooks module (`plugins/team/hooks/mod/`) loads in every session with the plugin and activates only in the session named by `orchestrator_session` in `.team/config.json`. A 15 s tick reads records, report files and `herdr agent list`, and sends REPORT and WATCH lines as one `$.prompt.submit`. Pure rules (plan parsing, watch rules, report pickup, layout rules) live in their own files and take plain data; `tick.ts` gathers the data through `$`. The bash scripts keep spawning panes and composing briefs; identity is the Claude session id, followed through `/clear` by a `SessionStart` command hook (workers) and a `session.end` mod hook (orchestrator).

**Tech Stack:** Claude Code 2.1.287 function hooks (TypeScript/TSX, `claude plugin validate`, `claude plugin test`), bash, Python 3 (`tests/test_team.py`, `unittest`), herdr CLI (`tests/fake-herdr` in bash tests).

**Spec:** `docs/superpowers/specs/2026-10-05-team-mod-and-resurrect-design.md`

## Global Constraints

- Minimum Claude Code version: `2.1.287`.
- One tick every `15000` ms drives REPORT pickup, WATCH checks and the overview refresh.
- No-report threshold: `120` s. Tab budget: `6` panes.
- Mod command names: letters, digits, `_`, `-` only. The toggle is `/team-overview`.
- Tool name: `brief_send`, listed as `mcp__team__brief_send`. Input `{ name, topic }`.
- Session index dir: `${TEAM_INDEX_DIR:-$HOME/.claude/team/sessions}`, one `<session>.json` per agent: `{ "scratch": "<abs run dir>", "name": "<agent name>" }`.
- Run dir: `${TEAM_SCRATCH:-scratchpad/current}`; team dir `<run dir>/.team`.
- No mocking library, no monkey patching. Bash tests use `tests/fake-herdr`. Mod tests answer `$` events from the in-memory world in `tests/mod/world.ts`.
- Test output must be pristine: no warnings, no stray logs. `python3 -m unittest test_team` and `claude plugin test plugins/team` both green before a task ends.
- Never commit or stage. Each task ends with a checkpoint: show Chebu the diff; Chebu commits.
- Never use the em dash in any file or message. Use `-`.
- Comments: minimal, evergreen, no ticket ids, no "new"/"improved".
- Bash follows the `writing-bash-scripts` skill; match the style of the surrounding script.

## Review Focus

1. **First activation after the upgrade, with old reports on disk:** the mod must not resend every report already in `reports/`. Expected: a missing `delivered.json` is a baseline; existing reports are marked, not sent. Test in Task 8.
2. **`/clear` of a worker right before `brief_send`:** the record's `session` may not have changed yet. Expected: the tool waits up to 10 s, then fails with `<name> was not cleared since its last brief`. Test in Task 10.
3. **herdr down for many ticks:** expected one `WATCH herdr unreachable: <reason>` until a tick succeeds, not one per tick; the pane shows the error. Test in Task 9.
4. **A record whose session is not in `herdr agent list` (worker exited or not resumed yet):** expected no crash, no pane write, state shown as `gone`, no WATCH flood. Test in Task 7.
5. **A team dir from before this change (records without `session`, `config.json` without `orchestrator_session`):** expected the mod stays inactive and the Stop hook still works by `TEAM_NAME`. Test in Task 5 and Task 2.

---

## File Structure

| Path | Responsibility |
|---|---|
| `plugins/team/hooks/mod/team.tsx` | `register`: wires events to the modules below |
| `plugins/team/hooks/mod/paths.ts` | run dir, team dir, index dir, file names |
| `plugins/team/hooks/mod/io.ts` | `readText`, `readJson`, `writeJson`, `listNames`, `mtime`, `tailText` over `$` |
| `plugins/team/hooks/mod/activation.ts` | is this session the orchestrator; follow `/clear` |
| `plugins/team/hooks/mod/plan.ts` | `parsePlan`, `fitPlan` (pure) |
| `plugins/team/hooks/mod/pane.tsx` | the `Team` pane drawing and `/team-overview` |
| `plugins/team/hooks/mod/herdr.ts` | `herdrAgents`, `herdrPanes`, `herdrDialog` over `$.process.run` |
| `plugins/team/hooks/mod/facts.ts` | gathers per-agent facts from files (report, brief, stop, transcript) |
| `plugins/team/hooks/mod/watch.ts` | WATCH rules (pure) |
| `plugins/team/hooks/mod/layout.ts` | empty-pane closes, budget and release flags (pure) |
| `plugins/team/hooks/mod/reports.ts` | report pickup and `reportLine` (pure) |
| `plugins/team/hooks/mod/tick.ts` | one tick: gather, decide, act |
| `plugins/team/hooks/mod/brief.ts` | the `brief_send` tool |
| `plugins/team/types/index.d.ts` | `PluginState` contract for `team` |
| `plugins/team/tests/mod/world.ts` | in-memory world answering the mod's `$` events |
| `plugins/team/tests/mod/*.test.ts` | mod tests |
| `plugins/team/hooks/handlers/session-start.sh` | worker follows `/clear`; marks a restored worker |
| `plugins/team/bin/team-resurrect` | relaunches restored workers with their saved flags |
| `plugins/team/commands/resurrect.md` | `/team:resurrect` |

Deleted: `bin/team-watch`, `bin/team-overview`, `bin/team-deliver`, `lib/overview.py`, and their tests.

---

### Task 0: Restart repro (manual, with Chebu)

Records what herdr does on restore. Its findings decide nothing in Tasks 1-11; they confirm Task 12's detection and tell whether the index must keep a chain of ids.

**Files:**
- Create: `scratchpad/resurrect-repro/findings.md` (gitignored)

- [ ] **Step 1: Ask Chebu to open a throwaway repo tab in herdr and start one worker by hand there:**

```bash
SID=$(python3 -c "import uuid;print(uuid.uuid4())")
TEAM_NAME=repro-w TEAM_SCRATCH=/tmp/repro claude --session-id "$SID" --name repro-w \
  --model claude-sonnet-5-5 --settings '{"crossSessionInbound":"accept"}'
echo "$SID"
```

- [ ] **Step 2: In that worker, Chebu types any prompt, then `/clear`, then another prompt. Record both session ids:**

Run (from this session): `herdr agent list | python3 -c "import sys,json;[print(a['pane_id'],a.get('agent_session',{}).get('value')) for a in json.load(sys.stdin)['result']['agents']]"`
Write the pane id and the id herdr shows after `/clear` into `findings.md`.

- [ ] **Step 3: Chebu quits herdr fully and reopens it. After the restore, record:**

1. The session id herdr shows for the pane (first or latest?).
2. The worker's command line: `ps -o args= -p $(pgrep -f "claude.*<latest id prefix>" | head -1)`.
3. Whether `TEAM_NAME` is set in the restored process: `ps eww -p <pid> | tr ' ' '\n' | grep TEAM_NAME`.
4. Whether the agent has a herdr name (`herdr agent list`, field `name`).

- [ ] **Step 4: Write `findings.md` with the four answers.** If herdr restores the **first** id (not the latest), stop and tell Chebu: the index must then map every id of a chain, which changes Task 3.

- [ ] **Step 5: Checkpoint.** Show `findings.md` to Chebu.

---

### Task 1: `team-start` assigns the session id and writes the index

**Files:**
- Modify: `plugins/team/bin/team-start`
- Modify: `plugins/team/tests/test_team.py` (class `Base.env`, class `TeamStart`)

**Interfaces:**
- Produces: record fields `session` (full uuid), `model` (e.g. `claude-sonnet-5-5`), `effort`, `mode` (`auto`|`acceptEdits`); index file `$TEAM_INDEX_DIR/<session>.json` = `{"scratch": <abs run dir>, "name": <name>}`; claude args gain `--session-id <uuid>`.

- [ ] **Step 1: Give every test its own index dir.** In `Base.env`, after `e["CLAUDE_PLUGIN_ROOT"] = ROOT`, add:

```python
        e["TEAM_INDEX_DIR"] = os.path.join(self.proj, "_index")
```

And add to `Base`:

```python
    def index_entry(self, session):
        return json.loads(read_text(os.path.join(self.proj, "_index", session + ".json")))
```

- [ ] **Step 2: Write the failing tests** in `class TeamStart`:

```python
    UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"

    def test_assigns_session_id_and_records_launch_flags(self):
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj, env_extra=self.bar_env("Opus 5.5", cwd=self.proj))
        self.assertEqual(p.returncode, 0, p.stderr)
        start = next(c for c in self.herdr_calls() if c.startswith("agent start "))
        sid = re.search(r"--session-id (%s)" % self.UUID, start).group(1)
        rec = self.team_json("scout")
        self.assertEqual(rec["session"], sid)
        self.assertEqual((rec["model"], rec["effort"], rec["mode"]),
                         ("claude-opus-5-5", "medium", "auto"))

    def test_writes_session_index_entry(self):
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj, env_extra=self.bar_env("Opus 5.5", cwd=self.proj))
        self.assertEqual(p.returncode, 0, p.stderr)
        sid = self.team_json("scout")["session"]
        entry = self.index_entry(sid)
        self.assertEqual(entry["name"], "scout")
        self.assertEqual(entry["scratch"], os.path.realpath(self.sp()))
```

- [ ] **Step 3: Run to see them fail**

Run: `cd plugins/team/tests && python3 -m unittest test_team.TeamStart.test_assigns_session_id_and_records_launch_flags test_team.TeamStart.test_writes_session_index_entry`
Expected: FAIL (`AttributeError: 'NoneType' object has no attribute 'group'`, then `KeyError: 'session'`).

- [ ] **Step 4: Implement in `bin/team-start`.**

After the `effort=` / `mode=` validation block (before `placements=0`), add:

```bash
session_id="$(python3 -c "import uuid;print(uuid.uuid4())")"
index_dir="${TEAM_INDEX_DIR:-$HOME/.claude/team/sessions}"
```

In the `--dry-run` echo and in `start()`, add `--session-id "$session_id"` right after `--- ` arguments' `--agent "team-$role"`:

```bash
  herdr agent start "$name" --kind claude --pane "$pane" --timeout 90000 -- \
    --agent "team-$role" --session-id "$session_id" --model "$model" --effort "$effort" \
    --permission-mode "$permission_mode" --name "$name" --settings '{"crossSessionInbound":"accept"}'
```

Replace the record `printf` (the line writing `"$teamdir/$name.json"`) with:

```bash
ROLE="$role" PANE="$pane" STARTED="$started" CWD_ABS="$cwd_abs" SESSION="$session_id" \
MODEL="$model" EFFORT="$effort" MODE="$permission_mode" python3 - "$teamdir/$name.json" <<'PY'
import json, os, sys
json.dump({"role": os.environ["ROLE"], "topic": "", "brief": "", "pane": os.environ["PANE"],
           "started": os.environ["STARTED"], "cwd": os.environ["CWD_ABS"],
           "session": os.environ["SESSION"], "model": os.environ["MODEL"],
           "effort": os.environ["EFFORT"], "mode": os.environ["MODE"]},
          open(sys.argv[1], "w"))
PY

mkdir -p "$index_dir"
SCRATCH="$scratch_abs" NAME="$name" python3 - "$index_dir/$session_id.json" <<'PY'
import json, os, sys
json.dump({"scratch": os.environ["SCRATCH"], "name": os.environ["NAME"]}, open(sys.argv[1], "w"))
PY
```

Replace `session=$(echo "$out" | json_get ...)` and `session="${session:0:8}"` with `session="${session_id:0:8}"`.

- [ ] **Step 5: Update the argv test helper.** In `TeamStart.start_argv`, insert `--session-id <id>` and compare with a regex. Replace `start_argv` with:

```python
    def start_argv(self, name, agent, model, effort, mode="auto"):
        return re.compile(
            r"agent start %s --kind claude --pane w1:p2 --timeout 90000 "
            r"-- --agent %s --session-id %s --model %s --effort %s --permission-mode %s "
            r"--name %s --settings \{\"crossSessionInbound\":\"accept\"\}$"
            % (name, agent, self.UUID, model, effort, mode, name))

    def assert_started(self, pattern):
        self.assertTrue(any(pattern.match(c) for c in self.herdr_calls()), self.herdr_calls())
```

Then replace every `self.assertIn(self.start_argv(...), self.herdr_calls())` in the file with `self.assert_started(self.start_argv(...))`. Find them with: `grep -n "start_argv(" plugins/team/tests/test_team.py`. Update the `--dry-run` test the same way if it asserts the exact line.

- [ ] **Step 6: Run the whole suite**

Run: `cd plugins/team/tests && python3 -m unittest test_team 2>&1 | tail -4`
Expected: `OK`, no other output.

- [ ] **Step 7: Checkpoint.** Show Chebu `git diff plugins/team/bin/team-start plugins/team/tests/test_team.py`.

---

### Task 2: Stop hook finds its agent by env, else by session id

**Files:**
- Modify: `plugins/team/hooks/handlers/stop-report.sh`
- Modify: `plugins/team/tests/test_team.py` (class `StopHook`)

**Interfaces:**
- Consumes: index entry from Task 1.
- Produces: unchanged report and stop files. The hook never forwards anything (REPORT forwarding moves to the mod in Task 8).

- [ ] **Step 1: Write the failing tests** in `class StopHook`:

```python
    def write_index(self, session, name):
        d = os.path.join(self.proj, "_index")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, session + ".json"),
                   json.dumps({"scratch": os.path.realpath(self.sp()), "name": name}))

    def test_finds_agent_by_session_id_without_team_env(self):
        self.write_record("scout", "investigator", topic="digest")
        rec = self.team_json("scout"); rec["session"] = "sid-1"
        write_text(self.sp(".team", "scout.json"), json.dumps(rec))
        self.write_index("sid-1", "scout")
        tr = self.transcript("REPORT scout digest: done")
        p = self.run_hook({"session_id": "sid-1", "transcript_path": tr, "cwd": self.proj},
                          TEAM_NAME=None, TEAM_SCRATCH=None)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("REPORT scout digest: done", read_text(self.report_path("scout", "digest")))

    def test_index_entry_for_another_session_is_ignored(self):
        self.write_record("scout", "investigator", topic="digest")
        rec = self.team_json("scout"); rec["session"] = "sid-2"
        write_text(self.sp(".team", "scout.json"), json.dumps(rec))
        self.write_index("sid-1", "scout")
        tr = self.transcript("REPORT scout digest: done")
        p = self.run_hook({"session_id": "sid-1", "transcript_path": tr, "cwd": self.proj},
                          TEAM_NAME=None, TEAM_SCRATCH=None)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(os.path.exists(self.report_path("scout", "digest")))

    def test_never_forwards_to_the_orchestrator(self):
        self.write_record("scout", "investigator", topic="digest")
        tr = self.transcript("REPORT scout digest: done")
        p = self.run_hook({"transcript_path": tr, "cwd": self.proj}, TEAM_NAME="scout")
        self.assertEqual(p.returncode, 0, p.stderr)
        time.sleep(0.3)
        self.assertFalse(any(c.startswith("agent prompt ") for c in self.herdr_calls()))
```

- [ ] **Step 2: Run to see them fail**

Run: `cd plugins/team/tests && python3 -m unittest test_team.StopHook`
Expected: the two session-id tests FAIL (no report written); `test_never_forwards_to_the_orchestrator` FAILS (a prompt is sent).

- [ ] **Step 3: Implement.** In `stop-report.sh`, replace the block from `# A team agent knows its own name from TEAM_NAME` through `except Exception:\n        sys.exit(0)` (the record load) with:

```python
    def by_env():
        name = os.environ.get("TEAM_NAME", "")
        return (name, teamdir) if name else None

    def by_session():
        sid = p.get("session_id", "")
        index = os.environ.get("TEAM_INDEX_DIR") or os.path.expanduser("~/.claude/team/sessions")
        if not re.match(r"^[A-Za-z0-9-]{1,64}$", sid):
            return None
        try:
            entry = json.load(open(os.path.join(index, sid + ".json")))
        except Exception:
            return None
        return entry.get("name", ""), os.path.join(entry.get("scratch", ""), ".team")

    found = by_env() or by_session()
    if not found:
        sys.exit(0)
    name, teamdir = found
    scratch = os.path.dirname(teamdir)
    if not re.match(r"^[a-z][a-z0-9_-]{0,31}$", name):
        sys.exit(0)
    recf = os.path.join(teamdir, name + ".json")
    try:
        rec = json.load(open(recf))
    except Exception:
        sys.exit(0)
    if not os.environ.get("TEAM_NAME") and rec.get("session") != p.get("session_id"):
        sys.exit(0)
```

Delete everything after the stop-record `json.dump(...)` (the `# Forward the worker's REPORT line` block through the `subprocess.Popen` `except`), keeping the outer `except Exception as e: log("hook error: %s" % e)`. Remove the now unused `report_line` import and `subprocess` import. Update the header comment to: `# Stop hook: if this session is a team agent, write its latest message to a\n# report file and record the stop. The orchestrator's mod picks the report up.`

- [ ] **Step 4: Delete the forwarding tests** that no longer apply: `test_identifies_by_team_name_env_and_pings`, `test_forwards_report_line`, `test_holds_report_until_orchestrator_draft_clears`, `test_stop_does_not_wait_for_the_draft`, `test_forwards_report_line_after_status_bar`, `test_no_self_ping_when_name_is_orchestrator`. In `test_reports_after_agent_moves_its_cwd` and `test_forwards_last_message_the_transcript_does_not_hold_yet`, drop the `wait_for_calls` / `agent prompt` assertions and keep the report-file assertions.

- [ ] **Step 5: Run the whole suite**

Run: `cd plugins/team/tests && python3 -m unittest test_team 2>&1 | tail -4`
Expected: `OK`.

- [ ] **Step 6: Checkpoint.** Show Chebu the diff.

---

### Task 3: Workers follow `/clear`; a restored worker is marked

**Files:**
- Create: `plugins/team/hooks/handlers/session-start.sh`
- Modify: `plugins/team/hooks/hooks.json`
- Modify: `plugins/team/tests/test_team.py` (new class `SessionStartHook`)

**Interfaces:**
- Consumes: record `session`, index from Task 1.
- Produces: on `source: clear` with `TEAM_NAME`: record `session` = payload `session_id`, new index file, old index file removed. On `source: resume` without `TEAM_NAME` but with an index entry whose record `session` matches: file `<team dir>/restored/<name>` (empty). Task 12 reads it.

- [ ] **Step 1: Write the failing tests**

```python
class SessionStartHook(Base):
    HOOK = os.path.join(ROOT, "hooks", "handlers", "session-start.sh")

    def run_hook(self, payload, **env_extra):
        return subprocess.run(["bash", self.HOOK], input=json.dumps(payload),
                              capture_output=True, text=True, env=self.env(**env_extra), cwd=self.proj)

    def setup_worker(self, session):
        self.write_record("scout", "investigator", topic="digest")
        rec = self.team_json("scout"); rec["session"] = session
        write_text(self.sp(".team", "scout.json"), json.dumps(rec))
        d = os.path.join(self.proj, "_index"); os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, session + ".json"),
                   json.dumps({"scratch": os.path.realpath(self.sp()), "name": "scout"}))

    def test_clear_moves_identity_to_the_new_session(self):
        self.setup_worker("old-1")
        p = self.run_hook({"session_id": "new-2", "source": "clear", "cwd": self.proj},
                          TEAM_NAME="scout")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(self.team_json("scout")["session"], "new-2")
        self.assertEqual(self.index_entry("new-2")["name"], "scout")
        self.assertFalse(os.path.exists(os.path.join(self.proj, "_index", "old-1.json")))

    def test_clear_without_team_name_changes_nothing(self):
        self.setup_worker("old-1")
        p = self.run_hook({"session_id": "new-2", "source": "clear", "cwd": self.proj},
                          TEAM_NAME=None, TEAM_SCRATCH=None)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(self.team_json("scout")["session"], "old-1")

    def test_resume_without_team_env_marks_restored_worker(self):
        self.setup_worker("old-1")
        p = self.run_hook({"session_id": "old-1", "source": "resume", "cwd": self.proj},
                          TEAM_NAME=None, TEAM_SCRATCH=None)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.sp(".team", "restored", "scout")))

    def test_resume_with_team_env_is_not_marked(self):
        self.setup_worker("old-1")
        p = self.run_hook({"session_id": "old-1", "source": "resume", "cwd": self.proj},
                          TEAM_NAME="scout")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(os.path.exists(self.sp(".team", "restored", "scout")))

    def test_unrelated_session_is_silent(self):
        p = self.run_hook({"session_id": "x", "source": "startup", "cwd": self.proj},
                          TEAM_NAME=None, TEAM_SCRATCH=None)
        self.assertEqual((p.returncode, p.stdout, p.stderr), (0, "", ""))
```

- [ ] **Step 2: Run to see them fail**

Run: `cd plugins/team/tests && python3 -m unittest test_team.SessionStartHook`
Expected: FAIL (`No such file or directory` for the hook).

- [ ] **Step 3: Implement `hooks/handlers/session-start.sh`**

```bash
#!/usr/bin/env bash
# SessionStart hook: a team worker keeps its identity across /clear, and a
# worker restored without its team env is marked for /team:resurrect. Runs in
# every session, so it stays silent and cheap when it does not apply.
set -uo pipefail

PAYLOAD="$(cat)" python3 - <<'PY' || true
import json, os, re

p = json.loads(os.environ["PAYLOAD"])
sid, source = p.get("session_id", ""), p.get("source", "")
index = os.environ.get("TEAM_INDEX_DIR") or os.path.expanduser("~/.claude/team/sessions")
if not re.match(r"^[A-Za-z0-9-]{1,64}$", sid):
    raise SystemExit(0)

def load(path):
    try:
        return json.load(open(path))
    except Exception:
        return None

def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(data, open(path, "w"))

name = os.environ.get("TEAM_NAME", "")
if source == "clear" and re.match(r"^[a-z][a-z0-9_-]{0,31}$", name):
    scratch = os.path.realpath(os.environ.get("TEAM_SCRATCH", "scratchpad/current"))
    recf = os.path.join(scratch, ".team", name + ".json")
    rec = load(recf)
    if rec is None:
        raise SystemExit(0)
    old = rec.get("session", "")
    rec["session"] = sid
    save(recf, rec)
    save(os.path.join(index, sid + ".json"), {"scratch": scratch, "name": name})
    if old and old != sid:
        try:
            os.remove(os.path.join(index, old + ".json"))
        except OSError:
            pass
elif source == "resume" and not name:
    entry = load(os.path.join(index, sid + ".json"))
    if entry and re.match(r"^[a-z][a-z0-9_-]{0,31}$", entry.get("name", "")):
        teamdir = os.path.join(entry.get("scratch", ""), ".team")
        rec = load(os.path.join(teamdir, entry["name"] + ".json"))
        if rec and rec.get("session") == sid:
            os.makedirs(os.path.join(teamdir, "restored"), exist_ok=True)
            open(os.path.join(teamdir, "restored", entry["name"]), "w").close()
PY

exit 0
```

Make it executable: `chmod +x plugins/team/hooks/handlers/session-start.sh`.

- [ ] **Step 4: Register it in `hooks/hooks.json`**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/handlers/session-start.sh\""
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/handlers/stop-report.sh\""
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 5: Run the whole suite**

Run: `cd plugins/team/tests && python3 -m unittest test_team 2>&1 | tail -4`
Expected: `OK`.

- [ ] **Step 6: Checkpoint.** Show Chebu the diff.

---

### Task 4: `team-init` writes `orchestrator_session`, checks the version, prunes the index

**Files:**
- Modify: `plugins/team/bin/team-init`
- Modify: `plugins/team/tests/test_team.py` (class for `team-init`; find it with `grep -n "class .*Init" plugins/team/tests/test_team.py`)
- Create: `plugins/team/tests/fake-claude`

**Interfaces:**
- Consumes: `TEAM_SESSION_ID` (set by the mod, Task 5); `claude --version` output `X.Y.Z (Claude Code)`.
- Produces: `config.json` gains `"orchestrator_session": "<id>"`. No `herdr agent rename`. Exit 1 with a message when `TEAM_SESSION_ID` is unset or the version is below `2.1.287`.

- [ ] **Step 1: Add a fake `claude` binary** `tests/fake-claude`:

```bash
#!/usr/bin/env bash
# Test double for the claude CLI: answers --version from $FAKE_CLAUDE_VERSION.
set -euo pipefail
[ "${1:-}" = "--version" ] || { echo "fake-claude: only --version" >&2; exit 2; }
echo "${FAKE_CLAUDE_VERSION:-2.1.287} (Claude Code)"
```

`chmod +x plugins/team/tests/fake-claude`. In `Base.setUp`, add the symlink: `os.symlink(os.path.join(HERE, "fake-claude"), os.path.join(self.shim, "claude"))`. In `Base.env`, add `e["TEAM_SESSION_ID"] = "orch-sid"`.

- [ ] **Step 2: Write the failing tests** in the `team-init` test class:

```python
    def test_records_orchestrator_session(self):
        p = self.run_script("team-init", "APP-1")
        self.assertEqual(p.returncode, 0, p.stderr)
        cfg = json.loads(read_text(self.sp(".team", "config.json")))
        self.assertEqual(cfg["orchestrator_session"], "orch-sid")

    def test_refuses_without_session_id(self):
        p = self.run_script("team-init", "APP-1", env_extra={"TEAM_SESSION_ID": None})
        self.assertEqual(p.returncode, 1)
        self.assertIn("TEAM_SESSION_ID is unset", p.stderr)

    def test_refuses_old_claude_code(self):
        p = self.run_script("team-init", "APP-1", env_extra={"FAKE_CLAUDE_VERSION": "2.1.286"})
        self.assertEqual(p.returncode, 1)
        self.assertIn("Claude Code 2.1.286 is older than 2.1.287", p.stderr)

    def test_does_not_rename_the_orchestrator(self):
        p = self.run_script("team-init", "APP-1", "--orchestrator-pane", "w1:p1")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(any(c.startswith("agent rename") for c in self.herdr_calls()))

    def test_prunes_index_entries_without_a_matching_record(self):
        idx = os.path.join(self.proj, "_index"); os.makedirs(idx)
        write_text(os.path.join(idx, "gone.json"),
                   json.dumps({"scratch": os.path.join(self.proj, "nowhere"), "name": "x"}))
        p = self.run_script("team-init", "APP-1")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(os.path.exists(os.path.join(idx, "gone.json")))
```

Delete any existing test asserting `agent rename` happens (find with `grep -n "agent rename" plugins/team/tests/test_team.py`).

- [ ] **Step 3: Run to see them fail**

Run: `cd plugins/team/tests && python3 -m unittest test_team -k orchestrator_session -k without_session_id -k old_claude_code -k rename -k prunes`
Expected: FAIL.

- [ ] **Step 4: Implement in `bin/team-init`.** Right after argument parsing (after the `while` loop), add:

```bash
[ -n "${TEAM_SESSION_ID:-}" ] || {
  echo "TEAM_SESSION_ID is unset: the team mod did not load in this session (Claude Code too old, or the team plugin disabled)" >&2
  exit 1
}
min_version="2.1.287"
found_version="$(claude --version 2>/dev/null | awk '{print $1}')"
FOUND="$found_version" MIN="$min_version" python3 -c "
import os, sys
v = lambda s: tuple(int(x) for x in s.split('.'))
try:
    sys.exit(0 if v(os.environ['FOUND']) >= v(os.environ['MIN']) else 1)
except ValueError:
    sys.exit(1)
" || { echo "Claude Code ${found_version:-unknown} is older than $min_version" >&2; exit 1; }
```

Delete the `herdr agent rename` block (the `if [ -n "$orch_pane" ]; then herdr agent rename ...` block and its comment). Keep `orch="${team_id}-orch"` (still the orchestrator's display name in briefs).

Change the config write to include the session:

```bash
TICKET="$ticket" TEAM_ID="$team_id" ORCH="$orch" python3 - "$teamdir/config.json" <<'PY'
import os, json, sys
json.dump({"team_id": os.environ["TEAM_ID"], "ticket": os.environ["TICKET"],
           "orchestrator": os.environ["ORCH"],
           "orchestrator_session": os.environ["TEAM_SESSION_ID"]}, open(sys.argv[1], "w"))
PY
```

Before `echo "team_id=..."`, add the prune:

```bash
INDEX="${TEAM_INDEX_DIR:-$HOME/.claude/team/sessions}" python3 - <<'PY'
import glob, json, os
for f in glob.glob(os.path.join(os.environ["INDEX"], "*.json")):
    sid = os.path.splitext(os.path.basename(f))[0]
    try:
        e = json.load(open(f))
        rec = json.load(open(os.path.join(e["scratch"], ".team", e["name"] + ".json")))
        keep = rec.get("session") == sid
    except Exception:
        keep = False
    if not keep:
        os.remove(f)
PY
```

- [ ] **Step 5: Run the whole suite**

Run: `cd plugins/team/tests && python3 -m unittest test_team 2>&1 | tail -4`
Expected: `OK`.

- [ ] **Step 6: Checkpoint.** Show Chebu the diff.

---

### Task 5: Mod scaffold, test world, activation, following the orchestrator's `/clear`

**Files:**
- Modify: `plugins/team/hooks/hooks.json` (add `modules`)
- Modify: `plugins/team/.claude-plugin/plugin.json` (add `"types"`)
- Create: `plugins/team/types/index.d.ts`
- Create: `plugins/team/hooks/mod/team.tsx`, `paths.ts`, `io.ts`, `activation.ts`
- Create: `plugins/team/tests/mod/world.ts`, `plugins/team/tests/mod/activation.test.ts`

**Interfaces:**
- Produces:
  - `paths.ts`: `runDir($): Promise<string>` (abs), `teamDir($)`, `CONFIG = 'config.json'`.
  - `io.ts`: `readText($, path): Promise<string | null>`, `readJson<T>($, path): Promise<T | null>`, `writeJson($, path, value): Promise<void>`, `listNames($, dir): Promise<string[]>`, `mtime($, path): Promise<number | null>`, `tailText($, path, bytes): Promise<string>`.
  - `activation.ts`: `type TeamConfig = { team_id: string; ticket: string; orchestrator: string; orchestrator_session?: string }`; `activeConfig($): Promise<TeamConfig | null>`; `noteClear(oldId: string): void`; `followClear($): Promise<void>`.
  - `team.tsx`: on `session.start` sets env `TEAM_SESSION_ID`, starts `$.clock.every(15000, tick)`.
  - State `team.active: boolean`.
  - `world.ts`: `world(on): Promise<World>` (see code).

- [ ] **Step 1: Prove the manifest takes both command hooks and a module.** Add `"modules": ["./mod/team.tsx"]` to `hooks/hooks.json` next to `"hooks"`, create `hooks/mod/team.tsx` with `export const register = () => {}`, then run:

Run: `claude plugin validate plugins/team`
Expected: `✔ Validation passed` listing `./mod/team.tsx`. If it refuses the mix of `hooks` and `modules`, STOP and tell Chebu: the mod then needs its own plugin folder, which changes the delivery.

- [ ] **Step 2: Write the state contract** `plugins/team/types/index.d.ts`:

```ts
export type TeamAgentRow = { name: string; state: string; pane: string }
export type TeamPlanItem = { mark: 'x' | '>' | ' '; text: string }
export type TeamPlan = {
  title: string
  done: TeamPlanItem[]
  running: TeamPlanItem[]
  next: TeamPlanItem[]
}

declare module 'claude-code' {
  interface PluginState {
    team: {
      active: boolean
      agents: TeamAgentRow[]
      plan: TeamPlan | null
      planPath: string
      tickAt: string
      error: string
    }
  }
}
```

Add `"types": "./types/index.d.ts"` to `plugins/team/.claude-plugin/plugin.json`.

- [ ] **Step 3: Write the test world** `tests/mod/world.ts`:

```ts
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

export type HerdrAgent = {
  pane_id: string
  tab_id?: string
  agent_status: string
  agent_session?: { value: string }
  name?: string
}
export type HerdrPane = { pane_id: string; tab_id: string; agent_status: string }

export type World = {
  cwd: string
  team: string
  files: Map<string, { text: string; mtimeMs: number }>
  agents: HerdrAgent[]
  panes: HerdrPane[]
  herdrFails: string | null
  runs: string[][]
  submits: string[]
  sends: { to: unknown; text: string }[]
  env: Map<string, string>
  opened: string[]
  closed: string[]
  clock: ReturnType<typeof mock.clock>
  write: (path: string, text: string, mtimeMs?: number) => void
  writeJson: (path: string, value: unknown, mtimeMs?: number) => void
  json: (path: string) => any
}

export const CWD = '/proj'

export function world(on: On): World {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const w: World = {
    cwd: CWD,
    team: `${CWD}/scratchpad/current/.team`,
    files: new Map(),
    agents: [],
    panes: [],
    herdrFails: null,
    runs: [],
    submits: [],
    sends: [],
    env: new Map(),
    opened: [],
    closed: [],
    clock,
    write: (path, text, mtimeMs) => w.files.set(path, { text, mtimeMs: mtimeMs ?? clock.now }),
    writeJson: (path, value, mtimeMs) => w.write(path, JSON.stringify(value), mtimeMs),
    json: path => JSON.parse(w.files.get(path)!.text),
  }

  on('fs.read', ($, e) => {
    const f = w.files.get(e.path)
    return f ? { value: f.text } : { deny: `ENOENT: ${e.path}` }
  })
  on('fs.write', ($, e) => {
    w.write(e.path, e.text)
    return { value: undefined }
  })
  on('fs.exists', ($, e) => ({ value: w.files.has(e.path) }))
  on('fs.stat', ($, e) => {
    const f = w.files.get(e.path)
    return f
      ? { value: { kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: false } }
      : { deny: `ENOENT: ${e.path}` }
  })
  on('fs.list', ($, e) => {
    const prefix = e.path.endsWith('/') ? e.path : `${e.path}/`
    const names = new Set<string>()
    for (const p of w.files.keys()) {
      if (p.startsWith(prefix)) names.add(p.slice(prefix.length).split('/')[0])
    }
    return {
      value: [...names].map(name => {
        const f = w.files.get(prefix + name)
        return f
          ? { name, kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: false }
          : { name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false }
      }),
    }
  })
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    w.runs.push(argv)
    const out = (stdout: string, exitCode = 0, stderr = '') => ({
      value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (argv[0] === 'tail') return out(w.files.get(argv[argv.length - 1])?.text ?? '')
    if (argv[0].endsWith('/bin/team-brief')) {
      return out(`Read scratchpad/current/brief-${argv[2]}-${argv[4]}.md and execute it fully.\n`)
    }
    if (w.herdrFails) return out('', 1, w.herdrFails)
    const sub = argv.slice(1, 3).join(' ')
    if (sub === 'agent list') return out(JSON.stringify({ result: { agents: w.agents } }))
    if (sub === 'pane list') return out(JSON.stringify({ result: { panes: w.panes } }))
    if (sub === 'agent read') return out('Allow Bash(rm -rf build)? [y/n]\n')
    return out('{"result":{"ok":true}}')
  })
  on('env.get', ($, e) => ({ value: w.env.get(e.name) }))
  on('env.set', ($, e) => {
    if (e.value === undefined) w.env.delete(e.name)
    else w.env.set(e.name, e.value)
    return { value: undefined }
  })
  on('prompt.submit', ($, e) => {
    w.submits.push(e.text)
    return { text: e.text }
  })
  on('session.send', ($, e) => {
    w.sends.push({ to: e.to, text: e.text })
    return { isDelivered: true }
  })
  on('ui.open', ($, e) => {
    w.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    w.closed.push(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [...new Set(w.opened)]
      .filter(id => w.opened.lastIndexOf(id) > w.closed.lastIndexOf(id))
      .map(id => ({ id, title: 'Team', isShown: true, isFocused: false, isPlaced: true })),
  }))
  return w
}
```

Note: `prompt.submit` and `session.send` are chain events, not op events, so the world answers with the event's own result (`PromptSubmitResult` `{ text }`, `SessionSendResult` `{ isDelivered }`), not `{ value }`.

- [ ] **Step 4: Write the failing tests** `tests/mod/activation.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'
import { CWD, world } from './world'

const start = ($: any) => $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })

describe('activation', () => {
  test('sets TEAM_SESSION_ID on session start', async ($, on) => {
    const w = world(on)
    await start($)
    expect(w.env.get('TEAM_SESSION_ID')).toBe(await $.session.id())
  })

  test('stays inactive without a team config', async ($, on) => {
    const w = world(on)
    await start($)
    await w.clock.advance(15000)
    expect(await $.state.get({ plugin: 'team', key: 'active' })).toMatchObject({ value: false })
    expect(w.opened).toEqual([])
  })

  test('stays inactive for a config without orchestrator_session', async ($, on) => {
    const w = world(on)
    w.writeJson(`${w.team}/config.json`, { team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch' })
    await start($)
    await w.clock.advance(15000)
    expect(w.opened).toEqual([])
  })

  test('activates when orchestrator_session is this session', async ($, on) => {
    const w = world(on)
    await start($)
    w.writeJson(`${w.team}/config.json`, {
      team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch',
      orchestrator_session: await $.session.id(),
    })
    await w.clock.advance(15000)
    expect(await $.state.get({ plugin: 'team', key: 'active' })).toMatchObject({ value: true })
  })

  test('follows its own /clear', async ($, on) => {
    const w = world(on)
    await start($)
    w.writeJson(`${w.team}/config.json`, {
      team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch', orchestrator_session: 'old-id',
    })
    await $.session.end({ reason: 'clear', sessionId: 'old-id', resume: { id: '' } } as never)
    await w.clock.advance(15000)
    const id = await $.session.id()
    expect(w.json(`${w.team}/config.json`).orchestrator_session).toBe(id)
    expect(w.env.get('TEAM_SESSION_ID')).toBe(id)
  })

  test('ignores a /clear of another session', async ($, on) => {
    const w = world(on)
    await start($)
    w.writeJson(`${w.team}/config.json`, {
      team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch', orchestrator_session: 'other',
    })
    await $.session.end({ reason: 'clear', sessionId: 'old-id', resume: { id: '' } } as never)
    await w.clock.advance(15000)
    expect(w.json(`${w.team}/config.json`).orchestrator_session).toBe('other')
  })
})
```

The world serves `/proj` paths, so the mod must take the run dir from the `cwd` it is started with. `paths.ts` reads it from `session.start`'s `e.cwd`, which the test passes.

- [ ] **Step 5: Run to see them fail**

Run: `claude plugin test plugins/team`
Expected: FAIL (`TEAM_SESSION_ID` undefined; `active` unset).

- [ ] **Step 6: Implement.**

`hooks/mod/paths.ts`:

```ts
import type { EngineInterface } from 'claude-code'

let sessionCwd = ''

export const setCwd = (cwd: string) => {
  sessionCwd = cwd
}

export async function runDir($: EngineInterface): Promise<string> {
  const scratch = (await $.env.get('TEAM_SCRATCH')) ?? 'scratchpad/current'
  return scratch.startsWith('/') ? scratch : `${sessionCwd}/${scratch}`
}

export async function teamDir($: EngineInterface): Promise<string> {
  return `${await runDir($)}/.team`
}
```

`hooks/mod/io.ts`:

```ts
import type { EngineInterface } from 'claude-code'

export async function readText($: EngineInterface, path: string): Promise<string | null> {
  try {
    const text = await $.fs.read(path)
    return typeof text === 'string' ? text : null
  } catch {
    return null
  }
}

export async function readJson<T>($: EngineInterface, path: string): Promise<T | null> {
  const text = await readText($, path)
  if (text === null) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

export async function writeJson($: EngineInterface, path: string, value: unknown): Promise<void> {
  await $.fs.write(path, JSON.stringify(value))
}

export async function listNames($: EngineInterface, dir: string): Promise<string[]> {
  try {
    return (await $.fs.list(dir)).map(e => e.name)
  } catch {
    return []
  }
}

export async function mtime($: EngineInterface, path: string): Promise<number | null> {
  try {
    return (await $.fs.stat(path)).mtimeMs
  } catch {
    return null
  }
}

export async function tailText($: EngineInterface, path: string, bytes: number): Promise<string> {
  const r = await $.process.run(['tail', '-c', String(bytes), path])
  return r.exitCode === 0 ? r.stdout : ''
}
```

`hooks/mod/activation.ts`:

```ts
import type { EngineInterface } from 'claude-code'
import { readJson, writeJson } from './io'
import { teamDir } from './paths'

export type TeamConfig = {
  team_id: string
  ticket: string
  orchestrator: string
  orchestrator_session?: string
}

let clearedFrom: string | null = null

export const noteClear = (oldId: string) => {
  clearedFrom = oldId
}

export async function followClear($: EngineInterface): Promise<void> {
  if (clearedFrom === null) return
  const old = clearedFrom
  clearedFrom = null
  const path = `${await teamDir($)}/config.json`
  const cfg = await readJson<TeamConfig>($, path)
  const id = await $.session.id()
  await $.env.set('TEAM_SESSION_ID', id)
  if (cfg && cfg.orchestrator_session === old && old !== id) {
    await writeJson($, path, { ...cfg, orchestrator_session: id })
  }
}

export async function activeConfig($: EngineInterface): Promise<TeamConfig | null> {
  const cfg = await readJson<TeamConfig>($, `${await teamDir($)}/config.json`)
  if (!cfg?.orchestrator_session) return null
  return cfg.orchestrator_session === (await $.session.id()) ? cfg : null
}
```

`hooks/mod/team.tsx`:

```tsx
import { atom, update } from 'claude-code'
import type { Register } from 'claude-code'
import { activeConfig, followClear, noteClear } from './activation'
import { setCwd } from './paths'

export const TICK_MS = 15000
const active = atom({ plugin: 'team', key: 'active' } as const, false)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    setCwd(e.cwd)
    await $.env.set('TEAM_SESSION_ID', await $.session.id())
    $.clock.every(TICK_MS, async () => {
      await followClear($)
      const cfg = await activeConfig($)
      await update($, active, () => cfg !== null)
    })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') noteClear(e.sessionId)
    return next(e)
  })
}
```

- [ ] **Step 7: Run the tests**

Run: `claude plugin test plugins/team`
Expected: all `activation` tests PASS, no other output.

- [ ] **Step 8: Validate and type-check**

Run: `claude plugin validate plugins/team && tsc -p plugins/team`
Expected: validation passes; `tsc` prints nothing. (`.claude-plugin/types/tsconfig.json` is laid when the engine loads the mod; if `tsc -p` finds no `tsconfig.json`, create `plugins/team/tsconfig.json` with `{ "extends": "./.claude-plugin/types/tsconfig.json", "include": ["hooks/mod", "types", "tests/mod"] }` after one `claude --plugin-dir plugins/team -p "hi"` run lays the types.)

- [ ] **Step 9: Checkpoint.** Show Chebu the diff.

---

### Task 6: Plan parsing, the `Team` pane, `/team-overview`

**Files:**
- Create: `plugins/team/hooks/mod/plan.ts`, `plugins/team/hooks/mod/pane.tsx`
- Modify: `plugins/team/hooks/mod/team.tsx`
- Create: `plugins/team/tests/mod/plan.test.ts`, `plugins/team/tests/mod/pane.test.ts`

**Interfaces:**
- Consumes: `activeConfig`, state atoms from Task 5.
- Produces:
  - `plan.ts`: `parsePlan(text: string): TeamPlan`; `fitPlan(plan: TeamPlan, rows: number): { plan: TeamPlan; hiddenDone: number }`.
  - `pane.tsx`: `PANE = 'team-overview'`; `showPane($, teamId): Promise<void>` (opens unless hidden); `registerPane(on)`; store key `overviewHidden:<team_id>`.
  - On activation (inactive -> active), `team.tsx` calls `showPane`.

- [ ] **Step 1: Write the failing unit tests** `tests/mod/plan.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'
import { fitPlan, parsePlan } from '../../hooks/mod/plan'

const TEXT = `# APP-1

## DONE
- [x] 1. Analysis - app-1-inv
- [x] 2. Design reviewed

## RUNNING
- [>] 3. Implementation - app-1-impl

## Notes
- [ ] not an item, wrong section

## NEXT
* [ ] 4. Gate
`

describe('parsePlan', () => {
  test('reads title and items per section', () => {
    expect(parsePlan(TEXT)).toEqual({
      title: 'APP-1',
      done: [{ mark: 'x', text: '1. Analysis - app-1-inv' }, { mark: 'x', text: '2. Design reviewed' }],
      running: [{ mark: '>', text: '3. Implementation - app-1-impl' }],
      next: [{ mark: ' ', text: '4. Gate' }],
    })
  })

  test('matches headings in any case and an upper-case X', () => {
    expect(parsePlan('## done\n- [X] a\n').done).toEqual([{ mark: 'x', text: 'a' }])
  })
})

describe('fitPlan', () => {
  test('drops the oldest DONE items first', () => {
    const fitted = fitPlan(parsePlan(TEXT), 5)
    expect(fitted.plan.done).toEqual([{ mark: 'x', text: '2. Design reviewed' }])
    expect(fitted.hiddenDone).toBe(1)
    expect(fitted.plan.running).toHaveLength(1)
  })
})
```

`fitPlan(plan, rows)`: `rows` is the room for item lines; the three section headings are not counted. RUNNING and NEXT are never dropped.

- [ ] **Step 2: Write the failing pane tests** `tests/mod/pane.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'
import { CWD, world } from './world'

async function activeTeam($: any, on: any) {
  const w = world(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  w.writeJson(`${w.team}/config.json`, {
    team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch',
    orchestrator_session: await $.session.id(),
  })
  w.write(`${CWD}/scratchpad/current/progress-APP-1.md`, '# APP-1\n\n## RUNNING\n- [>] 3. Build\n')
  await w.clock.advance(15000)
  return w
}

describe('Team pane', () => {
  test('opens on activation', async ($, on) => {
    const w = await activeTeam($, on)
    expect(w.opened).toEqual(['team-overview'])
  })

  test('draws plan items as glyph rows, not markdown', async ($, on) => {
    await activeTeam($, on)
    const ui = await $.ui.mount({ plugin: 'team', surface: 'terminal', component: 'Pane',
                                  requestId: 'team-overview', props: { bodyColumns: 60 } } as never)
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /▶ 3\. Build/ }))?.text).toContain('3. Build')
  })

  test('/team-overview hides and shows, and hiding survives a restart', async ($, on) => {
    const w = await activeTeam($, on)
    expect((await $.command.run({ command: 'team-overview' })).text).toBe('Team overview hidden.')
    expect(w.closed).toEqual(['team-overview'])
    expect(await $.store.get('overviewHidden:app-1')).toBe(true)
    expect((await $.command.run({ command: 'team-overview' })).text).toBe('Team overview shown.')
    expect(await $.store.get('overviewHidden:app-1')).toBe(false)
  })

  test('closing the pane by hand counts as hiding', async ($, on) => {
    await activeTeam($, on)
    await $.ui.close({ id: 'team-overview', origin: 'person' } as never)
    expect(await $.store.get('overviewHidden:app-1')).toBe(true)
  })
})
```

- [ ] **Step 3: Run to see them fail**

Run: `claude plugin test plugins/team`
Expected: FAIL (`plan` module missing; pane never opened).

- [ ] **Step 4: Implement `hooks/mod/plan.ts`**

```ts
import type { TeamPlan, TeamPlanItem } from '../../types'

const ITEM = /^\s*[-*]\s+\[([xX> ])\]\s*(.*?)\s*$/
const SECTIONS = { DONE: 'done', RUNNING: 'running', NEXT: 'next' } as const

export function parsePlan(text: string): TeamPlan {
  const plan: TeamPlan = { title: '', done: [], running: [], next: [] }
  let section: TeamPlanItem[] | null = null
  for (const line of text.split('\n')) {
    if (line.startsWith('# ') && !plan.title) {
      plan.title = line.slice(2).trim()
    } else if (line.startsWith('## ')) {
      const key = SECTIONS[line.slice(3).trim().toUpperCase() as keyof typeof SECTIONS]
      section = key ? plan[key] : null
    } else {
      const m = ITEM.exec(line)
      if (m && section) section.push({ mark: m[1].toLowerCase() as TeamPlanItem['mark'], text: m[2] })
    }
  }
  return plan
}

export function fitPlan(plan: TeamPlan, rows: number): { plan: TeamPlan; hiddenDone: number } {
  const room = Math.max(rows - plan.running.length - plan.next.length, 0)
  const done = plan.done.slice(Math.max(plan.done.length - room, 0))
  return { plan: { ...plan, done }, hiddenDone: plan.done.length - done.length }
}
```

- [ ] **Step 5: Implement `hooks/mod/pane.tsx`**

```tsx
import { atom, read } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'
import type { TeamAgentRow, TeamPlan, TeamPlanItem } from '../../types'
import { activeConfig } from './activation'
import { fitPlan } from './plan'

export const PANE = 'team-overview'
export const agents = atom({ plugin: 'team', key: 'agents' } as const, [] as TeamAgentRow[])
export const plan = atom({ plugin: 'team', key: 'plan' } as const, null as TeamPlan | null)
export const planPath = atom({ plugin: 'team', key: 'planPath' } as const, '')
export const tickAt = atom({ plugin: 'team', key: 'tickAt' } as const, '')
export const error = atom({ plugin: 'team', key: 'error' } as const, '')

const MARK = {
  x: { glyph: '✓', color: 'green', dim: true },
  '>': { glyph: '▶', color: 'yellow', dim: false },
  ' ': { glyph: '○', color: undefined, dim: false },
} as const

const hiddenKey = (teamId: string) => `overviewHidden:${teamId}`

export async function showPane($: EngineInterface, teamId: string): Promise<void> {
  if ((await $.store.get(hiddenKey(teamId))) === true) return
  await $.ui.open({ id: PANE, title: 'Team' })
}

export function registerPane(on: On): void {
  on('command.run', { command: 'team-overview' }, async $ => {
    const cfg = await activeConfig($)
    if (!cfg) return { text: 'No team run in this session.' }
    const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
    if (isOpen) {
      await $.ui.close({ id: PANE })
      await $.store.set(hiddenKey(cfg.team_id), true)
      return { text: 'Team overview hidden.' }
    }
    await $.store.set(hiddenKey(cfg.team_id), false)
    await $.ui.open({ id: PANE, title: 'Team' })
    return { text: 'Team overview shown.' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const done = await next(e)
    if (e.origin === 'person') {
      const cfg = await activeConfig($)
      if (cfg) await $.store.set(hiddenKey(cfg.team_id), true)
    }
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const rows = await read($, agents)
    const full = await read($, plan)
    const path = await read($, planPath)
    const at = await read($, tickAt)
    const err = await read($, error)
    const room = Math.max((e.viewport?.rows ?? 30) - rows.length - 12, 3)
    const fitted = full ? fitPlan(full, room) : null
    const item = (i: TeamPlanItem) => (
      <Text wrap="truncate-end" dimColor={MARK[i.mark].dim}>
        {' '}
        <Text color={MARK[i.mark].color}>{MARK[i.mark].glyph}</Text> {i.text}
      </Text>
    )
    const section = (title: string, items: TeamPlanItem[]) => (
      <Box flexDirection="column">
        <Text dimColor>{title}</Text>
        {items.length === 0 ? <Text dimColor> -</Text> : items.map(item)}
      </Box>
    )
    return (
      <Box flexDirection="column">
        {fitted ? (
          <Box flexDirection="column">
            <Text bold wrap="truncate-end">{fitted.plan.title || 'Plan'}</Text>
            {section(fitted.hiddenDone ? `DONE (+${fitted.hiddenDone} earlier)` : 'DONE', fitted.plan.done)}
            {section('RUNNING', fitted.plan.running)}
            {section('NEXT', fitted.plan.next)}
          </Box>
        ) : (
          <Text dimColor wrap="truncate-end">no plan yet: {path}</Text>
        )}
        <Text> </Text>
        <Text bold>Agents</Text>
        {rows.length === 0 && <Text dimColor> (none)</Text>}
        {rows.map(a => (
          <Text wrap="truncate-end">
            {' '}{a.state.padEnd(8)} {a.name} <Text dimColor>{a.pane}</Text>
          </Text>
        ))}
        {err !== '' && <Text color="red" wrap="truncate-end">{err}</Text>}
        <Text dimColor>tick {at || '-'}</Text>
      </Box>
    )
  })
}
```

- [ ] **Step 6: Wire it into `team.tsx`.** Add imports `import { parsePlan } from './plan'`, `import { plan, planPath, registerPane, showPane, tickAt } from './pane'`, `import { readText } from './io'`, `import { runDir } from './paths'`. In `register`, call `registerPane(on)` first. In `session.start`, register the command before starting the timer:

```tsx
    await $.command.register({ name: 'team-overview', description: 'Show or hide the team overview pane' })
```

Replace the timer body with:

```tsx
    $.clock.every(TICK_MS, async () => {
      await followClear($)
      const cfg = await activeConfig($)
      const was = (await $.state.get({ plugin: 'team', key: 'active' })).value === true
      await update($, active, () => cfg !== null)
      if (!cfg) return
      if (!was) await showPane($, cfg.team_id)
      const path = `${await runDir($)}/progress-${cfg.ticket}.md`
      const text = await readText($, path)
      const at = new Date(await $.clock.now()).toISOString().slice(11, 19)
      await update($, planPath, () => path)
      await update($, plan, () => (text === null ? null : parsePlan(text)))
      await update($, tickAt, () => at)
    })
```

- [ ] **Step 7: Run the tests**

Run: `claude plugin test plugins/team`
Expected: PASS, no other output.

- [ ] **Step 8: Validate and type-check**

Run: `claude plugin validate plugins/team && tsc -p plugins/team`
Expected: pass, no output from `tsc`.

- [ ] **Step 9: Checkpoint.** Show Chebu the diff.

---

### Task 7: herdr adapter, agent rows, pane-id healing

**Files:**
- Create: `plugins/team/hooks/mod/herdr.ts`, `plugins/team/hooks/mod/tick.ts`
- Modify: `plugins/team/hooks/mod/team.tsx` (timer body moves into `tick.ts`)
- Create: `plugins/team/tests/mod/tick.test.ts`

**Interfaces:**
- Produces:
  - `herdr.ts`: `type HerdrAgent = { pane_id: string; tab_id?: string; agent_status: string; agent_session?: { value: string } }`; `type HerdrPane = { pane_id: string; tab_id: string; agent_status: string }`; `herdrAgents($): Promise<{ ok: true; agents: HerdrAgent[] } | { ok: false; reason: string }>`; `herdrPanes($): Promise<HerdrPane[] | null>`; `herdrDialog($, pane): Promise<string>`; `herdrClose($, pane): Promise<void>`.
  - `tick.ts`: `type TeamRecord = { role: string; topic: string; brief: string; pane: string; session?: string; cwd?: string; brief_sent_session?: string }`; `readRecords($, teamdir): Promise<Record<string, TeamRecord>>`; `tick($): Promise<void>` (the whole timer body).
  - Non-record files in the team dir: `config.json`, `watch-state.json`, `tabs.json`, `layout-flags.json`, `delivered.json`.

- [ ] **Step 1: Write the failing tests** `tests/mod/tick.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'
import { CWD, world } from './world'

export async function team($: any, on: any) {
  const w = world(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  w.writeJson(`${w.team}/config.json`, {
    team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch',
    orchestrator_session: await $.session.id(),
  })
  w.writeJson(`${w.team}/app-1-scout.json`, {
    role: 'investigator', topic: '', brief: '', pane: 'w1:p2', session: 'sid-scout',
  })
  return w
}

describe('agent rows', () => {
  test('maps records to herdr agents by session id, not name', async ($, on) => {
    const w = await team($, on)
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'working', agent_session: { value: 'sid-scout' } }]
    await w.clock.advance(15000)
    expect((await $.state.get({ plugin: 'team', key: 'agents' })).value).toEqual([
      { name: 'app-1-scout', state: 'working', pane: 'w1:p2' },
    ])
  })

  test('writes a moved pane id back to the record', async ($, on) => {
    const w = await team($, on)
    w.agents = [{ pane_id: 'w1:p7', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]
    await w.clock.advance(15000)
    expect(w.json(`${w.team}/app-1-scout.json`).pane).toBe('w1:p7')
  })

  test('a record whose session herdr does not list shows as gone', async ($, on) => {
    const w = await team($, on)
    w.agents = []
    await w.clock.advance(15000)
    expect((await $.state.get({ plugin: 'team', key: 'agents' })).value).toEqual([
      { name: 'app-1-scout', state: 'gone', pane: 'w1:p2' },
    ])
    expect(w.json(`${w.team}/app-1-scout.json`).pane).toBe('w1:p2')
    expect(w.submits).toEqual([])
  })

  test('uses HERDR_BIN_PATH when set', async ($, on) => {
    const w = await team($, on)
    w.env.set('HERDR_BIN_PATH', '/opt/homebrew/bin/herdr')
    await w.clock.advance(15000)
    expect(w.runs.some(r => r[0] === '/opt/homebrew/bin/herdr' && r[1] === 'agent')).toBe(true)
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `claude plugin test plugins/team`
Expected: FAIL (`agents` stays `[]`).

- [ ] **Step 3: Implement `hooks/mod/herdr.ts`**

```ts
import type { EngineInterface } from 'claude-code'

export type HerdrAgent = {
  pane_id: string
  tab_id?: string
  agent_status: string
  agent_session?: { value: string }
}
export type HerdrPane = { pane_id: string; tab_id: string; agent_status: string }

async function herdr($: EngineInterface, args: string[]) {
  const bin = (await $.env.get('HERDR_BIN_PATH')) ?? 'herdr'
  try {
    return await $.process.run([bin, ...args], { timeoutMs: 10000 })
  } catch (err) {
    return { exitCode: -1, stdout: '', stderr: String(err), isStdoutTruncated: false, isStderrTruncated: false }
  }
}

export async function herdrAgents(
  $: EngineInterface,
): Promise<{ ok: true; agents: HerdrAgent[] } | { ok: false; reason: string }> {
  const r = await herdr($, ['agent', 'list'])
  if (r.exitCode !== 0) return { ok: false, reason: (r.stderr || r.stdout).trim().slice(0, 200) || `exit ${r.exitCode}` }
  try {
    return { ok: true, agents: JSON.parse(r.stdout)?.result?.agents ?? [] }
  } catch {
    return { ok: false, reason: 'bad output from herdr agent list' }
  }
}

export async function herdrPanes($: EngineInterface): Promise<HerdrPane[] | null> {
  const r = await herdr($, ['pane', 'list'])
  if (r.exitCode !== 0) return null
  try {
    return JSON.parse(r.stdout)?.result?.panes ?? []
  } catch {
    return null
  }
}

export async function herdrDialog($: EngineInterface, pane: string): Promise<string> {
  const r = await herdr($, ['agent', 'read', pane, '--source', 'detection', '--lines', '20'])
  return r.stdout.split('\n').find(l => l.trim() !== '')?.trim() ?? ''
}

export async function herdrClose($: EngineInterface, pane: string): Promise<void> {
  await herdr($, ['pane', 'close', pane])
}
```

- [ ] **Step 4: Implement `hooks/mod/tick.ts`** (moves the timer body from Task 6 and adds agent rows):

```ts
import { update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import { activeConfig, followClear } from './activation'
import { herdrAgents } from './herdr'
import type { HerdrAgent } from './herdr'
import { listNames, readJson, readText, writeJson } from './io'
import { agents, error, plan, planPath, showPane, tickAt } from './pane'
import { parsePlan } from './plan'
import { runDir, teamDir } from './paths'
import { atom } from 'claude-code'

export type TeamRecord = {
  role: string
  topic: string
  brief: string
  pane: string
  session?: string
  cwd?: string
  brief_sent_session?: string
}

const NON_RECORD = new Set(['config.json', 'watch-state.json', 'tabs.json', 'layout-flags.json', 'delivered.json'])
export const active = atom({ plugin: 'team', key: 'active' } as const, false)

export async function readRecords($: EngineInterface, teamdir: string): Promise<Record<string, TeamRecord>> {
  const out: Record<string, TeamRecord> = {}
  for (const file of await listNames($, teamdir)) {
    if (!file.endsWith('.json') || NON_RECORD.has(file)) continue
    const rec = await readJson<TeamRecord>($, `${teamdir}/${file}`)
    if (rec) out[file.slice(0, -5)] = rec
  }
  return out
}

export function bySession(list: HerdrAgent[]): Map<string, HerdrAgent> {
  const map = new Map<string, HerdrAgent>()
  for (const a of list) if (a.agent_session?.value) map.set(a.agent_session.value, a)
  return map
}

export async function tick($: EngineInterface): Promise<void> {
  await followClear($)
  const cfg = await activeConfig($)
  const was = (await $.state.get({ plugin: 'team', key: 'active' })).value === true
  await update($, active, () => cfg !== null)
  if (!cfg) return
  if (!was) await showPane($, cfg.team_id)

  const teamdir = await teamDir($)
  const path = `${await runDir($)}/progress-${cfg.ticket}.md`
  const text = await readText($, path)
  await update($, planPath, () => path)
  await update($, plan, () => (text === null ? null : parsePlan(text)))

  const listed = await herdrAgents($)
  const sessions = listed.ok ? bySession(listed.agents) : new Map<string, HerdrAgent>()
  const records = await readRecords($, teamdir)
  const rows = []
  for (const [name, rec] of Object.entries(records)) {
    const agent = rec.session ? sessions.get(rec.session) : undefined
    if (agent && agent.pane_id !== rec.pane) {
      rec.pane = agent.pane_id
      await writeJson($, `${teamdir}/${name}.json`, rec)
    }
    rows.push({ name, state: agent ? agent.agent_status : listed.ok ? 'gone' : '?', pane: rec.pane })
  }
  await update($, agents, () => rows)
  await update($, error, () => (listed.ok ? '' : `herdr: ${listed.reason}`))
  const at = new Date(await $.clock.now()).toISOString().slice(11, 19)
  await update($, tickAt, () => at)
}
```

In `team.tsx`, delete the inline timer body and the `active` atom, import `tick` from `./tick`, and start the timer with `$.clock.every(TICK_MS, () => tick($))`.

- [ ] **Step 5: Run the tests**

Run: `claude plugin test plugins/team`
Expected: PASS (all files).

- [ ] **Step 6: Validate and type-check**

Run: `claude plugin validate plugins/team && tsc -p plugins/team`
Expected: pass.

- [ ] **Step 7: Checkpoint.** Show Chebu the diff.

---

### Task 8: Report pickup, one prompt per tick

**Files:**
- Create: `plugins/team/hooks/mod/reports.ts`
- Modify: `plugins/team/hooks/mod/tick.ts`
- Create: `plugins/team/tests/mod/reports.test.ts`

**Interfaces:**
- Consumes: `readRecords`, `team()` test helper (export it from `tick.test.ts`; move it to `world.ts` as `export async function team($, on)` so every test file imports it from `./world`).
- Produces:
  - `reports.ts`: `reportLine(text: string): string | null` (first line starting with `REPORT `, trimmed); `type ReportFile = { name: string; mtimeMs: number; text: string }`; `pickReports(files: ReportFile[], delivered: Record<string, number> | null): { lines: string[]; delivered: Record<string, number> }`.
  - `tick.ts`: `send($, lines: string[]): Promise<void>` submits one prompt `lines.join('\n')` when non-empty; REPORT lines before WATCH lines.
  - `.team/delivered.json`: `{ "<agent>": <report mtimeMs> }`.

- [ ] **Step 1: Write the failing tests** `tests/mod/reports.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'
import { pickReports, reportLine } from '../../hooks/mod/reports'
import { team } from './world'

const report = (body: string) => `# Report: x / t\n- Brief: b\n\n---\n\n${body}\n`

describe('reportLine', () => {
  test('finds a REPORT line after a status bar', () => {
    expect(reportLine('| bar |\n\nREPORT a t: done\nmore')).toBe('REPORT a t: done')
  })
  test('none without one', () => {
    expect(reportLine('waiting on subagents')).toBeNull()
  })
})

describe('pickReports', () => {
  test('a missing delivered file is a baseline: marks, sends nothing', () => {
    const r = pickReports([{ name: 'a', mtimeMs: 5, text: report('REPORT a t: old') }], null)
    expect(r).toEqual({ lines: [], delivered: { a: 5 } })
  })
  test('sends a newer report once', () => {
    const r = pickReports([{ name: 'a', mtimeMs: 9, text: report('REPORT a t: new') }], { a: 5 })
    expect(r).toEqual({ lines: ['REPORT a t: new'], delivered: { a: 9 } })
  })
  test('a newer report without a REPORT line is marked, not sent', () => {
    const r = pickReports([{ name: 'a', mtimeMs: 9, text: report('pausing') }], { a: 5 })
    expect(r).toEqual({ lines: [], delivered: { a: 9 } })
  })
})

describe('pickup in the tick', () => {
  test('two reports in one tick become one prompt', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/app-1-maker.json`, { role: 'implementer', topic: 'build', brief: '', pane: 'w1:p3', session: 'sid-maker' })
    w.writeJson(`${w.team}/app-1-scout.json`, { role: 'investigator', topic: 'dig', brief: '', pane: 'w1:p2', session: 'sid-scout' })
    w.writeJson(`${w.team}/delivered.json`, {})
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-scout-dig.md`, report('REPORT app-1-scout dig: found it'))
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-maker-build.md`, report('REPORT app-1-maker build: green'))
    await w.clock.advance(15000)
    expect(w.submits).toHaveLength(1)
    expect(w.submits[0].split('\n').sort()).toEqual([
      'REPORT app-1-maker build: green', 'REPORT app-1-scout dig: found it',
    ])
    await w.clock.advance(15000)
    expect(w.submits).toHaveLength(1)
  })

  test('first activation with old reports sends nothing', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/app-1-scout.json`, { role: 'investigator', topic: 'dig', brief: '', pane: 'w1:p2', session: 'sid-scout' })
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-scout-dig.md`, report('REPORT app-1-scout dig: old'))
    await w.clock.advance(15000)
    expect(w.submits).toEqual([])
    expect(w.json(`${w.team}/delivered.json`)).toHaveProperty('app-1-scout')
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `claude plugin test plugins/team`
Expected: FAIL (`reports` module missing).

- [ ] **Step 3: Implement `hooks/mod/reports.ts`**

```ts
export type ReportFile = { name: string; mtimeMs: number; text: string }

export function reportLine(text: string): string | null {
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('REPORT ')) return line.trim()
  }
  return null
}

export function pickReports(
  files: ReportFile[],
  delivered: Record<string, number> | null,
): { lines: string[]; delivered: Record<string, number> } {
  const marks = { ...(delivered ?? {}) }
  const lines: string[] = []
  for (const f of files) {
    if (delivered !== null && f.mtimeMs > (delivered[f.name] ?? 0)) {
      const line = reportLine(f.text)
      if (line) lines.push(line)
    }
    marks[f.name] = Math.max(marks[f.name] ?? 0, f.mtimeMs)
  }
  return { lines, delivered: marks }
}
```

- [ ] **Step 4: Wire it into `tick.ts`.** Add imports `import { pickReports } from './reports'`, `import type { ReportFile } from './reports'`, and `mtime` from `./io`. Add:

```ts
async function reportFiles($: EngineInterface, run: string, records: Record<string, TeamRecord>): Promise<ReportFile[]> {
  const files: ReportFile[] = []
  for (const [name, rec] of Object.entries(records)) {
    const path = `${run}/reports/${name}-${rec.topic}.md`
    const at = await mtime($, path)
    const text = at === null ? null : await readText($, path)
    if (at !== null && text !== null) files.push({ name, mtimeMs: at, text })
  }
  return files
}

export async function send($: EngineInterface, lines: string[]): Promise<void> {
  if (lines.length > 0) await $.prompt.submit({ text: lines.join('\n') })
}
```

At the end of `tick`, after the rows update:

```ts
  const run = await runDir($)
  const deliveredPath = `${teamdir}/delivered.json`
  const picked = pickReports(await reportFiles($, run, records),
                             await readJson<Record<string, number>>($, deliveredPath))
  await send($, picked.lines)
  await writeJson($, deliveredPath, picked.delivered)
```

- [ ] **Step 5: Run the tests**

Run: `claude plugin test plugins/team`
Expected: PASS.

- [ ] **Step 6: Validate and type-check**

Run: `claude plugin validate plugins/team && tsc -p plugins/team`
Expected: pass.

- [ ] **Step 7: Checkpoint.** Show Chebu the diff.

---

### Task 9: WATCH rules, layout hygiene, herdr down

**Files:**
- Create: `plugins/team/hooks/mod/facts.ts`, `plugins/team/hooks/mod/watch.ts`, `plugins/team/hooks/mod/layout.ts`
- Modify: `plugins/team/hooks/mod/tick.ts`
- Create: `plugins/team/tests/mod/watch.test.ts`

**Interfaces:**
- Consumes: `readRecords`, `bySession`, `herdrPanes`, `herdrDialog`, `herdrClose`, `send`.
- Produces:
  - `facts.ts`: `type AgentFacts = { name: string; state: string; pane: string; reportPath: string; hasFreshReport: boolean; quietSinceStop: boolean }`; `gatherFacts($, run, name, rec, state, now, after): Promise<AgentFacts>`.
  - `watch.ts`: `type WatchMemory = { agents: Record<string, string>; _flagged: Record<string, boolean>; _idle_since: Record<string, number>; herdr_down?: boolean }`; `watchLines(facts: AgentFacts[], mem: WatchMemory, now: number, after: number): { blocked: string[]; lines: string[]; mem: WatchMemory }` (`blocked` names agents that just turned blocked, so the tick can append the dialog).
  - `layout.ts`: `layoutActions(input: LayoutInput): { closes: string[]; flags: string[]; fresh: string[] }`.
  - WATCH line text, exactly as `team-watch` wrote them: `WATCH <name>: <old> -> blocked: <dialog>`, `WATCH <name>: idle, no report - read <report path>`, `WATCH layout: tab <tab> over budget (<n>/6)`, `WATCH layout: tab <tab> idle, consider release`, `WATCH herdr unreachable: <reason>`.

- [ ] **Step 1: Write the failing tests** `tests/mod/watch.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'
import { layoutActions } from '../../hooks/mod/layout'
import { watchLines } from '../../hooks/mod/watch'
import { team } from './world'

const fact = (over: object) => ({
  name: 'a', state: 'working', pane: 'w1:p2', reportPath: '/r/a-t.md',
  hasFreshReport: false, quietSinceStop: false, ...over,
})
const empty = { agents: {}, _flagged: {}, _idle_since: {} }

describe('watchLines', () => {
  test('a turn to blocked is flagged with the old state', () => {
    const r = watchLines([fact({ state: 'blocked' })], { ...empty, agents: { a: 'working' } }, 0, 120)
    expect(r.blocked).toEqual(['a'])
    expect(r.lines).toEqual(['WATCH a: working -> blocked'])
  })
  test('idle without a fresh report is flagged once, after the grace period', () => {
    let r = watchLines([fact({ state: 'idle' })], empty, 1000, 120)
    expect(r.lines).toEqual([])
    r = watchLines([fact({ state: 'idle' })], r.mem, 1000 + 120_000, 120)
    expect(r.lines).toEqual(['WATCH a: idle, no report - read /r/a-t.md'])
    r = watchLines([fact({ state: 'idle' })], r.mem, 1000 + 240_000, 120)
    expect(r.lines).toEqual([])
  })
  test('quiet since its stop counts even while herdr shows working', () => {
    const r = watchLines([fact({ quietSinceStop: true })], empty, 0, 120)
    expect(r.lines).toEqual(['WATCH a: idle, no report - read /r/a-t.md'])
  })
  test('a fresh report is never flagged', () => {
    const r = watchLines([fact({ state: 'idle', hasFreshReport: true })], empty, 999_999, 120)
    expect(r.lines).toEqual([])
  })
})

describe('layoutActions', () => {
  const base = {
    teamTabs: ['w1:t2'], orchTab: 'w1:t1', namedPanes: new Set(['w1:p2', 'w1:p3']),
    briefed: new Map<string, boolean>(), prevFlags: [] as string[],
  }
  test('closes an empty pane a record names, never one it does not', () => {
    const r = layoutActions({ ...base, panes: [
      { pane_id: 'w1:p2', tab_id: 'w1:t2', agent_status: 'unknown' },
      { pane_id: 'w1:p9', tab_id: 'w1:t2', agent_status: 'unknown' },
    ] })
    expect(r.closes).toEqual(['w1:p2'])
  })
  test('never touches the orchestrator tab', () => {
    const r = layoutActions({ ...base, teamTabs: ['w1:t1'], panes: [
      { pane_id: 'w1:p2', tab_id: 'w1:t1', agent_status: 'unknown' },
    ] })
    expect(r.closes).toEqual([])
  })
  test('flags a tab over budget once', () => {
    const panes = Array.from({ length: 7 }, (_, i) => ({ pane_id: `w1:x${i}`, tab_id: 'w1:t2', agent_status: 'working' }))
    let r = layoutActions({ ...base, panes })
    expect(r.fresh).toEqual(['layout: tab w1:t2 over budget (7/6)'])
    r = layoutActions({ ...base, panes, prevFlags: r.flags })
    expect(r.fresh).toEqual([])
  })
  test('suggests release only when every briefed agent there has a fresh report', () => {
    const panes = [{ pane_id: 'w1:p2', tab_id: 'w1:t2', agent_status: 'idle' }]
    expect(layoutActions({ ...base, panes, briefed: new Map([['w1:p2', false]]) }).fresh).toEqual([])
    expect(layoutActions({ ...base, panes, briefed: new Map([['w1:p2', true]]) }).fresh)
      .toEqual(['layout: tab w1:t2 idle, consider release'])
  })
})

describe('watch in the tick', () => {
  test('blocked line carries the dialog and goes out in the tick prompt', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'working', agent_session: { value: 'sid-scout' } }]
    await w.clock.advance(15000)
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'blocked', agent_session: { value: 'sid-scout' } }]
    await w.clock.advance(15000)
    expect(w.submits).toEqual(['WATCH app-1-scout: working -> blocked: Allow Bash(rm -rf build)? [y/n]'])
  })

  test('herdr down sends one line until it is back', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.herdrFails = 'server_unavailable'
    await w.clock.advance(15000)
    await w.clock.advance(15000)
    expect(w.submits).toEqual(['WATCH herdr unreachable: server_unavailable'])
    expect((await $.state.get({ plugin: 'team', key: 'error' })).value).toBe('herdr: server_unavailable')
    w.herdrFails = null
    await w.clock.advance(15000)
    w.herdrFails = 'again'
    await w.clock.advance(15000)
    expect(w.submits).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `claude plugin test plugins/team`
Expected: FAIL (`watch`/`layout` modules missing).

- [ ] **Step 3: Implement `hooks/mod/watch.ts`** (port of the agent part of `team-watch`):

```ts
import type { AgentFacts } from './facts'

export type WatchMemory = {
  agents: Record<string, string>
  _flagged: Record<string, boolean>
  _idle_since: Record<string, number>
  herdr_down?: boolean
}

export function watchLines(
  facts: AgentFacts[],
  mem: WatchMemory,
  now: number,
  after: number,
): { blocked: string[]; lines: string[]; mem: WatchMemory } {
  const next: WatchMemory = { agents: {}, _flagged: {}, _idle_since: {}, herdr_down: mem.herdr_down }
  const blocked: string[] = []
  const lines: string[] = []
  for (const f of facts) {
    next.agents[f.name] = f.state
    const old = mem.agents[f.name]
    if (old !== undefined && old !== f.state && f.state === 'blocked') {
      blocked.push(f.name)
      lines.push(`WATCH ${f.name}: ${old} -> blocked`)
    }
    if (f.state === 'blocked' || f.hasFreshReport) continue
    const idle = f.state === 'idle' || f.state === 'done'
    if (idle) next._idle_since[f.name] = mem._idle_since[f.name] ?? now
    const idleLong = idle && now - next._idle_since[f.name] >= after * 1000
    if (idleLong || f.quietSinceStop) {
      if (!mem._flagged[f.name]) lines.push(`WATCH ${f.name}: idle, no report - read ${f.reportPath}`)
      next._flagged[f.name] = true
    }
  }
  return { blocked, lines, mem: next }
}
```

- [ ] **Step 4: Implement `hooks/mod/layout.ts`** (port of the hygiene part of `team-watch`):

```ts
import type { HerdrPane } from './herdr'

export type LayoutInput = {
  panes: HerdrPane[]
  teamTabs: string[]
  orchTab: string | null
  namedPanes: Set<string>
  briefed: Map<string, boolean>
  prevFlags: string[]
}

const OCCUPIED = new Set(['idle', 'working', 'blocked', 'done'])
const BUDGET = 6

export function layoutActions(input: LayoutInput): { closes: string[]; flags: string[]; fresh: string[] } {
  const byTab = new Map<string, HerdrPane[]>()
  for (const p of input.panes) byTab.set(p.tab_id, [...(byTab.get(p.tab_id) ?? []), p])
  const closes: string[] = []
  const flags: string[] = []
  for (const [tab, list] of byTab) {
    if (!input.teamTabs.includes(tab) || tab === input.orchTab) continue
    if (list.length > BUDGET) flags.push(`layout: tab ${tab} over budget (${list.length}/${BUDGET})`)
    const occupied = list.filter(p => OCCUPIED.has(p.agent_status) || !input.namedPanes.has(p.pane_id))
    for (const p of list) {
      if (!OCCUPIED.has(p.agent_status) && input.namedPanes.has(p.pane_id)) closes.push(p.pane_id)
    }
    const briefedHere = occupied.filter(p => input.briefed.has(p.pane_id))
    if (occupied.length > 0
        && occupied.every(p => p.agent_status === 'idle' || p.agent_status === 'done')
        && briefedHere.length > 0
        && briefedHere.every(p => input.briefed.get(p.pane_id) === true)) {
      flags.push(`layout: tab ${tab} idle, consider release`)
    }
  }
  const unique = [...new Set(flags)].sort()
  return { closes, flags: unique, fresh: unique.filter(f => !input.prevFlags.includes(f)) }
}
```

- [ ] **Step 5: Implement `hooks/mod/facts.ts`** (port of `fresh_report`, `last_turn_at`, `quiet_since_stop` from `lib/teamlib.py`):

```ts
import type { EngineInterface } from 'claude-code'
import { mtime, readJson, readText, tailText } from './io'
import { reportLine } from './reports'
import type { TeamRecord } from './tick'

export type AgentFacts = {
  name: string
  state: string
  pane: string
  reportPath: string
  hasFreshReport: boolean
  quietSinceStop: boolean
}

function lastTurnAt(tail: string): number | null {
  let last: number | null = null
  for (const line of tail.split('\n')) {
    try {
      const ev = JSON.parse(line)
      if ((ev.type === 'user' || ev.type === 'assistant') && ev.timestamp) last = Date.parse(ev.timestamp)
    } catch {
      continue
    }
  }
  return last
}

export async function gatherFacts(
  $: EngineInterface, run: string, name: string, rec: TeamRecord, state: string, now: number, after: number,
): Promise<AgentFacts> {
  const reportPath = `${run}/reports/${name}-${rec.topic}.md`
  const briefAt = await mtime($, `${run}/brief-${name}-${rec.topic}.md`)
  const reportAt = await mtime($, reportPath)
  const text = reportAt === null ? null : await readText($, reportPath)
  const hasFreshReport = text !== null && reportLine(text) !== null
    && !(briefAt !== null && reportAt! < briefAt)

  let quietSinceStop = false
  const stop = await readJson<{ transcript: string; at: number }>($, `${run}/.team/stops/${name}.json`)
  if (stop && now - stop.at * 1000 >= after * 1000 && !(briefAt !== null && briefAt > stop.at * 1000)) {
    const last = lastTurnAt(await tailText($, stop.transcript, 262144))
    quietSinceStop = last === null || last <= stop.at * 1000
  }
  return { name, state, pane: rec.pane, reportPath, hasFreshReport, quietSinceStop }
}
```

- [ ] **Step 6: Wire it into `tick.ts`.** After the rows update and before report pickup, build the facts, run the rules, close panes, and collect WATCH lines; send REPORT lines first, then WATCH lines, in one `send`. Replace the report-pickup block from Task 8 with:

```ts
  const run = await runDir($)
  const now = await $.clock.now()
  const watchPath = `${teamdir}/watch-state.json`
  const mem = (await readJson<WatchMemory>($, watchPath)) ?? { agents: {}, _flagged: {}, _idle_since: {} }
  const watch: string[] = []

  if (!listed.ok) {
    if (!mem.herdr_down) watch.push(`WATCH herdr unreachable: ${listed.reason}`)
    await writeJson($, watchPath, { ...mem, herdr_down: true })
  } else {
    const facts: AgentFacts[] = []
    for (const [name, rec] of Object.entries(records)) {
      const agent = rec.session ? sessions.get(rec.session) : undefined
      if (agent) facts.push(await gatherFacts($, run, name, rec, agent.agent_status, now, NO_REPORT_AFTER))
    }
    const result = watchLines(facts, { ...mem, herdr_down: false }, now, NO_REPORT_AFTER)
    for (const line of result.lines) {
      const name = line.slice('WATCH '.length).split(':')[0]
      if (result.blocked.includes(name)) {
        const dialog = await herdrDialog($, records[name].pane)
        watch.push(dialog ? `${line}: ${dialog}` : line)
      } else {
        watch.push(line)
      }
    }
    await writeJson($, watchPath, result.mem)

    const panes = await herdrPanes($)
    if (panes) {
      const myId = await $.session.id()
      const me = listed.agents.find(a => a.agent_session?.value === myId)
      const flagsPath = `${teamdir}/layout-flags.json`
      const layout = layoutActions({
        panes,
        teamTabs: (await readJson<string[]>($, `${teamdir}/tabs.json`)) ?? [],
        orchTab: me?.tab_id ?? null,
        namedPanes: new Set(Object.values(records).map(r => r.pane)),
        briefed: new Map(facts.filter(f => records[f.name].brief).map(f => [f.pane, f.hasFreshReport])),
        prevFlags: (await readJson<string[]>($, flagsPath)) ?? [],
      })
      for (const pane of layout.closes) await herdrClose($, pane)
      await writeJson($, flagsPath, layout.flags)
      watch.push(...layout.fresh.map(f => `WATCH ${f}`))
    }
  }

  const deliveredPath = `${teamdir}/delivered.json`
  const picked = pickReports(await reportFiles($, run, records),
                             await readJson<Record<string, number>>($, deliveredPath))
  await send($, [...picked.lines, ...watch])
  await writeJson($, deliveredPath, picked.delivered)
```

Add at the top of `tick.ts`: `const NO_REPORT_AFTER = 120`, and imports for `gatherFacts`/`AgentFacts` (`./facts`), `watchLines`/`WatchMemory` (`./watch`), `layoutActions` (`./layout`), `herdrPanes`, `herdrDialog`, `herdrClose` (`./herdr`).

- [ ] **Step 7: Run the tests**

Run: `claude plugin test plugins/team`
Expected: PASS.

- [ ] **Step 8: Validate and type-check**

Run: `claude plugin validate plugins/team && tsc -p plugins/team`
Expected: pass.

- [ ] **Step 9: Checkpoint.** Show Chebu the diff.

---

### Task 10: `brief_send` tool and `team-brief prepare`

**Files:**
- Create: `plugins/team/hooks/mod/brief.ts`
- Modify: `plugins/team/hooks/mod/team.tsx`
- Modify: `plugins/team/bin/team-brief` (`send` becomes `prepare`)
- Modify: `plugins/team/tests/test_team.py` (team-brief send tests)
- Create: `plugins/team/tests/mod/brief.test.ts`

**Interfaces:**
- Consumes: `readRecords`, `bySession`, `herdrAgents`, `teamDir`.
- Produces:
  - `team-brief prepare <name> --topic <t>`: updates the record's `topic` and `brief`, mirrors into a worktree (unchanged logic), prints the kickoff prompt on stdout; exit 2 on bad input. No herdr call.
  - Tool `brief_send` `{ name: string, topic: string }` → `{ result: "<name>: <herdr state>" }` or `{ result: "<reason>", isError: true }`; writes record `brief_sent_session`.

- [ ] **Step 1: Write the failing bash tests.** Find the `team-brief send` tests (`grep -n '"send"' plugins/team/tests/test_team.py`). Delete the tests about herdr exit codes 5 and 6 (stall, blocked) and the herdr prompt argv. Add:

```python
    def test_prepare_prints_kickoff_and_updates_record(self):
        self.write_record("scout", "investigator")
        os.makedirs(self.sp(), exist_ok=True)
        write_text(self.sp("brief-scout-digest.md"), "brief")
        p = self.run_script("team-brief", "prepare", "scout", "--topic", "digest")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.strip(),
                         "Read scratchpad/current/brief-scout-digest.md and execute it fully. "
                         "Report back as it describes. You are in execution mode; if your session "
                         "shows plan mode, say so immediately.")
        rec = self.team_json("scout")
        self.assertEqual((rec["topic"], rec["brief"]), ("digest", "scratchpad/current/brief-scout-digest.md"))
        self.assertEqual(self.herdr_calls(), [])

    def test_send_is_gone(self):
        p = self.run_script("team-brief", "send", "scout")
        self.assertEqual(p.returncode, 2)
```

Keep the worktree-mirroring tests, renamed from `send` to `prepare` and with their herdr assertions removed.

- [ ] **Step 2: Run to see them fail**

Run: `cd plugins/team/tests && python3 -m unittest test_team 2>&1 | tail -15`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement in `bin/team-brief`.** Rename the `send)` case to `prepare)`. In `usage`, replace the `send` line with `echo "       team-brief prepare <name> --topic <topic>" >&2`. Replace everything from `prompt="Read $brief_ref ...` to the end of the case with:

```bash
  echo "Read $brief_ref and execute it fully. Report back as it describes. You are in execution mode; if your session shows plan mode, say so immediately."
  ;;
```

Update the header comment: `# Compose a brief file from templates + overlay, or prepare its kick-off prompt.` and exit codes `0 ok, 1 refused (brief exists), 2 bad arguments.`

- [ ] **Step 4: Run the bash suite**

Run: `cd plugins/team/tests && python3 -m unittest test_team 2>&1 | tail -4`
Expected: `OK`.

- [ ] **Step 5: Write the failing mod tests** `tests/mod/brief.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'
import { team } from './world'

const call = ($: any, args: { name: string; topic: string }) =>
  $.tool.call({ tool: 'mcp__team__brief_send', tool_use_id: 't1', ...args } as never)

describe('brief_send', () => {
  test('sends the kickoff to the record session and returns its state', async ($, on) => {
    const w = await team($, on)
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]
    const r = await call($, { name: 'app-1-scout', topic: 'dig' })
    expect(r.result).toBe('app-1-scout: idle')
    expect(w.sends).toEqual([{ to: { sessionId: 'sid-scout' },
                               text: 'Read scratchpad/current/brief-app-1-scout-dig.md and execute it fully.' }])
    expect(w.json(`${w.team}/app-1-scout.json`).brief_sent_session).toBe('sid-scout')
  })

  test('an unknown agent is an error', async ($, on) => {
    await team($, on)
    const r = await call($, { name: 'app-1-ghost', topic: 'dig' })
    expect(r).toMatchObject({ isError: true, result: 'no agent record: app-1-ghost' })
  })

  test('waits for a /clear to land, then fails when it never does', async ($, on) => {
    const w = await team($, on)
    const rec = w.json(`${w.team}/app-1-scout.json`)
    w.writeJson(`${w.team}/app-1-scout.json`, { ...rec, brief_sent_session: 'sid-scout' })
    const pending = call($, { name: 'app-1-scout', topic: 'dig' })
    await w.clock.advance(10_000)
    expect(await pending).toMatchObject({ isError: true, result: 'app-1-scout was not cleared since its last brief' })
    expect(w.sends).toEqual([])
  })

  test('sends once the cleared session id lands', async ($, on) => {
    const w = await team($, on)
    const rec = w.json(`${w.team}/app-1-scout.json`)
    w.writeJson(`${w.team}/app-1-scout.json`, { ...rec, brief_sent_session: 'sid-scout' })
    const pending = call($, { name: 'app-1-scout', topic: 'dig' })
    await w.clock.advance(1000)
    w.writeJson(`${w.team}/app-1-scout.json`, { ...rec, brief_sent_session: 'sid-scout', session: 'sid-new' })
    await w.clock.advance(1000)
    expect((await pending).isError).toBeUndefined()
    expect(w.sends[0].to).toEqual({ sessionId: 'sid-new' })
  })
})
```

- [ ] **Step 6: Run to see them fail**

Run: `claude plugin test plugins/team`
Expected: FAIL (`mcp__team__brief_send` not registered).

- [ ] **Step 7: Implement `hooks/mod/brief.ts`**

```ts
import type { EngineInterface, On } from 'claude-code'
import { herdrAgents } from './herdr'
import { readJson, writeJson } from './io'
import { teamDir } from './paths'
import { bySession } from './tick'
import type { TeamRecord } from './tick'

export const BRIEF_TOOL = 'brief_send'
const WAIT_MS = 10000
const POLL_MS = 500

const fail = (result: string) => ({ result, isError: true as const })

async function clearedRecord($: EngineInterface, path: string): Promise<TeamRecord | null> {
  for (let waited = 0; ; waited += POLL_MS) {
    const rec = await readJson<TeamRecord>($, path)
    if (!rec || rec.brief_sent_session !== rec.session || waited >= WAIT_MS) return rec
    await $.clock.sleep(POLL_MS)
  }
}

export async function registerBriefTool($: EngineInterface): Promise<void> {
  await $.tool.register({
    name: BRIEF_TOOL,
    description: 'Send a composed brief to a team agent by its session id. Run `team-brief compose` first.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, topic: { type: 'string' } },
      required: ['name', 'topic'],
    },
  })
}

export function registerBrief(on: On): void {
  on('tool.call', { tool: `mcp__team__${BRIEF_TOOL}` }, async ($, e) => {
    const name = String(e.name ?? '')
    const topic = String(e.topic ?? '')
    const dir = await teamDir($)
    const path = `${dir}/${name}.json`
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name)) return fail(`bad name: ${name}`)
    let rec = await clearedRecord($, path)
    if (!rec) return fail(`no agent record: ${name}`)
    if (!rec.session) return fail(`${name} has no session id; start it with this plugin version`)
    if (rec.brief_sent_session === rec.session) return fail(`${name} was not cleared since its last brief`)

    const prepared = await $.process.run([`${$.plugin.root}/bin/team-brief`, 'prepare', name, '--topic', topic])
    if (prepared.exitCode !== 0) return fail(prepared.stderr.trim() || `team-brief prepare failed (${prepared.exitCode})`)
    const sent = await $.session.send({ to: { sessionId: rec.session }, text: prepared.stdout.trim() })
    if (!sent.isDelivered) return fail(`not delivered: ${sent.reason}`)

    rec = (await readJson<TeamRecord>($, path)) ?? rec
    await writeJson($, path, { ...rec, brief_sent_session: rec.session })
    const listed = await herdrAgents($)
    const state = listed.ok ? bySession(listed.agents).get(rec.session!)?.agent_status ?? 'gone' : 'unknown'
    return { result: `${name}: ${state}` }
  })
}
```

An MCP tool's arguments arrive at the top level of `e` beside `tool` and `tool_use_id` (`McpToolCallInputFallback`), so the hook reads `e.name` and `e.topic`.

In `team.tsx`: `import { registerBrief, registerBriefTool } from './brief'`; call `registerBrief(on)` in `register`, and `await registerBriefTool($)` in `session.start` before the timer.

- [ ] **Step 8: Run the tests**

Run: `claude plugin test plugins/team`
Expected: PASS.

- [ ] **Step 9: Validate and type-check**

Run: `claude plugin validate plugins/team && tsc -p plugins/team`
Expected: pass.

- [ ] **Step 10: Checkpoint.** Show Chebu the diff.

---

### Task 11: Remove the bash watcher, overview and delivery; `team-status` by session

**Files:**
- Delete: `plugins/team/bin/team-watch`, `plugins/team/bin/team-overview`, `plugins/team/bin/team-deliver`, `plugins/team/lib/overview.py`
- Modify: `plugins/team/lib/teamlib.py` (`NON_RECORD_FILES`; drop `input_draft`, `typed_text` if unused)
- Modify: `plugins/team/bin/team-status`
- Modify: `plugins/team/commands/init.md`, `plugins/team/commands/release.md`, `plugins/team/commands/brief.md`
- Modify: `plugins/team/tests/test_team.py`

**Interfaces:**
- Produces: `team-status` rows keyed by record session: `name (pane, session[:8]) state role topic age`; the orchestrator row comes from `orchestrator_session`.

- [ ] **Step 1: Write the failing `team-status` test** in the `team-status` test class:

```python
    def test_maps_records_by_session_not_name(self):
        d = self.sp(".team"); os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "config.json"), json.dumps(
            {"team_id": "app-1", "orchestrator": "app-1-orch", "orchestrator_session": "oooo0000dddd"}))
        write_text(os.path.join(d, "app-1-scout.json"), json.dumps(
            {"role": "investigator", "topic": "", "brief": "", "pane": "w2:p2", "session": "c23a1be5eeee"}))
        p = self.run_script("team-status", scenario="status_two_teams")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("app-1-orch (w2:p1, oooo0000) working", p.stdout)
        self.assertIn("app-1-scout (w2:pB, c23a1be5) idle investigator", p.stdout)
```

(`status_two_teams` lists an unnamed agent `w2:pB` with session `c23a1be5eeee`: it matches by session only.)

- [ ] **Step 2: Run to see it fail**

Run: `cd plugins/team/tests && python3 -m unittest test_team -k by_session_not_name`
Expected: FAIL.

- [ ] **Step 3: Implement in `bin/team-status`.** Replace the python loop head `for a in team_agents(agents, teamdir):` and the lines that derive `name` with a session map:

```python
cfg = {}
try:
    cfg = json.load(open(os.path.join(teamdir, "config.json")))
except (OSError, ValueError):
    pass
by_session = {a.get("agent_session", {}).get("value"): a for a in agents}
members = []
if cfg.get("orchestrator_session") in by_session:
    members.append((cfg.get("orchestrator", "orchestrator"), by_session[cfg["orchestrator_session"]]))
for rname, rec in sorted(recs.items()):
    if rec.get("session") in by_session:
        members.append((rname, by_session[rec["session"]]))

out, text = [], []
for name, a in members:
```

Remove the `team_agents` import. `last_screen_line(name)` must read by pane: change its argument to `a.get("pane_id", "")` at the call site and inside to `["herdr", "agent", "read", pane, ...]`.

- [ ] **Step 4: Delete the old scripts and their tests.** Use `rm`, not `git rm` (no staging):

```bash
rm plugins/team/bin/team-watch plugins/team/bin/team-overview plugins/team/bin/team-deliver plugins/team/lib/overview.py
```

In `test_team.py`, delete the test classes for the watcher, the overview, and delivery. Find them: `grep -n "^class " plugins/team/tests/test_team.py` and remove each class whose tests run `team-watch`, `team-overview`, `team-deliver`, or import `overview`. In `lib/teamlib.py`, set `NON_RECORD_FILES = ("config.json", "watch-state.json", "tabs.json", "layout-flags.json", "delivered.json")` and delete `typed_text`, `input_draft`, `CSI`, and `team_agents` if `grep -rn "input_draft\|typed_text\|team_agents" plugins/team/bin plugins/team/hooks` finds no user.

- [ ] **Step 5: Update the commands.**

`commands/init.md`: delete steps 5 and 6 (overview and watcher spawn). Step 2 now reads: `Run team-init <ticket> --orchestrator-pane <this pane id>. It archives the previous run, writes the team id and the config (with this session's id as orchestrator_session), the safe permission baseline, and records this tab. ...` (keep the rest of step 2). Add after the plan-file step: `The team mod in this session activates within 15 s: it opens the Team overview pane (toggle with /team-overview) and starts watching.`

`commands/brief.md`: step 3 becomes `Call the mcp__team__brief_send tool with { name, topic }. It returns "<name>: <state>". An error result names the reason (no record, not cleared since its last brief, not delivered); report it to the human.` Delete the exit-code mapping.

`commands/release.md`: step 2 becomes `Send it /clear by pane: find its pane with team-status, then herdr agent prompt <pane> "/clear" --wait. ...` (keep the stalled note). Add step 4b: `Delete its session index entry: rm -f "${TEAM_INDEX_DIR:-$HOME/.claude/team/sessions}/<session>.json", the session from its record.` Replace step 5 with: `When releasing all, remove .team/tabs.json, .team/watch-state.json, .team/layout-flags.json and .team/delivered.json, all under ${TEAM_SCRATCH:-scratchpad/current}. The mod stays active until /team:init starts another run.`

- [ ] **Step 6: Run both suites**

Run: `cd plugins/team/tests && python3 -m unittest test_team 2>&1 | tail -4 && cd ../../.. && claude plugin test plugins/team`
Expected: `OK` and all mod tests PASS.

- [ ] **Step 7: Checkpoint.** Show Chebu the diff.

---

### Task 12: `/team:resurrect`

**Files:**
- Create: `plugins/team/bin/team-resurrect`
- Create: `plugins/team/commands/resurrect.md`
- Modify: `plugins/team/tests/test_team.py` (new class `TeamResurrect`)
- Modify: `plugins/team/tests/fake-herdr` (scenario `resurrect`)

**Interfaces:**
- Consumes: `restored/<name>` markers (Task 3); record `session`, `role`, `model`, `effort`, `mode`, `cwd`; herdr `agent list` with `agent_session`.
- Produces: for each marked worker: `herdr agent prompt <pane> "/exit"`, `herdr agent wait <pane> --status unknown --timeout 30000`, then `herdr pane run <pane> "export TEAM_NAME=... TEAM_SCRATCH=..."` and `herdr agent start <name> --kind claude --pane <pane> --timeout 90000 -- --resume <session> --agent team-<role> --model <model> --effort <effort> --permission-mode <mode> --name <name> --settings {"crossSessionInbound":"accept"}`; removes the marker. Prints one line per agent: `relaunched <name> (<pane>)`, `healthy <name>`, or `missing <name>: session <id> not in herdr`. Exit 0, or 4 on a herdr error.

- [ ] **Step 1: Add the fake scenario.** In `tests/fake-herdr`, inside `"agent list"`, add before `*)`:

```bash
      resurrect)
        emit '{"result":{"agents":[
          {"pane_id":"w1:p5","agent_status":"idle","agent_session":{"value":"sid-scout"}},
          {"pane_id":"w1:p6","agent_status":"idle","agent_session":{"value":"sid-maker"}}
        ]}}' ;;
```

- [ ] **Step 2: Write the failing tests**

```python
class TeamResurrect(Base):
    def setup_team(self):
        d = self.sp(".team"); os.makedirs(os.path.join(d, "restored"))
        for name, sid, role in (("scout", "sid-scout", "investigator"), ("maker", "sid-maker", "implementer"),
                                ("ghost", "sid-ghost", "tester")):
            write_text(os.path.join(d, name + ".json"), json.dumps(
                {"role": role, "topic": "", "brief": "", "pane": "w1:p2", "session": sid,
                 "model": "claude-sonnet-5-5", "effort": "low", "mode": "auto", "cwd": self.proj}))
        open(os.path.join(d, "restored", "scout"), "w").close()
        open(os.path.join(d, "restored", "ghost"), "w").close()

    def test_relaunches_marked_workers_with_saved_flags(self):
        self.setup_team()
        p = self.run_script("team-resurrect", scenario="resurrect")
        self.assertEqual(p.returncode, 0, p.stderr)
        calls = self.herdr_calls()
        self.assertIn('agent prompt w1:p5 /exit', calls)
        self.assertIn(
            'agent start scout --kind claude --pane w1:p5 --timeout 90000 -- --resume sid-scout '
            '--agent team-investigator --model claude-sonnet-5-5 --effort low --permission-mode auto '
            '--name scout --settings {"crossSessionInbound":"accept"}', calls)
        self.assertFalse(os.path.exists(self.sp(".team", "restored", "scout")))
        self.assertIn("relaunched scout (w1:p5)", p.stdout)

    def test_unmarked_worker_is_healthy_and_untouched(self):
        self.setup_team()
        p = self.run_script("team-resurrect", scenario="resurrect")
        self.assertIn("healthy maker", p.stdout)
        self.assertFalse(any("w1:p6" in c and c.startswith(("agent prompt", "agent start")) for c in self.herdr_calls()))

    def test_worker_missing_from_herdr_is_reported(self):
        self.setup_team()
        p = self.run_script("team-resurrect", scenario="resurrect")
        self.assertIn("missing ghost: session sid-ghost not in herdr", p.stdout)
```

- [ ] **Step 3: Run to see them fail**

Run: `cd plugins/team/tests && python3 -m unittest test_team.TeamResurrect`
Expected: FAIL (no such script).

- [ ] **Step 4: Implement `bin/team-resurrect`**

```bash
#!/usr/bin/env bash
# Relaunch team workers that a herdr restore brought back without their team
# env and flags (marked by the SessionStart hook), resuming their sessions.
# Exit codes: 0 ok, 4 herdr error.
set -euo pipefail

scratch="${TEAM_SCRATCH:-scratchpad/current}"
teamdir="$scratch/.team"
lib="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)"
scratch_abs="$(python3 -c "import os,sys;print(os.path.realpath(sys.argv[1]))" "$scratch")"

list="$(herdr agent list)" || exit 4

plan="$(PYTHONPATH="$lib" TEAMDIR="$teamdir" LIST="$list" python3 - <<'PY'
import json, os
from teamlib import records
teamdir = os.environ["TEAMDIR"]
agents = json.loads(os.environ["LIST"]).get("result", {}).get("agents", [])
panes = {a.get("agent_session", {}).get("value"): a.get("pane_id") for a in agents}
for name, rec in sorted(records(teamdir).items()):
    sid = rec.get("session", "")
    if not sid:
        continue
    pane = panes.get(sid)
    marked = os.path.exists(os.path.join(teamdir, "restored", name))
    kind = "missing" if not pane else "relaunch" if marked else "healthy"
    print("\t".join([kind, name, pane or "-", sid, rec.get("role", ""), rec.get("model", ""),
                     rec.get("effort", ""), rec.get("mode", "")]))
PY
)"

while IFS=$'\t' read -r kind name pane sid role model effort mode; do
  [ -n "$kind" ] || continue
  case "$kind" in
    missing) echo "missing $name: session $sid not in herdr" ;;
    healthy) echo "healthy $name" ;;
    relaunch)
      herdr agent prompt "$pane" "/exit" >/dev/null 2>&1 || true
      herdr agent wait "$pane" --status unknown --timeout 30000 >/dev/null 2>&1 || true
      herdr pane run "$pane" "export TEAM_NAME=$name TEAM_SCRATCH=$(printf %q "$scratch_abs")" >/dev/null || exit 4
      herdr agent start "$name" --kind claude --pane "$pane" --timeout 90000 -- \
        --resume "$sid" --agent "team-$role" --model "$model" --effort "$effort" \
        --permission-mode "$mode" --name "$name" --settings '{"crossSessionInbound":"accept"}' >/dev/null || exit 4
      rm -f "$teamdir/restored/$name"
      echo "relaunched $name ($pane)"
      ;;
  esac
done <<<"$plan"
```

`chmod +x plugins/team/bin/team-resurrect`.

- [ ] **Step 5: Write `commands/resurrect.md`**

```markdown
---
description: After a restart, relaunch team workers that came back without their team flags, resuming their sessions.
argument-hint:
---
Load the `team-orchestration` skill first. Then:

1. Run `team-resurrect`. It prints one line per worker: `relaunched`,
   `healthy`, or `missing`.
2. Report the lines to the human. For a `missing` worker, say that its
   session is gone and that it needs a new `team-start` and a new brief.
3. Run `team-status` and report the roster.
```

- [ ] **Step 6: Run the bash suite**

Run: `cd plugins/team/tests && python3 -m unittest test_team 2>&1 | tail -4`
Expected: `OK`.

- [ ] **Step 7: Checkpoint.** Show Chebu the diff.

---

### Task 13: Docs and version

**Files:**
- Modify: `plugins/team/SPEC.md`, `plugins/team/README.md`
- Modify: `plugins/team/skills/team-orchestration/SKILL.md` (and any `references/*.md` that mention `team-brief send`, `team-watch`, `team-overview`, `team-deliver`)
- Modify: `plugins/team/.claude-plugin/plugin.json` (`"version": "0.5.0"`)

- [ ] **Step 1: Find every stale mention**

Run: `grep -rn "team-brief send\|team-watch\|team-overview\|team-deliver\|overview.json\|own_pane\|agent rename" plugins/team --include=*.md`
Expected: a list; every hit is updated in Steps 2-3 (except the history in earlier `## Increment` sections of `SPEC.md`, which stays).

- [ ] **Step 2: Update the docs.** In each file from Step 1: briefs go through `mcp__team__brief_send`; the watcher and the overview are the team mod in the orchestrator session (`/team-overview` toggles the pane); identity is the session id; `/team:resurrect` after a restart. In `README.md`, list `.team/delivered.json`, `.team/restored/`, and the session index `~/.claude/team/sessions/` among the files, and state the minimum Claude Code version `2.1.287`.

- [ ] **Step 3: Add `## Increment 2026-10-05` to `SPEC.md`**

```markdown
## Increment 2026-10-05

The watcher and the overview run as a Claude Code mod in the orchestrator
session instead of two herdr panes. The mod activates in the session that
`config.json` names as `orchestrator_session`, ticks every 15 s, sends REPORT
and WATCH lines as one prompt, and draws the `Team` pane (`/team-overview`
toggles it). Agents are addressed by Claude session id, not herdr name:
`team-start` assigns `--session-id`, a `SessionStart` hook follows `/clear`,
the Stop hook finds its agent through `~/.claude/team/sessions/`, and briefs
go out through the `brief_send` tool. `/team:resurrect` relaunches workers
that a herdr restore brought back without their flags. Requires Claude Code
2.1.287.
```

- [ ] **Step 4: Bump the version** in `plugins/team/.claude-plugin/plugin.json` to `0.5.0`.

- [ ] **Step 5: Run both suites and validate**

Run: `cd plugins/team/tests && python3 -m unittest test_team 2>&1 | tail -4 && cd ../../.. && claude plugin test plugins/team && claude plugin validate plugins/team`
Expected: all pass.

- [ ] **Step 6: Checkpoint.** Show Chebu the diff.

---

### Task 14: Live verification (manual, with Chebu)

- [ ] **Step 1:** Chebu loads the branch build: `claude --plugin-dir /Users/abrose/workspace/private/claude/claude-plugins/plugins/team` in a throwaway repo tab.
- [ ] **Step 2:** `/team:init repro-2`. Expected: within 15 s the `Team` pane opens; `config.json` holds `orchestrator_session`.
- [ ] **Step 3:** Start one investigator, compose a trivial brief, send it with `brief_send`. Expected: the worker starts a turn; within one tick after its stop, the orchestrator gets `REPORT ...`.
- [ ] **Step 4:** `/team-overview` twice. Expected: hidden, then shown.
- [ ] **Step 5:** `/team:release <worker>` path for `/clear`, then compose and send a second brief. Expected: the record's `session` changed; the REPORT arrives.
- [ ] **Step 6:** Chebu quits herdr and restores it. Run `/team:resurrect`. Expected: `relaunched <worker>`; a third brief gets a REPORT.
- [ ] **Step 7:** Write the results into `scratchpad/resurrect-repro/findings.md` and report to Chebu.
