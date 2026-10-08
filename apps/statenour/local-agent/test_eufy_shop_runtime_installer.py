#!/usr/bin/env python3
from pathlib import Path
import unittest


SCRIPT = Path(__file__).with_name("install-eufy-shop-runtime.ps1")
SOURCE = SCRIPT.read_text(encoding="utf-8")


class EufyShopRuntimeInstallerTests(unittest.TestCase):
    def test_python_resolution_requires_a_real_interpreter(self):
        self.assertIn("sys.executable", SOURCE)
        self.assertIn("Test-Path $resolved.Trim()", SOURCE)
        self.assertIn("Windows Store python.exe alias does not count", SOURCE)
        self.assertIn("Python.Python.3.12", SOURCE)

    def test_pins_reviewed_bridge_and_go2rtc_asset(self):
        self.assertIn(
            'f00dd987a7b86d1b5fd91731fcdb179513c88ac4',
            SOURCE,
        )
        self.assertIn(
            'dd4167d75cb04abe618855b7c71f8658bd009f60c1a71835d134d2c11c939907',
            SOURCE,
        )
        self.assertIn("eufy_bridge_overlay.py", SOURCE)
        self.assertIn("--check", SOURCE)

    def test_bridge_and_media_listeners_are_local_only(self):
        self.assertIn('$env:BRIDGE_HOST = "127.0.0.1"', SOURCE)
        self.assertIn('$env:BRIDGE_SELF_HOST = "127.0.0.1"', SOURCE)
        self.assertIn('ws://127.0.0.1:3000/ws', SOURCE)
        self.assertIn('[string]$Go2RtcApiListen = "127.0.0.1:1984"', SOURCE)
        self.assertIn('[string]$Go2RtcRtspListen = "127.0.0.1:8654"', SOURCE)
        self.assertIn('[string]$Go2RtcWebrtcListen = "127.0.0.1:8655"', SOURCE)
        self.assertIn('$env:GO2RTC_API_LISTEN = "__GO2RTC_API_LISTEN__"', SOURCE)
        self.assertIn('$env:GO2RTC_RTSP_LISTEN = "__GO2RTC_RTSP_LISTEN__"', SOURCE)
        self.assertIn('$env:GO2RTC_WEBRTC_LISTEN = "__GO2RTC_WEBRTC_LISTEN__"', SOURCE)
        self.assertNotIn('BRIDGE_HOST = "0.0.0.0"', SOURCE)

    def test_bridge_launcher_names_server_mjs_by_its_absolute_path(self):
        # The NicksMax supervisor knows the bridge's node by this path under StateNour\Eufy\; a bare
        # `server.mjs` is any node project's entry point, so a launcher that passed one could not be
        # told from a neighbour (2026-10-08).
        self.assertIn('& "__NODE__" "__BRIDGE_ROOT__\\server.mjs"', SOURCE)
        self.assertNotIn('& "__NODE__" server.mjs', SOURCE)

    def test_secrets_are_dpapi_and_never_written_to_runtime_json(self):
        self.assertIn("ConvertFrom-SecureString", SOURCE)
        self.assertIn("ConvertTo-SecureString", SOURCE)
        runtime_block = SOURCE.split("$runtime = [ordered]@{", 1)[1].split("}", 1)[0]
        for forbidden in (
            "EUFY_PASSWORD",
            "STATENOUR_SYNC_KEY",
            "NICKS_CAMERA_INGEST_KEY",
        ):
            self.assertNotIn(forbidden, runtime_block)

    def test_first_run_auth_handles_2fa_and_captcha_without_cli_secrets(self):
        self.assertIn('cmd = "auth.status"', SOURCE)
        self.assertIn('cmd = "auth.submit"; code = $code.Trim()', SOURCE)
        self.assertIn('cmd = "auth.submit"; captcha = $answer.Trim()', SOURCE)
        self.assertIn("Payload (including 2FA/captcha answers) travels over stdin", SOURCE)
        self.assertIn("Remove-Item -LiteralPath $captchaPath", SOURCE)
        self.assertNotIn('ArgumentList $code', SOURCE)
        self.assertNotIn('ArgumentList $answer', SOURCE)

    def test_office_heartbeat_is_production_by_default(self):
        self.assertIn('heartbeatMode = "PRODUCTION"', SOURCE)
        self.assertIn("NICKS_OFFICE_CAMERA_MODE", SOURCE)
        self.assertIn('[string]$OfficeSerial = "T8410P5225154105"', SOURCE)
        self.assertNotIn('[string]$OfficeSerial = "T8410P522517180B"', SOURCE)
        self.assertIn("OFFICE_CONVERSATION_STATUS_PATH", SOURCE)
        self.assertIn("OfficeIntelligence\\office-conversation-status.json", SOURCE)
        self.assertIn('OFFICE_CONVERSATION_STATUS_MAX_AGE_SECONDS = "120"', SOURCE)

    def test_control_fails_closed_until_explicitly_enabled(self):
        self.assertIn("controlEnabled = $false", SOURCE)
        self.assertIn("if ($EnableControl)", SOURCE)
        identity = SOURCE.index("Verifying office camera identity and PTZ capability")
        enable = SOURCE.index("PTZ command queue enabled after auth + identity + capability proof")
        self.assertLess(identity, enable)

    def test_office_intelligence_owns_wake_capture_and_summary(self):
        self.assertIn("StateNour-Eufy-OfficeWake", SOURCE)
        self.assertIn("Disable-ScheduledTask -TaskName \"StateNour-Eufy-OfficeWake\"", SOURCE)
        self.assertIn('OfficeWakeMode = "delegated_to_StateNour-OfficeIntelligence-NicksMax"', SOURCE)
        self.assertNotIn("-m vision.officewake", SOURCE)
        self.assertNotIn("$OfficeWakeRequirements", SOURCE)
        self.assertNotIn("OFFICE_INTERACTION_CAPTURE_ENABLED", SOURCE)
        self.assertNotIn("--capture", SOURCE)

    def test_commissioning_requires_control_home_preset_and_physical_receipts(self):
        self.assertIn('if (-not $EnableControl)', SOURCE)
        self.assertIn('if (-not $HomePresetId.HasValue)', SOURCE)
        self.assertIn("b.start_event_thread()", SOURCE)
        self.assertIn('b.execute_command({"command": "ptz_right"', SOURCE)
        self.assertIn('b.execute_command({"command": "ptz_preset"', SOURCE)
        self.assertIn("PTZ motor receipts verified", SOURCE)
        self.assertIn("Absolute home still requires visual verification", SOURCE)

    def test_runtime_tasks_are_restart_capable_and_user_scoped(self):
        self.assertIn("-RestartCount 999", SOURCE)
        self.assertIn("-RestartInterval (New-TimeSpan -Minutes 1)", SOURCE)
        self.assertIn("-LogonType Interactive", SOURCE)
        self.assertIn("-RunLevel Highest", SOURCE)
        for name in ("StateNour-Eufy-Bridge", "StateNour-Eufy-Agent"):
            self.assertIn('Install-Task "' + name + '"', SOURCE)
        self.assertNotIn('Install-Task "StateNour-Eufy-OfficeWake"', SOURCE)

    def test_media_health_uses_real_bridge_bytes(self):
        self.assertIn("probe_office_media_health", SOURCE)
        self.assertIn("force=True", SOURCE)


    def test_click_launcher_only_elevates_the_reviewed_installer(self):
        launcher = SCRIPT.with_suffix(".cmd").read_text(encoding="utf-8")
        self.assertIn("install-eufy-shop-runtime.ps1", launcher)
        self.assertIn("Start-Process powershell.exe -Verb RunAs", launcher)
        self.assertIn("-InstallPrerequisites", launcher)
        for forbidden in ("EUFY_PASSWORD", "STATENOUR_SYNC_KEY", "NICKS_CAMERA_INGEST_KEY"):
            self.assertNotIn(forbidden, launcher)


if __name__ == "__main__":
    unittest.main()
