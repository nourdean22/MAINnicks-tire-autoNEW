#!/usr/bin/env python3
import unittest
from datetime import datetime, timezone
from unittest.mock import Mock, patch

import eufy_agent
import eufy_bridge


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

    def test_office_heartbeat_compiler_preserves_false_and_proof_timestamps(self):
        at = datetime(2026, 9, 26, 23, 55, tzinfo=timezone.utc)
        payload = eufy_agent.build_office_camera_heartbeat(
            auth_ok=True,
            runtime_health={
                "eventPlaneOk": True,
                "controlPlaneOk": False,
                "mediaPlaneOk": False,
                "ptzHomeOk": False,
                "lastEventProofAt": "2026-09-26T23:54:00+00:00",
                "lastControlProofAt": None,
                "lastMediaProofAt": None,
                "lastPtzNotifyAt": None,
            },
            seq=7,
            observed_at=at,
        )
        self.assertEqual(payload["camera"], "office")
        self.assertEqual(payload["mode"], "SHADOW")
        self.assertEqual(payload["heartbeatSeq"], 7)
        self.assertTrue(payload["authPlaneOk"])
        self.assertTrue(payload["eventPlaneOk"])
        self.assertFalse(payload["controlPlaneOk"])
        self.assertFalse(payload["mediaPlaneOk"])
        self.assertFalse(payload["ptzHomeOk"])
        self.assertEqual(payload["lastEventProofAt"], "2026-09-26T23:54:00+00:00")
        self.assertNotIn("lastControlProofAt", payload)
        self.assertEqual(payload["sourceGeneration"], eufy_agent.EUFY_OFFICE_CAMERA_SERIAL)

    def test_office_heartbeat_is_inert_until_separate_nicks_credentials_exist(self):
        with patch.object(eufy_agent, "NICKS_CAMERA_HEARTBEAT_URL", ""), patch.object(
            eufy_agent,
            "NICKS_CAMERA_INGEST_KEY",
            "",
        ), patch.object(eufy_agent.requests, "post") as post:
            self.assertEqual(eufy_agent.sync_office_camera_heartbeat(), 0)
            post.assert_not_called()

    def test_office_heartbeat_posts_bridge_and_runtime_health_without_claiming_unknowns(self):
        response = Mock(status_code=200, text='{"accepted":true}')
        eufy_bridge._reset_runtime_health_for_test()
        eufy_bridge._mark_runtime(
            eventPlaneOk=True,
            controlPlaneOk=False,
            mediaPlaneOk=None,
            ptzHomeOk=None,
            lastEventProofAt="2026-09-26T23:54:00+00:00",
        )
        with patch.object(
            eufy_agent,
            "NICKS_CAMERA_HEARTBEAT_URL",
            "https://nickstire.example/api/camera/heartbeat",
        ), patch.object(
            eufy_agent,
            "NICKS_CAMERA_INGEST_KEY",
            "test-key",
        ), patch.object(
            eufy_bridge,
            "bridge_ready",
            return_value=(True, "auth=ok"),
        ), patch.object(
            eufy_agent.requests,
            "post",
            return_value=response,
        ) as post:
            self.assertEqual(eufy_agent.sync_office_camera_heartbeat(), 1)

        sent = post.call_args.kwargs["json"]
        self.assertTrue(sent["authPlaneOk"])
        self.assertTrue(sent["eventPlaneOk"])
        self.assertFalse(sent["controlPlaneOk"])
        self.assertNotIn("mediaPlaneOk", sent)
        self.assertNotIn("ptzHomeOk", sent)
        self.assertEqual(post.call_args.kwargs["headers"]["x-sync-key"], "test-key")


if __name__ == "__main__":
    unittest.main()
