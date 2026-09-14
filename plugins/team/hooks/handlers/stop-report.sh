#!/usr/bin/env bash
# Stop hook: if this session is a team agent, write its latest message to a
# report file and forward a REPORT line to the orchestrator. Runs in every
# session of every profile with the plugin enabled, so it stays silent and
# cheap when it does not apply, and never blocks the stop.
set -uo pipefail

payload="$(cat)"

PAYLOAD="$payload" python3 - <<'PY' || true
import os, json, glob, subprocess, datetime, sys, re

def log(msg):
    try:
        cwd = json.loads(os.environ.get("PAYLOAD", "{}")).get("cwd", ".")
        d = os.path.join(cwd, os.environ.get("TEAM_SCRATCH", "scratchpad"), ".team")
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, "hook.log"), "a").write(msg + "\n")
    except Exception:
        pass

try:
    p = json.loads(os.environ["PAYLOAD"])
    cwd = p.get("cwd", ".")
    session_id = p.get("session_id", "")
    transcript = p.get("transcript_path", "")
    scratch = os.path.join(cwd, os.environ.get("TEAM_SCRATCH", "scratchpad"))
    teamdir = os.path.join(scratch, ".team")
    if not (session_id and os.path.isdir(teamdir)):
        sys.exit(0)

    match = None
    for f in glob.glob(os.path.join(teamdir, "*.json")):
        if os.path.basename(f) in ("config.json", "roster.md"):
            continue
        try:
            rec = json.load(open(f))
        except Exception:
            continue
        if rec.get("session") and rec["session"] == session_id[:8]:
            match = (os.path.splitext(os.path.basename(f))[0], rec)
            break
    if not match:
        sys.exit(0)
    name, rec = match

    # Last assistant message from the JSONL transcript.
    message = ""
    try:
        for line in open(transcript):
            line = line.strip()
            if not line:
                continue
            ev = json.loads(line)
            m = ev.get("message") if isinstance(ev.get("message"), dict) else None
            role = (m or ev).get("role") or ev.get("type")
            if role != "assistant":
                continue
            content = (m or ev).get("content", "")
            if isinstance(content, list):
                parts = [c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text"]
                text = "".join(parts)
            else:
                text = str(content)
            if text.strip():
                message = text
    except Exception as e:
        log("transcript unreadable: %s" % e)

    topic = rec.get("topic", "")
    brief = rec.get("brief", "")
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    reports = os.path.join(scratch, "reports")
    os.makedirs(reports, exist_ok=True)
    body = "# Report: %s / %s\n- Brief: %s\n- Written: %s\n\n---\n\n%s\n" % (name, topic, brief, ts, message)
    open(os.path.join(reports, "%s-%s.md" % (name, topic)), "w").write(body)

    if message.startswith("REPORT "):
        orch = "orchestrator"
        cf = os.path.join(teamdir, "config.json")
        if os.path.exists(cf):
            try:
                orch = json.load(open(cf)).get("orchestrator", orch) or orch
            except Exception:
                pass
        first = message.splitlines()[0]
        if not re.match(r"^[a-z][a-z0-9_-]{0,31}$", orch):
            log("bad orchestrator name, not forwarding: %r" % orch)
        else:
            try:
                subprocess.run(["herdr", "agent", "prompt", orch, first],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            except Exception as e:
                log("forward failed: %s" % e)
except Exception as e:
    log("hook error: %s" % e)
PY

exit 0
