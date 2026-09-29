import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import eufy_bridge_overlay as overlay
from eufy_bridge_overlay import (
    GO2RTC_ENV_NEW,
    GO2RTC_ENV_OLD,
    GO2RTC_PATH,
    HTTP_PATH,
    HTTP_ROUTE_NEW,
    HTTP_ROUTE_OLD,
    REVIEWED_DIGESTS,
    ROUTER_NEW,
    ROUTER_OLD,
    SUPPORTED_NAME,
    SUPPORTED_VERSION,
    WS_PATH,
    OverlayError,
    _canonical_digest,
    apply,
    verify,
)


class EufyBridgeOverlayTests(unittest.TestCase):
    def _restore_digests(self, original):
        REVIEWED_DIGESTS.clear()
        REVIEWED_DIGESTS.update(original)

    def fixture(self, *, version=SUPPORTED_VERSION, drift=False):
        temp = tempfile.TemporaryDirectory()
        root = Path(temp.name)
        (root / WS_PATH).parent.mkdir(parents=True)
        (root / "package.json").write_text(
            json.dumps({"name": SUPPORTED_NAME, "version": version}),
            encoding="utf-8",
        )

        router = "const surfaces = getCapabilitySurfaces(dev);" if drift else ROUTER_OLD
        ws_original = router + "\n"
        http_original = HTTP_ROUTE_OLD + "\n"
        go_original = (
            GO2RTC_ENV_OLD
            + "\n"
            + "\n".join(
                (
                    '"api:"',
                    "'  listen: \":1984\"'",
                    '"rtsp:"',
                    "'  listen: \":8554\"'",
                    '"webrtc:"',
                    "'  listen: \":8555\"'",
                )
            )
            + "\n"
        )
        (root / WS_PATH).write_text(ws_original, encoding="utf-8")
        (root / HTTP_PATH).write_text(http_original, encoding="utf-8")
        (root / GO2RTC_PATH).write_text(go_original, encoding="utf-8")

        # Unit fixtures are deliberately tiny. Pin their COMPLETE original/patched
        # logical contents exactly the same way production pins the reviewed bridge.
        old_map = dict(REVIEWED_DIGESTS)
        ws_patched = (
            ws_original.replace(ROUTER_OLD, ROUTER_NEW, 1)
            if not drift
            else ws_original
        )
        http_patched = http_original.replace(HTTP_ROUTE_OLD, HTTP_ROUTE_NEW, 1)
        go_patched = go_original.replace(GO2RTC_ENV_OLD, GO2RTC_ENV_NEW, 1)
        for variants, new in overlay.LISTENER_REPLACEMENTS:
            candidates = (variants,) if isinstance(variants, str) else variants
            match = next(v for v in candidates if v in go_patched)
            go_patched = go_patched.replace(match, new, 1)
        REVIEWED_DIGESTS[WS_PATH] = frozenset(
            {_canonical_digest(ws_original), _canonical_digest(ws_patched)}
        )
        REVIEWED_DIGESTS[HTTP_PATH] = frozenset(
            {_canonical_digest(http_original), _canonical_digest(http_patched)}
        )
        REVIEWED_DIGESTS[GO2RTC_PATH] = frozenset(
            {_canonical_digest(go_original), _canonical_digest(go_patched)}
        )

        self.addCleanup(self._restore_digests, old_map)
        self.addCleanup(temp.cleanup)
        return root

    def test_apply_patches_ptz_preset_and_binds_media_loopback(self):
        root = self.fixture()
        report = apply(root)
        self.assertEqual(
            set(report.changed_files),
            {"src/ws-server.mjs", "src/http-routes.mjs", "go2rtc-config.mjs"},
        )
        ws = (root / WS_PATH).read_text(encoding="utf-8")
        self.assertIn(ROUTER_NEW, ws)
        self.assertIn('action === "preset.goto"', ws)
        self.assertIn('method = "goto"', ws)

        http = (root / HTTP_PATH).read_text(encoding="utf-8")
        self.assertIn(HTTP_ROUTE_NEW, http)
        self.assertIn('kind === "record" && sn', http)
        self.assertIn("recordFragments", http)

        go = (root / GO2RTC_PATH).read_text(encoding="utf-8")
        self.assertIn(GO2RTC_ENV_NEW, go)
        self.assertIn("go2rtcApiListen", go)
        self.assertIn("go2rtcRtspListen", go)
        self.assertIn("go2rtcWebrtcListen", go)
        self.assertNotIn("'  listen: \":8654\"'", go)
        self.assertNotIn("'  listen: \":8655\"'", go)

        verified = verify(root)
        self.assertEqual(verified.ptz_router, "verified_with_preset_goto")
        self.assertEqual(verified.record_route, "verified_fragmented_mp4")
        self.assertEqual(verified.go2rtc_listeners, "loopback_runtime_configurable")

    def test_apply_is_idempotent(self):
        root = self.fixture()
        apply(root)
        report = apply(root)
        self.assertEqual(report.changed_files, ())
        self.assertEqual(report.ptz_router, "already_patched")
        self.assertEqual(report.record_route, "already_patched")
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

    def test_full_source_pin_rejects_mutation_outside_reviewed_seam(self):
        root = self.fixture()
        ws = root / WS_PATH
        ws.write_text(
            ws.read_text(encoding="utf-8") + "// unrelated executable drift\n",
            encoding="utf-8",
        )
        with self.assertRaisesRegex(OverlayError, "full-source drift"):
            apply(root)

    def test_later_target_preflight_failure_leaves_first_file_untouched(self):
        root = self.fixture()
        ws = root / WS_PATH
        go = root / GO2RTC_PATH
        before_ws = ws.read_text(encoding="utf-8")
        go.write_text(
            go.read_text(encoding="utf-8") + "// unreviewed later-file drift\n",
            encoding="utf-8",
        )

        with self.assertRaisesRegex(OverlayError, "full-source drift"):
            apply(root)

        self.assertEqual(
            ws.read_text(encoding="utf-8"),
            before_ws,
            "PTZ file must not be written before all targets pass preflight",
        )

    def test_windows_replace_permission_error_uses_full_file_fallback(self):
        root = self.fixture()
        with patch(
            "eufy_bridge_overlay.os.replace",
            side_effect=PermissionError("synthetic WinError 5"),
        ):
            report = apply(root)

        self.assertEqual(
            set(report.changed_files),
            {"src/ws-server.mjs", "src/http-routes.mjs", "go2rtc-config.mjs"},
        )
        verified = verify(root)
        self.assertEqual(verified.record_route, "verified_fragmented_mp4")
        self.assertEqual(verified.go2rtc_listeners, "loopback_runtime_configurable")

    def test_second_write_failure_rolls_back_first_write(self):
        root = self.fixture()
        ws = root / WS_PATH
        go = root / GO2RTC_PATH
        before_ws = ws.read_text(encoding="utf-8")
        before_go = go.read_text(encoding="utf-8")
        real_write = overlay._write_atomic
        calls = 0

        def fail_second_write(path, text):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("synthetic second-write failure")
            return real_write(path, text)

        with patch(
            "eufy_bridge_overlay._write_atomic",
            side_effect=fail_second_write,
        ):
            with self.assertRaisesRegex(
                OverlayError,
                "rolled back",
            ):
                apply(root)

        self.assertEqual(ws.read_text(encoding="utf-8"), before_ws)
        self.assertEqual(go.read_text(encoding="utf-8"), before_go)


if __name__ == "__main__":
    unittest.main()
