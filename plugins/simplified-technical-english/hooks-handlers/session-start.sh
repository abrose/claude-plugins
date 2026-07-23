#!/usr/bin/env bash
set -euo pipefail

# SessionStart hook for the simplified-technical-english plugin.
# Injects Simplified Technical English (STE) writing rules as additionalContext.
# Per-session toggle: set CLAUDE_STE=0 to silence for one session.

instructions="${CLAUDE_PLUGIN_ROOT}/instructions/ste-instructions.md"

[[ "${CLAUDE_STE:-}" == "0" ]] && exit 0
[[ -f "${instructions}" ]] || exit 0

python3 - "${instructions}" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    context = f.read()
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": context,
    }
}))
PY
