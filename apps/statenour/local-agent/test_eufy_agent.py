#!/usr/bin/env python3
import unittest
from unittest.mock import patch

import eufy_agent


class EufyAgentTests(unittest.TestCase):
    def test_bridge_device_normalization_preserves_capabilities(self):
        rows = eufy_agent._normalize_bridge_devices([
            {
                "sn": "T8410P522517180B",
                "name": "Moes Euclid Office",
                "model": "T8410",
                "modelName": "Indoor Cam Pan & Tilt",
                "codec": "camera",
                "capabilities": ["video", "motion", "ptz", "audio"],
                "state": {"motion": True},
                "streaming": False,
                "stream": "/stream/T8410P522517180B",
            }
        ])
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["platformDeviceId"], "eufy-T8410P522517180B")
        self.assertEqual(row["status"], "ONLINE")
        self.assertIn("ptz", row["metadata"]["capabilities"])
        self.assertEqual(row["metadata"]["controlPlane"], "mega-yfue-bridge")

    def test_bridge_outage_does_not_fall_through_to_fake_live_registry(self):
        with patch.object(
            eufy_agent,
            "_poll_bridge_devices",
            side_effect=RuntimeError("bridge down"),
        ), patch.object(eufy_agent, "_load_token") as load_token:
            with self.assertRaisesRegex(RuntimeError, "bridge down"):
                eufy_agent.poll_eufy_devices()
            load_token.assert_not_called()

    def test_successful_bridge_sync_does_not_start_legacy_cloud_login(self):
        live = [{
            "platformDeviceId": "eufy-T8410P522517180B",
            "name": "Office",
            "platform": "EUFY",
            "deviceType": "CAMERA",
            "location": "office",
            "status": "ONLINE",
            "currentState": {},
            "metadata": {"serial": "T8410P522517180B"},
        }]
        with patch.object(
            eufy_agent,
            "_poll_bridge_devices",
            return_value=live,
        ), patch.object(eufy_agent, "_load_token") as load_token:
            self.assertEqual(eufy_agent.poll_eufy_devices(), live)
            load_token.assert_not_called()


if __name__ == "__main__":
    unittest.main()
