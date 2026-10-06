#!/usr/bin/env bash
# Stop hook: if this session is a team agent, write its latest message to a
# report file and record the stop; the orchestrator's mod picks the report up.
# Runs in every session of every profile with the plugin enabled, so it stays
# silent and cheap when it does not apply, and never blocks the stop.
set -uo pipefail

payload="$(cat)"

PAYLOAD="$payload" python3 - <<'PY' || true
import os, json, datetime, sys, re, time

def log(msg):
    try:
        cwd = json.loads(os.environ.get("PAYLOAD", "{}")).get("cwd", ".")
        d = os.path.join(cwd, os.environ.get("TEAM_SCRATCH", "scratchpad/current"), ".team")
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, "hook.log"), "a").write(msg + "\n")
    except Exception:
        pass

def last_message_in(transcript):
    """Last assistant text in the JSONL transcript, "" when there is none."""
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
    return message

try:
    p = json.loads(os.environ["PAYLOAD"])
    cwd = p.get("cwd", ".")
    transcript = p.get("transcript_path", "")

    # A team agent knows its name from TEAM_NAME, stamped into its pane by
    # team-start and kept through /clear. A restart loses the env; then the
    # session index, which follows /clear, names it by session id.
    def by_env():
        name = os.environ.get("TEAM_NAME", "")
        scratch = os.path.join(cwd, os.environ.get("TEAM_SCRATCH", "scratchpad/current"))
        return (name, os.path.join(scratch, ".team")) if name else None

    def by_session():
        sid = p.get("session_id", "")
        index = os.environ.get("TEAM_INDEX_DIR") or os.path.join(
            os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude"), "team", "sessions")
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
    try:
        rec = json.load(open(os.path.join(teamdir, name + ".json")))
    except Exception:
        sys.exit(0)
    if not os.environ.get("TEAM_NAME") and rec.get("session") != p.get("session_id"):
        sys.exit(0)

    # Last assistant message. The payload carries it; the transcript may not
    # hold it yet when the hook runs, so it is only the fallback.
    message = p.get("last_assistant_message") or last_message_in(transcript)

    topic = rec.get("topic", "")
    brief = rec.get("brief", "")
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    reports = os.path.join(scratch, "reports")
    os.makedirs(reports, exist_ok=True)
    report = os.path.join(reports, "%s-%s.md" % (name, topic))

    # The orchestrator's mod picks a REPORT up within a tick; a later stop
    # without one (a peer message woke the worker) keeps it until a new brief.
    def has_report(text):
        return any(l.strip().startswith("REPORT ") for l in text.splitlines())

    def fresh_report_on_disk():
        try:
            if not has_report(open(report).read()):
                return False
            brief_file = os.path.join(scratch, "brief-%s-%s.md" % (name, topic))
            return not (os.path.exists(brief_file) and os.path.getmtime(report) < os.path.getmtime(brief_file))
        except OSError:
            return False

    if has_report(message) or not fresh_report_on_disk():
        body = "# Report: %s / %s\n- Brief: %s\n- Written: %s\n\n---\n\n%s\n" % (name, topic, brief, ts, message)
        open(report, "w").write(body)

    # Record the stop, so the orchestrator's mod can tell a worker that stays
    # quiet after it from one that started a new turn, even while herdr shows
    # it working.
    stops = os.path.join(teamdir, "stops")
    os.makedirs(stops, exist_ok=True)
    json.dump({"transcript": transcript, "at": time.time()},
              open(os.path.join(stops, name + ".json"), "w"))
except Exception as e:
    log("hook error: %s" % e)
PY

exit 0
