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
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)          # plugins/team
BIN = os.path.join(ROOT, "bin")


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
        e["TEAM_SCRATCH"] = "scratchpad"
        e["CLAUDE_PLUGIN_ROOT"] = ROOT
        e.update(extra)
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

    def git_calls(self):
        with open(self.git_log) as f:
            return [l.rstrip("\n") for l in f if l.strip()]

    def team_json(self, name):
        return json.loads(read_text(os.path.join(self.proj, "scratchpad", ".team", name + ".json")))

    def write_record(self, name, role, topic="", brief="", session="abcdef12"):
        d = os.path.join(self.proj, "scratchpad", ".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, name + ".json"),
                   json.dumps({"role": role, "topic": topic, "brief": brief, "pane": "w1:p2",
                               "session": session, "started": "t"}))


class TeamStart(Base):
    def bar_env(self, model, mode="auto", cwd=None):
        return {"FAKE_STATUS_MODEL": model, "FAKE_STATUS_MODE": mode,
                "FAKE_STATUS_CWD": cwd or self.proj}

    def test_builds_exact_agent_start_argv_per_role(self):
        cases = {
            "investigator": ("team-investigator", "medium", "Opus 4.8"),
            "implementer": ("team-implementer", "medium", "Sonnet 5"),
            "tester": ("team-tester", "low", "Sonnet 5"),
        }
        for role, (agent, effort, model) in cases.items():
            with self.subTest(role=role):
                open(self.herdr_log, "w").close()
                p = self.run_script("team-start", role[:4], role, "--pane", "w1:p2",
                                    "--cwd", self.proj,
                                    env_extra=self.bar_env(model, cwd=self.proj))
                self.assertEqual(p.returncode, 0, p.stderr)
                expect = ("agent start %s --kind claude --pane w1:p2 --timeout 90000 "
                          "-- --agent %s --effort %s --permission-mode auto"
                          % (role[:4], agent, effort))
                self.assertIn(expect, self.herdr_calls())

    def test_writes_team_record(self):
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj, env_extra=self.bar_env("Opus 4.8"))
        self.assertEqual(p.returncode, 0, p.stderr)
        rec = self.team_json("scout")
        self.assertEqual(rec["role"], "investigator")
        self.assertEqual(rec["pane"], "w1:p2")
        self.assertEqual(rec["session"], "abcdef12")
        out = json.loads(p.stdout)
        self.assertEqual(out["model"], "claude-opus-4-8")

    def test_answers_first_run_dialog_once(self):
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj, scenario="first_run_dialog",
                            env_extra=self.bar_env("Opus 4.8"))
        self.assertEqual(p.returncode, 0, p.stderr)
        calls = self.herdr_calls()
        self.assertTrue(any(c.startswith("agent send-keys scout enter") for c in calls))
        self.assertEqual(sum(c.startswith("agent start ") for c in calls), 2)

    def test_writes_record_when_bar_shows_basename_only(self):
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj,
                            env_extra=self.bar_env("Opus 4.8", cwd=os.path.basename(self.proj)))
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        rec = self.team_json("scout")
        self.assertEqual(rec["role"], "investigator")

    def test_aborts_on_wrong_model(self):
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj, env_extra=self.bar_env("Sonnet 5"))
        self.assertEqual(p.returncode, 3, p.stdout + p.stderr)

    def test_unknown_role_is_bad_args(self):
        p = self.run_script("team-start", "x", "wizard", "--pane", "w1:p2")
        self.assertEqual(p.returncode, 2)

    def test_rejects_path_traversal_name(self):
        p = self.run_script("team-start", "../evil", "investigator", "--pane", "w1:p2")
        self.assertEqual(p.returncode, 2)
        self.assertFalse(any(c.startswith("agent start ") for c in self.herdr_calls()))

    def test_prefixes_name_with_team_id_from_config(self):
        d = os.path.join(self.proj, "scratchpad", ".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "config.json"),
                   json.dumps({"team_id": "app-5066", "orchestrator": "app-5066-orch"}))
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj, env_extra=self.bar_env("Opus 4.8"))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(any(c.startswith("agent start app-5066-scout ") for c in self.herdr_calls()))
        self.assertTrue(os.path.exists(os.path.join(d, "app-5066-scout.json")))
        out = json.loads(p.stdout)
        self.assertEqual(out["name"], "app-5066-scout")

    def test_does_not_double_prefix_already_namespaced_name(self):
        # The orchestrator refers to agents by their full <team_id>-<label> name
        # everywhere, so it may pass that name to team-start. Prepending again
        # would produce app-5066-app-5066-scout. It must not.
        d = os.path.join(self.proj, "scratchpad", ".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "config.json"),
                   json.dumps({"team_id": "app-5066", "orchestrator": "app-5066-orch"}))
        p = self.run_script("team-start", "app-5066-scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj, env_extra=self.bar_env("Opus 4.8"))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(any(c.startswith("agent start app-5066-scout ") for c in self.herdr_calls()),
                        self.herdr_calls())
        out = json.loads(p.stdout)
        self.assertEqual(out["name"], "app-5066-scout")

    def test_no_team_id_keeps_bare_name(self):
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj, env_extra=self.bar_env("Opus 4.8"))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(any(c.startswith("agent start scout ") for c in self.herdr_calls()))

    def config(self, team_id="app-1", orch="app-1-orch"):
        d = os.path.join(self.proj, "scratchpad", ".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "config.json"),
                   json.dumps({"team_id": team_id, "orchestrator": orch}))

    def test_refuses_name_already_live(self):
        # Starting a label whose namespaced name is already a live agent would
        # reuse its pane and cross-poison it. Refuse before touching herdr.
        self.config()
        p = self.run_script("team-start", "scout", "investigator", "--pane", "w1:p2",
                            "--cwd", self.proj, scenario="name_scout_taken",
                            env_extra=self.bar_env("Opus 4.8"))
        self.assertEqual(p.returncode, 3, p.stdout + p.stderr)
        self.assertFalse(any(c.startswith("agent start ") for c in self.herdr_calls()))

    def test_starts_when_namespaced_name_free(self):
        self.config()
        p = self.run_script("team-start", "maker", "implementer", "--pane", "w1:p2",
                            "--cwd", self.proj, scenario="name_scout_taken",
                            env_extra=self.bar_env("Sonnet 5"))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(any(c.startswith("agent start app-1-maker ") for c in self.herdr_calls()))

    def test_into_full_tab_spills_to_new_tab(self):
        d = os.path.join(self.proj, "scratchpad", ".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "tabs.json"), json.dumps(["w1:t2"]))
        p = self.run_script("team-start", "maker", "implementer", "--into-tab", "w1:t2",
                            "--cwd", self.proj, scenario="panes_overbudget",
                            env_extra={**self.bar_env("Sonnet 5"), "HERDR_WORKSPACE_ID": "w1"})
        self.assertEqual(p.returncode, 0, p.stderr)
        calls = self.herdr_calls()
        self.assertTrue(any(c.startswith("tab create") for c in calls), calls)
        self.assertTrue(any("agent start maker --kind claude --pane w1:p9" in c for c in calls))
        tabs = json.loads(read_text(os.path.join(d, "tabs.json")))
        self.assertIn("w1:t9", tabs)

    def test_into_underbudget_tab_splits_in_place(self):
        p = self.run_script("team-start", "maker", "implementer", "--into-tab", "w1:tG",
                            "--cwd", self.proj, scenario="grid2",
                            env_extra={**self.bar_env("Sonnet 5"), "HERDR_WORKSPACE_ID": "w1"})
        self.assertEqual(p.returncode, 0, p.stderr)
        calls = self.herdr_calls()
        self.assertFalse(any(c.startswith("tab create") for c in calls))
        self.assertTrue(any(c.startswith("pane split") for c in calls), calls)
        self.assertTrue(any("agent start maker --kind claude --pane w1:p9" in c for c in calls))

    def test_spill_defers_tab_registration_until_agent_live(self):
        # A spilled tab must not be registered while its root pane is still
        # empty; register only after the agent is live (a failed start = no tab).
        d = os.path.join(self.proj, "scratchpad", ".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "tabs.json"), json.dumps(["w1:t2"]))
        p = self.run_script("team-start", "maker", "implementer", "--into-tab", "w1:t2",
                            "--cwd", self.proj, scenario="panes_overbudget",
                            env_extra={**self.bar_env("Opus 4.8"), "HERDR_WORKSPACE_ID": "w1"})
        self.assertEqual(p.returncode, 3, p.stderr)   # wrong model bar -> pre-flight fail
        tabs = json.loads(read_text(os.path.join(d, "tabs.json")))
        self.assertNotIn("w1:t9", tabs)

    def grid_split(self, scenario):
        p = self.run_script("team-start", "scout", "investigator", "--into-tab", "w1:tG",
                            "--cwd", self.proj, scenario=scenario,
                            env_extra={**self.bar_env("Opus 4.8"), "HERDR_WORKSPACE_ID": "w1"})
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

    def test_into_tab_with_pane_is_bad_args(self):
        p = self.run_script("team-start", "maker", "implementer", "--into-tab", "w1:t2", "--pane", "w1:p2")
        self.assertEqual(p.returncode, 2)
        self.assertFalse(any(c.startswith("agent start ") for c in self.herdr_calls()))

    def test_into_empty_tab_is_bad_args(self):
        d = os.path.join(self.proj, "scratchpad", ".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "tabs.json"), json.dumps(["w1:t2"]))
        p = self.run_script("team-start", "maker", "implementer", "--into-tab", "w1:t2",
                            "--cwd", self.proj, env_extra={**self.bar_env("Sonnet 5"), "HERDR_WORKSPACE_ID": "w1"})
        self.assertEqual(p.returncode, 2)


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
        os.makedirs(os.path.join(self.proj, "scratchpad"), exist_ok=True)
        write_text(os.path.join(self.proj, "scratchpad", "brief-%s-%s.md" % (name, topic)), "x")

    def test_working_exits_zero_and_records(self):
        self.prep()
        p = self.run_script("team-brief", "send", "scout", "--topic", "digest")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.strip(), "working")
        rec = self.team_json("scout")
        self.assertEqual(rec["topic"], "digest")
        self.assertTrue(rec["brief"].endswith("brief-scout-digest.md"))

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

    def test_send_positions_prompt_before_wait_flag(self):
        self.prep()
        p = self.run_script("team-brief", "send", "scout", "--topic", "digest")
        self.assertEqual(p.returncode, 0, p.stderr)
        prompts = [c for c in self.herdr_calls() if c.startswith("agent prompt ")]
        self.assertEqual(len(prompts), 1)
        call = prompts[0]
        self.assertTrue(call.startswith("agent prompt scout Read "), call)
        self.assertTrue(call.endswith(" --wait"), call)


class TeamSlice(Base):
    def test_default_worktree_cmd_no_machete(self):
        p = self.run_script("team-slice", "feat", "main", "--label", "T1 APP-1 slug",
                            env_extra={"HERDR_WORKSPACE_ID": "w1"})
        self.assertEqual(p.returncode, 0, p.stderr)
        git = self.git_calls()
        self.assertIn("worktree add -b feat ../feat main", git)
        self.assertFalse(any(c.startswith("m add") for c in git))
        out = json.loads(p.stdout.splitlines()[0])
        self.assertEqual(out, {"worktree": "../feat", "tab": "w1:t9", "pane": "w1:p9"})

    def test_rejects_unsafe_git_ref(self):
        p = self.run_script("team-slice", "evil;rm -rf x", "main", "--label", "T1 X y",
                            env_extra={"HERDR_WORKSPACE_ID": "w1"})
        self.assertEqual(p.returncode, 2)
        self.assertEqual(self.git_calls(), [])

    def test_custom_worktree_cmd_and_stacked(self):
        d = os.path.join(self.proj, ".claude", "team")
        os.makedirs(d)
        write_text(os.path.join(d, "project.yaml"),
                   'stacked: true\nworktree_cmd: "git worktree add {branch} {parent}"\nworktree_dir: "{branch}"\n')
        p = self.run_script("team-slice", "feat", "main", "--label", "T1 APP-1 slug",
                            env_extra={"HERDR_WORKSPACE_ID": "w1"})
        self.assertEqual(p.returncode, 0, p.stderr)
        git = self.git_calls()
        self.assertIn("worktree add feat main", git)
        self.assertIn("m add feat --onto main", git)


class TeamStatus(Base):
    def test_joins_roster_and_reads_idle(self):
        self.write_record("scout", "investigator", topic="digest")
        p = self.run_script("team-status", "--read-idle", scenario="status_mixed")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("scout (w1:p2, 11111111) idle investigator digest -", p.stdout)
        calls = self.herdr_calls()
        self.assertTrue(any(c.startswith("agent read scout") for c in calls))
        self.assertFalse(any(c.startswith("agent read maker") for c in calls))
        roster = os.path.join(self.proj, "scratchpad", ".team", "roster.md")
        self.assertTrue(os.path.exists(roster))


class StopHook(Base):
    HOOK = os.path.join(ROOT, "hooks", "handlers", "stop-report.sh")

    def run_hook(self, payload):
        env = self.env()
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
        return os.path.join(self.proj, "scratchpad", "reports", "%s-%s.md" % (name, topic))

    def test_no_match_is_silent(self):
        p = self.run_hook({"session_id": "zzzzzzzz9999", "transcript_path": "/nope",
                           "cwd": self.proj})
        self.assertEqual(p.returncode, 0)
        self.assertEqual(p.stdout, "")
        self.assertEqual(p.stderr, "")

    def test_writes_report_for_match(self):
        self.write_record("scout", "investigator", topic="digest", session="abcdef12")
        tr = self.transcript("earlier", "final answer")
        p = self.run_hook({"session_id": "abcdef1299999", "transcript_path": tr, "cwd": self.proj})
        self.assertEqual(p.returncode, 0, p.stderr)
        body = read_text(self.report_path("scout", "digest"))
        self.assertIn("# Report: scout / digest", body)
        self.assertIn("final answer", body)

    def test_forwards_report_line(self):
        self.write_record("scout", "investigator", topic="digest", session="abcdef12")
        tr = self.transcript("REPORT scout digest: done, 2 files")
        p = self.run_hook({"session_id": "abcdef1200000", "transcript_path": tr, "cwd": self.proj})
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(any(c.startswith("agent prompt orchestrator REPORT scout digest: done")
                            for c in self.herdr_calls()))

    def test_forwards_report_line_after_status_bar(self):
        # The reported bug: a status-bar first line (workers inherit the rule)
        # meant the message never started with "REPORT ", so the ping was skipped
        # while the report file still landed. The hook must find the REPORT line
        # anywhere in the message, not only at offset zero.
        self.write_record("scout", "investigator", topic="digest", session="abcdef12")
        tr = self.transcript("| status bar |\n\nREPORT scout digest: done, 2 files")
        p = self.run_hook({"session_id": "abcdef1200000", "transcript_path": tr, "cwd": self.proj})
        self.assertEqual(p.returncode, 0, p.stderr)
        prompts = [c for c in self.herdr_calls() if c.startswith("agent prompt ")]
        self.assertTrue(any("REPORT scout digest: done, 2 files" in c for c in prompts), prompts)
        self.assertFalse(any("status bar" in c for c in prompts), prompts)

    def test_fallback_ping_when_no_report_line(self):
        # A worker that stops without any REPORT line must still wake the
        # orchestrator, with a nudge that points at the report file on disk.
        self.write_record("scout", "investigator", topic="digest", session="abcdef12")
        tr = self.transcript("just some final prose, no report line")
        p = self.run_hook({"session_id": "abcdef1200000", "transcript_path": tr, "cwd": self.proj})
        self.assertEqual(p.returncode, 0, p.stderr)
        prompts = [c for c in self.herdr_calls() if c.startswith("agent prompt ")]
        self.assertTrue(any(c.startswith("agent prompt orchestrator REPORT scout digest:")
                            for c in prompts), prompts)
        self.assertTrue(any("scratchpad/reports/scout-digest.md" in c for c in prompts), prompts)

    def test_no_self_ping_when_session_is_orchestrator(self):
        # Belt-and-suspenders: the orchestrator has no record today, but if one
        # ever matched, the hook must not prompt the orchestrator to itself.
        d = os.path.join(self.proj, "scratchpad", ".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "config.json"),
                   json.dumps({"team_id": "app-1", "orchestrator": "app-1-orch"}))
        self.write_record("app-1-orch", "investigator", topic="digest", session="abcdef12")
        tr = self.transcript("REPORT app-1-orch digest: done")
        p = self.run_hook({"session_id": "abcdef1200000", "transcript_path": tr, "cwd": self.proj})
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(any(c.startswith("agent prompt ") for c in self.herdr_calls()))

    def test_unreadable_transcript_logs_and_exits_zero(self):
        self.write_record("scout", "investigator", topic="digest", session="abcdef12")
        p = self.run_hook({"session_id": "abcdef1211111", "transcript_path": "/does/not/exist",
                           "cwd": self.proj})
        self.assertEqual(p.returncode, 0, p.stderr)
        log = os.path.join(self.proj, "scratchpad", ".team", "hook.log")
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
        cfg = json.loads(read_text(os.path.join(self.proj, "scratchpad", ".team", "config.json")))
        self.assertEqual(cfg["team_id"], "app-5066")
        self.assertEqual(cfg["ticket"], "APP-5066")
        self.assertEqual(cfg["orchestrator"], "app-5066-orch")

    def test_refuses_second_init(self):
        self.run_script("team-init", "APP-1")
        p = self.run_script("team-init", "APP-1")
        self.assertEqual(p.returncode, 1)

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
        tabs = json.loads(read_text(os.path.join(self.proj, "scratchpad", ".team", "tabs.json")))
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
        cfg = json.loads(read_text(os.path.join(self.proj, "scratchpad", ".team", "config.json")))
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
        d = os.path.join(self.proj, "scratchpad", ".team")
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
        state = json.loads(read_text(os.path.join(self.proj, "scratchpad", ".team", "watch-state.json")))
        self.assertEqual(state["agents"]["app-1-scout"], "working")

    def test_second_pass_pushes_watch_line_on_change(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        self.run_script("team-watch", "--once", scenario="watch_change")   # baseline: working
        self.run_script("team-watch", "--once", scenario="watch_change")   # now: blocked
        pushes = [c for c in self.herdr_calls() if c.startswith("agent prompt app-1-orch WATCH")]
        self.assertTrue(any("app-1-scout: working -> blocked" in c for c in pushes), self.herdr_calls())

    def test_ignores_agents_not_in_records(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        # app-2-maker is live but has no record here; must be ignored.
        self.run_script("team-watch", "--once", scenario="watch_two_teams")
        state = json.loads(read_text(os.path.join(self.proj, "scratchpad", ".team", "watch-state.json")))
        self.assertNotIn("app-2-maker", state["agents"])

    def test_blocked_line_includes_dialog(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        self.run_script("team-watch", "--once", scenario="watch_change")   # working
        self.run_script("team-watch", "--once", scenario="watch_change")   # blocked
        pushes = [c for c in self.herdr_calls() if "WATCH" in c]
        self.assertTrue(any("blocked:" in c for c in pushes), pushes)
        self.assertTrue(any("agent read app-1-scout" in c for c in self.herdr_calls()))

    def test_idle_without_report_is_flagged_once(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        self.run_script("team-watch", "--once", scenario="watch_idle")   # baseline, flags once
        self.run_script("team-watch", "--once", scenario="watch_idle")   # same state, must NOT flag again
        flags = [c for c in self.herdr_calls() if "no report" in c]
        self.assertEqual(len(flags), 1)

    def prep_tabs(self, tabs, own_pane="w1:p9"):
        d = os.path.join(self.proj, "scratchpad", ".team")
        os.makedirs(d, exist_ok=True)
        write_text(os.path.join(d, "tabs.json"), json.dumps(tabs))
        write_text(os.path.join(d, "watch-state.json"),
                   json.dumps({"agents": {}, "_flagged": {}, "own_pane": own_pane}))

    def test_closes_empty_pane_in_team_tab(self):
        self.cfg()
        self.prep_tabs(["w1:t2"])
        self.run_script("team-watch", "--once", scenario="panes_empty")
        self.assertTrue(any(c.startswith("pane close w1:p3") for c in self.herdr_calls()), self.herdr_calls())
        # p2 hosts an agent (idle status) -> not closed
        self.assertFalse(any(c.startswith("pane close w1:p2") for c in self.herdr_calls()))

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
        self.assertTrue(any("over budget" in c for c in self.herdr_calls()), self.herdr_calls())

    def test_layout_flag_pushed_once_across_repeated_passes(self):
        self.cfg()
        self.prep_tabs(["w1:t2"])
        self.run_script("team-watch", "--once", scenario="panes_overbudget")
        self.run_script("team-watch", "--once", scenario="panes_overbudget")
        flags = [c for c in self.herdr_calls() if "over budget" in c]
        self.assertEqual(len(flags), 1)

    def test_captures_own_pane_when_missing(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest")
        self.run_script("team-watch", "--once")
        state = json.loads(read_text(os.path.join(self.proj, "scratchpad", ".team", "watch-state.json")))
        self.assertEqual(state.get("own_pane"), "w1:p1")

    def test_never_closes_own_pane(self):
        self.cfg()
        self.prep_tabs(["w1:t2"], own_pane="w1:p3")
        self.run_script("team-watch", "--once", scenario="panes_empty")
        self.assertFalse(any(c.startswith("pane close w1:p3") for c in self.herdr_calls()))

    def test_pending_pane_not_closed(self):
        self.cfg()
        self.prep_tabs(["w1:t2"])   # own_pane defaults to w1:p9
        pend = os.path.join(self.proj, "scratchpad", ".team", "pending")
        os.makedirs(pend, exist_ok=True)
        open(os.path.join(pend, "w1_p3"), "w").close()   # mark w1:p3 pending
        self.run_script("team-watch", "--once", scenario="panes_empty")
        self.assertFalse(any(c.startswith("pane close w1:p3") for c in self.herdr_calls()))

    def test_unknown_own_pane_closes_nothing(self):
        self.cfg()
        d = os.path.join(self.proj, "scratchpad", ".team")
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
        state = os.path.join(self.proj, "scratchpad", ".team", "watch-state.json")
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
        state = json.loads(read_text(os.path.join(self.proj, "scratchpad", ".team", "watch-state.json")))
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

    def test_idle_briefed_tab_flags_release(self):
        self.cfg()
        self.write_record("app-1-scout", "investigator", topic="digest",
                          brief="scratchpad/brief-app-1-scout-digest.md")
        self.prep_tabs(["w1:t2"])   # own_pane w1:p9, not in the idle tab
        self.run_script("team-watch", "--once", scenario="panes_idle_only")
        pushes = [c for c in self.herdr_calls() if "WATCH" in c]
        self.assertTrue(any("consider release" in c for c in pushes), pushes)

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
