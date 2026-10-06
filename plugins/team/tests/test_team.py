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
        os.symlink(os.path.join(HERE, "fake-claude"), os.path.join(self.shim, "claude"))
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
        e["TEAM_INDEX_DIR"] = os.path.join(self.proj, "_index")
        e["TEAM_SESSION_ID"] = "orch-sid"
        e.pop("CLAUDE_CONFIG_DIR", None)
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

    def index_entry(self, session):
        return json.loads(read_text(os.path.join(self.proj, "_index", session + ".json")))

    # A Claude Code profile: its own config dir, with a space to prove quoting.
    # The session index follows it when TEAM_INDEX_DIR is not set.
    def profile(self):
        return os.path.join(self.proj, "my profile")

    def profile_env(self):
        return {"CLAUDE_CONFIG_DIR": self.profile(), "TEAM_INDEX_DIR": None}

    def profile_index(self, *parts):
        return os.path.join(self.profile(), "team", "sessions", *parts)

    def write_record(self, name, role, topic="", brief="", cwd=None, pane="w1:p2", session=None):
        d = self.sp(".team")
        os.makedirs(d, exist_ok=True)
        rec = {"role": role, "topic": topic, "brief": brief, "pane": pane, "started": "t"}
        if cwd is not None:
            rec["cwd"] = cwd
        if session is not None:
            rec["session"] = session
        write_text(os.path.join(d, name + ".json"), json.dumps(rec))


class TeamStart(Base):
    UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"

    def test_assigns_session_id_and_records_launch_flags(self):
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj, env_extra=self.bar_env("Opus 5.5", cwd=self.proj))
        self.assertEqual(p.returncode, 0, p.stderr)
        start = next(c for c in self.herdr_calls() if c.startswith("agent start "))
        sid = re.search(r"--session-id (%s)" % self.UUID, start).group(1)
        rec = self.team_json("scout")
        self.assertEqual(rec["session"], sid)
        self.assertEqual((rec["model"], rec["effort"], rec["mode"]),
                         ("claude-opus-5-5", "medium", "auto"))

    def test_writes_session_index_entry(self):
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj, env_extra=self.bar_env("Opus 5.5", cwd=self.proj))
        self.assertEqual(p.returncode, 0, p.stderr)
        sid = self.team_json("scout")["session"]
        entry = self.index_entry(sid)
        self.assertEqual(entry["name"], "scout")
        self.assertEqual(entry["scratch"], os.path.realpath(self.sp()))

    def test_session_index_follows_the_claude_profile(self):
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj,
                            env_extra={**self.bar_env("Opus 5.5", cwd=self.proj), **self.profile_env()})
        self.assertEqual(p.returncode, 0, p.stderr)
        sid = self.team_json("scout")["session"]
        self.assertEqual(json.loads(read_text(self.profile_index(sid + ".json")))["name"], "scout")

    def test_pane_gets_the_claude_profile(self):
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj,
                            env_extra={**self.bar_env("Opus 5.5"), **self.profile_env()})
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("pane run w1:p2 export TEAM_NAME=scout TEAM_SCRATCH=%s CLAUDE_CONFIG_DIR=%s"
                      % (self.abs_scratch(), self.profile().replace(" ", "\\ ")), self.herdr_calls())

    def test_split_pane_gets_the_claude_profile(self):
        p = self.run_script("team-start", "scout", "investigator", "--split", "w1:p1", "down",
                            "--cwd", self.proj,
                            env_extra={**self.bar_env("Opus 5.5"), **self.profile_env()})
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(any(c.startswith("pane split") and "--env CLAUDE_CONFIG_DIR=%s " % self.profile() in c
                            for c in self.herdr_calls()), self.herdr_calls())

    def test_new_tab_gets_the_claude_profile(self):
        p = self.run_script("team-start", "scout", "investigator", "--new-tab", "--cwd", self.proj,
                            env_extra={**self.bar_env("Opus 5.5"), **self.profile_env()})
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(any(c.startswith("tab create") and "--env CLAUDE_CONFIG_DIR=%s " % self.profile() in c
                            for c in self.herdr_calls()), self.herdr_calls())

    def test_no_profile_passes_no_config_dir(self):
        p = self.run_script("team-start", "scout", "investigator", "--split", "w1:p1", "down",
                            "--cwd", self.proj, env_extra=self.bar_env("Opus 5.5"))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(any("CLAUDE_CONFIG_DIR" in c for c in self.herdr_calls()), self.herdr_calls())

    def bar_env(self, model, mode="auto", cwd=None):
        return {"FAKE_STATUS_MODEL": model, "FAKE_STATUS_MODE": mode,
                "FAKE_STATUS_CWD": cwd or self.proj}

    def start_argv(self, name, agent, model, effort, mode="auto"):
        return re.compile(
            r"agent start %s --kind claude --pane w1:p2 --timeout 90000 "
            r"-- --agent %s --session-id %s --model %s --effort %s --permission-mode %s "
            r"--name %s --settings \{\"crossSessionInbound\":\"accept\"\}$"
            % (name, agent, self.UUID, model, effort, mode, name))

    def assert_started(self, pattern):
        self.assertTrue(any(pattern.match(c) for c in self.herdr_calls()), self.herdr_calls())

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
                self.assert_started(self.start_argv(role[:4], agent, model, effort))
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
                self.assert_started(self.start_argv("maker", "team-implementer", model, "xhigh"))
                self.assertEqual(json.loads(p.stdout)["model"], model)

    def test_haiku_starts_in_accept_edits_mode(self):
        # Haiku has no auto mode, so the default mode follows the model.
        p = self.run_script("team-start", "clerk", "implementer", "--pane", "w1:p2",
                            "--cwd", self.proj, "--model", "haiku-4-5", "--effort", "low",
                            env_extra=self.bar_env("Haiku 4.5", mode="accept edits on"))
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assert_started(self.start_argv("clerk", "team-implementer", "claude-haiku-4-5-20251001",
                                            "low", mode="acceptEdits"))
        out = json.loads(p.stdout)
        self.assertEqual(out["mode"], "accept-edits")

    def test_accept_edits_mode_uses_claude_permission_mode_name(self):
        p = self.run_script("team-start", "maker", "implementer", "--pane", "w1:p2",
                            "--cwd", self.proj, "--mode", "accept-edits",
                            env_extra=self.bar_env("Sonnet 5.5", mode="accept edits on"))
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assert_started(self.start_argv("maker", "team-implementer", "claude-sonnet-5-5",
                                            "medium", mode="acceptEdits"))

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


