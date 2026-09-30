import unittest
from pathlib import Path

SOURCE = Path(__file__).with_name("install-external-worker.ps1").read_text(encoding="utf-8")


class ExternalWorkerInstallerTests(unittest.TestCase):
    def test_secret_is_dpapi_protected_and_not_put_in_task_arguments(self):
        self.assertIn("ConvertFrom-SecureString", SOURCE)
        self.assertIn("runner-secret.dpapi", SOURCE)
        task_section = SOURCE[SOURCE.index("$taskArgs") :]
        self.assertNotIn("RUNNER_SHARED_SECRET=", task_section)
        self.assertNotIn("-RunnerSecret", task_section)

    def test_writes_are_default_off_and_double_gate_is_preserved(self):
        self.assertIn("[switch]$EnableWrites", SOURCE)
        self.assertIn('$writes = if ($EnableWrites) { "1" } else { "0" }', SOURCE)
        self.assertIn("NOUR_EXTERNAL_WORKER_ALLOW_WRITES", SOURCE)

    def test_task_is_outbound_worker_for_current_interactive_user(self):
        self.assertIn("StateNour-ExternalWorker-NattyNour", SOURCE)
        self.assertIn("New-ScheduledTaskTrigger -AtLogOn", SOURCE)
        self.assertIn("-LogonType Interactive", SOURCE)
        self.assertIn("-RunLevel Limited", SOURCE)
        self.assertIn("-RestartCount 10", SOURCE)

    def test_runtime_is_copied_out_of_repo_worktree(self):
        self.assertIn('Copy-Item -LiteralPath $SourceAgent -Destination $RuntimeAgent -Force', SOURCE)
        self.assertIn("$env:LOCALAPPDATA\\StateNour\\external-worker", SOURCE)

    def test_launcher_scrubs_metered_api_key_envs(self):
        for key in (
            "OPENAI_API_KEY",
            "CODEX_API_KEY",
            "CODEX_ACCESS_TOKEN",
            "ANTHROPIC_API_KEY",
            "GEMINI_API_KEY",
            "GOOGLE_API_KEY",
        ):
            self.assertIn(f"$env:{key} = $null", SOURCE)


if __name__ == "__main__":
    unittest.main()
