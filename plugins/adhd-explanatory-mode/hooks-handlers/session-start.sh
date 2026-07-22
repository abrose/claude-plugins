#!/usr/bin/env bash
set -euo pipefail

# SessionStart hook for the adhd-explanatory-mode plugin.
# Injects Explanatory-ADHD output rules as additionalContext.
# Per-session toggle: set CLAUDE_ADHD=0 to silence for one session.

instructions="${CLAUDE_PLUGIN_ROOT}/instructions/adhd-explanatory-instructions.md"

[[ "${CLAUDE_ADHD:-}" == "0" ]] && exit 0
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
