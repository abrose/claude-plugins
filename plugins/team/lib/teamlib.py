"""Team membership and agent state, shared by the bin/ scripts.

A role agent has a record at <teamdir>/<name>.json. The team is the role
agents plus the orchestrator named in <teamdir>/config.json.
"""
import datetime
import glob
import json
import os
import re

NON_RECORD_FILES = ("config.json", "watch-state.json", "tabs.json", "layout-flags.json")


def agent_state(agent):
    return agent.get("agent_status", "unknown")


def records(teamdir):
    out = {}
    for f in glob.glob(os.path.join(teamdir, "*.json")):
        if os.path.basename(f) in NON_RECORD_FILES:
            continue
        try:
            with open(f) as fh:
                out[os.path.splitext(os.path.basename(f))[0]] = json.load(fh)
        except (OSError, ValueError):
            out[os.path.splitext(os.path.basename(f))[0]] = {}
    return out


def report_line(message):
    """The first line of the message that starts with "REPORT ", or None."""
    for line in message.splitlines():
        if line.strip().startswith("REPORT "):
            return line.strip()
    return None


def fresh_report(scratch, name, rec):
    """True when the agent's report holds a REPORT line and is newer than its brief."""
    topic = rec.get("topic", "")
    report = os.path.join(scratch, "reports", "%s-%s.md" % (name, topic))
    brief = os.path.join(scratch, "brief-%s-%s.md" % (name, topic))
    try:
        with open(report) as fh:
            if report_line(fh.read()) is None:
                return False
    except OSError:
        return False
    return not (os.path.exists(brief) and os.path.getmtime(report) < os.path.getmtime(brief))


def last_turn_at(transcript):
    """Epoch seconds of the transcript's last user or assistant entry, or None.
    Claude Code keeps appending metadata after a stop, so only turns count."""
    try:
        with open(transcript, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            fh.seek(max(0, fh.tell() - 262144))
            tail = fh.read().decode("utf-8", "replace")
    except OSError:
        return None
    last = None
    for line in tail.splitlines():
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if isinstance(ev, dict) and ev.get("type") in ("user", "assistant") and ev.get("timestamp"):
            last = ev["timestamp"]
    if last is None:
        return None
    try:
        return datetime.datetime.fromisoformat(last.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def quiet_since_stop(teamdir, name, now, after):
    """True when the agent's last stop is at least `after` seconds old and no
    turn has started since, whatever state herdr shows for it."""
    try:
        with open(os.path.join(teamdir, "stops", name + ".json")) as fh:
            stop = json.load(fh)
        stopped = float(stop["at"])
    except (OSError, ValueError, KeyError, TypeError):
        return False
    if now - stopped < after:
        return False
    last = last_turn_at(stop.get("transcript", ""))
    return last is None or last <= stopped


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


def orchestrator(teamdir):
    try:
        with open(os.path.join(teamdir, "config.json")) as fh:
            return json.load(fh).get("orchestrator")
    except (OSError, ValueError):
        return None


def role_agents(agents, teamdir):
    recs = records(teamdir)
    return [a for a in agents if a.get("name") in recs]


CSI = re.compile(r"\x1b\[([0-9;?]*)([A-Za-z])")


def typed_text(ansi_line):
    """A screen line without escape codes and without dim text. Claude Code
    dims hints and placeholders; what the human typed is never dim."""
    out, dim, pos = [], False, 0
    for m in CSI.finditer(ansi_line):
        if not dim:
            out.append(ansi_line[pos:m.start()])
        pos = m.end()
        if m.group(2) == "m":
            codes = (m.group(1) or "0").split(";")
            i = 0
            while i < len(codes):
                if codes[i] in ("38", "48", "58"):   # extended colour: skip its arguments
                    i += 5 if codes[i + 1:i + 2] == ["2"] else 3
                    continue
                if codes[i] == "2":
                    dim = True
                elif codes[i] in ("0", "", "22"):
                    dim = False
                i += 1
    if not dim:
        out.append(ansi_line[pos:])
    return "".join(out)


def input_draft(screen):
    """Text typed into a Claude Code input box: the lines between the last two
    horizontal rules, after the ❯ prompt. Takes an ANSI screen. None when no
    input box shows."""
    lines = [typed_text(l).strip() for l in screen.splitlines()]
    rules = [i for i, l in enumerate(lines) if len(l) >= 10 and set(l) == {"─"}]
    if len(rules) < 2:
        return None
    box = lines[rules[-2] + 1:rules[-1]]
    if not box or not box[0].startswith("❯"):
        return None
    return "\n".join([box[0][1:]] + box[1:]).strip()


def team_agents(agents, teamdir):
    recs = records(teamdir)
    orch = orchestrator(teamdir)
    return [a for a in agents if a.get("name") in recs or (orch and a.get("name") == orch)]