class TeamBriefPrepare(Base):
    KICKOFF = ("Read scratchpad/current/brief-scout-digest.md and execute it fully. "
               "Report back as it describes. You are in execution mode; if your session "
               "shows plan mode, say so immediately.")

    def prep(self, name="scout", topic="digest"):
        self.write_record(name, "investigator", topic=topic)
        os.makedirs(self.sp(), exist_ok=True)
        write_text(self.sp("brief-%s-%s.md" % (name, topic)), "x")

    def test_prepare_prints_kickoff_and_updates_record(self):
        self.write_record("scout", "investigator")
        os.makedirs(self.sp(), exist_ok=True)
        write_text(self.sp("brief-scout-digest.md"), "brief")
        p = self.run_script("team-brief", "prepare", "scout", "--topic", "digest")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.strip(), self.KICKOFF)
        rec = self.team_json("scout")
        self.assertEqual((rec["topic"], rec["brief"]), ("digest", "scratchpad/current/brief-scout-digest.md"))
        self.assertEqual(self.herdr_calls(), [])

    def test_send_is_gone(self):
        self.prep()
        p = self.run_script("team-brief", "send", "scout", "--topic", "digest")
        self.assertEqual(p.returncode, 2)
        self.assertEqual(self.herdr_calls(), [])

    def test_missing_brief_is_bad_args(self):
        self.write_record("scout", "investigator")
        p = self.run_script("team-brief", "prepare", "scout", "--topic", "digest")
        self.assertEqual(p.returncode, 2)
        self.assertIn("no brief", p.stderr)

    def test_mirrors_brief_and_decisions_into_worktree_scratch(self):
        # A worktree agent's record carries an absolute cwd outside self.proj.
        # prepare must copy the brief and the decisions file into that
        # worktree's own scratchpad, and reference the brief by a path relative
        # to it, so the agent never reads outside its own working directory.
        wt = tempfile.mkdtemp()
        try:
            self.write_record("scout", "investigator", topic="digest", cwd=wt)
            d = self.sp(".team")
            os.makedirs(d, exist_ok=True)
            write_text(os.path.join(d, "config.json"), json.dumps({"team_id": "app-1", "ticket": "APP-1"}))
            write_text(self.sp("decisions-APP-1.md"), "1. decision\n")
            write_text(self.sp("brief-scout-digest.md"), "brief body\n")

            p = self.run_script("team-brief", "prepare", "scout", "--topic", "digest")

            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertEqual(read_text(os.path.join(wt, "scratchpad", "current", "brief-scout-digest.md")), "brief body\n")
            self.assertEqual(read_text(os.path.join(wt, "scratchpad", "current", "decisions-APP-1.md")), "1. decision\n")
            self.assertEqual(p.stdout.strip(), self.KICKOFF)
            self.assertNotIn(wt, p.stdout)
        finally:
            shutil.rmtree(wt, ignore_errors=True)

    def test_no_mirroring_when_cwd_is_the_main_repo(self):
        self.prep()
        p = self.run_script("team-brief", "prepare", "scout", "--topic", "digest")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.strip(), self.KICKOFF)


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
    def test_joins_roster_and_reads_idle_by_pane(self):
        self.write_record("scout", "investigator", topic="digest", session="11111111aaaa")
        self.write_record("maker", "implementer", topic="build", session="22222222bbbb")
        p = self.run_script("team-status", "--read-idle", scenario="status_mixed")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("scout (w1:p2, 11111111) idle investigator digest -", p.stdout)
        calls = self.herdr_calls()
        self.assertTrue(any(c.startswith("agent read w1:p2") for c in calls))
        self.assertFalse(any(c.startswith("agent read w1:p3") for c in calls))
        roster = self.sp(".team", "roster.md")
        self.assertTrue(os.path.exists(roster))

    def cfg(self, orch="app-1-orch"):
        d = self.sp(".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "config.json"),
                   json.dumps({"team_id": "app-1", "orchestrator": orch,
                               "orchestrator_session": "oooo0000dddd"}))

    def test_roster_lists_only_team_agents_and_orchestrator(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest", session="11111111aaaa")
        p = self.run_script("team-status", scenario="status_two_teams")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.splitlines(), [
            "app-1-orch (w2:p1, oooo0000) working - - -",
            "app-1-scout (w2:p2, 11111111) idle investigator digest -",
        ])

    def test_maps_records_by_session_not_name(self):
        # w2:pB has no herdr name at all, as after a restart.
        self.cfg()
        self.write_record("app-1-scout", "investigator", session="c23a1be5eeee")
        p = self.run_script("team-status", scenario="status_two_teams")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("app-1-scout (w2:pB, c23a1be5) idle investigator", p.stdout)

    def test_warns_about_a_team_started_before_session_ids(self):
        # Such a team gets no REPORT delivery from the team mod: say so.
        d = self.sp(".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "config.json"), json.dumps({"team_id": "app-1", "orchestrator": "app-1-orch"}))
        p = self.run_script("team-status", scenario="status_two_teams")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("started before team 0.5.0", p.stderr)
        self.assertIn("/team:init", p.stderr)

    def test_no_warning_for_a_current_team(self):
        self.cfg()
        p = self.run_script("team-status", scenario="status_two_teams")
        self.assertEqual(p.stderr, "")

    def test_record_without_a_live_session_is_left_out(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", session="gone0000")
        p = self.run_script("team-status", scenario="status_two_teams")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.splitlines(), ["app-1-orch (w2:p1, oooo0000) working - - -"])

    def test_json_reports_herdr_agent_status(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest", session="11111111aaaa")
        p = self.run_script("team-status", "--json", scenario="status_two_teams")
        self.assertEqual(p.returncode, 0, p.stderr)
        states = {r["name"]: r["state"] for r in json.loads(p.stdout)}
        self.assertEqual(states, {"app-1-orch": "working", "app-1-scout": "idle"})

    def test_empty_record_fields_keep_columns(self):
        self.cfg()
        self.write_record("app-1-scout", "", session="11111111aaaa")
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

    def write_index(self, session, name):
        d = os.path.join(self.proj, "_index")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, session + ".json"),
                   json.dumps({"scratch": os.path.realpath(self.sp()), "name": name}))

    def test_finds_agent_by_session_id_without_team_env(self):
        self.write_record("scout", "investigator", topic="digest")
        rec = self.team_json("scout"); rec["session"] = "sid-1"
        write_text(self.sp(".team", "scout.json"), json.dumps(rec))
        self.write_index("sid-1", "scout")
        tr = self.transcript("REPORT scout digest: done")
        p = self.run_hook({"session_id": "sid-1", "transcript_path": tr, "cwd": self.proj},
                          TEAM_NAME=None, TEAM_SCRATCH=None)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("REPORT scout digest: done", read_text(self.report_path("scout", "digest")))

    def test_finds_agent_in_the_index_of_the_claude_profile(self):
        self.write_record("scout", "investigator", topic="digest", session="sid-1")
        os.makedirs(self.profile_index())
        write_text(self.profile_index("sid-1.json"),
                   json.dumps({"scratch": os.path.realpath(self.sp()), "name": "scout"}))
        tr = self.transcript("REPORT scout digest: done")
        p = self.run_hook({"session_id": "sid-1", "transcript_path": tr, "cwd": self.proj},
                          TEAM_NAME=None, TEAM_SCRATCH=None, **self.profile_env())
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("REPORT scout digest: done", read_text(self.report_path("scout", "digest")))

    def test_index_entry_for_another_session_is_ignored(self):
        self.write_record("scout", "investigator", topic="digest")
        rec = self.team_json("scout"); rec["session"] = "sid-2"
        write_text(self.sp(".team", "scout.json"), json.dumps(rec))
        self.write_index("sid-1", "scout")
        tr = self.transcript("REPORT scout digest: done")
        p = self.run_hook({"session_id": "sid-1", "transcript_path": tr, "cwd": self.proj},
                          TEAM_NAME=None, TEAM_SCRATCH=None)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(os.path.exists(self.report_path("scout", "digest")))

    def test_never_forwards_to_the_orchestrator(self):
        self.write_record("scout", "investigator", topic="digest")
        tr = self.transcript("REPORT scout digest: done")
        p = self.run_hook({"transcript_path": tr, "cwd": self.proj}, TEAM_NAME="scout")
        self.assertEqual(p.returncode, 0, p.stderr)
        time.sleep(0.3)
        self.assertFalse(any(c.startswith("agent prompt ") for c in self.herdr_calls()))

    def test_identifies_by_team_name_env(self):
        # TEAM_NAME wins over the session id while the env is there. A second
        # record is present to prove it picks the record by name.
        self.write_record("scout", "investigator", topic="digest")
        self.write_record("maker", "implementer", topic="build")
        tr = self.transcript("REPORT scout digest: done, 2 files")

        p = self.run_hook({"session_id": "no-such-session", "transcript_path": tr,
                           "cwd": self.proj}, TEAM_NAME="scout")

        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("REPORT scout digest: done, 2 files",
                      read_text(self.report_path("scout", "digest")))
        self.assertFalse(os.path.exists(self.report_path("maker", "build")))

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

    def test_reports_last_message_the_transcript_does_not_hold_yet(self):
        # Claude Code may flush the final message to the transcript after the
        # Stop hook runs. The payload's last_assistant_message already holds it.
        self.write_record("scout", "investigator", topic="digest")
        tr = self.transcript("Now writing the deliverable.")
        p = self.run_hook({"transcript_path": tr, "cwd": self.proj,
                           "last_assistant_message": "Done.\n\nREPORT scout digest: done, 1 file"},
                          TEAM_NAME="scout")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("REPORT scout digest: done, 1 file", read_text(self.report_path("scout", "digest")))

    def test_later_stop_without_report_keeps_the_fresh_report(self):
        # The team mod picks reports up every 15 s; a second stop in between
        # (a peer message woke the worker) must not erase the REPORT.
        self.write_record("scout", "investigator", topic="digest")
        p = self.run_hook({"transcript_path": self.transcript("x"), "cwd": self.proj,
                           "last_assistant_message": "REPORT scout digest: done"}, TEAM_NAME="scout")
        self.assertEqual(p.returncode, 0, p.stderr)
        p = self.run_hook({"transcript_path": self.transcript("x"), "cwd": self.proj,
                           "last_assistant_message": "noted, nothing to add"}, TEAM_NAME="scout")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("REPORT scout digest: done", read_text(self.report_path("scout", "digest")))

    def test_a_new_brief_lets_the_next_stop_replace_the_old_report(self):
        self.write_record("scout", "investigator", topic="digest")
        self.run_hook({"transcript_path": self.transcript("x"), "cwd": self.proj,
                       "last_assistant_message": "REPORT scout digest: done"}, TEAM_NAME="scout")
        brief = self.sp("brief-scout-digest.md")
        write_text(brief, "# Brief\n")
        later = os.path.getmtime(self.report_path("scout", "digest")) + 5
        os.utime(brief, (later, later))
        self.run_hook({"transcript_path": self.transcript("x"), "cwd": self.proj,
                       "last_assistant_message": "working on the new brief"}, TEAM_NAME="scout")
        self.assertIn("working on the new brief", read_text(self.report_path("scout", "digest")))

    def test_stop_without_report_line_writes_report(self):
        # A stop without a REPORT line is often a pause (the worker waits on its
        # own subagents); the report file still holds the latest message.
        self.write_record("scout", "investigator", topic="digest")
        tr = self.transcript("two subagents still running, waiting")
        p = self.run_hook({"transcript_path": tr, "cwd": self.proj}, TEAM_NAME="scout")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("waiting", read_text(self.report_path("scout", "digest")))

    def test_unreadable_transcript_logs_and_exits_zero(self):
        self.write_record("scout", "investigator", topic="digest")
        p = self.run_hook({"transcript_path": "/does/not/exist", "cwd": self.proj},
                          TEAM_NAME="scout")
        self.assertEqual(p.returncode, 0, p.stderr)
        log = self.sp(".team", "hook.log")
        self.assertTrue(os.path.exists(log))
        self.assertIn("transcript unreadable", read_text(log))


