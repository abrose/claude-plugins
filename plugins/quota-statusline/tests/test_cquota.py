"""Tests for the quota-statusline projection engine.

Two layers:
  * Unit - import the engine, call project() directly with synthetic samples.
  * Behaviour - run bin/quota-statusline as a subprocess, pipe a crafted
    payload on stdin, assert on the parsed JSON and the log file.

The expected projection values are ported from the proven chezmoi suite
(tests/statusline/projection_test.sh); the math is identical, so the numbers
transfer verbatim. Glyph->severity map from the origin: hot/🔥, near/⚠️,
warm/⏳, max/🛑, safe/🟢.
"""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from importlib.machinery import SourceFileLoader

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.join(HERE, "..", "bin", "quota-statusline")

# Fixed clock shared with the chezmoi suite so the proven numbers apply.
NOW = 1789200000
H5_RESET = NOW + 9000       # half of the 5h window
D7_RESET = NOW + 302400     # half of the 7d window


def load_engine():
    # The engine has no .py suffix, so name a loader explicitly. Suppress the
    # bytecode cache so importing it never writes __pycache__ into the shipped
    # bin/ directory.
    sys.dont_write_bytecode = True
    loader = SourceFileLoader("quota_engine", ENGINE)
    spec = importlib.util.spec_from_loader("quota_engine", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


cq = load_engine()


def gen_samples(key, start_used, end_used, n, t0, reset):
    """n JSONL sample lines, 300s apart, used% rising start->end.

    Integer step matches the bash gen_samples helper exactly.
    """
    lines = []
    for i in range(n):
        u = start_used + (end_used - start_used) * i // (n - 1)
        lines.append(json.dumps({"t": t0 + i * 300, key: {"u": u, "r": reset}}))
    return lines


def payload(h5_used=None, h5_reset=H5_RESET, d7_used=None, d7_reset=D7_RESET):
    rl = {}
    if h5_used is not None:
        rl["five_hour"] = {"used_percentage": h5_used, "resets_at": h5_reset}
    if d7_used is not None:
        rl["seven_day"] = {"used_percentage": d7_used, "resets_at": d7_reset}
    doc = {"model": {"display_name": "Opus"}}
    if rl:
        doc["rate_limits"] = rl
    return json.dumps(doc)


class ProjectUnitTests(unittest.TestCase):
    """Pure: call project() with samples already in hand, no I/O."""

    def test_capped_window_is_max(self):
        v = cq.project(100.0, H5_RESET, 18000, NOW, [], "recent")
        self.assertEqual(v["severity"], "max")
        self.assertEqual(v["info"], "CAP")
        self.assertEqual(v["used_pct"], 100)
        self.assertIsNone(v["diff_h"])
        self.assertIsNone(v["landing_pct"])

    def test_too_early_is_warm(self):
        # Only 10000s of the 7d window elapsed: below the 5% floor.
        v = cq.project(2.0, NOW + 594800, 604800, NOW, [], "active")
        self.assertEqual(v["severity"], "warm")
        self.assertEqual(v["info"], "~")
        self.assertEqual(v["used_pct"], 2)
        self.assertIsNone(v["diff_h"])

    def test_recent_present_but_flat_is_coast(self):
        pts = [(NOW - 3600 + i * 300, 60.0) for i in range(13)]
        v = cq.project(60.0, D7_RESET, 604800, NOW, pts, "active")
        self.assertEqual(v["severity"], "safe")
        self.assertEqual(v["info"], "∞")
        self.assertIsNone(v["diff_h"])

    def test_recent_slope_lands_on_the_boundary(self):
        # 5h window, slope 1/180 %/s over the last 3 samples -> lands at 80%,
        # caps 1h after reset.
        pts = [(NOW - 3600, 10.0), (NOW - 1800, 20.0), (NOW, 30.0)]
        v = cq.project(30.0, H5_RESET, 18000, NOW, pts, "recent")
        self.assertEqual(v["severity"], "near")
        self.assertEqual(v["info"], "+1h")
        self.assertEqual(v["diff_h"], 1)
        self.assertEqual(v["landing_pct"], 80.0)

    def test_used_pct_is_floored(self):
        v = cq.project(30.7, D7_RESET, 604800, NOW, [], "active")
        self.assertEqual(v["used_pct"], 30)

    def low_duty_history(self, extra=None):
        """A bursty low-duty 7d history: a dense active cluster ~3 days ago, a
        multi-day idle gap, and a short active cluster ending at NOW. `extra`
        appends one later sample so a second render can push span past the
        3-day learn threshold.
        """
        pts = [(NOW - 259000 + i * 300, 40.0 + 2.0 * i / 8) for i in range(9)]
        pts += [(NOW - 2700 + i * 300, 50.0 + 4.0 * i / 9) for i in range(10)]
        if extra is not None:
            pts.append(extra)
        pts.sort()
        return pts

    def test_landing_does_not_jump_when_span_crosses_learn_min(self):
        # Two renders 10 min apart. The second adds one flat sample that tips
        # span from just under 3 days to just over. used% is unchanged, so the
        # verdict must not lurch.
        before = self.low_duty_history()
        after = self.low_duty_history(extra=(NOW + 600, 54.0))

        v_before = cq.project(54.0, D7_RESET, 604800, NOW, before, "active")
        v_after = cq.project(54.0, D7_RESET, 604800, NOW + 600, after, "active")

        self.assertEqual(v_after["severity"], v_before["severity"])
        self.assertLess(
            abs(v_after["landing_pct"] - v_before["landing_pct"]),
            0.25 * v_before["landing_pct"],
        )

    def two_cluster_history(self, earlier_start):
        """A ~4h active cluster ending at NOW plus a second ~4h cluster starting
        at `earlier_start`. Both clusters carry identical active time; only the
        idle gap between them changes with `earlier_start`.
        """
        recent = [(NOW - 14100 + i * 300, 50.0 + 4.0 * i / 47) for i in range(48)]
        earlier = [(earlier_start + i * 300, 40.0) for i in range(48)]
        return sorted(earlier + recent)

    def test_idle_days_between_bursts_do_not_dilute_duty(self):
        # Same active work, same recent burst - only the idle gap grows. Duty is
        # hours-per-active-day, so widening the gap must not relax the landing.
        near = self.two_cluster_history(NOW - 3 * 86400 - 3600)
        far = self.two_cluster_history(NOW - 6 * 86400 - 3600)

        v_near = cq.project(54.0, D7_RESET, 604800, NOW, near, "active")
        v_far = cq.project(54.0, D7_RESET, 604800, NOW, far, "active")

        self.assertEqual(v_near["landing_pct"], v_far["landing_pct"])


class CliBehaviourTests(unittest.TestCase):
    """Run the engine the way Claude Code does: JSON on stdin, JSON out."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.log = os.path.join(self.dir, "usage-log.jsonl")

    def run_engine(self, stdin, now=NOW, log=None, args=()):
        env = dict(os.environ)
        env["CQUOTA_NOW"] = str(now)
        env["CQUOTA_LOG_PATH"] = log or self.log
        proc = subprocess.run(
            [sys.executable, ENGINE, *args],
            input=stdin,
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(proc.stderr, "", "engine wrote to stderr")
        return json.loads(proc.stdout)

    def seed(self, *lines):
        with open(self.log, "w") as f:
            f.write("\n".join(lines) + "\n")

    def d7_count(self):
        with open(self.log) as f:
            return sum(1 for line in f if '"d7"' in line)

    # --- cold-log projection (bootstrap from the window average) ---

    def test_under_pace_shows_positive_margin(self):
        out = self.run_engine(payload(h5_used=3, d7_used=30))
        self.assertEqual(out["7d"]["info"], "+112h")
        self.assertEqual(out["7d"]["severity"], "safe")
        self.assertEqual(out["7d"]["used_pct"], 30)

    def test_over_pace_shows_negative_hours_and_hot(self):
        out = self.run_engine(payload(h5_used=30, d7_used=60))
        self.assertEqual(out["7d"]["info"], "-28h")
        self.assertEqual(out["7d"]["severity"], "hot")
        self.assertLess(out["7d"]["diff_h"], 0)

    def test_near_pace_shows_small_margin(self):
        out = self.run_engine(payload(h5_used=3, d7_used=48))
        self.assertEqual(out["7d"]["info"], "+7h")
        self.assertEqual(out["7d"]["severity"], "near")

    def test_warming_up_is_warm(self):
        out = self.run_engine(payload(h5_used=3, d7_used=2, d7_reset=NOW + 594800))
        self.assertEqual(out["7d"]["severity"], "warm")
        self.assertEqual(out["7d"]["info"], "~")
        self.assertEqual(out["7d"]["used_pct"], 2)
        self.assertIsNone(out["7d"]["landing_pct"])

    def test_capped_window_is_max(self):
        out = self.run_engine(payload(h5_used=100, d7_used=0))
        self.assertEqual(out["5h"]["severity"], "max")
        self.assertEqual(out["5h"]["info"], "CAP")
        self.assertEqual(out["5h"]["used_pct"], 100)

    def test_no_rate_limits_is_empty_and_writes_no_log(self):
        out = self.run_engine(payload())
        self.assertEqual(out, {})
        self.assertFalse(os.path.exists(self.log), "a no-limits render wrote a log")

    # --- active-mode projection (7d, duty-cycle aware) ---

    def test_active_burst_projected_over_worked_hours_not_247(self):
        # 24->30 over the last 4h. Duty is learned with growing confidence, so
        # 4h of same-day activity nudges active-hpd just below the 8h default and
        # the margin lands a few hours wider than a pure-default projection.
        self.seed(*gen_samples("d7", 24, 30, 48, 1789185600, D7_RESET))
        out = self.run_engine(payload(h5_used=3, d7_used=30))
        self.assertEqual(out["7d"]["info"], "+60h")
        self.assertEqual(out["7d"]["severity"], "safe")

    def test_active_coast_reads_infinity(self):
        self.seed(*gen_samples("d7", 60, 60, 12, 1789196400, D7_RESET))
        out = self.run_engine(payload(h5_used=3, d7_used=60))
        self.assertEqual(out["7d"]["info"], "∞")
        self.assertEqual(out["7d"]["severity"], "safe")

    def test_active_surge_reads_hot(self):
        self.seed(*gen_samples("d7", 20, 27, 6, 1789198200, D7_RESET))
        out = self.run_engine(payload(h5_used=3, d7_used=27))
        self.assertEqual(out["7d"]["severity"], "hot")

    def test_overnight_gap_not_counted_as_active(self):
        lines = gen_samples("d7", 10, 15, 6, NOW - 108000, D7_RESET)
        lines += gen_samples("d7", 40, 40, 6, 1789198200, D7_RESET)
        self.seed(*lines)
        out = self.run_engine(payload(h5_used=3, d7_used=40))
        self.assertEqual(out["7d"]["info"], "∞")
        self.assertNotEqual(out["7d"]["severity"], "hot")

    def test_short_burst_reads_hot(self):
        self.seed(*gen_samples("d7", 30, 34, 6, 1789198200, D7_RESET))
        out = self.run_engine(payload(h5_used=3, d7_used=34))
        self.assertEqual(out["7d"]["severity"], "hot")

    def test_learned_low_duty_history_relaxes_to_safe(self):
        lines = gen_samples("d7", 30, 34, 6, 1789198200, D7_RESET)
        for days in (4, 5, 6):
            lines += gen_samples("d7", 10, 10, 12, NOW - days * 86400, D7_RESET)
        self.seed(*lines)
        out = self.run_engine(payload(h5_used=3, d7_used=34))
        self.assertEqual(out["7d"]["severity"], "safe")

    # --- log bookkeeping ---

    def test_throttle_appends_at_most_one_sample_per_window(self):
        self.run_engine(payload(h5_used=3, d7_used=30), now=NOW)
        self.run_engine(payload(h5_used=3, d7_used=31), now=NOW + 240)
        self.assertEqual(self.d7_count(), 1)

    def test_retention_prunes_old_samples(self):
        self.seed('{"t":1788249600,"d7":{"u":5,"r":1789502400}}')
        self.run_engine(payload(h5_used=3, d7_used=30))
        with open(self.log) as f:
            self.assertNotIn("1788249600", f.read())

    def test_no_log_flag_does_not_write(self):
        out = self.run_engine(payload(h5_used=3, d7_used=30), args=("--no-log",))
        self.assertIn("7d", out)
        self.assertFalse(os.path.exists(self.log))

    def test_window_flag_prints_single_window(self):
        out = self.run_engine(payload(h5_used=3, d7_used=30), args=("--window", "7d"))
        self.assertIn("severity", out)
        self.assertNotIn("5h", out)

    def test_per_profile_logs_are_isolated(self):
        log_a = os.path.join(self.dir, "a.jsonl")
        log_b = os.path.join(self.dir, "b.jsonl")
        self.run_engine(payload(h5_used=3, d7_used=30), log=log_a)
        self.run_engine(payload(h5_used=3, d7_used=30), log=log_b)
        with open(log_a) as f:
            self.assertEqual(sum(1 for _ in f if _.strip()), 1)
        self.assertTrue(os.path.exists(log_b))


if __name__ == "__main__":
    unittest.main()
