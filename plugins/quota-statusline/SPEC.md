# Spec: `quota-statusline` — a Claude Code quota-projection engine plugin

## Goal

Package the quota-spend **projection engine** (used today inside Chebu's chezmoi
statusline) as a plugin in the `abrose-plugins` marketplace, so any profile can
install it and any statusline can call it. The engine answers one question per
rate-limit window: **"at my recent pace, do I blow this limit before it resets,
or coast under it?"** - and returns a machine-readable verdict. Rendering
(colors, glyphs, bars) stays with the caller.

## Why an engine, not a "statusline plugin"

A Claude Code plugin **cannot register a `statusLine`**. Confirmed from the
official plugin reference:

> Only the `agent` and `subagentStatusLine` keys are supported in a plugin's
> `settings.json`.

`statusLine.command` lives only in the user's own `settings.json`, and it is
**not** on the list of fields that expand `${CLAUDE_PLUGIN_ROOT}`. So the plugin
cannot own the status line or inject its path there.

What a plugin *can* do, and what this plugin uses:

- Ship an executable under `bin/`. Claude Code adds a plugin's `bin/` to the
  Bash tool's `PATH` while the plugin is enabled.
- Ship bundled files referenced by `${CLAUDE_PLUGIN_ROOT}` from hooks/skills.

