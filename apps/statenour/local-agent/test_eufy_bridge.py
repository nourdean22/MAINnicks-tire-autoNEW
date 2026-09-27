#!/usr/bin/env python3
import unittest
from unittest.mock import patch

import eufy_bridge


class EufyBridgeTests(unittest.TestCase):
    def setUp(self):
        eufy_bridge._reset_runtime_health_for_test()

    def test_serial_from_platform_id(self):
        self.assertEqual(
            eufy_bridge.serial_from_platform_id("eufy-T8410P522517180B"),
            "T8410P522517180B",
        )
        self.assertEqual(
            eufy_bridge.serial_from_platform_id("T8410P522517180B"),
            "T8410P522517180B",
        )

    def test_queue_is_not_claimed_when_control_not_ready(self):
        with patch.object(
            eufy_bridge,
            "control_ready",
            return_value=(False, "bridge unavailable"),
        ), patch.object(eufy_bridge.requests, "get") as get:
            self.assertEqual(eufy_bridge.poll_commands(), [])
            get.assert_not_called()

    def test_direction_command_uses_capability_gated_ptz_action(self):
        cmd = {
            "command": "ptz",
            "params": {"direction": "left"},
            "device": {"platformDeviceId": "eufy-T8410P522517180B"},
        }
        with patch.object(
            eufy_bridge,
            "_ptz_action",
            return_value={"ok": True, "result": None},
        ) as action:
            result = eufy_bridge.execute_command(cmd)

        action.assert_called_once_with("T8410P522517180B", "left")
        self.assertEqual(result["ptzCommand"], "sent")
        self.assertEqual(result["direction"], "left")
        self.assertFalse(result["verified"])
        # A bridge ack is command intent, not physical proof.
        self.assertIsNone(eufy_bridge.runtime_health_snapshot()["controlPlaneOk"])

    def test_invalid_direction_fails_before_bridge_action(self):
        cmd = {
            "command": "ptz",
            "params": {"direction": "around"},
            "device": {"platformDeviceId": "eufy-T8410P522517180B"},
        }
        with patch.object(eufy_bridge, "_ptz_action") as action:
            with self.assertRaises(eufy_bridge.EufyBridgeError):
                eufy_bridge.execute_command(cmd)
            action.assert_not_called()

    def test_preset_command_maps_to_upstream_action(self):
        cmd = {
            "command": "ptz_preset",
            "params": {"id": 3},
            "device": {"platformDeviceId": "eufy-T8410P522517180B"},
        }
        with patch.object(
            eufy_bridge,
            "_ptz_action",
            return_value={"ok": True, "result": None},
        ) as action:
            result = eufy_bridge.execute_command(cmd)

        action.assert_called_once_with("T8410P522517180B", "preset.goto", [3])
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

    def test_semantic_event_is_positive_event_plane_proof(self):
        eufy_bridge._record_bridge_event(
            {"event": "personDetected", "deviceSn": "T8410P522517180B"}
        )
        health = eufy_bridge.runtime_health_snapshot()
        self.assertTrue(health["eventPlaneOk"])
        self.assertIsNotNone(health["lastEventProofAt"])

    def test_stream_active_is_media_proof_but_stream_inactive_is_not_failure(self):
        eufy_bridge._record_bridge_event(
            {"event": "streamState", "deviceSn": "T8410P522517180B", "active": True}
        )
        first = eufy_bridge.runtime_health_snapshot()
        self.assertTrue(first["mediaPlaneOk"])
        self.assertIsNotNone(first["lastMediaProofAt"])

        eufy_bridge._record_bridge_event(
            {"event": "streamState", "deviceSn": "T8410P522517180B", "active": False}
        )
        second = eufy_bridge.runtime_health_snapshot()
        self.assertTrue(second["mediaPlaneOk"])
        self.assertEqual(second["lastMediaProofAt"], first["lastMediaProofAt"])

    def test_home_preset_requires_ptz_notify_before_control_and_home_turn_green(self):
        cmd = {
            "command": "ptz_preset",
            "params": {"id": 3},
            "device": {"platformDeviceId": "eufy-T8410P522517180B"},
        }
        with patch.object(eufy_bridge, "HOME_PRESET_ID", 3), patch.object(
            eufy_bridge,
            "_ptz_action",
            return_value={"ok": True, "result": None},
        ):
            eufy_bridge.execute_command(cmd)

        before = eufy_bridge.runtime_health_snapshot()
        self.assertIsNone(before["controlPlaneOk"])
        self.assertIsNone(before["ptzHomeOk"])

        eufy_bridge._record_bridge_event(
            {"event": "ptzNotify", "deviceSn": "T8410P522517180B"}
        )
        after = eufy_bridge.runtime_health_snapshot()
        self.assertTrue(after["controlPlaneOk"])
        self.assertTrue(after["ptzHomeOk"])
        self.assertIsNotNone(after["lastControlProofAt"])
        self.assertIsNotNone(after["lastPtzNotifyAt"])

    def test_directional_move_marks_home_away_only_after_physical_receipt(self):
        cmd = {
            "command": "ptz_right",
            "params": {},
            "device": {"platformDeviceId": "eufy-T8410P522517180B"},
        }
        with patch.object(
            eufy_bridge,
            "_ptz_action",
            return_value={"ok": True, "result": None},
        ):
            eufy_bridge.execute_command(cmd)

        self.assertIsNone(eufy_bridge.runtime_health_snapshot()["ptzHomeOk"])
        eufy_bridge._record_bridge_event(
            {"event": "ptzNotify", "deviceSn": "T8410P522517180B"}
        )
        self.assertFalse(eufy_bridge.runtime_health_snapshot()["ptzHomeOk"])

    def test_measured_ptz_failure_marks_control_plane_down(self):
        with patch.object(eufy_bridge, "_require_ptz"), patch.object(
            eufy_bridge,
            "request",
            side_effect=eufy_bridge.EufyBridgeError("P2P connect timeout"),
        ):
            with self.assertRaisesRegex(eufy_bridge.EufyBridgeError, "P2P"):
                eufy_bridge._ptz_action("T8410P522517180B", "left")

        self.assertFalse(eufy_bridge.runtime_health_snapshot()["controlPlaneOk"])


if __name__ == "__main__":
    unittest.main()
