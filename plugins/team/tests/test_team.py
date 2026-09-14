"""Behaviour tests for the team plugin scripts.

Each test runs a bin/ script as a subprocess in a throwaway project directory.
A shim directory on PATH exposes tests/fake-herdr as `herdr` and tests/fake-git
as `git`; both record every invocation and answer with canned JSON, so the
scripts run against a real (fake) CLI, never a mock.
"""
import json
import os
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
        self.assertFalse(any(c.startswith("agent prompt ") for c in self.herdr_calls()))

    def test_forwards_only_report_prefixed(self):
        self.write_record("scout", "investigator", topic="digest", session="abcdef12")
        tr = self.transcript("REPORT scout digest: done, 2 files")
        p = self.run_hook({"session_id": "abcdef1200000", "transcript_path": tr, "cwd": self.proj})
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(any(c.startswith("agent prompt orchestrator REPORT scout digest: done")
                            for c in self.herdr_calls()))

    def test_unreadable_transcript_logs_and_exits_zero(self):
        self.write_record("scout", "investigator", topic="digest", session="abcdef12")
        p = self.run_hook({"session_id": "abcdef1211111", "transcript_path": "/does/not/exist",
                           "cwd": self.proj})
        self.assertEqual(p.returncode, 0, p.stderr)
        log = os.path.join(self.proj, "scratchpad", ".team", "hook.log")
        self.assertTrue(os.path.exists(log))
        self.assertIn("transcript unreadable", read_text(log))


if __name__ == "__main__":
    unittest.main()
