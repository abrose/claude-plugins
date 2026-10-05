"""Team records and agent state, shared by the bin/ scripts.

A role agent has a record at <teamdir>/<name>.json; its "session" field is
the Claude session id it is addressed by. The orchestrator's session is
"orchestrator_session" in <teamdir>/config.json.
"""
import glob
import json
import os

NON_RECORD_FILES = ("config.json", "watch-state.json", "tabs.json", "layout-flags.json", "delivered.json")


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
