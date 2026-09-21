#!/usr/bin/env bash
# Stop hook: if this session is a team agent, write its latest message to a
# report file and forward a REPORT line to the orchestrator. Runs in every
# session of every profile with the plugin enabled, so it stays silent and
# cheap when it does not apply, and never blocks the stop.
set -uo pipefail

payload="$(cat)"

PAYLOAD="$payload" python3 - <<'PY' || true
import os, json, subprocess, datetime, sys, re

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
    transcript = p.get("transcript_path", "")
    scratch = os.path.join(cwd, os.environ.get("TEAM_SCRATCH", "scratchpad"))
    teamdir = os.path.join(scratch, ".team")

    # A team agent knows its own name from TEAM_NAME, stamped into its pane
    # environment by team-start. No name -> this is not a team agent.
    name = os.environ.get("TEAM_NAME", "")
    if not re.match(r"^[a-z][a-z0-9_-]{0,31}$", name):
        sys.exit(0)
    recf = os.path.join(teamdir, name + ".json")
    if not os.path.isfile(recf):
        sys.exit(0)
    try:
        rec = json.load(open(recf))
    except Exception:
        sys.exit(0)

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

    # Ping the orchestrator on every stop of a team worker, so it never waits on
    # a worker that is already done. Forward the worker's REPORT line if it wrote
    # one anywhere in its final message; otherwise send a nudge to the report file.
    orch = "orchestrator"
    cf = os.path.join(teamdir, "config.json")
    if os.path.exists(cf):
        try:
            orch = json.load(open(cf)).get("orchestrator", orch) or orch
        except Exception:
            pass
    if name == orch:
        pass  # never prompt the orchestrator to itself
    elif not re.match(r"^[a-z][a-z0-9_-]{0,31}$", orch):
        log("bad orchestrator name, not forwarding: %r" % orch)
    else:
        line = None
        for ln in message.splitlines():
            if ln.strip().startswith("REPORT "):
                line = ln.strip()
                break
        if line is None:
            reldir = os.environ.get("TEAM_SCRATCH", "scratchpad")
            line = ("REPORT %s %s: stopped without a REPORT line - read %s/reports/%s-%s.md"
                    % (name, topic, reldir, name, topic))
        try:
            subprocess.run(["herdr", "agent", "prompt", orch, line],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        except Exception as e:
            log("forward failed: %s" % e)
except Exception as e:
    log("hook error: %s" % e)
PY

exit 0