So this plugin ships `bin/cquota`. The user wires their own `statusLine.command`
to call `cquota`, or Chebu's chezmoi statusline calls it by absolute path (see
[Consuming the engine](#consuming-the-engine)). The plugin is the distribution
and versioning vehicle; the engine is a standalone script that also works from a
plain `git clone`.

## Scope

- **In scope:** the `cquota` engine (usage-log writer + projector), its tests,
  the plugin manifest, the marketplace entry, README, LICENSE.
- **Out of scope:** any rendering (colors/glyphs/bar), and Chebu's chezmoi
  statusline changes. Those live in the chezmoi repo and consume this engine.
  This spec only *notes* how they call it.

---

## Interface contract

`cquota` reads the Claude Code statusline JSON payload on **stdin** (the same
object Claude Code pipes to a `statusLine.command`). It uses only
`.rate_limits`. It needs **no `jq`** - it parses the JSON itself.

### Commands

| Invocation | Effect |
|---|---|
| `cquota` | Log one usage sample (throttled + retained), then print the verdict JSON for **both** windows. This is the normal statusline path. |
| `cquota --no-log` | Project only. Do **not** write the log. For tests and dry runs. |
| `cquota --window 7d` | Print the verdict for one window only (`5h` or `7d`). Still logs unless `--no-log`. |

One process per render. Reading stdin once covers both windows.

### Output

Default (both windows) - a JSON object keyed by window label:

```json
{
  "5h": {"severity": "near", "info": "+1h",   "diff_h": 1,    "used_pct": 50, "landing_pct": 92.0},
  "7d": {"severity": "safe", "info": "-104h", "diff_h": -104, "used_pct": 28, "landing_pct": 142.3}
}
```

`--window 7d` prints just the inner object:

```json
{"severity": "safe", "info": "-104h", "diff_h": -104, "used_pct": 28, "landing_pct": 142.3}
```

### Field contract

| Field | Meaning |
|---|---|
| `severity` | One of `max`, `hot`, `near`, `warm`, `safe`. Drives the caller's color/glyph. |
| `info` | Human string: `+Nh` (margin, caps N hours after reset), `-Nh` (over pace, caps N hours before reset), `0h`, `∞` (never at this pace), `~` (too early to judge), `CAP` (already at 100%). |
| `diff_h` | Raw integer hours: cap-time minus reset. Positive = margin, negative = overshoot. `null` when `info` is `~` or `CAP`. For callers that format their own string. |
| `used_pct` | Integer floor of the window's `used_percentage`. For the bar. |
| `landing_pct` | Projected used-% at reset, one decimal. `null` when `~` or `CAP`. |

### Severity rules (unchanged from today's script)

- `used >= 100` -> `severity=max`, `info=CAP`.
- Too early (`elapsed/window < 0.05`) -> `severity=warm`, `info=~`.
- Flat or falling pace (rate <= 0) -> `severity=safe`, `info=∞`.
- Otherwise: `severity = hot` if `landing_pct > 100`, `near` if `>= 80`, else
  `safe`. `info=∞` when `diff_h > 168` (over a week of margin).

---

## Projection model (ported verbatim from the current statusline)

Two modes, selected per window. The math is unchanged; this spec only relocates
it. See `dot_claude/executable_statusline.sh` in the chezmoi repo for the
origin.

**`recent` mode (5h window).** Rate = least-squares slope of `used%` over the
last `min(4h, window/4)` of samples. Short horizon, so extrapolating the current
slope across the remaining wall-clock is fair. Falls back to the whole-window
average (`used/elapsed`) with fewer than two recent samples.

**`active` mode (7d window).** Does **not** assume 24/7 spend. Rate = recent
`%/active-hour` (burst intensity while the session is present, measured from
sample gaps `<= ACTIVE_GAP`), projected over the active hours actually worked per
day:

```
active_rate_h = recent_active_burn / recent_active_time * 3600      # %/active-hour, over last RATE_WINDOW
active_hpd    = clamp(total_active_time / span * 24, 1, 24)  if span >= LEARN_MIN_DAYS
              = ACTIVE_HPD_DEFAULT                            otherwise   # hybrid: default -> learned
wall_to_cap   = (100 - used) / active_rate_h * (86400 / active_hpd)
diff_h        = round((wall_to_cap - remaining) / 3600)
landing_pct   = used + active_rate_h * active_hpd * (remaining / 86400)
```

- A gap `> ACTIVE_GAP` between two samples = the session was closed/idle: that
  span is **not** counted as active time. Overnight gaps do not leak in.
- Recent-present-but-flat reads as a coast (`active_rate_h = 0` -> `∞`).
- Fallback (recent active time `< MIN_ACTIVE`): whole-window average
  `used/elapsed`. Keeps the display correct right after a deploy or a reset.

### Usage log

`cquota` appends a rolling per-profile sample so the projector has velocity and
duty-cycle history. JSONL, one line per sample:

```json
{"t": 1789200000, "h5": {"u": 50, "r": 1789209000}, "d7": {"u": 28, "r": 1789502400}}
```

- `t` = epoch seconds. `h5`/`d7` = the two windows; `u` = `used_percentage`,
  `r` = `resets_at` (epoch). The projector keeps only samples whose `r` matches
  the current window instance - so a reset starts a clean history.
- **Throttle:** append only if the newest sample is `>= THROTTLE` old; else
  rewrite the file unchanged. Bounds the file and gives evenly-spaced samples
  (active detection relies on the spacing).
- **Retention:** prune samples older than `RETAIN_DAYS`.

---

## Configuration - environment variables

Sensible defaults; every knob overridable by env. The first two are the ones
real users change.

| Env var | Default | Meaning |
|---|---|---|
| `CQUOTA_ACTIVE_HPD_DEFAULT` | `8` | Active hours/day assumed until the log spans `LEARN_MIN_DAYS`. Your work pattern. |
| `CQUOTA_LOG_PATH` | `$CLAUDE_CONFIG_DIR/usage-log.jsonl`, else `~/.claude/usage-log.jsonl` | Where the sample log lives. Per-profile by default. |
| `CQUOTA_NOW` | `time.time()` | Injectable clock (epoch seconds). Tests set this for determinism. |
| `CQUOTA_ACTIVE_GAP` | `900` | Max gap (s) between samples still counted as "session present". |
| `CQUOTA_RATE_WINDOW` | `86400` | Window (s) for the recent active burn rate. |
| `CQUOTA_MIN_ACTIVE` | `900` | Minimum recent active time (s) before trusting the active rate. |
| `CQUOTA_LEARN_MIN_DAYS` | `3` | Learn `active_hpd` from the log only past this span. |
| `CQUOTA_RETAIN_DAYS` | `10` | Prune samples older than this. |
| `CQUOTA_THROTTLE` | `300` | Minimum seconds between appended samples. |

> The internal knobs (`ACTIVE_GAP` ... `THROTTLE`) are first-cut values. Tune
> them against real accumulated data - see [Open tuning](#open-tuning).

---

## Repo layout

A plugin under the existing `abrose-plugins` marketplace monorepo, matching the
sibling `adhd-friendly-simple-technical-english` layout (plugins under
`./plugins/<name>`).

```
claude-plugins/                              # the marketplace repo (already exists)
├── .claude-plugin/
│   └── marketplace.json                     # add one entry (below)
└── plugins/
    └── quota-statusline/
        ├── .claude-plugin/
        │   └── plugin.json                  # the plugin manifest
        ├── bin/
        │   └── cquota                       # the engine (python3, +x)   <- the payload
        ├── tests/
        │   └── test_cquota.py               # behaviour + unit tests (stdlib unittest)
        ├── SPEC.md                          # this file
        ├── README.md                        # what it is, install, the settings.json snippet
        └── LICENSE                          # MIT
```

`cquota` is a single python3 file structured as an importable module (pure
functions + `if __name__ == "__main__": main()`), so tests can call `project()`
directly *and* drive the CLI over stdin.

---

## File contents

### `.claude-plugin/marketplace.json` - add this plugin to the `plugins` array

```json
{
  "name": "quota-statusline",
  "description": "Quota-spend projection engine for statuslines. Reads the Claude Code rate-limit payload, logs a rolling per-profile usage sample, and emits a JSON verdict per window (5h/7d): are you on pace to blow the limit before it resets, or coasting under it? Weekly projection counts active hours, not 24/7. Bring your own rendering.",
  "source": "./plugins/quota-statusline",
  "category": "productivity"
}
```

### `plugins/quota-statusline/.claude-plugin/plugin.json`

```json
{
  "name": "quota-statusline",
  "version": "1.0.0",
  "description": "Quota-spend projection engine (bin/cquota). Reads the Claude Code rate-limit payload and emits a per-window JSON verdict for statuslines; the 7d projection counts active hours, not 24/7.",
  "author": {
    "name": "Alfred Brose"
  }
}
```

### `plugins/quota-statusline/bin/cquota`

Single python3 file. No third-party deps. Ports the log block and `projection()`
from the chezmoi statusline; adds arg parsing, env config, and JSON output.
`chmod +x` before commit.

```python
#!/usr/bin/env python3
"""cquota - quota-spend projection engine for Claude Code statuslines.

Reads the statusline JSON payload on stdin (uses only .rate_limits). Appends a
rolling per-profile usage sample, then prints a JSON verdict per rate-limit
window. Rendering is the caller's job. See SPEC.md for the model and the field
contract.
"""
import json
import os
import sys
import time

# Window table: label -> (window_seconds, log_key, mode).
WINDOWS = {
    "5h": (18000, "h5", "recent"),
    "7d": (604800, "d7", "active"),
}
# Which rate_limits key feeds which log key.
PAYLOAD_KEY = {"h5": "five_hour", "d7": "seven_day"}


def env_num(name, default):
    try:
        return type(default)(os.environ[name])
    except (KeyError, ValueError):
        return default


def now_ts():
    return int(os.environ.get("CQUOTA_NOW") or time.time())


def log_path():
    if "CQUOTA_LOG_PATH" in os.environ:
        return os.environ["CQUOTA_LOG_PATH"]
    config_dir = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(
        os.path.expanduser("~"), ".claude"
    )
    return os.path.join(config_dir, "usage-log.jsonl")


def log_sample(data, now):
    """Append one throttled, retained sample from the payload's rate_limits."""
    rl = data.get("rate_limits")
    if not rl:
        return
    retain = env_num("CQUOTA_RETAIN_DAYS", 10) * 86400
    throttle = env_num("CQUOTA_THROTTLE", 300)
    entry = {"t": now}
    for log_key, payload_key in PAYLOAD_KEY.items():
        w = rl.get(payload_key)
        if w:
            entry[log_key] = {"u": w.get("used_percentage", 0), "r": w.get("resets_at", 0)}
    path = log_path()
    kept, newest = [], None
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    t = json.loads(line).get("t", 0)
                except ValueError:
                    continue
                if t >= now - retain:
                    kept.append(line)
                    if newest is None or t > newest:
                        newest = t
    except FileNotFoundError:
        pass
    if newest is None or now - newest >= throttle:
        kept.append(json.dumps(entry))
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w") as f:
        f.write("\n".join(kept) + "\n")


def load_points(path, key, resets_at, now):
    """Samples for this window instance: matching reset, within retention, sorted."""
    retain = env_num("CQUOTA_RETAIN_DAYS", 10) * 86400
    pts = []
    try:
        with open(path) as f:
            for line in f:
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                w = e.get(key)
                if not w or float(w.get("r", 0)) != resets_at:
                    continue
                t = float(e.get("t", 0))
                if t >= now - retain:
                    pts.append((t, float(w.get("u", 0))))
    except FileNotFoundError:
        pass
    pts.sort()
    return pts


def project(used, resets_at, win, now, pts, mode):
    """Return the verdict dict for one window. Pure: pts already loaded."""
    active_gap = env_num("CQUOTA_ACTIVE_GAP", 900)
    rate_window = env_num("CQUOTA_RATE_WINDOW", 86400)
    min_active = env_num("CQUOTA_MIN_ACTIVE", 900)
    learn_min = env_num("CQUOTA_LEARN_MIN_DAYS", 3) * 86400
    active_hpd_default = float(env_num("CQUOTA_ACTIVE_HPD_DEFAULT", 8))

    used_pct = int(used)
    if used >= 100:
        return _verdict("max", "CAP", None, used_pct, None)
    elapsed = now - (resets_at - win)
    remaining = resets_at - now
    if elapsed <= 0 or remaining <= 0 or elapsed / win < 0.05:
        return _verdict("warm", "~", None, used_pct, None)

    def wall_project(rate_sec):
        if rate_sec <= 0:
            return None
        return (used + rate_sec * remaining,
                round(((100 - used) / rate_sec - remaining) / 3600))

    cumulative = used / elapsed if elapsed > 0 else 0.0
    landing = diff_h = None

    if mode == "active":
        tot_active = rec_active = rec_burn = 0.0
        for i in range(1, len(pts)):
            t0, u0 = pts[i - 1]
            t1, u1 = pts[i]
            gap = t1 - t0
            if gap <= 0 or gap > active_gap:
                continue
            tot_active += gap
            if t1 >= now - rate_window:
                rec_active += gap
                rec_burn += max(0.0, u1 - u0)
        span = pts[-1][0] - pts[0][0] if len(pts) >= 2 else 0.0
        active_hpd = active_hpd_default
        if span >= learn_min and tot_active > 0:
            active_hpd = min(24.0, max(1.0, tot_active / span * 24.0))
        if rec_active >= min_active:
            rate_h = rec_burn / rec_active * 3600.0
            if rate_h > 0:
                wall_to_cap = (100 - used) / rate_h * (86400.0 / active_hpd)
                landing = used + rate_h * active_hpd * (remaining / 86400.0)
                diff_h = round((wall_to_cap - remaining) / 3600)
        else:
            res = wall_project(cumulative)
            if res:
                landing, diff_h = res
    else:  # recent velocity (5h)
        lb = min(4 * 3600, win / 4)
        rp = [p for p in pts if p[0] >= now - lb]
        slope = None
        if len(rp) >= 2:
            n = len(rp)
            ts = [p[0] for p in rp]
            us = [p[1] for p in rp]
            tb = sum(ts) / n
            ub = sum(us) / n
            den = sum((t - tb) ** 2 for t in ts)
            if den > 0:
                slope = sum((ts[i] - tb) * (us[i] - ub) for i in range(n)) / den
        res = wall_project(slope if slope is not None else cumulative)
        if res:
            landing, diff_h = res

    if landing is None:
        return _verdict("safe", "∞", None, used_pct, None)
    if diff_h > 168:
        info = "∞"
    elif diff_h > 0:
        info = f"+{diff_h}h"
    elif diff_h < 0:
        info = f"{diff_h}h"
    else:
        info = "0h"
    sev = "hot" if landing > 100 else "near" if landing >= 80 else "safe"
    return _verdict(sev, info, diff_h, used_pct, round(landing, 1))


def _verdict(severity, info, diff_h, used_pct, landing_pct):
    return {
        "severity": severity,
        "info": info,
        "diff_h": diff_h,
        "used_pct": used_pct,
        "landing_pct": landing_pct,
    }


def verdict_for(label, data, now, path):
    win, key, mode = WINDOWS[label]
    rl = data.get("rate_limits") or {}
    w = rl.get(PAYLOAD_KEY[key])
    if not w or w.get("used_percentage") is None or w.get("resets_at") is None:
        return None
    used = float(w["used_percentage"])
    resets_at = float(w["resets_at"])
    pts = load_points(path, key, resets_at, now)
    return project(used, resets_at, win, now, pts, mode)


def main(argv):
    do_log = True
    only = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--no-log":
            do_log = False
        elif a == "--window":
            i += 1
            only = argv[i]
        else:
            sys.stderr.write(f"cquota: unknown arg {a}\n")
            return 2
        i += 1
    if only is not None and only not in WINDOWS:
        sys.stderr.write(f"cquota: unknown window {only}\n")
        return 2

    try:
        data = json.loads(sys.stdin.read() or "{}")
    except ValueError:
        data = {}
    now = now_ts()
    if do_log:
        log_sample(data, now)
    path = log_path()

    if only is not None:
        v = verdict_for(only, data, now, path)
        print(json.dumps(v))
        return 0
    out = {}
    for label in WINDOWS:
        v = verdict_for(label, data, now, path)
        if v is not None:
            out[label] = v
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
```

### `plugins/quota-statusline/tests/test_cquota.py`

Stdlib `unittest`, run with `python3 -m unittest` (pristine output, no deps).
Two layers, per the testing rules:

- **Unit:** import `cquota`, call `project(...)` directly with synthetic `pts`.
  Assert on the verdict dict. Fast, no I/O.
- **Behaviour / e2e:** run `bin/cquota` as a subprocess. Pipe a crafted payload
  on stdin, set `CQUOTA_NOW` and `CQUOTA_LOG_PATH` to a temp file. Assert on the
  parsed JSON output and on the log file contents.

Port the existing 33 assertions from
`tests/statusline/projection_test.sh` (chezmoi). They get *simpler* here: the
output is structured JSON, so no ANSI stripping and no bar-split parsing. Cases
to carry over, at minimum:

1. Active burst is not read as 24/7 (`7d` margin reflects intensity x 8h/day).
2. Coast (recent-present-but-flat) -> `info == "∞"`, `severity == "safe"`.
3. Overnight gap ignored (a `> ACTIVE_GAP` gap does not shrink the margin).
4. Steep burst -> `severity == "hot"`, negative `diff_h`.
5. Learned `active_hpd` (>= 3-day log, low duty) relaxes vs the 8h default.
6. 5h recent-velocity cases: under pace (`+Nh`), over pace (`-Nh`), near.
7. Warm (`~`) too-early guard, and `CAP` at `used >= 100`.
8. Throttle: two renders `< THROTTLE` apart append one sample.
9. Retention: a sample older than `RETAIN_DAYS` is pruned.
10. Per-profile isolation: `CQUOTA_LOG_PATH` fully separates histories.
11. No `rate_limits` in the payload -> empty object out, no crash, no log write.

### `plugins/quota-statusline/README.md`

Cover: what it is (one paragraph), the field contract table, the env-var table,
and copy-paste usage. Show the standalone install AND the plugin install. Include
a worked statusline snippet a reader can paste (bash + `jq` reading the JSON,
mapping `severity` to a glyph). State deps: `python3` (engine), `jq` (only the
example renderer, not the engine).

### `plugins/quota-statusline/LICENSE`

MIT, `Alfred Brose`. (Matches the sibling plugin.)

---

## Consuming the engine

### Public users (via the plugin)

```
/plugin marketplace add abrose/claude-plugins        # if not already added
/plugin install quota-statusline@abrose-plugins
```

Then point `statusLine.command` at the engine. **Open question to verify:**
whether a `statusLine.command` runs with the enabled plugin's `bin/` on `PATH`.

- If **yes**: the command is just `cquota` (plus the user's renderer). Cleanest.
- If **no**: the user references the engine by its installed path, or symlinks
  `bin/cquota` into their own `PATH` (e.g. `~/.local/bin`). The README documents
  the fallback.

This must be tested on a real install before publishing - see [Verify](#verify).

### Chebu's chezmoi statusline (the real first consumer)

Chebu's statusline does **not** depend on the plugin-enable `PATH`. It calls the
engine by a known path:

1. Add a `git-repo` external to chezmoi's `.chezmoiexternal.toml` that clones the
   `claude-plugins` marketplace repo into `$HOME` (same pattern as oh-my-zsh /
   tpm), with a `refreshPeriod`.
2. In `dot_claude/executable_statusline.sh`, **remove** the embedded log block
   and the `projection()` python. Call
   `python3 "$HOME/<clone>/plugins/quota-statusline/bin/cquota"` once, read the
   JSON with `jq`, and keep all existing rendering (profile, bar, glyphs,
   colors).
3. Graceful degrade: if the engine path is missing (fresh machine, external not
   pulled yet), skip the quota segments - no crash.
4. The procureai symlink and both `modify_settings.json.tmpl` paths are
   unchanged; they still point at `~/.claude/statusline.sh`.

That chezmoi change is a **separate task in the chezmoi repo**, tracked there,
not built from this spec.

---

## Publish steps (run in the `claude-plugins` repo)

1. Create the files above; `chmod +x plugins/quota-statusline/bin/cquota`.
2. Add the marketplace entry to `.claude-plugin/marketplace.json`.
3. `python3 -m unittest discover -s plugins/quota-statusline/tests` - all green.
4. `git add -A && git commit -m "feat: quota-statusline projection engine plugin"`
   (no agent-attribution trailers - the chezmoi hook rule; keep it here too).
5. Push. The marketplace repo is `abrose/claude-plugins` on GitHub (confirm the
   remote/slug).

---

## Verify

- **Unit + behaviour:** `python3 -m unittest discover -s plugins/quota-statusline/tests`
  passes, output pristine.
- **CLI smoke:** pipe a real captured payload:
  ```bash
  echo "$PAYLOAD" | CQUOTA_LOG_PATH=/tmp/cq.jsonl CQUOTA_NOW=1789200000 \
    plugins/quota-statusline/bin/cquota | python3 -m json.tool
  ```
  Confirm both windows appear with believable `info`/`landing_pct`, and that
  `/tmp/cq.jsonl` gained one line.
- **Plugin PATH question:** install the plugin on a scratch profile; from a
  `statusLine.command`, test whether bare `cquota` resolves. Record the answer in
  the README (drives the public install instructions).
- **No-limits guard:** a payload with no `rate_limits` prints `{}` and writes no
  log line.

---

## Open tuning

The internal constants (`ACTIVE_GAP`, `RATE_WINDOW`, `ACTIVE_HPD_DEFAULT`,
`LEARN_MIN_DAYS`) are first-cut. After the log accrues a few real days, revisit
them against Chebu's actual duty cycle. They are env-overridable, so tuning does
not require a code change - only a default bump once real data confirms a better
value.

---

## Decisions to confirm before building

1. **Executable name `cquota`** - short for "claude quota". Keep it, or prefer
   `quota-statusline` / `claude-quota`?
2. **Engine language python3** - matches the current implementation and needs no
   `jq`. Keep it (vs a bash + embedded-python port)?
3. **Marketplace slug** - the README/install lines assume the GitHub repo is
   `abrose/claude-plugins`. Confirm the exact `owner/repo`.
4. **MIT license** - same as the sibling plugin. Confirm.

---

## Notes

- Commit only when Chebu asks; never add agent-attribution trailers (a
  `block-agent-attribution` hook enforces this in the chezmoi repo; keep the same
  discipline here).
- The engine is behaviour-compatible with today's statusline output. The chezmoi
  statusline must render identically after switching to `cquota` - that is the
  acceptance bar for the migration.
```