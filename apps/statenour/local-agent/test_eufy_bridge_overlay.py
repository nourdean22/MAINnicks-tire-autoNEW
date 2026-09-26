import json
import tempfile
import unittest
from pathlib import Path

from eufy_bridge_overlay import (
    GO2RTC_PATH,
    ROUTER_NEW,
    ROUTER_OLD,
    SUPPORTED_NAME,
    SUPPORTED_VERSION,
    WS_PATH,
    OverlayError,
    apply,
    verify,
)


class EufyBridgeOverlayTests(unittest.TestCase):
    def fixture(self, *, version=SUPPORTED_VERSION, drift=False):
        temp = tempfile.TemporaryDirectory()
        root = Path(temp.name)
        (root / WS_PATH).parent.mkdir(parents=True)
        (root / "package.json").write_text(
            json.dumps({"name": SUPPORTED_NAME, "version": version}),
            encoding="utf-8",
        )
        router = "const surfaces = getCapabilitySurfaces(dev);" if drift else ROUTER_OLD
        (root / WS_PATH).write_text(router + "\n", encoding="utf-8")
        (root / GO2RTC_PATH).write_text(
            "\n".join(
                (
                    '"api:"',
                    "'  listen: \":1984\"'",
                    '"rtsp:"',
                    "'  listen: \":8554\"'",
                    '"webrtc:"',
                    "'  listen: \":8555\"'",
                )
            )
            + "\n",
            encoding="utf-8",
        )
        self.addCleanup(temp.cleanup)
        return root

    def test_apply_patches_ptz_preset_and_binds_media_loopback(self):
        root = self.fixture()
        report = apply(root)
        self.assertEqual(
            set(report.changed_files),
            {"src/ws-server.mjs", "go2rtc-config.mjs"},
        )
        ws = (root / WS_PATH).read_text(encoding="utf-8")
        self.assertIn(ROUTER_NEW, ws)
        self.assertIn('action === "preset.goto"', ws)
        self.assertIn('method = "goto"', ws)

        go = (root / GO2RTC_PATH).read_text(encoding="utf-8")
        for port in (1984, 8554, 8555):
            self.assertIn(f"127.0.0.1:{port}", go)
            self.assertNotIn(f'":{port}"', go)

        self.assertEqual(
            verify(root).ptz_router,
            "verified_with_preset_goto",
        )

    def test_apply_is_idempotent(self):
        root = self.fixture()
        apply(root)
        report = apply(root)
        self.assertEqual(report.changed_files, ())
        self.assertEqual(report.ptz_router, "already_patched")
        self.assertEqual(report.go2rtc_listeners, "already_patched")

    def test_unknown_bridge_version_fails_closed(self):
        root = self.fixture(version="0.3.1")
        with self.assertRaisesRegex(OverlayError, "unsupported bridge"):
            apply(root)

    def test_unexpected_ptz_source_drift_fails_closed(self):
        root = self.fixture(drift=True)
        with self.assertRaisesRegex(OverlayError, "source drift"):
            apply(root)

    def test_check_rejects_unpatched_fixture(self):
        root = self.fixture()
        with self.assertRaisesRegex(OverlayError, "not verified"):
            verify(root)


if __name__ == "__main__":
    unittest.main()
