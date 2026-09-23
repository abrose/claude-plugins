"""Team membership and agent state, shared by the bin/ scripts.

A role agent has a record at <teamdir>/<name>.json. The team is the role
agents plus the orchestrator named in <teamdir>/config.json.
"""
import glob
import json
import os

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


def fresh_report(scratch, name, rec):
    """True when the agent's report exists and is newer than its brief."""
    topic = rec.get("topic", "")
    report = os.path.join(scratch, "reports", "%s-%s.md" % (name, topic))
    brief = os.path.join(scratch, "brief-%s-%s.md" % (name, topic))
    if not os.path.exists(report):
        return False
    return not (os.path.exists(brief) and os.path.getmtime(report) < os.path.getmtime(brief))


def orchestrator(teamdir):
    try:
        with open(os.path.join(teamdir, "config.json")) as fh:
            return json.load(fh).get("orchestrator")
    except (OSError, ValueError):
        return None


def role_agents(agents, teamdir):
    recs = records(teamdir)
    return [a for a in agents if a.get("name") in recs]


def team_agents(agents, teamdir):
    recs = records(teamdir)
    orch = orchestrator(teamdir)
    return [a for a in agents if a.get("name") in recs or (orch and a.get("name") == orch)]
