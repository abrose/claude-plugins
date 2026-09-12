# quota-statusline

A quota-spend **projection engine** for Claude Code statuslines. It reads the
rate-limit payload that Claude Code pipes to a `statusLine.command`, appends a
rolling per-profile usage sample, and prints a JSON verdict per window (`5h` and
`7d`). It answers one question per window: **at my recent pace, do I blow this
limit before it resets, or coast under it?** The `7d` projection counts the
hours you actually work, not 24/7. Rendering (colors, glyphs, bars) is the
caller's job - bring your own.

## Why an engine, not a statusline plugin

A Claude Code plugin cannot register a `statusLine` (only `agent` and
`subagentStatusLine` are allowed in a plugin's `settings.json`). So this plugin
ships an executable, `bin/quota-statusline`, and you wire your own
`statusLine.command` to call it. The plugin is the distribution and versioning
vehicle; the engine also works from a plain `git clone`.

## Dependencies

- `python3` - the engine. No third-party packages.
- `jq` - only the example renderer below, **not** the engine.

## Install

### As a plugin

```
/plugin marketplace add abrose/claude-plugins
/plugin install quota-statusline@abrose-plugins
```

### Standalone (git clone)

```
git clone https://github.com/abrose/claude-plugins
# engine lives at: claude-plugins/plugins/quota-statusline/bin/quota-statusline
```

## Wiring it into your statusline

The engine reads the payload on **stdin** and prints JSON on **stdout**. Point
your `statusLine.command` at a wrapper that calls it and renders the result.

> **Reliable path:** reference the engine by its installed absolute path, or
> symlink it into your `PATH` (e.g. `~/.local/bin`):
> `ln -s <install>/plugins/quota-statusline/bin/quota-statusline ~/.local/bin/quota-statusline`.
> Whether a bare `quota-statusline` resolves inside a `statusLine.command` while
> the plugin is enabled is not yet verified - prefer the absolute path or the
> symlink until it is.

Worked renderer (bash + `jq`), mapping `severity` to a glyph:

```bash
#!/usr/bin/env bash
input=$(cat)

# Absolute path, or a bare name if you symlinked it into PATH.
verdict=$(printf '%s' "$input" | quota-statusline)

seg() {  # seg <window-label>
  local w=$1 sev info used
  read -r sev info used < <(printf '%s' "$verdict" \
    | jq -r --arg w "$w" '.[$w] // empty | "\(.severity) \(.info) \(.used_pct)"')
  [ -z "$sev" ] && return   # window absent: render nothing
  case "$sev" in
    max)  glyph="🛑" ;;
    hot)  glyph="🔥" ;;
    near) glyph="⚠️" ;;
    warm) glyph="⏳" ;;
    *)    glyph="🟢" ;;
  esac
  printf '%s %s%% %s %s' "$w" "$used" "$info" "$glyph"
}

printf '%s  %s\n' "$(seg 5h)" "$(seg 7d)"
```

## Commands

| Invocation | Effect |
|---|---|
| `quota-statusline` | Log one usage sample (throttled + retained), then print the verdict JSON for both windows. The normal statusline path. |
| `quota-statusline --no-log` | Project only. Do not write the log. For tests and dry runs. |
| `quota-statusline --window 7d` | Print the verdict for one window only (`5h` or `7d`). Still logs unless `--no-log`. |

## Output

Default (both windows) - a JSON object keyed by window label:

```json
{
  "5h": {"severity": "near", "info": "+1h",   "diff_h": 1,    "used_pct": 50, "landing_pct": 92.0},
  "7d": {"severity": "safe", "info": "-104h", "diff_h": -104, "used_pct": 28, "landing_pct": 142.3}
}
```

`--window 7d` prints just the inner object. A payload with no `rate_limits`
prints `{}` and writes no log line.

## Field contract

| Field | Meaning |
|---|---|
| `severity` | One of `max`, `hot`, `near`, `warm`, `safe`. Drives the caller's color/glyph. |
| `info` | Human string: `+Nh` (margin), `-Nh` (over pace), `0h`, `∞` (never at this pace), `~` (too early to judge), `CAP` (already at 100%). |
| `diff_h` | Raw integer hours: cap-time minus reset. Positive = margin, negative = overshoot. `null` when `info` is `~` or `CAP`. |
| `used_pct` | Integer floor of the window's `used_percentage`. For the bar. |
| `landing_pct` | Projected used-% at reset, one decimal. `null` when `~` or `CAP`. |

### Severity rules

- `used >= 100` -> `severity=max`, `info=CAP`.
- Too early (`elapsed/window < 0.05`) -> `severity=warm`, `info=~`.
- Flat or falling pace -> `severity=safe`, `info=∞`.
- Otherwise: `severity = hot` if the projected landing `> 100`, `near` if
  `>= 80`, else `safe`. `info=∞` when the margin exceeds a week.

## Configuration - environment variables

Sensible defaults; every knob overridable by env. The first two are the ones
most people change.

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

## How the projection works

Two modes, one per window:

- **`recent` (5h).** Rate = least-squares slope of `used%` over the last
  `min(4h, window/4)` of samples. Short horizon, so extrapolating the current
  slope across the remaining wall-clock is fair. Falls back to the whole-window
  average with fewer than two recent samples.
- **`active` (7d).** Does not assume 24/7 spend. Rate = recent `%/active-hour`
  (burst intensity while the session is present, measured from sample gaps
  `<= ACTIVE_GAP`), projected over the active hours you actually work per day.
  `active_hpd` defaults to 8 and is learned from the log's duty cycle once it
  spans `LEARN_MIN_DAYS`. A gap wider than `ACTIVE_GAP` is idle time and is not
  counted, so overnight gaps do not leak in.

## Tests

Stdlib `unittest`, no dependencies:

```
python3 -m unittest discover -s plugins/quota-statusline/tests
```

## License

MIT. See [LICENSE](LICENSE).
