import importlib.util
import unittest
from pathlib import Path
from unittest import mock

MODULE_PATH = Path(__file__).with_name("nour_cockpit_bridge.py")
spec = importlib.util.spec_from_file_location("nour_cockpit_bridge", MODULE_PATH)
cockpit = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(cockpit)


class CockpitBridgeTests(unittest.TestCase):
    def test_safe_shell_allowlist_is_narrow(self):
        self.assertTrue(cockpit.safe_shell_command("git status --short"))
        self.assertTrue(cockpit.safe_shell_command("git branch --show-current"))
        self.assertTrue(cockpit.safe_shell_command("git diff --check"))
        self.assertTrue(cockpit.safe_shell_command("node --check foo.js"))
        self.assertTrue(cockpit.safe_shell_command("pnpm --filter statenour typecheck"))
        self.assertFalse(cockpit.safe_shell_command("git push origin main"))
        self.assertFalse(cockpit.safe_shell_command("git commit -am ship"))
        self.assertFalse(cockpit.safe_shell_command("railway up"))
        self.assertFalse(cockpit.safe_shell_command("git status && git push"))
        self.assertFalse(cockpit.safe_shell_command("git status | Out-File x"))

    def test_pending_permissions_accepts_bare_array_shape(self):
        run = {"session_id": "ses_target", "worktree": r"C:\tmp\worktree"}
        payload = [
            {
                "id": "per_safe",
                "sessionID": "ses_target",
                "permission": "bash",
                "metadata": {"command": "git status --short"},
            },
            {
                "id": "per_other",
                "sessionID": "ses_other",
                "permission": "bash",
                "metadata": {"command": "git status --short"},
            },
        ]
        with mock.patch.object(cockpit, "http_json", return_value=payload):
            pending = cockpit.pending_permissions(run)
        self.assertEqual([item["id"] for item in pending], ["per_safe"])

    def test_auto_approve_only_safe_commands(self):
        run = {"run_id": "cr_test", "session_id": "ses_test", "worktree": r"C:\tmp\worktree"}
        requests = [
            {
                "id": "per_safe",
                "sessionID": "ses_test",
                "permission": "bash",
                "metadata": {"command": "git status --short"},
            },
            {
                "id": "per_risky",
                "sessionID": "ses_test",
                "permission": "bash",
                "metadata": {"command": "git push origin main"},
            },
        ]
        responses = []
        with (
            mock.patch.object(cockpit, "pending_permissions", return_value=requests),
            mock.patch.object(
                cockpit,
                "respond_permission",
                side_effect=lambda _run, permission_id, response: responses.append((permission_id, response)),
            ),
            mock.patch.object(cockpit, "log"),
        ):
            approved, pending = cockpit.auto_approve_safe(run)
        self.assertEqual(responses, [("per_safe", "once")])
        self.assertEqual([item["id"] for item in approved], ["per_safe"])
        self.assertEqual([item["id"] for item in pending], ["per_risky"])

    def test_permission_rules_deny_external_and_gate_shell(self):
        rules = cockpit.permission_rules()
        self.assertIn({"permission": "bash", "pattern": "*", "action": "ask"}, rules)
        self.assertIn({"permission": "external_directory", "pattern": "*", "action": "deny"}, rules)
        self.assertIn({"permission": "read", "pattern": "*.env", "action": "deny"}, rules)

    def test_openapi_is_simple_and_mission_separate(self):
        blob = cockpit.json.dumps(cockpit.OPENAPI)
        for operation in (
            "start_cockpit_run",
            "check_cockpit_run",
            "continue_cockpit_run",
            "approve_cockpit_run",
            "cancel_cockpit_run",
            "recent_cockpit_runs",
        ):
            self.assertIn(operation, blob)
        self.assertIn("never create StateNour Mission/Task items", cockpit.OPENAPI["info"]["description"])

    def test_public_run_never_implies_mission_link_without_id(self):
        run = {
            "run_id": "cr_test",
            "objective": "test",
            "status": "ready",
            "mission_id": None,
        }
        self.assertFalse(cockpit.public_run(run)["mission_linked"])


if __name__ == "__main__":
    unittest.main()