class SessionStartHook(Base):
    HOOK = os.path.join(ROOT, "hooks", "handlers", "session-start.sh")

    def run_hook(self, payload, **env_extra):
        return subprocess.run(["bash", self.HOOK], input=json.dumps(payload),
                              capture_output=True, text=True, env=self.env(**env_extra), cwd=self.proj)

    def setup_worker(self, session):
        self.write_record("scout", "investigator", topic="digest")
        rec = self.team_json("scout"); rec["session"] = session
        write_text(self.sp(".team", "scout.json"), json.dumps(rec))
        d = os.path.join(self.proj, "_index"); os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, session + ".json"),
                   json.dumps({"scratch": os.path.realpath(self.sp()), "name": "scout"}))

    def test_clear_moves_identity_to_the_new_session(self):
        self.setup_worker("old-1")
        p = self.run_hook({"session_id": "new-2", "source": "clear", "cwd": self.proj},
                          TEAM_NAME="scout")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(self.team_json("scout")["session"], "new-2")
        self.assertEqual(self.index_entry("new-2")["name"], "scout")
        self.assertFalse(os.path.exists(os.path.join(self.proj, "_index", "old-1.json")))

    def test_clear_writes_the_index_of_the_claude_profile(self):
        self.setup_worker("old-1")
        p = self.run_hook({"session_id": "new-2", "source": "clear", "cwd": self.proj},
                          TEAM_NAME="scout", **self.profile_env())
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(json.loads(read_text(self.profile_index("new-2.json")))["name"], "scout")

    def test_clear_without_team_name_changes_nothing(self):
        self.setup_worker("old-1")
        p = self.run_hook({"session_id": "new-2", "source": "clear", "cwd": self.proj},
                          TEAM_NAME=None, TEAM_SCRATCH=None)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(self.team_json("scout")["session"], "old-1")

    def setup_briefed_worker(self, session):
        self.setup_worker(session)
        rec = self.team_json("scout"); rec["brief_sent_session"] = session
        write_text(self.sp(".team", "scout.json"), json.dumps(rec))

    def test_compact_lifts_the_brief_mark(self):
        self.setup_briefed_worker("s-1")
        p = self.run_hook({"session_id": "s-1", "source": "compact", "cwd": self.proj},
                          TEAM_NAME="scout")
        self.assertEqual(p.returncode, 0, p.stderr)
        rec = self.team_json("scout")
        self.assertNotIn("brief_sent_session", rec)
        self.assertEqual(rec["session"], "s-1")

    def test_compact_of_another_session_keeps_the_brief_mark(self):
        self.setup_briefed_worker("s-1")
        p = self.run_hook({"session_id": "other", "source": "compact", "cwd": self.proj},
                          TEAM_NAME="scout")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(self.team_json("scout")["brief_sent_session"], "s-1")

    def test_compact_without_team_name_keeps_the_brief_mark(self):
        self.setup_briefed_worker("s-1")
        p = self.run_hook({"session_id": "s-1", "source": "compact", "cwd": self.proj},
                          TEAM_NAME=None, TEAM_SCRATCH=None)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(self.team_json("scout")["brief_sent_session"], "s-1")

    def test_resume_without_team_env_marks_restored_worker(self):
        self.setup_worker("old-1")
        p = self.run_hook({"session_id": "old-1", "source": "resume", "cwd": self.proj},
                          TEAM_NAME=None, TEAM_SCRATCH=None)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.sp(".team", "restored", "scout")))

    def test_resume_with_team_env_is_not_marked(self):
        self.setup_worker("old-1")
        p = self.run_hook({"session_id": "old-1", "source": "resume", "cwd": self.proj},
                          TEAM_NAME="scout")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(os.path.exists(self.sp(".team", "restored", "scout")))

    def test_unrelated_session_is_silent(self):
        p = self.run_hook({"session_id": "x", "source": "startup", "cwd": self.proj},
                          TEAM_NAME=None, TEAM_SCRATCH=None)
        self.assertEqual((p.returncode, p.stdout, p.stderr), (0, "", ""))


