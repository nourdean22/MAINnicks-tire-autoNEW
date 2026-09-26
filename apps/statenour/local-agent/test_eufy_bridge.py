#!/usr/bin/env python3
import unittest
from unittest.mock import patch

import eufy_bridge


class EufyBridgeTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
