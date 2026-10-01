"""Behaviour tests for the team plugin scripts.

Each test runs a bin/ script as a subprocess in a throwaway project directory.
A shim directory on PATH exposes tests/fake-herdr as `herdr` and tests/fake-git
as `git`; both record every invocation and answer with canned JSON, so the
scripts run against a real (fake) CLI, never a mock.
"""
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)          # plugins/team
BIN = os.path.join(ROOT, "bin")
SCRATCH = os.path.join("scratchpad", "current")


def write_text(path, content):
    with open(path, "w") as f:
        f.write(content)


def read_text(path):
    with open(path) as f:
        return f.read()


class Base(unittest.TestCase):
    def setUp(self):
        self.proj = tempfile.mkdtemp()
        self.shim = os.path.join(self.proj, "_shim")
        os.makedirs(self.shim)
        os.symlink(os.path.join(HERE, "fake-herdr"), os.path.join(self.shim, "herdr"))
        os.symlink(os.path.join(HERE, "fake-git"), os.path.join(self.shim, "git"))
        self.herdr_log = os.path.join(self.proj, "herdr.log")
        self.git_log = os.path.join(self.proj, "git.log")
        open(self.herdr_log, "w").close()
        open(self.git_log, "w").close()

    def tearDown(self):
        shutil.rmtree(self.proj, ignore_errors=True)

    def env(self, scenario="ok", **extra):
        e = dict(os.environ)
        e["PATH"] = self.shim + os.pathsep + e["PATH"]
        e["FAKE_HERDR_LOG"] = self.herdr_log
        e["FAKE_GIT_LOG"] = self.git_log
        e["FAKE_HERDR_SCENARIO"] = scenario
        e["TEAM_SCRATCH"] = SCRATCH
        e["CLAUDE_PLUGIN_ROOT"] = ROOT
        e.update(extra)
        for k in [k for k, v in e.items() if v is None]:
            del e[k]
        return e

    def run_script(self, name, *args, scenario="ok", env_extra=None, cwd=None):
        env = self.env(scenario=scenario, **(env_extra or {}))
        return subprocess.run(
            [os.path.join(BIN, name), *args],
            capture_output=True, text=True, env=env, cwd=cwd or self.proj,
        )

    def herdr_calls(self):
        with open(self.herdr_log) as f:
            return [l.rstrip("\n") for l in f if l.strip()]

    def sp(self, *parts):
        return os.path.join(self.proj, SCRATCH, *parts)

    def wait_for_calls(self, matches, timeout=5.0):
        """Poll the herdr log until a call satisfies `matches`, for work that a
        script hands to a background process. Returns all calls either way."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            calls = self.herdr_calls()
            if any(matches(c) for c in calls):
                return calls
            time.sleep(0.05)
        return self.herdr_calls()

    def git_calls(self):
        with open(self.git_log) as f:
            return [l.rstrip("\n") for l in f if l.strip()]

    def team_json(self, name):
        return json.loads(read_text(self.sp(".team", name + ".json")))

    def write_record(self, name, role, topic="", brief="", cwd=None, pane="w1:p2"):
        d = self.sp(".team")
        os.makedirs(d, exist_ok=True)
        rec = {"role": role, "topic": topic, "brief": brief, "pane": pane, "started": "t"}
        if cwd is not None:
            rec["cwd"] = cwd
        write_text(os.path.join(d, name + ".json"), json.dumps(rec))


class TeamStart(Base):
    def bar_env(self, model, mode="auto", cwd=None):
        return {"FAKE_STATUS_MODEL": model, "FAKE_STATUS_MODE": mode,
                "FAKE_STATUS_CWD": cwd or self.proj}

    def start_argv(self, name, agent, model, effort, mode="auto"):
        return ("agent start %s --kind claude --pane w1:p2 --timeout 90000 "
                "-- --agent %s --model %s --effort %s --permission-mode %s "
                "--name %s --settings {\"crossSessionInbound\":\"accept\"}"
                % (name, agent, model, effort, mode, name))

    def test_builds_exact_agent_start_argv_per_role(self):
        cases = {
            "investigator": ("team-investigator", "claude-opus-5-5", "medium", "Opus 5.5"),
            "implementer": ("team-implementer", "claude-sonnet-5-5", "medium", "Sonnet 5.5"),
            "tester": ("team-tester", "claude-sonnet-5-5", "low", "Sonnet 5.5"),
        }
        for role, (agent, model, effort, bar) in cases.items():
            with self.subTest(role=role):
                open(self.herdr_log, "w").close()
                p = self.run_script("team-start", role[:4], role, "--pane", "w1:p2",
                                    "--cwd", self.proj,
                                    env_extra=self.bar_env(bar, cwd=self.proj))
                self.assertEqual(p.returncode, 0, p.stderr)
                self.assertIn(self.start_argv(role[:4], agent, model, effort), self.herdr_calls())
                self.assertEqual(json.loads(p.stdout)["model"], model)

    def test_model_and_effort_override_role_defaults(self):
        cases = {
            "opus-5-5": ("claude-opus-5-5", "Opus 5.5"),
            "sonnet-5-5": ("claude-sonnet-5-5", "Sonnet 5.5"),
        }
        for flag, (model, bar) in cases.items():
            with self.subTest(model=flag):
                open(self.herdr_log, "w").close()
                p = self.run_script("team-start", "maker", "implementer", "--pane", "w1:p2",
                                    "--cwd", self.proj, "--model", flag, "--effort", "xhigh",
                                    env_extra=self.bar_env(bar))
                self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
                self.assertIn(self.start_argv("maker", "team-implementer", model, "xhigh"),
                              self.herdr_calls())
                self.assertEqual(json.loads(p.stdout)["model"], model)

    def test_haiku_starts_in_accept_edits_mode(self):
        # Haiku has no auto mode, so the default mode follows the model.
        p = self.run_script("team-start", "clerk", "implementer", "--pane", "w1:p2",
                            "--cwd", self.proj, "--model", "haiku-4-5", "--effort", "low",
                            env_extra=self.bar_env("Haiku 4.5", mode="accept edits on"))
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn(self.start_argv("clerk", "team-implementer", "claude-haiku-4-5-20251001",
                                      "low", mode="acceptEdits"), self.herdr_calls())
        out = json.loads(p.stdout)
        self.assertEqual(out["mode"], "accept-edits")

    def test_accept_edits_mode_uses_claude_permission_mode_name(self):
        p = self.run_script("team-start", "maker", "implementer", "--pane", "w1:p2",
                            "--cwd", self.proj, "--mode", "accept-edits",
                            env_extra=self.bar_env("Sonnet 5.5", mode="accept edits on"))
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn(self.start_argv("maker", "team-implementer", "claude-sonnet-5-5",
                                      "medium", mode="acceptEdits"), self.herdr_calls())

    def test_haiku_with_auto_mode_is_bad_args(self):
        p = self.run_script("team-start", "clerk", "implementer", "--pane", "w1:p2",
                            "--cwd", self.proj, "--model", "haiku-4-5", "--mode", "auto")
        self.assertEqual(p.returncode, 2, p.stdout + p.stderr)
        self.assertIn("haiku-4-5 has no auto mode", p.stderr)
        self.assertFalse(any(c.startswith("agent start ") for c in self.herdr_calls()))

    def test_rejects_model_outside_allowlist(self):
        for flag in ("fable", "opus", "opus-4-8", "sonnet-5", "claude-opus-5-5"):
            with self.subTest(model=flag):
                open(self.herdr_log, "w").close()
                p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                                    "--cwd", self.proj, "--model", flag)
                self.assertEqual(p.returncode, 2, p.stdout + p.stderr)
                self.assertIn("unknown model: %s" % flag, p.stderr)
                self.assertFalse(any(c.startswith("agent start ") for c in self.herdr_calls()))

    def test_effort_accepts_every_claude_level(self):
        for effort in ("low", "medium", "high", "xhigh", "max"):
            with self.subTest(effort=effort):
                p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                                    "--cwd", self.proj, "--effort", effort, "--dry-run")
                self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
                self.assertIn("--effort %s " % effort, p.stdout)

    def test_rejects_unknown_effort(self):
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj, "--effort", "extreme")
        self.assertEqual(p.returncode, 2, p.stdout + p.stderr)
        self.assertIn("unknown effort: extreme", p.stderr)
        self.assertFalse(any(c.startswith("agent start ") for c in self.herdr_calls()))

    def test_passes_resolved_name_to_claude(self):
        # ListAgents/SendMessage on other sessions match by name, so the name
        # given to claude after `--` must be the same resolved name team-start
        # gives Herdr, including the team-id prefix.
        self.config()
        p = self.run_script("team-start", "maker", "implementer", "--pane", "w1:p2",
                            "--cwd", self.proj, env_extra=self.bar_env("Sonnet 5.5"))
        self.assertEqual(p.returncode, 0, p.stderr)
        calls = self.herdr_calls()
        self.assertTrue(any(c.startswith("agent start app-1-maker ") and "--name app-1-maker" in c
                             for c in calls), calls)

    def test_passes_cross_session_inbound_accept_setting(self):
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj, env_extra=self.bar_env("Opus 5.5"))
        self.assertEqual(p.returncode, 0, p.stderr)
        calls = self.herdr_calls()
        start_call = next(c for c in calls if c.startswith("agent start scout "))
        self.assertIn('--settings {"crossSessionInbound":"accept"}', start_call)
        settings_arg = start_call.split("--settings ", 1)[1]
        json.loads(settings_arg)  # must be valid JSON, one argument

    def test_dry_run_echoes_name_and_settings(self):
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj, "--dry-run")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("--name scout", p.stdout)
        self.assertIn("--model claude-opus-5-5", p.stdout)
        self.assertIn('--settings \'{"crossSessionInbound":"accept"}\'', p.stdout)

    def test_writes_team_record(self):
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj, env_extra=self.bar_env("Opus 5.5"))
        self.assertEqual(p.returncode, 0, p.stderr)
        rec = self.team_json("scout")
        self.assertEqual(rec["role"], "investigator")
        self.assertEqual(rec["pane"], "w1:p2")
        self.assertNotIn("session", rec)
        self.assertEqual(rec["cwd"], os.path.realpath(self.proj))
        out = json.loads(p.stdout)
        self.assertEqual(out["model"], "claude-opus-5-5")

    def test_startup_dialog_is_handed_to_the_human(self):
        # A trust dialog is a security decision: team-start never answers it.
        # It names the pane and shows the dialog, and writes no record.
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj, scenario="first_run_dialog",
                            env_extra=self.bar_env("Opus 5.5"))
        self.assertEqual(p.returncode, 3, p.stdout + p.stderr)
        self.assertIn("scout is at a startup dialog in pane w1:p2", p.stderr)
        self.assertIn("Yes, I trust this folder", p.stderr)
        calls = self.herdr_calls()
        self.assertFalse(any(c.startswith("agent send-keys") for c in calls), calls)
        self.assertEqual(sum(c.startswith("agent start ") for c in calls), 1)
        self.assertFalse(os.path.exists(self.sp(".team", "scout.json")))

    def test_start_error_is_reported_as_herdr_error(self):
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj, scenario="start_fails",
                            env_extra=self.bar_env("Opus 5.5"))
        self.assertEqual(p.returncode, 4, p.stdout + p.stderr)
        self.assertIn("agent_pane_not_found", p.stderr)
        # w1:p2 is a caller-provided pane, never ours to close.
        self.assertFalse(any(c.startswith("pane close") for c in self.herdr_calls()), self.herdr_calls())

    def test_retries_agent_start_on_pane_busy_until_shell_is_ready(self):
        # A pane team-start just created is not at its shell prompt yet, so
        # `agent start` answers agent_pane_busy on the first call(s). team-start
        # must retry and still succeed, for both a pane it creates via grid
        # split (--into-tab) and via a direct split (--split).
        cases = {
            "into_tab": ("--into-tab", "w1:tG"),
            "split": ("--split", "w1:p1", "right"),
        }
        for kind, args in cases.items():
            with self.subTest(kind=kind):
                open(self.herdr_log, "w").close()
                scenario = "grid2" if kind == "into_tab" else "ok"
                p = self.run_script("team-start", "scout", "investigator", *args,
                                    "--cwd", self.proj, scenario=scenario,
                                    env_extra={**self.bar_env("Opus 5.5"), "HERDR_WORKSPACE_ID": "w1",
                                               "FAKE_AGENT_START_BUSY_COUNT": "2",
                                               "TEAM_START_BUSY_BACKOFF_MS": "1"})
                self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
                self.assertTrue(os.path.exists(self.sp(".team", "scout.json")))
                starts = [c for c in self.herdr_calls() if c.startswith("agent start ")]
                self.assertGreater(len(starts), 1, starts)

    def test_persistent_pane_busy_fails_once_budget_spent(self):
        # A pane whose shell never reaches its prompt must not retry forever:
        # team-start gives up once the budget (env-overridable so the test
        # stays fast) is spent, and exits 4 like any other herdr error.
        p = self.run_script("team-start", "scout", "investigator", "--split", "w1:p1", "right",
                            "--cwd", self.proj,
                            env_extra={**self.bar_env("Opus 5.5"),
                                       "FAKE_AGENT_START_BUSY_COUNT": "999",
                                       "TEAM_START_BUSY_BUDGET_MS": "20",
                                       "TEAM_START_BUSY_BACKOFF_MS": "5"})
        self.assertEqual(p.returncode, 4, p.stdout + p.stderr)
        self.assertIn("agent_pane_busy", p.stderr)
        self.assertFalse(os.path.exists(self.sp(".team", "scout.json")))
        # The pane team-start created (w1:p9, from the fake "pane split"
        # response) is closed so no orphan empty shell is left behind.
        self.assertTrue(any(c.startswith("pane close w1:p9") for c in self.herdr_calls()), self.herdr_calls())

    def test_other_error_code_on_created_pane_is_not_retried(self):
        # Only agent_pane_busy is transient on a fresh pane. Any other error
        # code (e.g. agent_pane_not_found) is a real failure: report it at
        # once, with a single agent start call, not a retry loop.
        p = self.run_script("team-start", "scout", "investigator", "--split", "w1:p1", "right",
                            "--cwd", self.proj, scenario="start_fails",
                            env_extra=self.bar_env("Opus 5.5"))
        self.assertEqual(p.returncode, 4, p.stdout + p.stderr)
        starts = [c for c in self.herdr_calls() if c.startswith("agent start ")]
        self.assertEqual(len(starts), 1, starts)
        self.assertTrue(any(c.startswith("pane close w1:p9") for c in self.herdr_calls()), self.herdr_calls())

    def test_startup_dialog_leaves_created_pane_open(self):
        # team-start's own message tells the human to answer the startup
        # dialog in this pane, then close it themselves: team-start must not
        # close a pane it created out from under that instruction.
        p = self.run_script("team-start", "scout", "investigator", "--split", "w1:p1", "right",
                            "--cwd", self.proj, scenario="first_run_dialog",
                            env_extra=self.bar_env("Opus 5.5"))
        self.assertEqual(p.returncode, 3, p.stdout + p.stderr)
        self.assertFalse(any(c.startswith("pane close") for c in self.herdr_calls()), self.herdr_calls())

    def test_pending_marker_exists_before_first_agent_start_call(self):
        # The marker must protect a created pane from the watcher's empty-pane
        # cleanup before team-start ever calls `agent start` on it, not after.
        check_log = os.path.join(self.proj, "marker_check.log")
        open(check_log, "w").close()
        marker = self.sp(".team", "pending", "w1_p9")
        p = self.run_script("team-start", "scout", "investigator", "--split", "w1:p1", "right",
                            "--cwd", self.proj,
                            env_extra={**self.bar_env("Opus 5.5"),
                                       "FAKE_MARKER_CHECK_GROUP": "agent",
                                       "FAKE_MARKER_CHECK_SUB": "start",
                                       "FAKE_MARKER_CHECK_FILE": marker,
                                       "FAKE_MARKER_CHECK_LOG": check_log})
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        with open(check_log) as f:
            lines = [l.strip() for l in f if l.strip()]
        self.assertEqual(lines, ["present"], lines)

    def test_writes_record_when_bar_shows_basename_only(self):
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj,
                            env_extra=self.bar_env("Opus 5.5", cwd=os.path.basename(self.proj)))
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        rec = self.team_json("scout")
        self.assertEqual(rec["role"], "investigator")

    def test_aborts_on_wrong_model(self):
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj, env_extra=self.bar_env("Sonnet 5.5"))
        self.assertEqual(p.returncode, 3, p.stdout + p.stderr)

    def test_unknown_role_is_bad_args(self):
        p = self.run_script("team-start", "x", "wizard", "--pane", "w1:p2")
        self.assertEqual(p.returncode, 2)

    def test_rejects_path_traversal_name(self):
        p = self.run_script("team-start", "../evil", "investigator", "--pane", "w1:p2")
        self.assertEqual(p.returncode, 2)
        self.assertFalse(any(c.startswith("agent start ") for c in self.herdr_calls()))

    def test_prefixes_name_with_team_id_from_config(self):
        d = self.sp(".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "config.json"),
                   json.dumps({"team_id": "app-5066", "orchestrator": "app-5066-orch"}))
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj, env_extra=self.bar_env("Opus 5.5"))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(any(c.startswith("agent start app-5066-scout ") for c in self.herdr_calls()))
        self.assertTrue(os.path.exists(os.path.join(d, "app-5066-scout.json")))
        out = json.loads(p.stdout)
        self.assertEqual(out["name"], "app-5066-scout")

    def test_does_not_double_prefix_already_namespaced_name(self):
        # The orchestrator refers to agents by their full <team_id>-<label> name
        # everywhere, so it may pass that name to team-start. Prepending again
        # would produce app-5066-app-5066-scout. It must not.
        d = self.sp(".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "config.json"),
                   json.dumps({"team_id": "app-5066", "orchestrator": "app-5066-orch"}))
        p = self.run_script("team-start", "app-5066-scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj, env_extra=self.bar_env("Opus 5.5"))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(any(c.startswith("agent start app-5066-scout ") for c in self.herdr_calls()),
                        self.herdr_calls())
        out = json.loads(p.stdout)
        self.assertEqual(out["name"], "app-5066-scout")

    def test_no_team_id_keeps_bare_name(self):
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj, env_extra=self.bar_env("Opus 5.5"))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(any(c.startswith("agent start scout ") for c in self.herdr_calls()))

    def config(self, team_id="app-1", orch="app-1-orch"):
        d = self.sp(".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "config.json"),
                   json.dumps({"team_id": team_id, "orchestrator": orch}))

    def test_refuses_name_already_live(self):
        # Starting a label whose namespaced name is already a live agent would
        # reuse its pane and cross-poison it. Refuse before touching herdr.
        self.config()
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj, scenario="name_scout_taken",
                            env_extra=self.bar_env("Opus 5.5"))
        self.assertEqual(p.returncode, 3, p.stdout + p.stderr)
        self.assertFalse(any(c.startswith("agent start ") for c in self.herdr_calls()))

    def test_starts_when_namespaced_name_free(self):
        self.config()
        p = self.run_script("team-start", "maker", "implementer", "--pane", "w1:p2",
                            "--cwd", self.proj, scenario="name_scout_taken",
                            env_extra=self.bar_env("Sonnet 5.5"))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(any(c.startswith("agent start app-1-maker ") for c in self.herdr_calls()))

    def test_into_full_tab_spills_to_new_tab(self):
        d = self.sp(".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "tabs.json"), json.dumps(["w1:t2"]))
        p = self.run_script("team-start", "maker", "implementer", "--into-tab", "w1:t2",
                            "--cwd", self.proj, scenario="panes_overbudget",
                            env_extra={**self.bar_env("Sonnet 5.5"), "HERDR_WORKSPACE_ID": "w1"})
        self.assertEqual(p.returncode, 0, p.stderr)
        calls = self.herdr_calls()
        self.assertTrue(any(c.startswith("tab create") for c in calls), calls)
        self.assertTrue(any("agent start maker --kind claude --pane w1:p9" in c for c in calls))
        tabs = json.loads(read_text(os.path.join(d, "tabs.json")))
        self.assertIn("w1:t9", tabs)

    def test_into_underbudget_tab_splits_in_place(self):
        p = self.run_script("team-start", "maker", "implementer", "--into-tab", "w1:tG",
                            "--cwd", self.proj, scenario="grid2",
                            env_extra={**self.bar_env("Sonnet 5.5"), "HERDR_WORKSPACE_ID": "w1"})
        self.assertEqual(p.returncode, 0, p.stderr)
        calls = self.herdr_calls()
        self.assertFalse(any(c.startswith("tab create") for c in calls))
        self.assertTrue(any(c.startswith("pane split") for c in calls), calls)
        self.assertTrue(any("agent start maker --kind claude --pane w1:p9" in c for c in calls))

    def test_spill_defers_tab_registration_until_agent_live(self):
        # A spilled tab must not be registered while its root pane is still
        # empty; register only after the agent is live (a failed start = no tab).
        d = self.sp(".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "tabs.json"), json.dumps(["w1:t2"]))
        p = self.run_script("team-start", "maker", "implementer", "--into-tab", "w1:t2",
                            "--cwd", self.proj, scenario="panes_overbudget",
                            env_extra={**self.bar_env("Opus 5.5"), "HERDR_WORKSPACE_ID": "w1"})
        self.assertEqual(p.returncode, 3, p.stderr)   # wrong model bar -> pre-flight fail
        tabs = json.loads(read_text(os.path.join(d, "tabs.json")))
        self.assertNotIn("w1:t9", tabs)

    def grid_split(self, scenario):
        p = self.run_script("team-start", "scout", "investigator", "--into-tab", "w1:tG",
                            "--cwd", self.proj, scenario=scenario,
                            env_extra={**self.bar_env("Opus 5.5"), "HERDR_WORKSPACE_ID": "w1"})
        self.assertEqual(p.returncode, 0, p.stderr)
        return [c for c in self.herdr_calls() if c.startswith("pane split")]

    def test_grid_pane2_starts_two_columns(self):
        splits = self.grid_split("grid1")
        self.assertTrue(any("pane split --pane w1:g1 --direction right --ratio 0.5" in c for c in splits), splits)

    def test_grid_pane3_splits_left_column_into_rows(self):
        splits = self.grid_split("grid2")
        self.assertTrue(any("pane split --pane w1:g1 --direction down --ratio 0.333" in c for c in splits), splits)

    def test_grid_pane4_splits_right_column_into_rows(self):
        splits = self.grid_split("grid3")
        self.assertTrue(any("pane split --pane w1:g2 --direction down --ratio 0.333" in c for c in splits), splits)

    def test_grid_pane5_fills_left_bottom_row(self):
        splits = self.grid_split("grid4")
        self.assertTrue(any("pane split --pane w1:g3 --direction down --ratio 0.5" in c for c in splits), splits)

    def test_grid_pane6_fills_right_bottom_row(self):
        splits = self.grid_split("grid5")
        self.assertTrue(any("pane split --pane w1:g4 --direction down --ratio 0.5" in c for c in splits), splits)

    def abs_scratch(self):
        return os.path.realpath(self.sp())

    def test_direct_pane_exports_team_env(self):
        # team-start did not create this pane, so it exports TEAM_NAME and the
        # absolute TEAM_SCRATCH into the pane's shell before the agent starts,
        # so the agent (and its Stop hook) inherits them. The absolute path
        # keeps the hook working after the agent changes its cwd.
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj, env_extra=self.bar_env("Opus 5.5"))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("pane run w1:p2 export TEAM_NAME=scout TEAM_SCRATCH=%s" % self.abs_scratch(),
                      self.herdr_calls())

    def test_split_stamps_team_env(self):
        p = self.run_script("team-start", "scout", "investigator", "--split", "w1:p1", "down",
                            "--cwd", self.proj, env_extra=self.bar_env("Opus 5.5"))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(any(c.startswith("pane split") and "--env TEAM_NAME=scout" in c
                            and "--env TEAM_SCRATCH=%s " % self.abs_scratch() in c
                            for c in self.herdr_calls()), self.herdr_calls())

    def test_grid_split_stamps_team_env(self):
        splits = self.grid_split("grid1")
        self.assertTrue(any("--env TEAM_NAME=scout" in c
                            and "--env TEAM_SCRATCH=%s " % self.abs_scratch() in c
                            for c in splits), splits)

    def test_spilled_tab_stamps_team_env(self):
        d = self.sp(".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "tabs.json"), json.dumps(["w1:t2"]))
        p = self.run_script("team-start", "maker", "implementer", "--into-tab", "w1:t2",
                            "--cwd", self.proj, scenario="panes_overbudget",
                            env_extra={**self.bar_env("Sonnet 5.5"), "HERDR_WORKSPACE_ID": "w1"})
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(any(c.startswith("tab create") and "--env TEAM_NAME=maker" in c
                            and "--env TEAM_SCRATCH=%s " % self.abs_scratch() in c
                            for c in self.herdr_calls()), self.herdr_calls())

    def test_namespaced_name_exported_to_pane(self):
        self.config(team_id="app-1", orch="app-1-orch")
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj, env_extra=self.bar_env("Opus 5.5"))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("pane run w1:p2 export TEAM_NAME=app-1-scout TEAM_SCRATCH=%s" % self.abs_scratch(),
                      self.herdr_calls())

    def test_pane_placement_without_cwd_uses_panes_cwd_from_herdr(self):
        # A caller-provided --pane with no --cwd must resolve the pane's real
        # cwd from Herdr (pane get), not fall back to team-start's own $PWD,
        # so the status-bar cwd check compares against the right value.
        pane_cwd = os.path.join(self.proj, "elsewhere")
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            env_extra={**self.bar_env("Opus 5.5", cwd=os.path.basename(pane_cwd)),
                                       "FAKE_PANE_CWD": pane_cwd})
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertTrue(any(c.startswith("pane get w1:p2") for c in self.herdr_calls()),
                        self.herdr_calls())

    def test_into_tab_with_pane_is_bad_args(self):
        p = self.run_script("team-start", "maker", "implementer", "--into-tab", "w1:t2", "--pane", "w1:p2")
        self.assertEqual(p.returncode, 2)
        self.assertFalse(any(c.startswith("agent start ") for c in self.herdr_calls()))

    def test_into_empty_tab_is_bad_args(self):
        d = self.sp(".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "tabs.json"), json.dumps(["w1:t2"]))
        p = self.run_script("team-start", "maker", "implementer", "--into-tab", "w1:t2",
                            "--cwd", self.proj, env_extra={**self.bar_env("Sonnet 5.5"), "HERDR_WORKSPACE_ID": "w1"})
        self.assertEqual(p.returncode, 2)

    # The pane env's HERDR_WORKSPACE_ID is a spawn-time snapshot; "w7" stands
    # for a stale one. The live workspace of the calling pane is w1.
    STALE_WS = {"HERDR_WORKSPACE_ID": "w7"}

    def new_tab(self, model="Opus 5.5", *extra):
        return self.run_script("team-start", "scout", "investigator", "--new-tab", *extra,
                               "--cwd", self.proj,
                               env_extra={**self.bar_env(model), **self.STALE_WS})

    def test_new_tab_starts_agent_in_its_root_pane(self):
        p = self.new_tab("Opus 5.5", "--label", "T1 scout")
        self.assertEqual(p.returncode, 0, p.stderr)
        calls = self.herdr_calls()
        self.assertFalse(any(c.startswith("pane split") for c in calls), calls)
        self.assertTrue(any(c.startswith("tab create") and "--label T1 scout" in c
                            and "--env TEAM_NAME=scout" in c for c in calls), calls)
        self.assertTrue(any("agent start scout --kind claude --pane w1:p9" in c for c in calls), calls)

    def test_new_tab_goes_to_the_callers_live_workspace(self):
        p = self.new_tab()
        self.assertEqual(p.returncode, 0, p.stderr)
        creates = [c for c in self.herdr_calls() if c.startswith("tab create")]
        self.assertTrue(creates and all("--workspace w1 " in c for c in creates), creates)

    def test_new_tab_is_registered_once_its_agent_is_live(self):
        p = self.new_tab()
        self.assertEqual(p.returncode, 0, p.stderr)
        tabs = json.loads(read_text(self.sp(".team", "tabs.json")))
        self.assertIn("w1:t9", tabs)

    def test_new_tab_is_not_registered_when_start_fails(self):
        p = self.new_tab("Sonnet 5.5")   # wrong model bar -> pre-flight fail
        self.assertEqual(p.returncode, 3, p.stderr)
        tabs_path = self.sp(".team", "tabs.json")
        self.assertFalse(os.path.exists(tabs_path) and "w1:t9" in json.loads(read_text(tabs_path)))

    def test_new_tab_with_other_placement_is_bad_args(self):
        p = self.run_script("team-start", "maker", "implementer", "--new-tab", "--pane", "w1:p2")
        self.assertEqual(p.returncode, 2)
        self.assertFalse(any(c.startswith("agent start ") for c in self.herdr_calls()))

    def test_spill_goes_to_the_callers_live_workspace(self):
        p = self.run_script("team-start", "maker", "implementer", "--into-tab", "w1:t2",
                            "--cwd", self.proj, scenario="panes_overbudget",
                            env_extra={**self.bar_env("Sonnet 5.5"), **self.STALE_WS})
        self.assertEqual(p.returncode, 0, p.stderr)
        creates = [c for c in self.herdr_calls() if c.startswith("tab create")]
        self.assertTrue(creates and all("--workspace w1 " in c for c in creates), creates)

    def test_into_tab_fills_a_lone_empty_pane_instead_of_splitting(self):
        # A tab created by hand holds one bare shell pane. Splitting it would
        # leave that shell empty next to the agent.
        p = self.run_script("team-start", "scout", "investigator", "--into-tab", "w1:tG",
                            "--cwd", self.proj, scenario="fresh_tab",
                            env_extra={**self.bar_env("Opus 5.5"), "HERDR_WORKSPACE_ID": "w1"})
        self.assertEqual(p.returncode, 0, p.stderr)
        calls = self.herdr_calls()
        self.assertFalse(any(c.startswith("pane split") for c in calls), calls)
        self.assertIn("pane run w1:g1 export TEAM_NAME=scout TEAM_SCRATCH=%s" % self.abs_scratch(), calls)
        self.assertTrue(any("agent start scout --kind claude --pane w1:g1" in c for c in calls), calls)


class TeamBriefCompose(Base):
    def overlay(self):
        d = os.path.join(self.proj, ".claude", "team")
        os.makedirs(os.path.join(d, "roles"))
        write_text(os.path.join(d, "roles", "investigator.md"), "OVERLAY-ROLE-FRAGMENT\n")
        write_text(os.path.join(d, "env.md"), "OVERLAY-ENV-BODY\n")
        write_text(os.path.join(d, "gate.md"), "OVERLAY-GATE-BODY\n")

    def test_concatenates_in_order_and_substitutes(self):
        self.write_record("scout", "investigator")
        self.overlay()
        p = self.run_script("team-brief", "compose", "scout", "digest", "--var", "ticket=APP-1")
        self.assertEqual(p.returncode, 0, p.stderr)
        text = read_text(os.path.join(self.proj, p.stdout.strip()))
        order = [text.index(m) for m in ("# Brief: scout / digest",
                                         "OVERLAY-ROLE-FRAGMENT",
                                         "## Environment", "OVERLAY-ENV-BODY",
                                         "## Gate", "OVERLAY-GATE-BODY",
                                         "## Report back", "## Rules")]
        self.assertEqual(order, sorted(order))
        self.assertIn("You are scout", text)
        self.assertIn("decisions-APP-1.md", text)
        self.assertIn('REPORT scout digest', text)
        self.assertNotIn("{{", text)

    def test_refuses_to_overwrite(self):
        self.write_record("scout", "investigator")
        first = self.run_script("team-brief", "compose", "scout", "digest", "--var", "ticket=APP-1")
        self.assertEqual(first.returncode, 0, first.stderr)
        again = self.run_script("team-brief", "compose", "scout", "digest", "--var", "ticket=APP-1")
        self.assertEqual(again.returncode, 1)

    def test_rejects_path_traversal_topic(self):
        self.write_record("scout", "investigator")
        p = self.run_script("team-brief", "compose", "scout", "../../oops", "--var", "ticket=APP-1")
        self.assertEqual(p.returncode, 2)

    def test_empty_overlay_still_valid(self):
        self.write_record("maker", "implementer")
        p = self.run_script("team-brief", "compose", "maker", "build")
        self.assertEqual(p.returncode, 0, p.stderr)
        text = read_text(os.path.join(self.proj, p.stdout.strip()))
        for marker in ("# Brief: maker / build", "## Report back", "## Rules"):
            self.assertIn(marker, text)


class TeamBriefSend(Base):
    def prep(self, name="scout", topic="digest"):
        self.write_record(name, "investigator", topic=topic)
        os.makedirs(self.sp(), exist_ok=True)
        write_text(self.sp("brief-%s-%s.md" % (name, topic)), "x")

    def test_settled_state_exits_zero_and_records(self):
        self.prep()
        p = self.run_script("team-brief", "send", "scout", "--topic", "digest")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.strip(), "idle")
        rec = self.team_json("scout")
        self.assertEqual(rec["topic"], "digest")
        self.assertTrue(rec["brief"].endswith("brief-scout-digest.md"))

    def test_delivered_without_status_prints_unknown_and_exits_zero(self):
        # The prompt landed; a missing status key must not report a failure.
        self.prep()
        p = self.run_script("team-brief", "send", "scout", "--topic", "digest",
                            scenario="prompt_no_status")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.strip(), "unknown")

    def test_stalled_exits_five_without_resend(self):
        self.prep()
        p = self.run_script("team-brief", "send", "scout", "--topic", "digest",
                            scenario="prompt_stalled")
        self.assertEqual(p.returncode, 5, p.stdout + p.stderr)
        prompts = [c for c in self.herdr_calls() if c.startswith("agent prompt ")]
        self.assertEqual(len(prompts), 1)

    def test_blocked_exits_six(self):
        self.prep()
        p = self.run_script("team-brief", "send", "scout", "--topic", "digest",
                            scenario="prompt_blocked")
        self.assertEqual(p.returncode, 6, p.stdout + p.stderr)

    def test_blocked_prints_the_dialog_text_not_the_raw_error(self):
        # SPEC.md: agent_blocked -> print the dialog text, exit 6. The pre-check
        # error carries the dialog in its own "dialog" field.
        self.prep()
        p = self.run_script("team-brief", "send", "scout", "--topic", "digest",
                            scenario="prompt_blocked")
        self.assertEqual(p.returncode, 6, p.stdout + p.stderr)
        self.assertIn("Allow write? [y/n]", p.stderr)
        self.assertNotIn("{", p.stderr)

    def test_working_returns_at_once_matching_spec(self):
        # herdr's real contract: plain --wait waits for a settled state
        # (idle/done/blocked), never "working" - --until working is required
        # to return as soon as the agent starts its turn, per SPEC.md.
        self.prep()
        p = self.run_script("team-brief", "send", "scout", "--topic", "digest",
                            scenario="prompt_working")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(p.stdout.strip(), "working")
        prompts = [c for c in self.herdr_calls() if c.startswith("agent prompt ")]
        self.assertEqual(len(prompts), 1)
        self.assertIn("--until working", prompts[0])
        self.assertIn("--until blocked", prompts[0])

    def test_mid_run_blocked_state_prints_dialog_and_exits_six(self):
        # A dialog raised mid-turn is matched via --until blocked and comes
        # back as a settled result, not an error; send must still read the
        # dialog text and exit 6, the same outward contract as the pre-check.
        self.prep()
        p = self.run_script("team-brief", "send", "scout", "--topic", "digest",
                            scenario="prompt_blocked_midrun")
        self.assertEqual(p.returncode, 6, p.stdout + p.stderr)
        self.assertIn("Allow Bash(rm -rf build)? [y/n]", p.stderr)

    def test_mirrors_brief_and_decisions_into_worktree_scratch(self):
        # A worktree agent's record carries an absolute cwd outside self.proj.
        # send must copy the brief and the decisions file into that worktree's
        # own scratchpad, and reference the brief by a path relative to it, so
        # the agent never reads outside its own working directory.
        wt = tempfile.mkdtemp()
        try:
            self.write_record("scout", "investigator", topic="digest", cwd=wt)
            d = self.sp(".team")
            os.makedirs(d, exist_ok=True)
            write_text(os.path.join(d, "config.json"), json.dumps({"team_id": "app-1", "ticket": "APP-1"}))
            write_text(self.sp("decisions-APP-1.md"), "1. decision\n")
            write_text(self.sp("brief-scout-digest.md"), "brief body\n")

            p = self.run_script("team-brief", "send", "scout", "--topic", "digest")

            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertEqual(read_text(os.path.join(wt, "scratchpad", "current", "brief-scout-digest.md")), "brief body\n")
            self.assertEqual(read_text(os.path.join(wt, "scratchpad", "current", "decisions-APP-1.md")), "1. decision\n")
            prompts = [c for c in self.herdr_calls() if c.startswith("agent prompt ")]
            self.assertEqual(len(prompts), 1)
            self.assertIn("Read scratchpad/current/brief-scout-digest.md ", prompts[0])
            self.assertNotIn(wt, prompts[0])
        finally:
            shutil.rmtree(wt, ignore_errors=True)

    def test_no_mirroring_when_cwd_is_the_main_repo(self):
        # A record with no cwd, or one matching this repo's own $PWD, is not a
        # worktree agent: send must behave as before, referencing the brief by
        # its path under the orchestrator's own scratchpad.
        self.prep()
        p = self.run_script("team-brief", "send", "scout", "--topic", "digest")
        self.assertEqual(p.returncode, 0, p.stderr)
        prompts = [c for c in self.herdr_calls() if c.startswith("agent prompt ")]
        self.assertIn("Read scratchpad/current/brief-scout-digest.md ", prompts[0])

    def test_send_positions_prompt_before_wait_flag(self):
        self.prep()
        p = self.run_script("team-brief", "send", "scout", "--topic", "digest")
        self.assertEqual(p.returncode, 0, p.stderr)
        prompts = [c for c in self.herdr_calls() if c.startswith("agent prompt ")]
        self.assertEqual(len(prompts), 1)
        call = prompts[0]
        self.assertTrue(call.startswith("agent prompt scout Read "), call)
        self.assertIn(" --wait ", call)


class TeamSlice(Base):
    WS = {"HERDR_WORKSPACE_ID": "w1"}

    def overlay(self, text):
        d = os.path.join(self.proj, ".claude", "team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "project.yaml"), text)

    def slice(self, *extra):
        return self.run_script("team-slice", "feat", "main", "--label", "T1 APP-1 slug", *extra,
                               env_extra=self.WS)

    def test_without_overlay_refuses_and_touches_nothing(self):
        p = self.slice()
        self.assertEqual(p.returncode, 2)
        self.assertIn("no worktree_cmd in .claude/team/project.yaml - ask the human how this repo makes worktrees",
                      p.stderr)
        self.assertEqual(self.git_calls(), [])
        self.assertEqual(self.herdr_calls(), [])

    def test_without_worktree_dir_refuses(self):
        self.overlay('worktree_cmd: "git worktree add {branch} {parent}"\n')
        p = self.slice()
        self.assertEqual(p.returncode, 2)
        self.assertIn("no worktree_dir in .claude/team/project.yaml - ask the human how this repo makes worktrees",
                      p.stderr)
        self.assertEqual(self.git_calls(), [])

    def test_uses_the_repos_own_worktree_command(self):
        self.overlay('stacked: true\nworktree_cmd: "git worktree add {branch} {parent}"\nworktree_dir: "{branch}"\n')
        p = self.slice()
        self.assertEqual(p.returncode, 0, p.stderr)
        git = self.git_calls()
        self.assertIn("worktree add feat main", git)
        self.assertIn("m add feat --onto main", git)

    def test_herdr_gets_the_absolute_worktree_cwd(self):
        self.overlay('worktree_cmd: "git worktree add {branch} {parent}"\nworktree_dir: "{branch}"\n')
        os.makedirs(os.path.join(self.proj, "feat"))
        p = self.slice()
        self.assertEqual(p.returncode, 0, p.stderr)
        creates = [c for c in self.herdr_calls() if c.startswith("tab create")]
        expect_abs = os.path.join(os.path.realpath(self.proj), "feat")
        self.assertTrue(any(("--cwd %s " % expect_abs) in c for c in creates), creates)

    def test_tab_goes_to_the_callers_live_workspace(self):
        self.overlay('worktree_cmd: "git worktree add {branch} {parent}"\nworktree_dir: "{branch}"\n')
        p = self.run_script("team-slice", "feat", "main", "--label", "T1 APP-1 slug",
                            env_extra={"HERDR_WORKSPACE_ID": "w7"})
        self.assertEqual(p.returncode, 0, p.stderr)
        creates = [c for c in self.herdr_calls() if c.startswith("tab create")]
        self.assertTrue(creates and all("--workspace w1 " in c for c in creates), creates)

    def test_copy_lands_in_the_worktrees_run_dir(self):
        self.overlay('worktree_cmd: "git worktree add {branch} {parent}"\nworktree_dir: "{branch}"\n')
        os.makedirs(os.path.join(self.proj, "feat"))
        os.makedirs(os.path.join(self.proj, "specs"))
        write_text(os.path.join(self.proj, "specs", "a.md"), "spec\n")
        p = self.slice("--copy", "specs")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(read_text(os.path.join(self.proj, "feat", "scratchpad", "current", "specs", "a.md")), "spec\n")

    def test_rejects_unsafe_git_ref(self):
        p = self.run_script("team-slice", "evil;rm -rf x", "main", "--label", "T1 X y", env_extra=self.WS)
        self.assertEqual(p.returncode, 2)
        self.assertEqual(self.git_calls(), [])


class TeamStatus(Base):
    def test_joins_roster_and_reads_idle(self):
        self.write_record("scout", "investigator", topic="digest")
        p = self.run_script("team-status", "--read-idle", scenario="status_mixed")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("scout (w1:p2, 11111111) idle investigator digest -", p.stdout)
        calls = self.herdr_calls()
        self.assertTrue(any(c.startswith("agent read scout") for c in calls))
        self.assertFalse(any(c.startswith("agent read maker") for c in calls))
        roster = self.sp(".team", "roster.md")
        self.assertTrue(os.path.exists(roster))

    def cfg(self, orch="app-1-orch"):
        d = self.sp(".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "config.json"),
                   json.dumps({"team_id": "app-1", "orchestrator": orch}))

    def test_roster_lists_only_team_agents_and_orchestrator(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        p = self.run_script("team-status", scenario="status_two_teams")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.splitlines(), [
            "app-1-orch (w2:p1, oooo0000) working - - -",
            "app-1-scout (w2:p2, 11111111) idle investigator digest -",
        ])

    def test_json_reports_herdr_agent_status(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        p = self.run_script("team-status", "--json", scenario="status_two_teams")
        self.assertEqual(p.returncode, 0, p.stderr)
        states = {r["name"]: r["state"] for r in json.loads(p.stdout)}
        self.assertEqual(states, {"app-1-orch": "working", "app-1-scout": "idle"})

    def test_empty_record_fields_keep_columns(self):
        self.cfg()
        self.write_record("app-1-scout", "")
        p = self.run_script("team-status", "--json", scenario="status_two_teams")
        self.assertEqual(p.returncode, 0, p.stderr)
        scout = [r for r in json.loads(p.stdout) if r["name"] == "app-1-scout"][0]
        self.assertEqual(scout, {"name": "app-1-scout", "pane": "w2:p2", "session": "11111111",
                                 "state": "idle", "role": "", "topic": "", "report_age": "-"})


class DefaultScratch(Base):
    """With TEAM_SCRATCH unset, every run file lives in scratchpad/current/."""
    UNSET = {"TEAM_SCRATCH": None}

    def cfg(self):
        d = self.sp(".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "config.json"),
                   json.dumps({"team_id": "app-1", "ticket": "APP-1", "orchestrator": "app-1-orch"}))

    def test_init_with_default_path_creates_current(self):
        p = self.run_script("team-init", "APP-1", env_extra=self.UNSET)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.sp(".team", "config.json")))

    def test_status_writes_roster_under_current(self):
        self.cfg()
        p = self.run_script("team-status", scenario="status_two_teams", env_extra=self.UNSET)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.sp(".team", "roster.md")))

    def test_watch_writes_state_under_current(self):
        self.cfg()
        p = self.run_script("team-watch", "--once", scenario="watch_idle", env_extra=self.UNSET)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.sp(".team", "watch-state.json")))

    def test_overview_reads_plan_under_current(self):
        self.cfg()
        write_text(self.sp("progress-APP-1.md"), "# APP-1\n")
        p = self.run_script("team-overview", "--once",
                            env_extra={**self.UNSET, "COLUMNS": "60", "LINES": "40"})
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.splitlines()[0], "APP-1")

    def test_stop_hook_writes_report_under_current(self):
        self.write_record("scout", "investigator", topic="digest")
        tr = os.path.join(self.proj, "t.jsonl")
        write_text(tr, json.dumps({"type": "assistant", "message": {"role": "assistant",
                   "content": [{"type": "text", "text": "REPORT scout digest: done"}]}}) + "\n")
        env = self.env(TEAM_NAME="scout", TEAM_SCRATCH=None)
        p = subprocess.run(["bash", os.path.join(ROOT, "hooks", "handlers", "stop-report.sh")],
                           input=json.dumps({"session_id": "s", "transcript_path": tr, "cwd": self.proj}),
                           capture_output=True, text=True, env=env, cwd=self.proj)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.sp("reports", "scout-digest.md")))


class TeamOverview(Base):
    NOW = 1800000000
    PLAN = ("# APP-1 round 2\n\n"
            "## DONE\n- [x] design (inv)\n\n"
            "## RUNNING\n- [>] fix round 2 (impl)\n\n"
            "## NEXT\n- [ ] review round 2 (rev)\n- [ ] you: manual test\n")
    AGENTS = ["AGENTS", " impl  w2:p3  working  2m", " rev   w2:p4  idle     -"]

    def cfg(self):
        d = self.sp(".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "config.json"),
                   json.dumps({"team_id": "app-1", "ticket": "APP-1", "orchestrator": "app-1-orch"}))

    def plan(self, text):
        write_text(self.sp("progress-APP-1.md"), text)

    def team(self):
        # impl reported 2 minutes ago; rev has no report.
        self.cfg()
        self.write_record("app-1-impl", "implementer", topic="fix")
        self.write_record("app-1-rev", "tester", topic="review")
        reports = self.sp("reports")
        os.makedirs(reports)
        report = os.path.join(reports, "app-1-impl-fix.md")
        write_text(report, "done")
        os.utime(report, (self.NOW - 120, self.NOW - 120))

    def overview(self, columns=60, lines=40, scenario="overview"):
        return self.run_script("team-overview", "--once", scenario=scenario,
                               env_extra={"COLUMNS": str(columns), "LINES": str(lines),
                                          "TEAM_NOW": str(self.NOW)})

    def test_renders_plan_and_live_agents(self):
        # The orchestrator, another team's agent and a nameless pane are in the
        # herdr list; only this team's role agents appear, without the team id.
        self.team()
        self.plan(self.PLAN)
        p = self.overview()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stderr, "")
        self.assertEqual(p.stdout.splitlines(), [
            "APP-1 round 2", "=============",
            "DONE", " [x] design (inv)",
            "RUNNING", " [>] fix round 2 (impl)",
            "NEXT", " [ ] review round 2 (rev)", " [ ] you: manual test",
        ] + self.AGENTS)

    def test_without_plan_file_says_where_it_goes_and_still_lists_agents(self):
        self.team()
        p = self.overview()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.splitlines(),
                         ["no plan yet: scratchpad/current/progress-APP-1.md"] + self.AGENTS)

    def test_without_team_config_asks_for_init(self):
        p = self.overview()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.splitlines(), ["no team: run /team:init"])

    def test_herdr_failure_keeps_the_plan(self):
        self.team()
        self.plan(self.PLAN)
        p = self.overview(scenario="list_fails")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stderr, "")
        lines = p.stdout.splitlines()
        self.assertEqual(lines[0], "APP-1 round 2")
        self.assertEqual(lines[-2:], ["AGENTS", " herdr unavailable"])

    def test_no_role_agents_yet(self):
        self.cfg()
        self.plan(self.PLAN)
        p = self.overview()
        self.assertEqual(p.stdout.splitlines()[-2:], ["AGENTS", " (none)"])

    def six_done(self):
        return self.PLAN.replace("- [x] design (inv)\n",
                                 "".join("- [x] d%d\n" % i for i in range(1, 7)))

    def test_short_pane_keeps_the_newest_done_items(self):
        # Fixed part: title 2 + DONE heading 1 + RUNNING 2 + NEXT 3 + AGENTS 3 = 11.
        self.team()
        self.plan(self.six_done())
        p = self.overview(lines=13)
        self.assertEqual(p.stdout.splitlines()[:7], [
            "APP-1 round 2", "=============",
            "DONE (+4 earlier)", " [x] d5", " [x] d6",
            "RUNNING", " [>] fix round 2 (impl)",
        ])

    def test_tiny_pane_keeps_only_the_done_heading(self):
        self.team()
        self.plan(self.six_done())
        p = self.overview(lines=5)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.splitlines(), [
            "APP-1 round 2", "=============", "DONE (+6 earlier)",
            "RUNNING", " [>] fix round 2 (impl)",
            "NEXT", " [ ] review round 2 (rev)", " [ ] you: manual test",
        ] + self.AGENTS)

    def test_narrow_pane_cuts_long_lines(self):
        self.team()
        self.plan(self.PLAN)
        p = self.overview(columns=20)
        lines = p.stdout.splitlines()
        self.assertIn(" [>] fix round 2 (i…", lines)
        self.assertIn(" impl  w2:p3  worki…", lines)
        self.assertTrue(all(len(l) <= 20 for l in lines), lines)

    def test_lenient_markdown_still_renders(self):
        self.cfg()
        self.plan("#  APP-1\n## Done\n* [X] design\nnotes here\n## next\n- [ ] ship\n")
        p = self.overview()
        self.assertEqual(p.stdout.splitlines(), [
            "APP-1", "=====", "DONE", " [X] design", "RUNNING", "NEXT", " [ ] ship",
            "AGENTS", " (none)",
        ])

    def test_plan_without_title_has_no_underline(self):
        self.cfg()
        self.plan("## NEXT\n- [ ] ship\n")
        p = self.overview()
        self.assertEqual(p.stdout.splitlines(), [
            "DONE", "RUNNING", "NEXT", " [ ] ship", "AGENTS", " (none)",
        ])

    def test_spawn_splits_right_of_the_orchestrator_and_runs_the_loop_there(self):
        self.cfg()
        p = self.run_script("team-overview", "--spawn")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.strip(), "w1:p9")
        calls = self.herdr_calls()
        split = [c for c in calls if c.startswith("pane split")]
        self.assertEqual(len(split), 1, calls)
        self.assertIn("--pane w1:p1 --direction right --ratio 0.72", split[0])
        self.assertTrue(split[0].endswith("--no-focus"), split)
        self.assertTrue(any(c.startswith("pane run w1:p9 ")
                            and c.endswith("/bin/team-overview --interval 5") for c in calls), calls)
        # --spawn only launches; it renders nothing itself.
        self.assertFalse(any(c.startswith("agent list") for c in calls), calls)

    def test_spawn_passes_an_absolute_team_scratch(self):
        self.cfg()
        p = self.run_script("team-overview", "--spawn")
        self.assertEqual(p.returncode, 0, p.stderr)
        split = [c for c in self.herdr_calls() if c.startswith("pane split")]
        self.assertIn("--env TEAM_SCRATCH=%s " % os.path.realpath(self.sp()), split[0] + " ")

    def test_spawn_records_the_overview_pane_for_release(self):
        self.cfg()
        p = self.run_script("team-overview", "--spawn")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(self.team_json("overview"), {"pane": "w1:p9"})

    def test_loop_redraws_only_when_the_frame_changes(self):
        self.team()
        self.plan(self.PLAN)
        env = self.env(scenario="overview", COLUMNS="40", LINES="40", TEAM_NOW=str(self.NOW))
        loop = subprocess.Popen([os.path.join(BIN, "team-overview"), "--interval", "0.1"],
                                cwd=self.proj, env=env, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, start_new_session=True)
        time.sleep(0.6)
        self.plan(self.PLAN + "- [ ] ship\n")
        time.sleep(0.6)
        os.killpg(loop.pid, signal.SIGTERM)
        out, err = loop.communicate(timeout=5)
        self.assertEqual(out.count("\x1b[2J"), 2, out)
        self.assertIn(" [ ] ship", out)
        self.assertEqual(err, "")

    def test_herdr_missing_from_path_shows_unavailable(self):
        self.team()
        self.plan(self.PLAN)
        env = self.env(scenario="overview", COLUMNS="60", LINES="40", TEAM_NOW=str(self.NOW))
        path = os.pathsep.join(p for p in env["PATH"].split(os.pathsep) if p != self.shim)
        if shutil.which("herdr", path=path):
            # This machine has a real herdr on PATH. Isolate a shim with only
            # the tools team-overview needs to start (python3, bash, and the
            # coreutils its argument parsing and path setup call), so herdr
            # stays the only thing missing.
            no_herdr = os.path.join(self.proj, "_no_herdr_shim")
            os.makedirs(no_herdr, exist_ok=True)
            for tool in ("python3", "bash", "dirname", "basename"):
                os.symlink(shutil.which(tool), os.path.join(no_herdr, tool))
            path = no_herdr
        env["PATH"] = path
        p = subprocess.run([os.path.join(BIN, "team-overview"), "--once"],
                           capture_output=True, text=True, env=env, cwd=self.proj)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stderr, "")
        self.assertEqual(p.stdout.splitlines()[-2:], ["AGENTS", " herdr unavailable"])

    def test_non_utf8_plan_still_renders(self):
        self.team()
        path = self.sp("progress-APP-1.md")
        with open(path, "wb") as f:
            f.write(self.PLAN.encode("utf-8") + b"- [ ] bad \xff byte\n")
        p = self.overview()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stderr, "")
        lines = p.stdout.splitlines()
        self.assertTrue(any(l.startswith(" [ ] bad ") for l in lines), lines)

    def test_herdr_list_not_json_shows_unavailable(self):
        self.team()
        self.plan(self.PLAN)
        p = self.overview(scenario="bad_list")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stderr, "")
        self.assertEqual(p.stdout.splitlines()[-2:], ["AGENTS", " herdr unavailable"])

    def test_bad_interval_is_bad_args(self):
        p = self.run_script("team-overview", "--interval", "abc")
        self.assertEqual(p.returncode, 2, p.stdout + p.stderr)
        self.assertIn("bad --interval: abc", p.stderr)

    def test_wide_characters_are_measured_in_columns(self):
        sys.path.insert(0, os.path.join(ROOT, "lib"))
        try:
            from overview import display_width
        finally:
            sys.path.pop(0)
        self.cfg()
        self.plan("# APP-1 修复\n\n"
                 "## RUNNING\n- [>] \U0001f680 修复 the login flow for everyone (impl)\n")
        p = self.overview(columns=20)
        self.assertEqual(p.returncode, 0, p.stderr)
        lines = p.stdout.splitlines()
        self.assertEqual(lines[1], "=" * 10)
        self.assertTrue(all(display_width(l) <= 20 for l in lines), lines)


class DisplayWidth(unittest.TestCase):
    def test_widths(self):
        sys.path.insert(0, os.path.join(ROOT, "lib"))
        try:
            from overview import cut, display_width
        finally:
            sys.path.pop(0)
        self.assertEqual(display_width("abc"), 3)
        self.assertEqual(display_width("修复"), 4)
        self.assertEqual(display_width("é"), 1)
        cut_result = cut("修复修复修复", 5)
        self.assertLessEqual(display_width(cut_result), 5)
        self.assertTrue(cut_result.endswith("…"))


class InputDraft(unittest.TestCase):
    # Screen lines recorded from a real Claude Code pane via `herdr agent read --format ansi`.
    RULE = "\x1b[0m\x1b[38;2;136;136;136m" + "─" * 40 + "\x1b[0m"
    PROMPT = "\x1b[0m\x1b[38;2;153;153;153m❯\xa0\x1b[0m"

    def draft(self, screen):
        sys.path.insert(0, os.path.join(ROOT, "lib"))
        try:
            from teamlib import input_draft
        finally:
            sys.path.pop(0)
        return input_draft(screen)

    def box(self, line):
        return "\n".join(["output", self.RULE, line, self.RULE, "status"])

    def test_typed_text_is_a_draft(self):
        self.assertEqual(self.draft(self.box(self.PROMPT + "hello draft")), "hello draft")

    def test_dim_hint_is_not_a_draft(self):
        hint = "\x1b[2mPress up to edit queued messages\x1b[0m"
        self.assertEqual(self.draft(self.box(self.PROMPT + hint)), "")

    def test_truecolor_text_is_not_mistaken_for_dim(self):
        # The 2 in 38;2;r;g;b selects truecolor; it is not the dim attribute.
        self.assertEqual(self.draft(self.box("\x1b[38;2;153;153;153m❯\xa0hello")), "hello")

    def test_no_input_box(self):
        self.assertIsNone(self.draft("Allow Bash(rm -rf build)? [y/n]"))


class TeamDeliver(Base):
    # Short timings so a waiting delivery finishes in well under a second.
    FAST = {"TEAM_DELIVER_INTERVAL": "0.05", "TEAM_DELIVER_CAP": "0.3"}

    def deliver(self, scenario):
        return self.run_script("team-deliver", "orch", "REPORT scout digest: done",
                               scenario=scenario, env_extra=self.FAST)

    def screen_reads_before_prompt(self):
        calls = self.herdr_calls()
        prompt_at = next(i for i, c in enumerate(calls) if c.startswith("agent prompt "))
        return [c for c in calls[:prompt_at] if c.startswith("agent read orch")]

    def test_empty_input_box_sends_at_once(self):
        p = self.deliver("box_empty")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("agent prompt orch REPORT scout digest: done", self.herdr_calls())
        self.assertEqual(len(self.screen_reads_before_prompt()), 1, self.herdr_calls())

    def test_waits_while_the_human_has_a_draft(self):
        # The reported bug: a prompt submitted while the human is half-way
        # through typing in the orchestrator gets their draft prepended to it.
        p = self.deliver("draft_then_clear")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("agent prompt orch REPORT scout digest: done", self.herdr_calls())
        self.assertEqual(len(self.screen_reads_before_prompt()), 3, self.herdr_calls())
        self.assertEqual(p.stderr, "")

    def test_sends_anyway_after_the_cap_and_says_so(self):
        p = self.deliver("draft_stuck")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("agent prompt orch REPORT scout digest: done", self.herdr_calls())
        self.assertIn("orch still had a draft after 0.3s, sent anyway", p.stderr)

    def test_dim_hint_in_input_box_is_not_a_draft(self):
        # Claude Code shows this hint, dimmed, while a message is queued.
        p = self.deliver("box_queued_hint")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("agent prompt orch REPORT scout digest: done", self.herdr_calls())
        self.assertEqual(len(self.screen_reads_before_prompt()), 1, self.herdr_calls())
        self.assertEqual(p.stderr, "")

    def test_screen_without_input_box_sends_at_once(self):
        # A dialog or a non-Claude agent: nothing to protect, so no wait.
        p = self.deliver("ok")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("agent prompt orch REPORT scout digest: done", self.herdr_calls())
        self.assertEqual(len(self.screen_reads_before_prompt()), 1, self.herdr_calls())


class StopHook(Base):
    HOOK = os.path.join(ROOT, "hooks", "handlers", "stop-report.sh")

    def run_hook(self, payload, **env_extra):
        env = self.env(**env_extra)
        return subprocess.run(["bash", self.HOOK], input=json.dumps(payload),
                              capture_output=True, text=True, env=env, cwd=self.proj)

    def transcript(self, *messages):
        path = os.path.join(self.proj, "transcript.jsonl")
        with open(path, "w") as f:
            for m in messages:
                f.write(json.dumps({"type": "assistant",
                                    "message": {"role": "assistant",
                                                "content": [{"type": "text", "text": m}]}}) + "\n")
        return path

    def report_path(self, name, topic):
        return self.sp("reports", "%s-%s.md" % (name, topic))

    def test_identifies_by_team_name_env_and_pings(self):
        # The hook learns which agent it is from TEAM_NAME in its environment,
        # not from the session id (herdr's agent_session and Claude Code's
        # session_id are different identifiers, so a session match never fires).
        # A second record is present to prove it picks the record by name.
        self.write_record("scout", "investigator", topic="digest")
        self.write_record("maker", "implementer", topic="build")
        tr = self.transcript("REPORT scout digest: done, 2 files")

        p = self.run_hook({"session_id": "no-such-session", "transcript_path": tr,
                           "cwd": self.proj}, TEAM_NAME="scout")

        self.assertEqual(p.returncode, 0, p.stderr)
        calls = self.wait_for_calls(lambda c: c.startswith("agent prompt "))
        self.assertTrue(any(c.startswith("agent prompt orchestrator REPORT scout digest: done")
                            for c in calls), calls)

    def test_reports_after_agent_moves_its_cwd(self):
        # An agent may cd into scratchpad/ or a worktree. team-start stamps an
        # absolute TEAM_SCRATCH, so the hook still finds the team dir.
        self.write_record("scout", "investigator", topic="digest")
        tr = self.transcript("REPORT scout digest: done")
        moved = self.sp()

        p = self.run_hook({"session_id": "s", "transcript_path": tr, "cwd": moved},
                          TEAM_NAME="scout", TEAM_SCRATCH=moved)

        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.report_path("scout", "digest")))
        calls = self.wait_for_calls(lambda c: c.startswith("agent prompt "))
        self.assertTrue(any(c.startswith("agent prompt orchestrator REPORT scout digest: done")
                            for c in calls), calls)

    def test_no_team_name_is_silent(self):
        self.write_record("scout", "investigator", topic="digest")
        tr = self.transcript("REPORT scout digest: done")

        p = self.run_hook({"session_id": "whatever", "transcript_path": tr, "cwd": self.proj})

        self.assertEqual(p.returncode, 0)
        self.assertFalse(any(c.startswith("agent prompt ") for c in self.herdr_calls()))
        self.assertFalse(os.path.exists(self.report_path("scout", "digest")))

    def test_team_name_without_record_is_silent(self):
        tr = self.transcript("REPORT ghost x: done")

        p = self.run_hook({"session_id": "whatever", "transcript_path": tr, "cwd": self.proj},
                          TEAM_NAME="ghost")

        self.assertEqual(p.returncode, 0)
        self.assertFalse(any(c.startswith("agent prompt ") for c in self.herdr_calls()))

    def test_invalid_team_name_is_silent(self):
        # Guard against a hostile TEAM_NAME reaching the report path.
        self.write_record("scout", "investigator", topic="digest")
        tr = self.transcript("REPORT scout digest: done")

        p = self.run_hook({"session_id": "whatever", "transcript_path": tr, "cwd": self.proj},
                          TEAM_NAME="../evil")

        self.assertEqual(p.returncode, 0)
        self.assertFalse(any(c.startswith("agent prompt ") for c in self.herdr_calls()))

    def test_writes_report_for_match(self):
        self.write_record("scout", "investigator", topic="digest")
        tr = self.transcript("earlier", "final answer")
        p = self.run_hook({"transcript_path": tr, "cwd": self.proj}, TEAM_NAME="scout")
        self.assertEqual(p.returncode, 0, p.stderr)
        body = read_text(self.report_path("scout", "digest"))
        self.assertIn("# Report: scout / digest", body)
        self.assertIn("final answer", body)

    def test_forwards_report_line(self):
        self.write_record("scout", "investigator", topic="digest")
        tr = self.transcript("REPORT scout digest: done, 2 files")
        p = self.run_hook({"transcript_path": tr, "cwd": self.proj}, TEAM_NAME="scout")
        self.assertEqual(p.returncode, 0, p.stderr)
        calls = self.wait_for_calls(lambda c: c.startswith("agent prompt "))
        self.assertTrue(any(c.startswith("agent prompt orchestrator REPORT scout digest: done")
                            for c in calls), calls)

    def test_holds_report_until_orchestrator_draft_clears(self):
        self.write_record("scout", "investigator", topic="digest")
        tr = self.transcript("REPORT scout digest: done")
        p = self.run_hook({"transcript_path": tr, "cwd": self.proj}, TEAM_NAME="scout",
                          FAKE_HERDR_SCENARIO="draft_then_clear", TEAM_DELIVER_INTERVAL="0.05")
        self.assertEqual(p.returncode, 0, p.stderr)
        calls = self.wait_for_calls(lambda c: c.startswith("agent prompt "))
        reads = [c for c in calls if c.startswith("agent read orchestrator")]
        self.assertEqual(len(reads), 3, calls)
        self.assertEqual(calls[-1], "agent prompt orchestrator REPORT scout digest: done")

    def test_stop_does_not_wait_for_the_draft(self):
        # The worker's stop returns while delivery is still waiting.
        self.write_record("scout", "investigator", topic="digest")
        tr = self.transcript("REPORT scout digest: done")
        started = time.monotonic()
        p = self.run_hook({"transcript_path": tr, "cwd": self.proj}, TEAM_NAME="scout",
                          FAKE_HERDR_SCENARIO="draft_stuck", TEAM_DELIVER_INTERVAL="0.05",
                          TEAM_DELIVER_CAP="1")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertLess(time.monotonic() - started, 0.8)
        self.assertFalse(any(c.startswith("agent prompt ") for c in self.herdr_calls()))
        calls = self.wait_for_calls(lambda c: c.startswith("agent prompt "))
        self.assertIn("agent prompt orchestrator REPORT scout digest: done", calls)
        log = read_text(self.sp(".team", "hook.log"))
        self.assertIn("orchestrator still had a draft after 1s, sent anyway", log)

    def test_forwards_report_line_after_status_bar(self):
        # The reported bug: a status-bar first line (workers inherit the rule)
        # meant the message never started with "REPORT ", so the ping was skipped
        # while the report file still landed. The hook must find the REPORT line
        # anywhere in the message, not only at offset zero.
        self.write_record("scout", "investigator", topic="digest")
        tr = self.transcript("| status bar |\n\nREPORT scout digest: done, 2 files")
        p = self.run_hook({"transcript_path": tr, "cwd": self.proj}, TEAM_NAME="scout")
        self.assertEqual(p.returncode, 0, p.stderr)
        calls = self.wait_for_calls(lambda c: c.startswith("agent prompt "))
        prompts = [c for c in calls if c.startswith("agent prompt ")]
        self.assertTrue(any("REPORT scout digest: done, 2 files" in c for c in prompts), prompts)
        self.assertFalse(any("status bar" in c for c in prompts), prompts)

    def test_stop_without_report_line_writes_report_but_stays_quiet(self):
        # A stop without a REPORT line is often a pause (the worker waits on its
        # own subagents), not an end. team-watch flags a worker that stays idle
        # without a REPORT, so the hook itself never wakes the orchestrator here.
        self.write_record("scout", "investigator", topic="digest")
        tr = self.transcript("two subagents still running, waiting")
        p = self.run_hook({"transcript_path": tr, "cwd": self.proj}, TEAM_NAME="scout")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("waiting", read_text(self.report_path("scout", "digest")))
        time.sleep(0.3)   # room for a wrong background ping to land
        self.assertFalse(any(c.startswith("agent prompt ") for c in self.herdr_calls()))

    def test_no_self_ping_when_name_is_orchestrator(self):
        # The orchestrator has no TEAM_NAME today, but if it ever ran the hook as
        # a named agent, it must not prompt itself.
        d = self.sp(".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "config.json"),
                   json.dumps({"team_id": "app-1", "orchestrator": "app-1-orch"}))
        self.write_record("app-1-orch", "investigator", topic="digest")
        tr = self.transcript("REPORT app-1-orch digest: done")
        p = self.run_hook({"transcript_path": tr, "cwd": self.proj}, TEAM_NAME="app-1-orch")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(any(c.startswith("agent prompt ") for c in self.herdr_calls()))

    def test_unreadable_transcript_logs_and_exits_zero(self):
        self.write_record("scout", "investigator", topic="digest")
        p = self.run_hook({"transcript_path": "/does/not/exist", "cwd": self.proj},
                          TEAM_NAME="scout")
        self.assertEqual(p.returncode, 0, p.stderr)
        log = self.sp(".team", "hook.log")
        self.assertTrue(os.path.exists(log))
        self.assertIn("transcript unreadable", read_text(log))


class TeamId(Base):
    def test_slug_lowercases_and_dashes(self):
        p = self.run_script("team-id", "slug", "APP-5066")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.strip(), "app-5066")

    def test_slug_collapses_and_trims_and_caps_12(self):
        p = self.run_script("team-id", "slug", "  Feature/Big__Thing 42  ")
        self.assertEqual(p.returncode, 0, p.stderr)
        s = p.stdout.strip()
        self.assertTrue(re.match(r"^[a-z][a-z0-9-]*$", s), s)
        self.assertLessEqual(len(s), 12)
        self.assertFalse(s.endswith("-"))

    def test_hash_is_six_char_base36_letter_first(self):
        p = self.run_script("team-id", "hash")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertRegex(p.stdout.strip(), r"^[a-z][a-z0-9]{5}$")

    def test_for_uses_slug_when_ticket_present_else_hash(self):
        p = self.run_script("team-id", "for", "APP-1")
        self.assertEqual(p.stdout.strip(), "app-1")
        q = self.run_script("team-id", "for", "")
        self.assertRegex(q.stdout.strip(), r"^[a-z][a-z0-9]{5}$")

    def test_missing_subcommand_is_bad_args(self):
        p = self.run_script("team-id")
        self.assertEqual(p.returncode, 2)


class TeamInit(Base):
    ALLOW = ["Read", "Bash(ls:*)", "Bash(grep:*)", "Bash(git status:*)"]

    def test_writes_config_with_team_id_and_orch(self):
        p = self.run_script("team-init", "APP-5066")
        self.assertEqual(p.returncode, 0, p.stderr)
        cfg = json.loads(read_text(self.sp(".team", "config.json")))
        self.assertEqual(cfg["team_id"], "app-5066")
        self.assertEqual(cfg["ticket"], "APP-5066")
        self.assertEqual(cfg["orchestrator"], "app-5066-orch")

    def test_refuses_second_init_when_agent_still_live(self):
        d = self.sp(".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "config.json"),
                   json.dumps({"team_id": "app-1", "ticket": "APP-1", "orchestrator": "app-1-orch"}))
        p = self.run_script("team-init", "APP-2", scenario="names_app1_taken")
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertIn("app-1-scout", p.stderr)
        self.assertTrue(os.path.exists(os.path.join(d, "config.json")))

    TODAY = "2026-01-02"

    def init(self, ticket="APP-2", scenario="ok", **env):
        return self.run_script("team-init", ticket, scenario=scenario,
                               env_extra={"TEAM_TODAY": self.TODAY, **env})

    def old_run(self, ticket="APP-1"):
        d = self.sp(".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "config.json"),
                   json.dumps({"team_id": "app-1", "ticket": ticket, "orchestrator": "app-1-orch"}))
        write_text(self.sp("brief-scout-digest.md"), "old brief\n")

    def archive(self, *parts):
        return os.path.join(self.proj, "scratchpad", ".archive", *parts)

    def test_archives_the_finished_run_and_starts_fresh(self):
        self.old_run()
        p = self.init()
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(read_text(self.archive("APP-1-2026-01-02", "brief-scout-digest.md")), "old brief\n")
        self.assertEqual(sorted(os.listdir(self.sp())), [".team"])
        self.assertEqual(json.loads(read_text(self.sp(".team", "config.json")))["ticket"], "APP-2")

    def test_archive_name_gets_a_suffix_when_taken(self):
        self.old_run()
        os.makedirs(self.archive("APP-1-2026-01-02"))
        p = self.init()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.archive("APP-1-2026-01-02-2", "brief-scout-digest.md")))

    def test_run_without_config_archives_as_run(self):
        os.makedirs(self.sp())
        write_text(self.sp("notes.md"), "ad hoc\n")
        p = self.init()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.archive("run-2026-01-02", "notes.md")))

    def test_sweeps_loose_entries_out_of_sight(self):
        root = os.path.join(self.proj, "scratchpad")
        os.makedirs(os.path.join(root, "reports"))
        write_text(os.path.join(root, "decisions-OLD.md"), "old\n")
        write_text(os.path.join(root, "reports", "x.md"), "old\n")
        p = self.init()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(sorted(os.listdir(root)), [".archive", "current"])
        self.assertTrue(os.path.exists(self.archive("loose-2026-01-02", "decisions-OLD.md")))
        self.assertTrue(os.path.exists(self.archive("loose-2026-01-02", "reports", "x.md")))

    def test_never_moves_a_worktree_and_warns(self):
        wt = os.path.join(self.proj, "scratchpad", "wt-feat")
        os.makedirs(os.path.join(wt, "src"))
        write_text(os.path.join(wt, ".git"), "gitdir: /elsewhere\n")
        nested = os.path.join(self.proj, "scratchpad", "deep", "a")
        os.makedirs(os.path.join(nested, ".git"))
        p = self.init()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(os.path.join(wt, ".git")))
        self.assertTrue(os.path.exists(os.path.join(nested, ".git")))
        self.assertIn("❗️ worktree inside scratchpad: scratchpad/wt-feat - move it out with git worktree move", p.stderr)
        self.assertIn("❗️ worktree inside scratchpad: scratchpad/deep - move it out with git worktree move", p.stderr)

    def test_live_agents_block_init_and_nothing_moves(self):
        self.old_run()
        write_text(os.path.join(self.proj, "scratchpad", "loose.md"), "x\n")
        p = self.init(scenario="names_app1_taken")
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertIn("app-1-scout", p.stderr)
        self.assertTrue(os.path.exists(self.sp("brief-scout-digest.md")))
        self.assertTrue(os.path.exists(os.path.join(self.proj, "scratchpad", "loose.md")))
        self.assertFalse(os.path.exists(self.archive()))

    def test_herdr_failure_blocks_init_and_nothing_moves(self):
        # A herdr error or unparsable reply must not read as "no live agents":
        # that would silence a real team's Stop hooks by archiving it live.
        self.old_run()
        for scenario in ("list_fails", "bad_list"):
            with self.subTest(scenario=scenario):
                p = self.init(scenario=scenario)
                self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
                self.assertIn("cannot check live agents", p.stderr)
                self.assertTrue(os.path.exists(self.sp("brief-scout-digest.md")))
                self.assertFalse(os.path.exists(self.archive()))

    def test_custom_scratch_archives_next_to_it_and_never_sweeps(self):
        run = os.path.join(self.proj, "work", "run")
        os.makedirs(os.path.join(run, ".team"))
        write_text(os.path.join(run, ".team", "config.json"), json.dumps({"team_id": "app-1", "ticket": "APP-1"}))
        write_text(os.path.join(self.proj, "work", "keep.md"), "mine\n")
        p = self.init(TEAM_SCRATCH=os.path.join("work", "run"))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(os.path.join(self.proj, "work", ".archive", "APP-1-2026-01-02", ".team")))
        self.assertTrue(os.path.exists(os.path.join(self.proj, "work", "keep.md")))

    def test_refuses_to_archive_a_run_dir_holding_a_worktree(self):
        # An old-style TEAM_SCRATCH=scratchpad points at the whole scratchpad,
        # worktrees included. Moving it would break them.
        root = os.path.join(self.proj, "scratchpad")
        os.makedirs(os.path.join(root, "wt-feat"))
        write_text(os.path.join(root, "wt-feat", ".git"), "gitdir: /elsewhere\n")
        p = self.init(TEAM_SCRATCH="scratchpad")
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertIn("scratchpad/wt-feat", p.stderr)
        self.assertTrue(os.path.exists(os.path.join(root, "wt-feat", ".git")))

    def test_ticket_with_slash_is_archived_under_a_flat_name(self):
        self.old_run(ticket="team/ABC-1")
        p = self.init()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.archive("team-ABC-1-2026-01-02", "brief-scout-digest.md")))

    def test_trailing_slash_in_team_scratch_is_normalised(self):
        self.old_run()
        p = self.init(TEAM_SCRATCH=SCRATCH + "/")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.archive("APP-1-2026-01-02", "brief-scout-digest.md")))

    def test_symlink_is_swept_without_following_it(self):
        target = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(target, ".git"))
            os.makedirs(os.path.join(self.proj, "scratchpad"))
            os.symlink(target, os.path.join(self.proj, "scratchpad", "link"))
            p = self.init()
            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertTrue(os.path.islink(self.archive("loose-2026-01-02", "link")))
            self.assertTrue(os.path.exists(os.path.join(target, ".git")))
        finally:
            shutil.rmtree(target, ignore_errors=True)

    def test_top_level_git_dir_is_never_swept(self):
        root = os.path.join(self.proj, "scratchpad")
        os.makedirs(os.path.join(root, ".git", "objects"))
        os.makedirs(os.path.join(root, "notes"))
        p = self.init()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(os.path.join(root, ".git", "objects")))
        self.assertIn("❗️ worktree inside scratchpad: scratchpad/.git - move it out with git worktree move", p.stderr)

    def test_refusal_names_a_top_level_git_dir_without_a_traceback(self):
        root = os.path.join(self.proj, "scratchpad")
        os.makedirs(os.path.join(root, ".git", "objects"))
        p = self.init(TEAM_SCRATCH="scratchpad")
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertNotIn("Traceback", p.stderr)
        self.assertIn("scratchpad/.git", p.stderr)

    def test_worktree_inside_current_gets_move_advice(self):
        # The default run dir IS scratchpad/current, so "set TEAM_SCRATCH to a
        # run dir such as scratchpad/current" would tell the human to point at
        # the very dir that already holds the worktree.
        os.makedirs(self.sp("wt-x"))
        write_text(self.sp("wt-x", ".git"), "gitdir: /elsewhere\n")
        p = self.init()
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertIn("move it out with git worktree move", p.stderr)
        self.assertNotIn("such as scratchpad/current", p.stderr)

    def test_old_layout_team_dir_blocks_init_when_live(self):
        old_dir = os.path.join(self.proj, "scratchpad", ".team")
        os.makedirs(old_dir)
        write_text(os.path.join(old_dir, "config.json"),
                   json.dumps({"team_id": "app-1", "ticket": "APP-1"}))
        p = self.init(scenario="names_app1_taken")
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertIn("app-1-scout", p.stderr)
        self.assertTrue(os.path.exists(os.path.join(old_dir, "config.json")))

    def test_double_trailing_slash_in_team_scratch_is_normalised(self):
        self.old_run()
        p = self.init(TEAM_SCRATCH=SCRATCH + "//")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.archive("APP-1-2026-01-02", "brief-scout-digest.md")))

    def test_malformed_config_archives_as_run_instead_of_crashing(self):
        d = self.sp(".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "config.json"), json.dumps([1, 2, 3]))
        write_text(self.sp("brief-scout-digest.md"), "old brief\n")
        p = self.init()
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertNotIn("Traceback", p.stderr)
        self.assertTrue(os.path.exists(self.archive("run-2026-01-02", "brief-scout-digest.md")))

    def test_seeds_allowlist_without_clobbering(self):
        d = os.path.join(self.proj, ".claude")
        os.makedirs(d)
        write_text(os.path.join(d, "settings.local.json"),
                   json.dumps({"permissions": {"allow": ["Bash(custom:*)"]}, "env": {"X": "1"}}))
        self.run_script("team-init", "APP-1")
        s = json.loads(read_text(os.path.join(d, "settings.local.json")))
        self.assertEqual(s["env"], {"X": "1"})
        self.assertIn("Bash(custom:*)", s["permissions"]["allow"])
        for a in self.ALLOW:
            self.assertIn(a, s["permissions"]["allow"])

    def test_records_orchestrator_tab(self):
        p = self.run_script("team-init", "APP-1", "--orchestrator-pane", "w1:p1",
                            scenario="pane_in_tab")
        self.assertEqual(p.returncode, 0, p.stderr)
        tabs = json.loads(read_text(self.sp(".team", "tabs.json")))
        self.assertIn("w1:t1", tabs)

    def test_renames_orchestrator_agent_to_namespaced_name(self):
        p = self.run_script("team-init", "APP-1", "--orchestrator-pane", "w1:p1",
                            scenario="pane_in_tab")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(any(c.startswith("agent rename w1:p1 app-1-orch") for c in self.herdr_calls()),
                        self.herdr_calls())

    def test_missing_orchestrator_pane_value_is_bad_args(self):
        p = self.run_script("team-init", "APP-1", "--orchestrator-pane")
        self.assertEqual(p.returncode, 2)

    def test_picks_free_team_id_when_slug_taken(self):
        # A prior team for the same ticket left app-1-* agents live. Reusing the
        # deterministic slug would cross-poison them, so init must disambiguate.
        p = self.run_script("team-init", "APP-1", scenario="names_app1_taken")
        self.assertEqual(p.returncode, 0, p.stderr)
        cfg = json.loads(read_text(self.sp(".team", "config.json")))
        self.assertEqual(cfg["team_id"], "app-1-2")
        self.assertEqual(cfg["orchestrator"], "app-1-2-orch")

    def test_renames_orchestrator_to_disambiguated_name(self):
        p = self.run_script("team-init", "APP-1", "--orchestrator-pane", "w1:p1",
                            scenario="names_app1_taken")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(any(c.startswith("agent rename w1:p1 app-1-2-orch") for c in self.herdr_calls()),
                        self.herdr_calls())


class TeamWatch(Base):
    def cfg(self, orch="app-1-orch", team_id="app-1"):
        d = self.sp(".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "config.json"),
                   json.dumps({"team_id": team_id, "orchestrator": orch}))
        return d

    def test_first_pass_records_state_and_pushes_nothing(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        p = self.run_script("team-watch", "--once", scenario="watch_change")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(any(c.startswith("agent prompt ") for c in self.herdr_calls()))
        state = json.loads(read_text(self.sp(".team", "watch-state.json")))
        self.assertEqual(state["agents"]["app-1-scout"], "working")

    def test_second_pass_pushes_watch_line_on_change(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        self.run_script("team-watch", "--once", scenario="watch_change")   # baseline: working
        self.run_script("team-watch", "--once", scenario="watch_change")   # now: blocked
        calls = self.wait_for_calls(lambda c: c.startswith("agent prompt app-1-orch WATCH"))
        pushes = [c for c in calls if c.startswith("agent prompt app-1-orch WATCH")]
        self.assertTrue(any("app-1-scout: working -> blocked" in c for c in pushes), calls)

    def test_working_to_idle_is_logged_but_not_pushed(self):
        # A worker that waits on its own subagents flips between working and
        # idle. The REPORT line and the idle-without-report flag cover what the
        # orchestrator needs, so the flip only shows in the watcher's own pane.
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        self.run_script("team-watch", "--once", scenario="watch_pause")        # baseline: working
        p = self.run_script("team-watch", "--once", scenario="watch_pause")    # now: idle
        self.assertIn("app-1-scout: working -> idle", p.stdout)
        time.sleep(0.3)   # room for a wrong push to land
        self.assertFalse(any(c.startswith("agent prompt ") for c in self.herdr_calls()),
                         self.herdr_calls())

    def test_watch_line_waits_for_the_orchestrator_input_box(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        self.run_script("team-watch", "--once", scenario="watch_change")   # baseline: working
        self.run_script("team-watch", "--once", scenario="watch_change")   # now: blocked
        calls = self.wait_for_calls(lambda c: c.startswith("agent prompt app-1-orch WATCH"))
        push_at = next(i for i, c in enumerate(calls) if c.startswith("agent prompt app-1-orch"))
        self.assertTrue(any(c.startswith("agent read app-1-orch") for c in calls[:push_at]), calls)

    def test_ignores_agents_not_in_records(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        # app-2-maker is live but has no record here; must be ignored.
        self.run_script("team-watch", "--once", scenario="watch_two_teams")
        state = json.loads(read_text(self.sp(".team", "watch-state.json")))
        self.assertNotIn("app-2-maker", state["agents"])

    def test_blocked_line_includes_dialog(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        self.run_script("team-watch", "--once", scenario="watch_change")   # working
        self.run_script("team-watch", "--once", scenario="watch_change")   # blocked
        calls = self.wait_for_calls(lambda c: "WATCH" in c)
        pushes = [c for c in calls if "WATCH" in c]
        self.assertTrue(any("blocked:" in c for c in pushes), pushes)
        self.assertTrue(any("agent read app-1-scout" in c for c in self.herdr_calls()))

    def test_idle_without_report_is_flagged_once(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        self.run_script("team-watch", "--once", "--no-report-after", "0", scenario="watch_idle")
        self.run_script("team-watch", "--once", "--no-report-after", "0", scenario="watch_idle")
        self.wait_for_calls(lambda c: "no report" in c)
        time.sleep(0.3)   # room for a wrong second push to land
        flags = [c for c in self.herdr_calls() if "no report" in c]
        self.assertEqual(len(flags), 1)

    def test_short_idle_without_report_is_not_flagged(self):
        # A worker that waits on its own subagents sits idle between their
        # results. That pause is not worth the orchestrator's attention.
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        self.run_script("team-watch", "--once", scenario="watch_idle")
        self.run_script("team-watch", "--once", scenario="watch_idle")
        time.sleep(0.3)   # room for a wrong push to land
        self.assertFalse(any("no report" in c for c in self.herdr_calls()), self.herdr_calls())

    def test_idle_without_report_is_flagged_once_the_grace_period_ends(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        self.run_script("team-watch", "--once", "--no-report-after", "1", scenario="watch_idle")
        time.sleep(1.1)
        self.run_script("team-watch", "--once", "--no-report-after", "1", scenario="watch_idle")
        calls = self.wait_for_calls(lambda c: "no report" in c)
        flags = [c for c in calls if "no report" in c]
        self.assertEqual(len(flags), 1, calls)
        self.assertIn("scratchpad/current/reports/app-1-scout-digest.md", flags[0])

    def test_report_file_without_report_line_still_counts_as_no_report(self):
        # The Stop hook rewrites the report file on every stop, so the file
        # alone proves nothing. Only a REPORT line in it means the worker reported.
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        self.write_report("app-1-scout", "digest", "still waiting on two subagents")
        self.run_script("team-watch", "--once", "--no-report-after", "0", scenario="watch_idle")
        calls = self.wait_for_calls(lambda c: "no report" in c)
        self.assertTrue(any("no report" in c for c in calls), calls)

    def turn(self, role, text):
        stamp = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + ".000Z"
        return json.dumps({"type": role, "timestamp": stamp,
                           "message": {"role": role, "content": [{"type": "text", "text": text}]}})

    def stop_without_report(self, name):
        """A real Stop hook run for a worker whose last message has no REPORT."""
        tr = os.path.join(self.proj, "transcript-%s.jsonl" % name)
        write_text(tr, self.turn("assistant", "two subagents still running, waiting") + "\n"
                   + json.dumps({"type": "system", "subtype": "stop_hook_summary"}) + "\n")
        env = self.env(TEAM_NAME=name)
        subprocess.run(["bash", StopHook.HOOK], input=json.dumps({"transcript_path": tr, "cwd": self.proj}),
                       capture_output=True, text=True, env=env, cwd=self.proj, check=True)
        return tr

    def test_quiet_worker_that_herdr_calls_working_is_flagged(self):
        # A worker that waits on background subagents stays "working" in herdr
        # even at an empty prompt. No turn since its last stop means it is quiet.
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        self.stop_without_report("app-1-scout")
        time.sleep(1.1)
        self.run_script("team-watch", "--once", "--no-report-after", "1", scenario="watch_working")
        calls = self.wait_for_calls(lambda c: "no report" in c)
        flags = [c for c in calls if "no report" in c]
        self.assertEqual(len(flags), 1, calls)
        self.assertIn("scratchpad/current/reports/app-1-scout-digest.md", flags[0])

    def test_working_worker_with_a_turn_after_its_stop_is_not_flagged(self):
        # A teammate result or a new prompt starts a turn: the worker is busy again.
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        tr = self.stop_without_report("app-1-scout")
        time.sleep(1.1)
        with open(tr, "a") as f:
            f.write(self.turn("user", "teammate A finished") + "\n")
        self.run_script("team-watch", "--once", "--no-report-after", "1", scenario="watch_working")
        time.sleep(0.3)   # room for a wrong push to land
        self.assertFalse(any("no report" in c for c in self.herdr_calls()), self.herdr_calls())

    def test_working_worker_on_a_new_brief_is_not_flagged_by_its_previous_stop(self):
        # A /clear before a new brief starts a new transcript, so the previous
        # task's stop record points at a transcript that no longer grows.
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="replay")
        self.stop_without_report("app-1-scout")
        time.sleep(1.1)
        write_text(self.sp("brief-app-1-scout-replay.md"), "# Brief: replay\n")
        self.run_script("team-watch", "--once", "--no-report-after", "1", scenario="watch_working")
        time.sleep(0.3)   # room for a wrong push to land
        self.assertFalse(any("no report" in c for c in self.herdr_calls()), self.herdr_calls())

    def test_working_worker_within_the_grace_period_is_not_flagged(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        self.stop_without_report("app-1-scout")
        self.run_script("team-watch", "--once", scenario="watch_working")
        time.sleep(0.3)   # room for a wrong push to land
        self.assertFalse(any("no report" in c for c in self.herdr_calls()), self.herdr_calls())

    def test_working_worker_that_never_stopped_is_not_flagged(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        self.run_script("team-watch", "--once", "--no-report-after", "0", scenario="watch_working")
        time.sleep(0.3)   # room for a wrong push to land
        self.assertFalse(any("no report" in c for c in self.herdr_calls()), self.herdr_calls())

    def test_idle_with_report_line_is_not_flagged(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        self.write_report("app-1-scout", "digest")
        self.run_script("team-watch", "--once", "--no-report-after", "0", scenario="watch_idle")
        time.sleep(0.3)   # room for a wrong push to land
        self.assertFalse(any("no report" in c for c in self.herdr_calls()), self.herdr_calls())

    def prep_tabs(self, tabs, own_pane="w1:p9"):
        d = self.sp(".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "tabs.json"), json.dumps(tabs))
        write_text(os.path.join(d, "watch-state.json"),
                   json.dumps({"agents": {}, "_flagged": {}, "own_pane": own_pane}))

    def test_closes_named_empty_pane_in_team_tab(self):
        # p3 is empty, but only closes because a team record (an agent that
        # exited) names it; see test_leaves_unnamed_empty_pane_in_team_tab for
        # the pane no record names.
        self.cfg()
        self.prep_tabs(["w1:t2"])
        self.write_record("app-1-scout", "investigator", pane="w1:p3")
        self.run_script("team-watch", "--once", scenario="panes_empty")
        self.assertTrue(any(c.startswith("pane close w1:p3") for c in self.herdr_calls()), self.herdr_calls())
        # p2 hosts an agent (idle status) -> not closed
        self.assertFalse(any(c.startswith("pane close w1:p2") for c in self.herdr_calls()))

    def test_overview_file_is_not_an_agent_record(self):
        self.cfg()
        self.prep_tabs(["w1:t2"])
        write_text(self.sp(".team", "overview.json"), json.dumps({"pane": "w1:p3"}))
        self.run_script("team-watch", "--once", scenario="panes_empty")
        self.assertFalse(any(c.startswith("pane close") for c in self.herdr_calls()), self.herdr_calls())

    def test_leaves_unnamed_empty_pane_in_team_tab(self):
        # A pane no team record names, such as one a human opened by hand in
        # a managed worker tab, is never closed.
        self.cfg()
        self.prep_tabs(["w1:t2"])
        self.run_script("team-watch", "--once", scenario="panes_empty")
        self.assertFalse(any(c.startswith("pane close") for c in self.herdr_calls()), self.herdr_calls())

    def test_does_not_close_panes_in_foreign_tabs(self):
        self.cfg()
        self.prep_tabs(["w1:t9"])  # team owns t9, not t2
        self.run_script("team-watch", "--once", scenario="panes_empty")
        self.assertFalse(any(c.startswith("pane close") for c in self.herdr_calls()))

    def test_leaves_human_pane_in_orchestrator_tab(self):
        # A pane the human opens in the orchestrator's own tab (the tab holding
        # the watcher's own pane) is the human's workspace and must never close.
        self.cfg()
        self.prep_tabs(["w1:t2"], own_pane="w1:p2")   # own pane in w1:t2 -> orch tab
        self.run_script("team-watch", "--once", scenario="panes_empty")
        self.assertFalse(any(c.startswith("pane close") for c in self.herdr_calls()),
                         self.herdr_calls())

    def test_does_not_flag_orchestrator_tab_over_budget(self):
        # The human may open extra panes in the orchestrator tab; the watcher
        # must not nag it as over budget or close anything there.
        self.cfg()
        self.prep_tabs(["w1:t2"], own_pane="w1:p2")   # orchestrator tab
        self.run_script("team-watch", "--once", scenario="panes_overbudget")
        calls = self.herdr_calls()
        self.assertFalse(any("over budget" in c for c in calls), calls)
        self.assertFalse(any(c.startswith("pane close") for c in calls), calls)

    def test_flags_over_budget_worker_tab(self):
        self.cfg()
        self.prep_tabs(["w1:t2"])
        self.run_script("team-watch", "--once", scenario="panes_overbudget")
        calls = self.wait_for_calls(lambda c: "over budget" in c)
        self.assertTrue(any("over budget" in c for c in calls), calls)

    def test_layout_flag_pushed_once_across_repeated_passes(self):
        self.cfg()
        self.prep_tabs(["w1:t2"])
        self.run_script("team-watch", "--once", scenario="panes_overbudget")
        self.run_script("team-watch", "--once", scenario="panes_overbudget")
        self.wait_for_calls(lambda c: "over budget" in c)
        time.sleep(0.3)   # room for a wrong second push to land
        flags = [c for c in self.herdr_calls() if "over budget" in c]
        self.assertEqual(len(flags), 1)

    def test_captures_own_pane_when_missing(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        self.run_script("team-watch", "--once")
        state = json.loads(read_text(self.sp(".team", "watch-state.json")))
        self.assertEqual(state.get("own_pane"), "w1:p1")

    def test_never_closes_own_pane(self):
        # Named by a record too, so it is the own-pane rule doing the work
        # here, not the naming rule.
        self.cfg()
        self.prep_tabs(["w1:t2"], own_pane="w1:p3")
        self.write_record("app-1-scout", "investigator", pane="w1:p3")
        self.run_script("team-watch", "--once", scenario="panes_empty")
        self.assertFalse(any(c.startswith("pane close w1:p3") for c in self.herdr_calls()))

    def test_pending_pane_not_closed(self):
        # Named by a record too, so it is the pending guard doing the work
        # here, not the naming rule.
        self.cfg()
        self.prep_tabs(["w1:t2"])   # own_pane defaults to w1:p9
        self.write_record("app-1-scout", "investigator", pane="w1:p3")
        pend = self.sp(".team", "pending")
        os.makedirs(pend, exist_ok=True)
        open(os.path.join(pend, "w1_p3"), "w").close()   # mark w1:p3 pending
        self.run_script("team-watch", "--once", scenario="panes_empty")
        self.assertFalse(any(c.startswith("pane close w1:p3") for c in self.herdr_calls()))

    def test_unknown_own_pane_closes_nothing(self):
        self.cfg()
        d = self.sp(".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "tabs.json"), json.dumps(["w1:t2"]))
        write_text(os.path.join(d, "watch-state.json"), json.dumps({"agents": {}, "_flagged": {}}))
        self.run_script("team-watch", "--once", scenario="own_pane_blind")
        self.assertFalse(any(c.startswith("pane close") for c in self.herdr_calls()))

    def test_survives_missing_team_dir(self):
        # No /team:init here: scratchpad/.team does not exist. A pass must create
        # what it needs and not crash, and must not leak a redirect error.
        p = self.run_script("team-watch", "--once", scenario="watch_idle")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertNotIn("No such file", p.stderr)
        state = self.sp(".team", "watch-state.json")
        self.assertTrue(os.path.exists(state))

    def test_loop_survives_failing_pass(self):
        # A pass that raises (here: a malformed agent list) must not kill the
        # loop. The loop logs the error and keeps polling.
        self.cfg()
        env = self.env(scenario="bad_list")
        try:
            r = subprocess.run([os.path.join(BIN, "team-watch"), "--interval", "1"],
                               capture_output=True, text=True, env=env, cwd=self.proj, timeout=3)
            survived, out = False, r.stdout
        except subprocess.TimeoutExpired as e:
            survived = True
            out = e.stdout.decode() if isinstance(e.stdout, (bytes, bytearray)) else (e.stdout or "")
        self.assertTrue(survived, "watcher loop exited instead of surviving a failing pass")
        self.assertIn("pass error", out)

    def test_own_pane_flag_overrides_detection(self):
        # The launcher passes the true pane id; the flag wins over `pane current`
        # (which returns the FOCUSED pane, wrong for a --no-focus watcher pane).
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        self.run_script("team-watch", "--once", "--own-pane", "w1:zz")
        state = json.loads(read_text(self.sp(".team", "watch-state.json")))
        self.assertEqual(state.get("own_pane"), "w1:zz")
        self.assertFalse(any(c.startswith("pane current") for c in self.herdr_calls()))

    def test_spawn_splits_pane_and_runs_watcher_with_own_pane(self):
        # --spawn splits a pane off the orchestrator pane and runs the watcher
        # there by absolute path, passing the new pane id as --own-pane.
        self.cfg()
        p = self.run_script("team-watch", "--spawn")
        self.assertEqual(p.returncode, 0, p.stderr)
        calls = self.herdr_calls()
        self.assertTrue(any(c.startswith("pane split") for c in calls), calls)
        runs = [c for c in calls if c.startswith("pane run")]
        self.assertTrue(runs, calls)
        self.assertTrue(any("team-watch" in c and "--own-pane w1:p9" in c for c in runs), runs)
        # --spawn only launches; it must not run a poll pass itself.
        self.assertFalse(any(c.startswith("agent list") for c in calls), calls)

    def test_prints_state_change_to_own_stdout(self):
        # The watcher pane must show activity, not sit blank. Each state change
        # is logged to stdout as well as pushed to the orchestrator.
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        self.run_script("team-watch", "--once", scenario="watch_change")   # baseline working
        p = self.run_script("team-watch", "--once", scenario="watch_change")  # now blocked
        self.assertIn("working -> blocked", p.stdout)

    def test_spawn_makes_watcher_pane_small(self):
        # A watcher only needs a few lines; the orchestrator keeps most of the
        # tab. The split passes a ratio so the new pane is small.
        self.cfg()
        p = self.run_script("team-watch", "--spawn")
        self.assertEqual(p.returncode, 0, p.stderr)
        split = [c for c in self.herdr_calls() if c.startswith("pane split")]
        self.assertTrue(split, self.herdr_calls())
        self.assertTrue(any("--ratio" in c for c in split), split)

    def test_spawn_passes_an_absolute_team_scratch(self):
        self.cfg()
        p = self.run_script("team-watch", "--spawn")
        self.assertEqual(p.returncode, 0, p.stderr)
        split = [c for c in self.herdr_calls() if c.startswith("pane split")]
        self.assertIn("--env TEAM_SCRATCH=%s " % os.path.realpath(self.sp()), split[0] + " ")

    def write_report(self, name, topic, message=None):
        d = self.sp("reports")
        os.makedirs(d, exist_ok=True)
        if message is None:
            message = "| status bar |\n\nREPORT %s %s: done" % (name, topic)
        write_text(os.path.join(d, "%s-%s.md" % (name, topic)),
                   "# Report: %s / %s\n\n---\n\n%s\n" % (name, topic, message))

    def test_idle_briefed_tab_flags_release(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest",
                          brief="scratchpad/current/brief-app-1-scout-digest.md")
        self.write_report("app-1-scout", "digest")
        self.prep_tabs(["w1:t2"])   # own_pane w1:p9, not in the idle tab
        self.run_script("team-watch", "--once", scenario="panes_idle_only")
        pushes = [c for c in self.herdr_calls() if "WATCH" in c]
        self.assertTrue(any("consider release" in c for c in pushes), pushes)

    def test_idle_tab_without_fresh_report_not_flagged_release(self):
        # An idle agent whose report never arrived must not be released unread.
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest",
                          brief="scratchpad/current/brief-app-1-scout-digest.md")
        self.prep_tabs(["w1:t2"])
        self.run_script("team-watch", "--once", scenario="panes_idle_only")
        pushes = [c for c in self.herdr_calls() if "WATCH" in c]
        self.assertFalse(any("consider release" in c for c in pushes), pushes)

    def test_idle_tab_with_report_file_but_no_report_line_not_flagged_release(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest",
                          brief="scratchpad/current/brief-app-1-scout-digest.md")
        self.write_report("app-1-scout", "digest", "still waiting on two subagents")
        self.prep_tabs(["w1:t2"])
        self.run_script("team-watch", "--once", scenario="panes_idle_only")
        pushes = [c for c in self.herdr_calls() if "WATCH" in c]
        self.assertFalse(any("consider release" in c for c in pushes), pushes)

    def test_idle_unbriefed_tab_not_flagged_release(self):
        # A freshly spawned, never-briefed agent looks idle too; it must NOT be
        # flagged as a release candidate (no brief recorded yet).
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest", brief="")
        self.prep_tabs(["w1:t2"])
        self.run_script("team-watch", "--once", scenario="panes_idle_only")
        pushes = [c for c in self.herdr_calls() if "WATCH" in c]
        self.assertFalse(any("consider release" in c for c in pushes), pushes)


if __name__ == "__main__":
    unittest.main()