class TeamResurrect(Base):
    def setup_team(self):
        d = self.sp(".team"); os.makedirs(os.path.join(d, "restored"))
        for name, sid, role in (("scout", "sid-scout", "investigator"), ("maker", "sid-maker", "implementer"),
                                ("ghost", "sid-ghost", "tester")):
            write_text(os.path.join(d, name + ".json"), json.dumps(
                {"role": role, "topic": "", "brief": "", "pane": "w1:p2", "session": sid,
                 "model": "claude-sonnet-5-5", "effort": "low", "mode": "auto", "cwd": self.proj}))
        open(os.path.join(d, "restored", "scout"), "w").close()
        open(os.path.join(d, "restored", "ghost"), "w").close()

    def test_relaunches_marked_workers_with_saved_flags(self):
        self.setup_team()
        p = self.run_script("team-resurrect", scenario="resurrect")
        self.assertEqual(p.returncode, 0, p.stderr)
        calls = self.herdr_calls()
        self.assertIn("agent prompt w1:p5 /exit", calls)
        self.assertIn("agent wait w1:p5 --until unknown --timeout 30000", calls)
        self.assertIn("pane run w1:p5 export TEAM_NAME=scout TEAM_SCRATCH=%s" % os.path.realpath(self.sp()), calls)
        self.assertIn(
            'agent start scout --kind claude --pane w1:p5 --timeout 90000 -- --resume sid-scout '
            '--agent team-investigator --model claude-sonnet-5-5 --effort low --permission-mode auto '
            '--name scout --settings {"crossSessionInbound":"accept"}', calls)
        self.assertFalse(os.path.exists(self.sp(".team", "restored", "scout")))
        self.assertIn("relaunched scout (w1:p5)", p.stdout)

    def test_unmarked_worker_is_healthy_and_untouched(self):
        self.setup_team()
        p = self.run_script("team-resurrect", scenario="resurrect")
        self.assertIn("healthy maker", p.stdout)
        self.assertFalse(any("w1:p6" in c and c.startswith(("agent prompt", "agent start", "pane run"))
                             for c in self.herdr_calls()))

    def test_worker_missing_from_herdr_is_reported(self):
        self.setup_team()
        p = self.run_script("team-resurrect", scenario="resurrect")
        self.assertIn("missing ghost: session sid-ghost not in herdr", p.stdout)

    def test_missing_worker_loses_its_restored_marker(self):
        self.setup_team()
        self.run_script("team-resurrect", scenario="resurrect")
        self.assertFalse(os.path.exists(self.sp(".team", "restored", "ghost")))

    def test_marker_without_a_record_is_removed(self):
        self.setup_team()
        open(self.sp(".team", "restored", "released"), "w").close()
        p = self.run_script("team-resurrect", scenario="resurrect")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(os.path.exists(self.sp(".team", "restored", "released")))

    def test_team_name_is_shell_quoted_in_the_pane(self):
        self.setup_team()
        os.rename(self.sp(".team", "scout.json"), self.sp(".team", "sc out.json"))
        os.rename(self.sp(".team", "restored", "scout"), self.sp(".team", "restored", "sc out"))
        p = self.run_script("team-resurrect", scenario="resurrect")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("pane run w1:p5 export TEAM_NAME=sc\\ out TEAM_SCRATCH=%s" % os.path.realpath(self.sp()),
                      self.herdr_calls())

    def test_relaunched_pane_gets_the_claude_profile(self):
        self.setup_team()
        p = self.run_script("team-resurrect", scenario="resurrect", env_extra=self.profile_env())
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("pane run w1:p5 export TEAM_NAME=scout TEAM_SCRATCH=%s CLAUDE_CONFIG_DIR=%s"
                      % (os.path.realpath(self.sp()), self.profile().replace(" ", "\\ ")), self.herdr_calls())

    def test_herdr_down_is_a_herdr_error(self):
        self.setup_team()
        p = self.run_script("team-resurrect", scenario="list_fails")
        self.assertEqual(p.returncode, 4)

    def cleared_worker(self, marked):
        # Restored without its env, then /clear'd: its record still names the
        # old session, while its pane now runs a session no record claims.
        d = self.sp(".team"); os.makedirs(os.path.join(d, "restored"))
        write_text(os.path.join(d, "scout.json"), json.dumps(
            {"role": "investigator", "topic": "", "brief": "", "pane": "w1:p5", "session": "sid-old",
             "model": "claude-sonnet-5-5", "effort": "low", "mode": "auto", "cwd": self.proj}))
        idx = os.path.join(self.proj, "_index"); os.makedirs(idx)
        write_text(os.path.join(idx, "sid-old.json"),
                   json.dumps({"scratch": os.path.realpath(self.sp()), "name": "scout"}))
        if marked:
            open(os.path.join(d, "restored", "scout"), "w").close()

    def test_adopts_the_session_a_restored_worker_got_from_a_clear(self):
        self.cleared_worker(marked=True)
        p = self.run_script("team-resurrect", scenario="resurrect_cleared")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("relaunched scout (w1:p5), adopted session sid-cleared", p.stdout)
        self.assertTrue(any(c.startswith("agent start scout ") and "--resume sid-cleared " in c
                            for c in self.herdr_calls()), self.herdr_calls())
        self.assertEqual(self.team_json("scout")["session"], "sid-cleared")
        self.assertEqual(self.index_entry("sid-cleared")["name"], "scout")
        self.assertFalse(os.path.exists(os.path.join(self.proj, "_index", "sid-old.json")))

    def test_never_adopts_a_pane_session_of_an_unmarked_worker(self):
        self.cleared_worker(marked=False)
        p = self.run_script("team-resurrect", scenario="resurrect_cleared")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("missing scout: session sid-old not in herdr", p.stdout)
        self.assertEqual(self.team_json("scout")["session"], "sid-old")

    def test_pane_is_pending_while_its_agent_restarts(self):
        # The team mod closes an empty pane a record names; a pane between
        # /exit and the relaunched Claude looks empty, so it must be pending.
        self.setup_team()
        marker_log = os.path.join(self.proj, "marker.log")
        p = self.run_script("team-resurrect", scenario="resurrect", env_extra={
            "FAKE_MARKER_CHECK_GROUP": "agent", "FAKE_MARKER_CHECK_SUB": "start",
            "FAKE_MARKER_CHECK_FILE": self.sp(".team", "pending", "w1_p5"),
            "FAKE_MARKER_CHECK_LOG": marker_log})
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(read_text(marker_log).split(), ["present"])
        self.assertFalse(os.path.exists(self.sp(".team", "pending", "w1_p5")))

    def test_claude_that_does_not_exit_is_skipped(self):
        self.setup_team()
        p = self.run_script("team-resurrect", scenario="resurrect",
                            env_extra={"FAKE_AGENT_WAIT_FAILS": "1"})
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("could not stop scout (w1:p5)", p.stdout)
        calls = self.herdr_calls()
        self.assertFalse(any(c.startswith(("pane run w1:p5", "agent start scout")) for c in calls), calls)
        self.assertTrue(os.path.exists(self.sp(".team", "restored", "scout")))
        self.assertIn("healthy maker", p.stdout)


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

    def test_help_prints_usage_and_touches_nothing(self):
        self.old_run()
        for flag in ("--help", "-h"):
            with self.subTest(flag=flag):
                p = self.init(ticket=flag)
                self.assertEqual(p.returncode, 0, p.stderr)
                self.assertIn("usage: team-init <ticket>", p.stdout)
                self.assertEqual(json.loads(read_text(self.sp(".team", "config.json")))["ticket"], "APP-1")
                self.assertFalse(os.path.exists(self.archive()))

    def test_ticket_that_looks_like_a_flag_is_bad_args(self):
        self.old_run()
        p = self.init(ticket="--label")
        self.assertEqual(p.returncode, 2, p.stderr)
        self.assertIn("usage: team-init <ticket>", p.stderr)
        self.assertEqual(json.loads(read_text(self.sp(".team", "config.json")))["ticket"], "APP-1")
        self.assertFalse(os.path.exists(self.archive()))

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

    def test_allows_send_message_so_brief_send_skips_the_auto_mode_classifier(self):
        # A message the team mod sends has no user request behind it, so auto
        # mode's classifier gives no verdict; an explicit allow rule decides it.
        self.run_script("team-init", "APP-1")
        s = json.loads(read_text(os.path.join(self.proj, ".claude", "settings.local.json")))
        self.assertIn("SendMessage", s["permissions"]["allow"])

    def test_records_orchestrator_tab(self):
        p = self.run_script("team-init", "APP-1", "--orchestrator-pane", "w1:p1",
                            scenario="pane_in_tab")
        self.assertEqual(p.returncode, 0, p.stderr)
        tabs = json.loads(read_text(self.sp(".team", "tabs.json")))
        self.assertIn("w1:t1", tabs)

    def test_config_names_the_orchestrator_tab(self):
        # The team mod exempts this tab from layout hygiene even while herdr
        # does not yet know the orchestrator's session (just after a /clear).
        p = self.run_script("team-init", "APP-1", "--orchestrator-pane", "w1:p1",
                            scenario="pane_in_tab")
        self.assertEqual(p.returncode, 0, p.stderr)
        cfg = json.loads(read_text(self.sp(".team", "config.json")))
        self.assertEqual(cfg["orchestrator_tab"], "w1:t1")

    def test_does_not_rename_the_orchestrator(self):
        p = self.run_script("team-init", "APP-1", "--orchestrator-pane", "w1:p1",
                            scenario="pane_in_tab")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(any(c.startswith("agent rename") for c in self.herdr_calls()))

    def test_records_orchestrator_session(self):
        p = self.run_script("team-init", "APP-1")
        self.assertEqual(p.returncode, 0, p.stderr)
        cfg = json.loads(read_text(self.sp(".team", "config.json")))
        self.assertEqual(cfg["orchestrator_session"], "orch-sid")

    def test_refuses_without_session_id(self):
        p = self.run_script("team-init", "APP-1", env_extra={"TEAM_SESSION_ID": None})
        self.assertEqual(p.returncode, 1)
        self.assertIn("TEAM_SESSION_ID is unset", p.stderr)

    def test_refuses_old_claude_code(self):
        p = self.run_script("team-init", "APP-1", env_extra={"FAKE_CLAUDE_VERSION": "2.1.286"})
        self.assertEqual(p.returncode, 1)
        self.assertIn("Claude Code 2.1.286 is older than 2.1.287", p.stderr)

    def test_keeps_an_index_entry_whose_record_it_cannot_read_right_now(self):
        # Another team's record caught mid-write is not a dead agent.
        other = os.path.join(self.proj, "other", ".team")
        os.makedirs(other)
        write_text(os.path.join(other, "w.json"), '{"session": "s')
        idx = os.path.join(self.proj, "_index"); os.makedirs(idx)
        write_text(os.path.join(idx, "live.json"),
                   json.dumps({"scratch": os.path.join(self.proj, "other"), "name": "w"}))
        p = self.run_script("team-init", "APP-1")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(os.path.join(idx, "live.json")))

    def test_prunes_index_entry_of_another_session(self):
        other = os.path.join(self.proj, "other", ".team")
        os.makedirs(other)
        write_text(os.path.join(other, "w.json"), json.dumps({"session": "newer"}))
        idx = os.path.join(self.proj, "_index"); os.makedirs(idx)
        write_text(os.path.join(idx, "older.json"),
                   json.dumps({"scratch": os.path.join(self.proj, "other"), "name": "w"}))
        p = self.run_script("team-init", "APP-1")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(os.path.exists(os.path.join(idx, "older.json")))

    def test_prunes_index_entries_without_a_matching_record(self):
        idx = os.path.join(self.proj, "_index"); os.makedirs(idx)
        write_text(os.path.join(idx, "gone.json"),
                   json.dumps({"scratch": os.path.join(self.proj, "nowhere"), "name": "x"}))
        p = self.run_script("team-init", "APP-1")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(os.path.exists(os.path.join(idx, "gone.json")))

    def test_prunes_the_index_of_the_claude_profile(self):
        os.makedirs(self.profile_index())
        write_text(self.profile_index("gone.json"),
                   json.dumps({"scratch": os.path.join(self.proj, "nowhere"), "name": "x"}))
        p = self.run_script("team-init", "APP-1", env_extra=self.profile_env())
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(os.path.exists(self.profile_index("gone.json")))

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


if __name__ == "__main__":
    unittest.main()
