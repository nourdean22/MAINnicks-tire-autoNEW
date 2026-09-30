import importlib.util
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
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
                "ANTHROPIC_AUTH_TOKEN": "stale-bearer",
                "ANTHROPIC_BASE_URL": "https://invalid.example",
                "CLAUDE_CODE_OAUTH_TOKEN": "stale-oauth",
                "GEMINI_API_KEY": "secret",
                "CLAUDECODE": "1",
                "CLAUDE_CODE_ENTRYPOINT": "nested-session",
                "SAFE_VALUE": "kept",
            },
            clear=False,
        ):
            env = worker.scrubbed_env()
        self.assertNotIn("OPENAI_API_KEY", env)
        self.assertNotIn("ANTHROPIC_API_KEY", env)
        self.assertNotIn("ANTHROPIC_AUTH_TOKEN", env)
        self.assertNotIn("ANTHROPIC_BASE_URL", env)
        self.assertNotIn("CLAUDE_CODE_OAUTH_TOKEN", env)
        self.assertNotIn("GEMINI_API_KEY", env)
        self.assertNotIn("CLAUDECODE", env)
        self.assertNotIn("CLAUDE_CODE_ENTRYPOINT", env)
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
        payload += "\njetski: trailing headless permission diagnostic"
        fake = subprocess.CompletedProcess(args=["agy"], returncode=0, stdout=payload, stderr="")
        with patch.object(worker.subprocess, "run", return_value=fake), patch.object(
            worker.Path, "exists", return_value=True
        ):
            code, output, _ = worker.execute_antigravity(
                "Return exactly ADAPTER_OK.", Path.cwd(), False
            )
        self.assertNotEqual(code, 0)
        self.assertIn("denied required actions", output)

    def test_antigravity_interactive_chat_forbids_tools_without_unsafe_bypass(self):
        payload = json.dumps({"status": "SUCCESS", "response": "ANTIGRAVITY_UI_OK"})
        fake = subprocess.CompletedProcess(args=["agy"], returncode=0, stdout=payload, stderr="")
        with patch.object(worker.subprocess, "run", return_value=fake) as run, patch.object(
            worker.Path, "exists", return_value=True
        ):
            code, output, _ = worker.execute_antigravity(
                "Return exactly ANTIGRAVITY_UI_OK", Path.cwd(), False, True
            )
        args = run.call_args.args[0]
        effective_prompt = args[args.index("--print") + 1]
        self.assertEqual(code, 0)
        self.assertEqual(output, "ANTIGRAVITY_UI_OK")
        self.assertIn("read-only chat lane", effective_prompt)
        self.assertNotIn("--dangerously-skip-permissions", args)

    def test_auto_interactive_routes_simple_chat_local_first(self):
        self.assertEqual(
            worker.auto_interactive_candidates("Explain this simply."),
            ["local-qwen", "chatgpt-plan", "codex", "claude-code", "antigravity"],
        )

    def test_auto_interactive_routes_code_to_codex_and_architecture_to_claude(self):
        self.assertEqual(
            worker.auto_interactive_candidates("Debug this TypeScript repository."),
            ["codex", "claude-code", "chatgpt-plan", "antigravity", "local-qwen"],
        )
        self.assertEqual(
            worker.auto_interactive_candidates("Design the system architecture and tradeoffs."),
            ["chatgpt-plan", "claude-code", "codex", "antigravity", "local-qwen"],
        )
        self.assertEqual(
            worker.auto_interactive_candidates("x" * 6001),
            ["chatgpt-plan", "claude-code", "codex", "antigravity", "local-qwen"],
        )

    def test_auto_interactive_prefers_routing_prompt_over_enriched_prompt(self):
        lanes = {"local-qwen": {"health": "ready", "quota": "available"}}
        result_payload = {"schemaVersion": 1, "laneId": "local-qwen", "status": "completed", "output": "ok", "outputTruncated": False, "elapsedMs": 1, "exitCode": 0, "model": "qwen35-4b-local", "errorCode": None}
        with patch.object(worker, "probe_lanes", return_value=lanes), patch.object(worker, "execute_job", return_value=("completed", result_payload, None, None)):
            response = worker.execute_interactive_request({"model": "nour-auto", "prompt": "repository code architecture strategy", "routingPrompt": "Hello there.", "workspaceKey": "repo"})
        self.assertEqual(
            response["candidateLaneIds"],
            ["local-qwen", "chatgpt-plan", "codex", "claude-code", "antigravity"],
        )

    def test_interactive_request_reuses_worker_contract_and_forces_read_only(self):
        lanes = {"codex": {"health": "ready", "quota": "available"}}
        result_payload = {
            "schemaVersion": 1,
            "laneId": "codex",
            "status": "completed",
            "output": "ok",
            "outputTruncated": False,
            "elapsedMs": 1,
            "exitCode": 0,
            "model": None,
            "errorCode": None,
        }
        with patch.object(worker, "probe_lanes", return_value=lanes), patch.object(
            worker,
            "execute_job",
            return_value=("completed", result_payload, None, None),
        ) as execute:
            response = worker.execute_interactive_request(
                {
                    "model": "nour-codex-chatgpt",
                    "prompt": "Review the code without changing it.",
                    "workspaceKey": "repo",
                }
            )
        self.assertEqual(response["status"], "completed")
        item = execute.call_args.args[0]
        self.assertEqual(item["requestPayload"]["candidateLaneIds"], ["codex"])
        self.assertFalse(item["requestPayload"]["allowWorkspaceWrite"])
        self.assertTrue(item["requestPayload"]["interactiveChat"])


    def test_interactive_request_rejects_prompt_beyond_worker_contract(self):
        response = worker.execute_interactive_request(
            {"model": "nour-auto", "prompt": "x" * 80_001, "workspaceKey": "repo"}
        )
        self.assertEqual(response["status"], "failed")
        self.assertEqual(response["errorCode"], "PROMPT_INVALID")

    def test_chatgpt_plan_explicit_lane_fails_closed(self):
        with patch.object(
            worker,
            "run_chatgpt_plan_bridge",
            side_effect=RuntimeError("CHATGPT_PLAN_SCOPE_DENIED"),
        ):
            code, output, model = worker.execute_chatgpt_plan("hello")
        self.assertNotEqual(code, 0)
        self.assertIn("CHATGPT_PLAN_SCOPE_DENIED", output)
        self.assertIsNone(model)

    def test_claude_research_adapter_is_web_only_and_proves_retrieval(self):
        payload = "\n".join(
            json.dumps(event)
            for event in (
                {"type": "system", "subtype": "init", "model": "claude-test"},
                {
                    "type": "assistant",
                    "message": {
                        "model": "claude-test",
                        "content": [
                            {
                                "type": "tool_use",
                                "id": "tool-search-1",
                                "name": "WebSearch",
                                "input": {"query": "official source"},
                            }
                        ],
                    },
                },
                {
                    "type": "user",
                    "message": {
                        "content": [
                            {"type": "tool_result", "tool_use_id": "tool-search-1"}
                        ]
                    },
                    "tool_use_result": {
                        "query": "official source",
                        "results": [
                            {
                                "content": [
                                    {
                                        "title": "Source",
                                        "url": "https://example.com/source",
                                    }
                                ]
                            }
                        ],
                        "searchCount": 1,
                    },
                },
                {
                    "type": "assistant",
                    "message": {
                        "model": "claude-test",
                        "content": [
                            {
                                "type": "tool_use",
                                "id": "tool-fetch-1",
                                "name": "WebFetch",
                                "input": {"url": "https://example.com/source"},
                            }
                        ],
                    },
                },
                {
                    "type": "user",
                    "message": {
                        "content": [
                            {"type": "tool_result", "tool_use_id": "tool-fetch-1"}
                        ]
                    },
                    "tool_use_result": {
                        "url": "https://example.com/source",
                        "code": 200,
                        "codeText": "OK",
                        "durationMs": 25,
                        "bytes": 1234,
                        "result": "retrieved source",
                    },
                },
                {
                    "type": "result",
                    "result": "research ok https://example.com/source",
                    "modelUsage": {"claude-test": {"webSearchRequests": 1}},
                    "permission_denials": [],
                    "is_error": False,
                },
            )
        )
        with patch.object(worker, "run_process", return_value=(0, payload)) as run:
            code, output, model, meta = worker.execute_claude_research(
                "research this", Path.cwd(), web_search=True
            )
        self.assertEqual(
            (code, output, model),
            (0, "research ok https://example.com/source", "claude-test"),
        )
        self.assertTrue(meta["retrievalVerified"])
        self.assertEqual(meta["webSearchRequests"], 1)
        self.assertEqual(meta["webFetchRequests"], 1)
        self.assertEqual(meta["permissionDenials"], 0)
        self.assertEqual(meta["reportedSources"], ["https://example.com/source"])
        self.assertEqual(meta["searchResultSources"], ["https://example.com/source"])
        self.assertEqual(meta["fetchedSources"], ["https://example.com/source"])
        self.assertEqual(meta["evidenceReceipts"][0]["tool"], "WebSearch")
        self.assertEqual(meta["evidenceReceipts"][1]["tool"], "WebFetch")
        args = run.call_args.args[1]
        self.assertIn("--restricted", args)
        self.assertEqual(args[args.index("--output-format") + 1], "stream-json")
        self.assertIn("--verbose", args)
        self.assertEqual(args[args.index("--permission-mode") + 1], "auto")
        tools = args[args.index("--tools") + 1]
        self.assertEqual(tools, "WebSearch,WebFetch")
        for forbidden in ("Bash", "PowerShell", "Edit", "Write", "Read", "Glob", "Grep"):
            self.assertNotIn(forbidden, tools)

    def test_claude_research_does_not_treat_url_text_as_retrieval(self):
        payload = "\n".join(
            json.dumps(event)
            for event in (
                {"type": "system", "subtype": "init", "model": "claude-test"},
                {
                    "type": "result",
                    "result": "memory-only answer https://example.com/not-retrieved",
                    "modelUsage": {"claude-test": {"webSearchRequests": 0}},
                    "permission_denials": [{"tool": "WebSearch"}],
                    "is_error": False,
                },
            )
        )
        with patch.object(worker, "run_process", return_value=(0, payload)):
            code, output, model, meta = worker.execute_claude_research(
                "research this", Path.cwd(), web_search=True
            )
        self.assertEqual(code, 0)
        self.assertEqual(model, "claude-test")
        self.assertFalse(meta["retrievalVerified"])
        self.assertEqual(meta["reportedSources"], [])
        self.assertEqual(meta["searchResultSources"], [])
        self.assertEqual(meta["fetchedSources"], [])
        self.assertEqual(meta["evidenceReceipts"], [])
        self.assertEqual(meta["permissionDenials"], 1)

    def test_research_provider_rejects_memory_answer_with_url_but_no_retrieval(self):
        lanes = {
            "chatgpt-plan": {"health": "unavailable", "quota": "unknown"},
            "claude-code": {"health": "ready", "quota": "unknown"},
        }
        with patch.object(
            worker,
            "execute_claude_research",
            return_value=(
                0,
                "memory answer https://example.com/not-retrieved",
                "claude-test",
                {
                    "retrievalVerified": False,
                    "webSearchRequests": 0,
                    "webFetchRequests": 0,
                    "permissionDenials": 1,
                    "reportedSources": [],
                },
            ),
        ):
            result = worker.research_provider_call(
                "research this",
                Path.cwd(),
                lanes,
                web_search=True,
                timeout_seconds=60,
            )
        self.assertFalse(result["ok"])
        self.assertEqual(result["sources"], [])
        self.assertIn("claude-code:no_verified_retrieval", result["failures"])

    def test_explicit_research_persists_receipt_and_marks_partial_degraded(self):
        def fake_research_call(prompt, workspace, lanes, *, web_search, timeout_seconds):
            if "research planner" in prompt:
                return {"ok": True, "provider": "claude-code", "model": "planner", "output": '{"threads":["q1","q2"]}', "sources": [], "failures": []}
            if "SEARCH THREAD:\nq1" in prompt:
                return {"ok": True, "provider": "claude-code", "model": "web", "output": "FACT one https://example.com/one", "sources": ["https://example.com/one"], "failures": []}
            if "SEARCH THREAD:\nq2" in prompt:
                return {"ok": False, "provider": "claude-code", "model": "web", "output": "", "sources": [], "failures": ["claude-code:failed"]}
            if "gap checker" in prompt:
                return {"ok": True, "provider": "claude-code", "model": "critic", "output": '{"gap":"","risks":["coverage partial"]}', "sources": [], "failures": []}
            if "research synthesizer" in prompt:
                return {"ok": True, "provider": "claude-code", "model": "synth", "output": "Synthesis https://example.com/one", "sources": ["https://example.com/one"], "failures": []}
            raise AssertionError(prompt[:100])

        lanes = {
            "chatgpt-plan": {"health": "unavailable", "quota": "unknown"},
            "claude-code": {"health": "ready", "quota": "unknown"},
        }
        with TemporaryDirectory() as tmp, patch.object(worker, "RESEARCH_DIR", Path(tmp)), patch.object(
            worker, "resolve_workspace", return_value=Path.cwd()
        ), patch.object(worker, "probe_lanes", return_value=lanes), patch.object(
            worker, "research_provider_call", side_effect=fake_research_call
        ):
            response = worker.execute_interactive_request(
                {
                    "model": "nour-research",
                    "prompt": "system context plus question",
                    "routingPrompt": "Research the thing.",
                    "workspaceKey": "repo",
                }
            )
            receipt_json = Path(response["result"]["receiptJson"])
            receipt_md = Path(response["result"]["receiptMarkdown"])
            self.assertTrue(receipt_json.exists())
            self.assertTrue(receipt_md.exists())
            receipt = json.loads(receipt_json.read_text(encoding="utf-8"))
        self.assertEqual(response["status"], "completed")
        self.assertEqual(response["result"]["researchStatus"], "degraded")
        self.assertEqual(response["result"]["sourceCount"], 1)
        self.assertEqual(receipt["status"], "degraded")

    def test_research_complete_requires_at_least_one_fetched_page(self):
        def fake_research_call(prompt, workspace, lanes, *, web_search, timeout_seconds):
            if "research planner" in prompt:
                return {"ok": True, "provider": "claude-code", "model": "planner", "output": '{"threads":["q1"]}', "sources": [], "failures": []}
            if "SEARCH THREAD:\nq1" in prompt:
                return {
                    "ok": True,
                    "provider": "claude-code",
                    "model": "web",
                    "output": "FACT one https://example.com/one",
                    "sources": ["https://example.com/one"],
                    "retrieval": {
                        "retrievalVerified": True,
                        "searchResultSources": ["https://example.com/one"],
                        "fetchedSources": [],
                    },
                    "failures": [],
                }
            if "gap checker" in prompt:
                return {"ok": True, "provider": "claude-code", "model": "critic", "output": '{"gap":"","risks":[]}', "sources": [], "failures": []}
            if "research synthesizer" in prompt:
                return {"ok": True, "provider": "claude-code", "model": "synth", "output": "Synthesis https://example.com/one", "sources": [], "failures": []}
            raise AssertionError(prompt[:100])

        lanes = {
            "chatgpt-plan": {"health": "unavailable", "quota": "unknown"},
            "claude-code": {"health": "ready", "quota": "unknown"},
        }
        with TemporaryDirectory() as tmp, patch.object(worker, "RESEARCH_DIR", Path(tmp)), patch.object(
            worker, "research_provider_call", side_effect=fake_research_call
        ):
            response = worker.run_research_orchestrator("Research the thing.", Path.cwd(), lanes)
            receipt = json.loads(Path(response["result"]["receiptJson"]).read_text(encoding="utf-8"))
        self.assertEqual(response["result"]["researchStatus"], "degraded")
        self.assertEqual(response["result"]["sourceCount"], 1)
        self.assertEqual(receipt["fetchedSources"], [])

    def test_local_probe_reports_lane_truth_and_read_only_policy(self):
        lanes = {
            "local-qwen": {"health": "ready", "quota": "available"},
            "codex": {"health": "ready", "quota": "unknown"},
        }
        with patch.object(worker, "probe_lanes", return_value=lanes), patch.object(
            worker, "ALLOW_WRITES", False
        ):
            payload = worker.local_probe_payload()
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["writePolicy"], "disabled")
        self.assertEqual(payload["lanes"], lanes)


if __name__ == "__main__":
    unittest.main()
