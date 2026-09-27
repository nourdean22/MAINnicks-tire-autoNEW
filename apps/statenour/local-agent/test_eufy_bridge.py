#!/usr/bin/env python3
import unittest
from unittest.mock import Mock, patch

import eufy_bridge


OFFICE = "T8410P522517180B"
OTHER = "T8410P5225154105"


class FakeResponse:
    def __init__(self, status_code: int, chunks=None):
        self.status_code = status_code
        self._chunks = list(chunks or [])

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def iter_content(self, chunk_size=2048):
        del chunk_size
        return iter(self._chunks)


class EufyBridgeTests(unittest.TestCase):
    def setUp(self):
        eufy_bridge._reset_runtime_health_for_test()

    def test_serial_from_platform_id(self):
        self.assertEqual(eufy_bridge.serial_from_platform_id(f"eufy-{OFFICE}"), OFFICE)
        self.assertEqual(eufy_bridge.serial_from_platform_id(OFFICE), OFFICE)

    def test_queue_is_not_claimed_when_control_not_ready(self):
        with patch.object(
            eufy_bridge,
            "control_ready",
            return_value=(False, "bridge unavailable"),
        ), patch.object(eufy_bridge.requests, "get") as get:
            self.assertEqual(eufy_bridge.poll_commands(), [])
            get.assert_not_called()

    def test_direction_command_passes_expected_home_false_to_ptz_action(self):
        cmd = {
            "command": "ptz",
            "params": {"direction": "left"},
            "device": {"platformDeviceId": f"eufy-{OFFICE}"},
        }
        with patch.object(
            eufy_bridge,
            "_ptz_action",
            return_value={"ok": True, "result": None},
        ) as action:
            result = eufy_bridge.execute_command(cmd)

        action.assert_called_once_with(OFFICE, "left", target_home=False)
        self.assertEqual(result["ptzCommand"], "sent")
        self.assertEqual(result["direction"], "left")
        self.assertFalse(result["verified"])

    def test_invalid_direction_fails_before_bridge_action(self):
        cmd = {
            "command": "ptz",
            "params": {"direction": "around"},
            "device": {"platformDeviceId": f"eufy-{OFFICE}"},
        }
        with patch.object(eufy_bridge, "_ptz_action") as action:
            with self.assertRaises(eufy_bridge.EufyBridgeError):
                eufy_bridge.execute_command(cmd)
            action.assert_not_called()

    def test_home_preset_maps_to_upstream_action_with_home_target(self):
        cmd = {
            "command": "ptz_preset",
            "params": {"id": 3},
            "device": {"platformDeviceId": f"eufy-{OFFICE}"},
        }
        with patch.object(eufy_bridge, "HOME_PRESET_ID", 3), patch.object(
            eufy_bridge,
            "_ptz_action",
            return_value={"ok": True, "result": None},
        ) as action:
            result = eufy_bridge.execute_command(cmd)

        action.assert_called_once_with(
            OFFICE,
            "preset.goto",
            [3],
            target_home=True,
        )
        self.assertEqual(result["presetId"], 3)
        self.assertFalse(result["verified"])

    def test_event_filter_is_camera_scoped(self):
        with patch.object(eufy_bridge, "_EVENT_FILTER", {"OFFICE"}):
            self.assertTrue(
                eufy_bridge._should_forward_event(
                    {"event": "motion", "deviceSn": "OFFICE"}
                )
            )
            self.assertFalse(
                eufy_bridge._should_forward_event(
                    {"event": "motion", "deviceSn": "HOME"}
                )
            )
            self.assertFalse(
                eufy_bridge._should_forward_event(
                    {"event": "batteryLevel", "deviceSn": "OFFICE"}
                )
            )

    def test_other_camera_events_never_mutate_office_health(self):
        eufy_bridge._record_bridge_event(
            {"event": "ptzNotify", "deviceSn": OTHER}
        )
        eufy_bridge._record_bridge_event(
            {"event": "streamState", "deviceSn": OTHER, "active": True}
        )
        health = eufy_bridge.runtime_health_snapshot()
        self.assertIsNone(health["controlPlaneOk"])
        self.assertIsNone(health["mediaPlaneOk"])
        self.assertIsNone(health["lastPtzNotifyAt"])

    def test_semantic_event_is_positive_event_plane_proof(self):
        eufy_bridge._record_bridge_event(
            {"event": "personDetected", "deviceSn": OFFICE}
        )
        health = eufy_bridge.runtime_health_snapshot()
        self.assertTrue(health["eventPlaneOk"])
        self.assertIsNotNone(health["lastEventProofAt"])

    def test_stream_active_is_media_proof_but_stream_inactive_is_not_failure(self):
        eufy_bridge._record_bridge_event(
            {"event": "streamState", "deviceSn": OFFICE, "active": True}
        )
        first = eufy_bridge.runtime_health_snapshot()
        self.assertTrue(first["mediaPlaneOk"])
        self.assertIsNotNone(first["lastMediaProofAt"])

        eufy_bridge._record_bridge_event(
            {"event": "streamState", "deviceSn": OFFICE, "active": False}
        )
        second = eufy_bridge.runtime_health_snapshot()
        self.assertTrue(second["mediaPlaneOk"])
        self.assertEqual(second["lastMediaProofAt"], first["lastMediaProofAt"])

    def test_early_ptz_receipt_before_request_returns_is_not_lost(self):
        def request_with_early_receipt(_payload):
            eufy_bridge._record_bridge_event(
                {"event": "ptzNotify", "deviceSn": OFFICE}
            )
            return {"ok": True, "result": None}

        with patch.object(eufy_bridge, "_require_ptz"), patch.object(
            eufy_bridge,
            "request",
            side_effect=request_with_early_receipt,
        ):
            eufy_bridge._ptz_action(
                OFFICE,
                "right",
                target_home=False,
            )

        health = eufy_bridge.runtime_health_snapshot()
        self.assertTrue(health["controlPlaneOk"])
        self.assertFalse(health["ptzHomeOk"])
        self.assertIsNotNone(health["lastPtzNotifyAt"])

    def test_back_to_back_office_moves_do_not_overwrite_home_receipts(self):
        def request_with_receipt(_payload):
            eufy_bridge._record_bridge_event(
                {"event": "ptzNotify", "deviceSn": OFFICE}
            )
            return {"ok": True, "result": None}

        with patch.object(eufy_bridge, "_require_ptz"), patch.object(
            eufy_bridge,
            "request",
            side_effect=request_with_receipt,
        ):
            eufy_bridge._ptz_action(
                OFFICE,
                "right",
                target_home=False,
            )
            self.assertFalse(eufy_bridge.runtime_health_snapshot()["ptzHomeOk"])
            eufy_bridge._ptz_action(
                OFFICE,
                "preset.goto",
                [3],
                target_home=True,
            )

        # Motor receipt proves control, not absolute pose. Home remains unverified
        # until a visual/SceneLock verifier confirms the returned frame.
        self.assertIsNone(eufy_bridge.runtime_health_snapshot()["ptzHomeOk"])

    def test_home_preset_receipt_never_claims_absolute_home_without_visual_proof(self):
        def request_with_receipt(_payload):
            eufy_bridge._record_bridge_event(
                {"event": "ptzNotify", "deviceSn": OFFICE}
            )
            return {"ok": True, "result": None}

        with patch.object(eufy_bridge, "_require_ptz"), patch.object(
            eufy_bridge,
            "request",
            side_effect=request_with_receipt,
        ):
            eufy_bridge._ptz_action(
                OFFICE,
                "preset.goto",
                [3],
                target_home=True,
            )

        health = eufy_bridge.runtime_health_snapshot()
        self.assertTrue(health["controlPlaneOk"])
        self.assertIsNone(health["ptzHomeOk"])

        eufy_bridge.mark_ptz_home_pose_verified(True)
        self.assertTrue(eufy_bridge.runtime_health_snapshot()["ptzHomeOk"])

    def test_missing_ptz_receipt_marks_office_control_down_and_home_unknown(self):
        with patch.object(eufy_bridge, "_require_ptz"), patch.object(
            eufy_bridge,
            "request",
            return_value={"ok": True, "result": None},
        ), patch.object(eufy_bridge, "PTZ_RECEIPT_TIMEOUT_SECONDS", 0.01):
            with self.assertRaisesRegex(eufy_bridge.EufyBridgeError, "no ptzNotify"):
                eufy_bridge._ptz_action(
                    OFFICE,
                    "left",
                    target_home=False,
                )

        health = eufy_bridge.runtime_health_snapshot()
        self.assertFalse(health["controlPlaneOk"])
        self.assertIsNone(health["ptzHomeOk"])

    def test_non_office_ptz_failure_does_not_poison_office_health(self):
        with patch.object(eufy_bridge, "_require_ptz"), patch.object(
            eufy_bridge,
            "request",
            side_effect=eufy_bridge.EufyBridgeError("P2P connect timeout"),
        ):
            with self.assertRaisesRegex(eufy_bridge.EufyBridgeError, "P2P"):
                eufy_bridge._ptz_action(OTHER, "left")

        self.assertIsNone(eufy_bridge.runtime_health_snapshot()["controlPlaneOk"])

    def test_measured_office_ptz_failure_marks_control_plane_down(self):
        with patch.object(eufy_bridge, "_require_ptz"), patch.object(
            eufy_bridge,
            "request",
            side_effect=eufy_bridge.EufyBridgeError("P2P connect timeout"),
        ):
            with self.assertRaisesRegex(eufy_bridge.EufyBridgeError, "P2P"):
                eufy_bridge._ptz_action(
                    OFFICE,
                    "left",
                    target_home=False,
                )

        self.assertFalse(eufy_bridge.runtime_health_snapshot()["controlPlaneOk"])

    def test_media_probe_5xx_is_measured_failure(self):
        with patch.object(
            eufy_bridge,
            "BRIDGE_URL",
            "ws://127.0.0.1:3000/ws",
        ), patch.object(
            eufy_bridge.requests,
            "get",
            return_value=FakeResponse(502),
        ):
            self.assertFalse(eufy_bridge.probe_office_media_health(force=True))

        self.assertFalse(eufy_bridge.runtime_health_snapshot()["mediaPlaneOk"])

    def test_media_probe_real_bytes_are_positive_proof(self):
        with patch.object(
            eufy_bridge,
            "BRIDGE_URL",
            "ws://127.0.0.1:3000/ws",
        ), patch.object(
            eufy_bridge.requests,
            "get",
            return_value=FakeResponse(200, [b"\x00\x00\x00\x01h264"]),
        ):
            self.assertTrue(eufy_bridge.probe_office_media_health(force=True))

        health = eufy_bridge.runtime_health_snapshot()
        self.assertTrue(health["mediaPlaneOk"])
        self.assertIsNotNone(health["lastMediaProofAt"])

    def test_old_positive_media_proof_expires_to_unknown(self):
        eufy_bridge._mark_runtime(
            mediaPlaneOk=True,
            lastMediaProofAt="2000-01-01T00:00:00+00:00",
        )
        with patch.object(eufy_bridge, "MEDIA_PROOF_TTL_SECONDS", 60):
            health = eufy_bridge.runtime_health_snapshot()
        self.assertIsNone(health["mediaPlaneOk"])


if __name__ == "__main__":
    unittest.main()
