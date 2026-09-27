#!/usr/bin/env python3
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
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

    def test_visual_home_receipt_must_be_fresh_and_newer_than_motor_receipt(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "home.json"
            path.write_text(json.dumps({
                "serial": eufy_agent.EUFY_OFFICE_CAMERA_SERIAL,
                "verifiedAt": "2026-09-27T10:00:30+00:00",
                "isHome": True,
                "verifierVersion": "office-home-pose-v1",
                "referenceSha256": "a" * 64,
            }), encoding="utf-8")

            with patch.object(eufy_agent, "EUFY_HOME_POSE_RECEIPT", str(path)), patch.object(
                eufy_agent,
                "EUFY_HOME_REFERENCE_SHA256",
                "a" * 64,
            ), patch.object(
                eufy_agent,
                "EUFY_HOME_POSE_MAX_AGE_SECONDS",
                300.0,
            ):
                current = datetime(2026, 9, 27, 10, 1, tzinfo=timezone.utc)
                self.assertTrue(eufy_agent.load_home_pose_receipt(
                    last_ptz_notify_at="2026-09-27T10:00:20+00:00",
                    now=current,
                ))
                # A later physical camera move invalidates the old home image immediately.
                self.assertIsNone(eufy_agent.load_home_pose_receipt(
                    last_ptz_notify_at="2026-09-27T10:00:40+00:00",
                    now=current,
                ))
                # Time alone also expires the proof.
                self.assertIsNone(eufy_agent.load_home_pose_receipt(
                    last_ptz_notify_at=None,
                    now=datetime(2026, 9, 27, 10, 10, tzinfo=timezone.utc),
                ))

    def test_visual_away_receipt_is_preserved_as_false(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "home.json"
            path.write_text(json.dumps({
                "serial": eufy_agent.EUFY_OFFICE_CAMERA_SERIAL,
                "verifiedAt": "2026-09-27T10:00:30Z",
                "isHome": False,
                "verifierVersion": "office-home-pose-v1",
                "referenceSha256": "b" * 64,
            }), encoding="utf-8")
            with patch.object(eufy_agent, "EUFY_HOME_POSE_RECEIPT", str(path)), patch.object(
                eufy_agent,
                "EUFY_HOME_REFERENCE_SHA256",
                "b" * 64,
            ):
                verdict = eufy_agent.load_home_pose_receipt(
                    last_ptz_notify_at="2026-09-27T10:00:20Z",
                    now=datetime(2026, 9, 27, 10, 1, tzinfo=timezone.utc),
                )
        self.assertIs(verdict, False)

    def test_visual_home_receipt_rejects_wrong_camera_and_unknown_verifier(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "home.json"
            base = {
                "serial": "SOME-OTHER-CAMERA",
                "verifiedAt": "2026-09-27T10:00:30+00:00",
                "isHome": True,
                "verifierVersion": "office-home-pose-v1",
                "referenceSha256": "c" * 64,
            }
            path.write_text(json.dumps(base), encoding="utf-8")
            with patch.object(eufy_agent, "EUFY_HOME_POSE_RECEIPT", str(path)), patch.object(
                eufy_agent,
                "EUFY_HOME_REFERENCE_SHA256",
                "c" * 64,
            ):
                self.assertIsNone(eufy_agent.load_home_pose_receipt(
                    last_ptz_notify_at=None,
                    now=datetime(2026, 9, 27, 10, 1, tzinfo=timezone.utc),
                ))
                base["serial"] = eufy_agent.EUFY_OFFICE_CAMERA_SERIAL
                base["verifierVersion"] = "mystery-verifier"
                path.write_text(json.dumps(base), encoding="utf-8")
                self.assertIsNone(eufy_agent.load_home_pose_receipt(
                    last_ptz_notify_at=None,
                    now=datetime(2026, 9, 27, 10, 1, tzinfo=timezone.utc),
                ))

    def test_visual_home_receipt_rejects_wrong_reference_hash(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "home.json"
            path.write_text(json.dumps({
                "serial": eufy_agent.EUFY_OFFICE_CAMERA_SERIAL,
                "verifiedAt": "2026-09-27T10:00:30+00:00",
                "isHome": True,
                "verifierVersion": "office-home-pose-v1",
                "referenceSha256": "d" * 64,
            }), encoding="utf-8")
            with patch.object(eufy_agent, "EUFY_HOME_POSE_RECEIPT", str(path)), patch.object(
                eufy_agent,
                "EUFY_HOME_REFERENCE_SHA256",
                "e" * 64,
            ):
                self.assertIsNone(eufy_agent.load_home_pose_receipt(
                    last_ptz_notify_at=None,
                    now=datetime(2026, 9, 27, 10, 1, tzinfo=timezone.utc),
                ))

    def test_home_verifier_runs_only_for_unknown_home_after_ptz_receipt(self):
        completed = Mock(returncode=0, stderr="")
        with patch.object(
            eufy_agent,
            "load_home_pose_receipt",
            side_effect=[None, True],
        ) as load_receipt, patch.object(
            eufy_agent,
            "EUFY_HOME_VERIFY_PYTHON",
            r"C:\camera-venv\python.exe",
        ), patch.object(
            eufy_agent,
            "EUFY_HOME_VERIFY_SCRIPT",
            r"C:\repo\camera-bridge\scripts\verify_home_pose.py",
        ), patch.object(
            eufy_agent,
            "EUFY_HOME_REFERENCE",
            r"C:\camera\office-home.png",
        ), patch.object(
            eufy_agent,
            "EUFY_HOME_MEDIA_URL",
            "rtsp://127.0.0.1:8554/office",
        ), patch.object(
            eufy_agent,
            "EUFY_HOME_POSE_RECEIPT",
            r"C:\camera\office-home-receipt.json",
        ), patch.object(
            eufy_agent,
            "EUFY_HOME_REFERENCE_SHA256",
            "f" * 64,
        ), patch.object(
            eufy_agent,
            "_last_home_verify_monotonic",
            0.0,
        ), patch.object(
            eufy_agent.subprocess,
            "run",
            return_value=completed,
        ) as run:
            verdict = eufy_agent.maybe_verify_home_pose({
                "mediaPlaneOk": True,
                "ptzHomeOk": None,
                "lastPtzNotifyAt": "2026-09-27T10:00:20+00:00",
            })

        self.assertTrue(verdict)
        self.assertEqual(load_receipt.call_count, 2)
        args = run.call_args.args[0]
        self.assertIn("--rtsp-env", args)
        self.assertIn("EUFY_HOME_MEDIA_URL", args)
        self.assertNotIn(
            "rtsp://127.0.0.1:8554/office",
            args,
            "media URL belongs in inherited environment, not process command line",
        )

    def test_home_verifier_does_not_run_without_motor_receipt_or_when_media_is_down(self):
        with patch.object(eufy_agent, "load_home_pose_receipt", return_value=None), patch.object(
            eufy_agent.subprocess,
            "run",
        ) as run:
            self.assertIsNone(eufy_agent.maybe_verify_home_pose({
                "mediaPlaneOk": True,
                "ptzHomeOk": None,
                "lastPtzNotifyAt": None,
            }))
            self.assertIsNone(eufy_agent.maybe_verify_home_pose({
                "mediaPlaneOk": False,
                "ptzHomeOk": None,
                "lastPtzNotifyAt": "2026-09-27T10:00:20+00:00",
            }))
        run.assert_not_called()

    def test_home_verifier_infrastructure_failure_does_not_invent_away(self):
        completed = Mock(returncode=2, stderr="capture timeout")
        with patch.object(
            eufy_agent,
            "load_home_pose_receipt",
            return_value=None,
        ), patch.object(
            eufy_agent,
            "EUFY_HOME_VERIFY_PYTHON",
            "python",
        ), patch.object(
            eufy_agent,
            "EUFY_HOME_VERIFY_SCRIPT",
            "verify_home_pose.py",
        ), patch.object(
            eufy_agent,
            "EUFY_HOME_REFERENCE",
            "home.png",
        ), patch.object(
            eufy_agent,
            "EUFY_HOME_MEDIA_URL",
            "rtsp://127.0.0.1:8554/office",
        ), patch.object(
            eufy_agent,
            "EUFY_HOME_POSE_RECEIPT",
            "receipt.json",
        ), patch.object(
            eufy_agent,
            "EUFY_HOME_REFERENCE_SHA256",
            "f" * 64,
        ), patch.object(
            eufy_agent,
            "_last_home_verify_monotonic",
            0.0,
        ), patch.object(
            eufy_agent.subprocess,
            "run",
            return_value=completed,
        ):
            self.assertIsNone(eufy_agent.maybe_verify_home_pose({
                "mediaPlaneOk": True,
                "ptzHomeOk": None,
                "lastPtzNotifyAt": "2026-09-27T10:00:20+00:00",
            }))

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
            eufy_bridge,
            "probe_office_media_health",
            return_value=False,
        ) as media_probe, patch.object(
            eufy_agent.requests,
            "post",
            return_value=response,
        ) as post:
            self.assertEqual(eufy_agent.sync_office_camera_heartbeat(), 1)
            media_probe.assert_called_once_with()

        sent = post.call_args.kwargs["json"]
        self.assertTrue(sent["authPlaneOk"])
        self.assertTrue(sent["eventPlaneOk"])
        self.assertFalse(sent["controlPlaneOk"])
        self.assertNotIn("mediaPlaneOk", sent)
        self.assertNotIn("ptzHomeOk", sent)
        self.assertEqual(post.call_args.kwargs["headers"]["x-sync-key"], "test-key")


if __name__ == "__main__":
    unittest.main()
