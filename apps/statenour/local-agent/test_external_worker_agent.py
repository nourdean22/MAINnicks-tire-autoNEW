import importlib.util
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

MODULE_PATH = Path(__file__).with_name("external_worker_agent.py")
SPEC = importlib.util.spec_from_file_location("external_worker_agent", MODULE_PATH)
worker = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = worker
SPEC.loader.exec_module(worker)


class ExternalWorkerAgentTests(unittest.TestCase):
    def test_scrubs_metered_api_credentials(self):
        with patch.dict(
            os.environ,
            {
                "OPENAI_API_KEY": "secret",
                "ANTHROPIC_API_KEY": "secret",
                "GEMINI_API_KEY": "secret",
                "SAFE_VALUE": "kept",
            },
            clear=False,
        ):
            env = worker.scrubbed_env()
        self.assertNotIn("OPENAI_API_KEY", env)
        self.assertNotIn("ANTHROPIC_API_KEY", env)
        self.assertNotIn("GEMINI_API_KEY", env)
        self.assertEqual(env.get("SAFE_VALUE"), "kept")

    def test_post_unwraps_standard_api_handler_envelope(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "ok": True,
            "data": {"items": [{"id": "job-1"}]},
            "meta": {"request_id": "req-1"},
        }
        with patch.object(worker, "RUNNER_SECRET", "test-secret"), patch.object(
            worker.requests, "post", return_value=response
        ):
            result = worker.post("/api/internal/runner/claim", {"nodeKey": "node-1"})
        self.assertEqual(result, {"items": [{"id": "job-1"}]})

    def test_lane_choice_skips_exhausted_and_unavailable(self):
        lanes = {
            "codex": {"health": "ready", "quota": "exhausted"},
            "claude-code": {"health": "unavailable", "quota": "unknown"},
            "antigravity": {"health": "ready", "quota": "unknown"},
        }
        self.assertEqual(
            worker.choose_lane(["codex", "claude-code", "antigravity"], lanes),
            "antigravity",
        )

    def test_result_output_is_bounded(self):
        text, truncated = worker.truncate_output("x" * (worker.MAX_OUTPUT_CHARS + 1))
        self.assertTrue(truncated)
        self.assertEqual(len(text), worker.MAX_OUTPUT_CHARS)

    def test_codex_write_uses_approve_for_me_without_explicit_sandbox(self):
        with patch.object(worker, "run_process", return_value=(0, "ok")) as run:
            code, output, _ = worker.execute_codex("Make one edit.", Path.cwd(), True)
        self.assertEqual(code, 0)
        self.assertEqual(output, "ok")
        args = run.call_args.args[1]
        self.assertIn("--approve-for-me", args)
        self.assertNotIn("-s", args)
        self.assertNotIn("workspace-write", args)

    def test_claude_worker_isolated_from_interactive_context(self):
        payload = json.dumps({"result": "ok", "modelUsage": {"claude-test": {}}})
        payload += "\nworkspace trust diagnostic"
        with patch.object(worker, "run_process", return_value=(0, payload)) as run:
            code, output, model = worker.execute_claude("Make one edit.", Path.cwd(), True)
        self.assertEqual((code, output, model), (0, "ok", "claude-test"))
        args = run.call_args.args[1]
        self.assertIn("--safe-mode", args)
        self.assertIn("--no-session-persistence", args)
        self.assertIn("--no-chrome", args)
        self.assertEqual(args[args.index("--permission-prompts") + 1], "none")
        self.assertEqual(args[args.index("--permission-mode") + 1], "acceptEdits")

    def test_workspace_key_is_allowlisted(self):
        with patch.object(worker, "workspace_map", return_value={"repo": str(Path.cwd())}):
            self.assertEqual(worker.resolve_workspace("repo"), Path.cwd().resolve())
            with self.assertRaisesRegex(ValueError, "workspace_key_not_allowed"):
                worker.resolve_workspace("anything-else")

    def test_write_job_refuses_when_machine_policy_off(self):
        item = {
            "id": "job",
            "requestPayload": {
                "schemaVersion": 1,
                "candidateLaneIds": ["antigravity"],
                "workspaceKey": "repo",
                "allowWorkspaceWrite": True,
                "prompt": "Inspect the repository and explain the architecture.",
            },
        }
        lanes = {
            "antigravity": {"health": "ready", "quota": "unknown"},
        }
        with patch.object(worker, "ALLOW_WRITES", False), patch.object(
            worker, "resolve_workspace", return_value=Path.cwd()
        ):
            status, result, code, _ = worker.execute_job(item, lanes)
        self.assertEqual(status, "failed")
        self.assertEqual(code, "WRITE_POLICY_DISABLED")
        self.assertEqual(result["status"], "refused")

    def test_read_job_uses_first_ready_candidate(self):
        item = {
            "id": "job",
            "requestPayload": {
                "schemaVersion": 1,
                "candidateLaneIds": ["codex", "local-qwen"],
                "workspaceKey": "repo",
                "allowWorkspaceWrite": False,
                "prompt": "Summarize the architecture without changing anything.",
            },
        }
        lanes = {
            "codex": {"health": "unavailable", "quota": "unknown"},
            "local-qwen": {"health": "ready", "quota": "available"},
        }
        with patch.object(worker, "resolve_workspace", return_value=Path.cwd()), patch.object(
            worker, "execute_local_qwen", return_value=(0, "ok", "qwen35-4b-local")
        ):
            status, result, code, _ = worker.execute_job(item, lanes)
        self.assertEqual(status, "completed")
        self.assertIsNone(code)
        self.assertEqual(result["laneId"], "local-qwen")

    def test_codex_workspace_out_of_credits_is_quota_exhaustion(self):
        self.assertEqual(
            worker.quota_from_text("ERROR: Your workspace is out of credits. Add credits to continue."),
            "exhausted",
        )

    def test_read_only_job_falls_through_quota_exhausted_lane(self):
        worker.runtime_lane_overrides.clear()
        item = {
            "id": "job",
            "requestPayload": {
                "schemaVersion": 1,
                "candidateLaneIds": ["codex", "claude-code"],
                "workspaceKey": "repo",
                "allowWorkspaceWrite": False,
                "prompt": "Review this repository without changing any files.",
            },
        }
        lanes = {
            "codex": {"health": "ready", "quota": "unknown"},
            "claude-code": {"health": "ready", "quota": "unknown"},
        }
        with patch.object(worker, "resolve_workspace", return_value=Path.cwd()), patch.object(
            worker,
            "execute_codex",
            return_value=(1, "ERROR: Your workspace is out of credits.", None),
        ), patch.object(
            worker,
            "execute_claude",
            return_value=(0, "fallback ok", None),
        ) as claude:
            status, result, code, _ = worker.execute_job(item, lanes)
        self.assertEqual(status, "completed")
        self.assertIsNone(code)
        self.assertEqual(result["laneId"], "claude-code")
        self.assertEqual(worker.runtime_lane_overrides["codex"]["quota"], "exhausted")
        claude.assert_called_once()

    def test_write_job_never_falls_through_after_execution_starts(self):
        worker.runtime_lane_overrides.clear()
        item = {
            "id": "job",
            "requestPayload": {
                "schemaVersion": 1,
                "candidateLaneIds": ["codex", "claude-code"],
                "workspaceKey": "repo",
                "allowWorkspaceWrite": True,
                "prompt": "Make one authorized edit.",
            },
        }
        lanes = {
            "codex": {"health": "ready", "quota": "unknown"},
            "claude-code": {"health": "ready", "quota": "unknown"},
        }
        with patch.object(worker, "ALLOW_WRITES", True), patch.object(
            worker, "resolve_workspace", return_value=Path.cwd()
        ), patch.object(
            worker,
            "execute_codex",
            return_value=(1, "ERROR: Your workspace is out of credits.", None),
        ), patch.object(worker, "execute_claude") as claude:
            status, result, code, _ = worker.execute_job(item, lanes)
        self.assertEqual(status, "failed")
        self.assertEqual(code, "QUOTA_EXHAUSTED")
        self.assertEqual(result["laneId"], "codex")
        claude.assert_not_called()

    def test_antigravity_zero_exit_with_denied_action_is_not_success(self):
        payload = json.dumps(
            {
                "status": "SUCCESS",
                "response": "",
                "denied_actions": [{"action": "command", "display_name": "RunCommand"}],
            }
        )
        fake = subprocess.CompletedProcess(args=["agy"], returncode=0, stdout=payload, stderr="")
        with patch.object(worker.subprocess, "run", return_value=fake), patch.object(
            worker.Path, "exists", return_value=True
        ):
            code, output, _ = worker.execute_antigravity(
                "Return exactly ADAPTER_OK.", Path.cwd(), False
            )
        self.assertNotEqual(code, 0)
        self.assertIn("denied required actions", output)


if __name__ == "__main__":
    unittest.main()
