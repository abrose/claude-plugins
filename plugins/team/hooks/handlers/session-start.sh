#!/usr/bin/env bash
# SessionStart hook: a team worker keeps its identity across /clear, and a
# worker restored without its team env is marked for /team:resurrect. Runs in
# every session, so it stays silent and cheap when it does not apply.
set -uo pipefail

PAYLOAD="$(cat)" python3 - <<'PY' || true
import json, os, re

p = json.loads(os.environ["PAYLOAD"])
sid, source = p.get("session_id", ""), p.get("source", "")
index = os.environ.get("TEAM_INDEX_DIR") or os.path.join(
    os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude"), "team", "sessions")
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
