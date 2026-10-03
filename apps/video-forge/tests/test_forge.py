"""Video Forge contract tests — run on CPU with the ffmpeg mock backend.

    cd apps/video-forge && python -m unittest discover -v -s tests
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import shutil
import tempfile
import time
import unittest

SECRET = "test-secret"


def signed(client, method: str, path: str, body: dict | None = None, secret: str = SECRET, ts: int | None = None):
    payload = json.dumps(body) if body is not None else ""
    ts = str(ts if ts is not None else int(time.time()))
    sig = hmac.new(secret.encode(), f"{ts}.{method}.{path}.{hashlib.sha256(payload.encode()).hexdigest()}".encode(), hashlib.sha256).hexdigest()
    headers = {"x-forge-timestamp": ts, "x-forge-signature": sig, "content-type": "application/json"}
    if method == "POST":
        return client.post(path, content=payload, headers=headers)
    return client.get(path, headers=headers)


def job_body(key: str = "nickstire-reel-1-b1-mock-a0", **over):
    b = {"idempotency_key": key, "profile": "mock-testpattern", "prompt": "SUBJECT: tire", "duration_seconds": 4, "width": 704, "height": 1280, "fps": 24, "seed": 7}
    b.update(over)
    return b


class ForgeTestBase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        os.environ.update({"FORGE_SECRET": SECRET, "FORGE_DATA_DIR": self.dir, "FORGE_ALLOW_UNAPPROVED_FOR_TESTS": "1", "FORGE_GPU_TYPE": "CPU-test"})
        from fastapi.testclient import TestClient
        from forge.app import create_app

        self.app = create_app(start_worker=False)
        self.forge = self.app.state.forge
        self.client = TestClient(self.app)

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)
        for k in ("FORGE_ALLOW_UNAPPROVED_FOR_TESTS", "FORGE_ENABLED_PROFILES"):
            os.environ.pop(k, None)


class AuthTests(ForgeTestBase):
    def test_unsigned_rejected(self):
        self.assertEqual(self.client.get("/health").status_code, 401)

    def test_wrong_secret_rejected(self):
        self.assertEqual(signed(self.client, "GET", "/health", secret="nope").status_code, 401)

    def test_stale_timestamp_rejected(self):
        self.assertEqual(signed(self.client, "GET", "/health", ts=int(time.time()) - 3600).status_code, 401)

    def test_signed_ok(self):
        r = signed(self.client, "GET", "/health")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["recent_success_rate"], "UNKNOWN")  # no data → UNKNOWN, not 0


class IdempotencyTests(ForgeTestBase):
    def test_same_key_same_request_returns_same_job(self):
        a = signed(self.client, "POST", "/v1/jobs", job_body())
        b = signed(self.client, "POST", "/v1/jobs", job_body(metadata={"trace": "retry"}))  # metadata is tracing only
        self.assertEqual(a.status_code, 202)
        self.assertEqual(b.status_code, 200)
        self.assertEqual(a.json()["job"]["id"], b.json()["job"]["id"])
        self.assertEqual(self.forge.store.counts().get("queued"), 1)

    def test_same_key_different_request_is_409_not_a_second_render(self):
        signed(self.client, "POST", "/v1/jobs", job_body())
        r = signed(self.client, "POST", "/v1/jobs", job_body(prompt="different"))
        self.assertEqual(r.status_code, 409)

    def test_resubmit_after_success_returns_completed_output(self):
        jid = signed(self.client, "POST", "/v1/jobs", job_body()).json()["job"]["id"]
        self.assertTrue(self.forge.run_one())
        again = signed(self.client, "POST", "/v1/jobs", job_body()).json()["job"]
        self.assertEqual(again["id"], jid)
        self.assertEqual(again["status"], "succeeded")


class RenderTests(ForgeTestBase):
    def test_mock_render_produces_verified_receipt_and_output(self):
        jid = signed(self.client, "POST", "/v1/jobs", job_body()).json()["job"]["id"]
        self.forge.run_one()
        job = signed(self.client, "GET", f"/v1/jobs/{jid}").json()["job"]
        self.assertEqual(job["status"], "succeeded", job)
        o = job["output"]
        self.assertEqual((o["width"], o["height"]), (704, 1280))
        self.assertAlmostEqual(o["fps"], 24, delta=0.5)
        self.assertEqual(o["mime"], "video/mp4")
        self.assertIsNotNone(job["gpu_seconds"])
        blob = signed(self.client, "GET", f"/v1/jobs/{jid}/output").content
        self.assertEqual(hashlib.sha256(blob).hexdigest(), o["sha256"])
        self.assertEqual(blob[4:8], b"ftyp")

    def test_reference_image_conditioning_stored_by_hash(self):
        png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
        r = signed(self.client, "POST", "/v1/jobs", job_body(key="nickstire-reel-1-b2-mock-a0", start_image_b64=base64.b64encode(png).decode()))
        self.assertEqual(r.status_code, 202)
        req = self.forge.store.get_request(r.json()["job"]["id"])
        self.assertTrue(req["start_image_sha256"].endswith(".png"))
        self.assertNotIn("start_image_b64", req)

    def test_non_image_reference_rejected(self):
        r = signed(self.client, "POST", "/v1/jobs", job_body(start_image_b64=base64.b64encode(b"<svg/>" * 10).decode()))
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["error_code"], "invalid_reference_image")

    def test_unsupported_duration_and_resolution(self):
        self.assertEqual(signed(self.client, "POST", "/v1/jobs", job_body(duration_seconds=7)).json()["error_code"], "unsupported_duration")
        self.assertEqual(signed(self.client, "POST", "/v1/jobs", job_body(width=1080, height=1920)).json()["error_code"], "unsupported_resolution")
        self.assertEqual(signed(self.client, "POST", "/v1/jobs", job_body(width=720)).json()["error_code"], "unsupported_resolution")

    def test_i2v_only_profile_requires_start_image(self):
        r = signed(self.client, "POST", "/v1/jobs", job_body(profile="wan2.2-i2v-a14b"))
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["error_code"], "capability_mismatch")

    def test_unknown_or_disabled_profile(self):
        r = signed(self.client, "POST", "/v1/jobs", job_body(profile="does-not-exist"))
        self.assertEqual(r.json()["error_code"], "config_unavailable")


class LicenseGateTests(ForgeTestBase):
    def test_unapproved_license_refused_without_test_override(self):
        self.forge.allow_unapproved = False
        r = signed(self.client, "POST", "/v1/jobs", job_body())  # mock is UNKNOWN
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()["error_code"], "license_blocked")

    def test_territory_blocked_refused(self):
        self.forge.allow_unapproved = False
        r = signed(self.client, "POST", "/v1/jobs", job_body(profile="minimax-h3", duration_seconds=6))
        self.assertEqual(r.json()["error_code"], "license_blocked")


class LifecycleTests(ForgeTestBase):
    def test_cancel_queued(self):
        jid = signed(self.client, "POST", "/v1/jobs", job_body()).json()["job"]["id"]
        self.assertEqual(signed(self.client, "POST", f"/v1/jobs/{jid}/cancel", {}).json()["job"]["status"], "cancelled")
        self.assertFalse(self.forge.run_one())  # nothing left to render

    def test_cancel_running_wins_over_late_success(self):
        jid = signed(self.client, "POST", "/v1/jobs", job_body()).json()["job"]["id"]
        job = self.forge.store.claim_next()
        self.forge.store.cancel(job["id"])
        self.assertFalse(self.forge.store.heartbeat(job["id"]))  # backend told to stop
        self.forge.store.succeed(job["id"], {"x": 1}, 1, "t", "m", "w", 1)
        self.assertEqual(self.forge.store.get(jid)["status"], "cancelled")

    def test_restart_requeues_running_work_then_fails_after_bound(self):
        jid = signed(self.client, "POST", "/v1/jobs", job_body()).json()["job"]["id"]
        store = self.forge.store
        for _ in range(store.max_restarts):
            store.claim_next()
            store.recover_after_restart()
            self.assertEqual(store.get(jid)["status"], "queued")
        store.claim_next()
        store.recover_after_restart()
        self.assertEqual(store.get(jid)["status"], "failed")
        self.assertEqual(store.get(jid)["error_code"], "worker_restart_lost")

    def test_restart_of_whole_service_keeps_jobs(self):
        jid = signed(self.client, "POST", "/v1/jobs", job_body()).json()["job"]["id"]
        self.forge.store.claim_next()
        from forge.app import create_app
        app2 = create_app(start_worker=False)  # same data dir = new process after a crash
        self.assertEqual(app2.state.forge.recovered, 1)
        self.assertEqual(app2.state.forge.store.get(jid)["status"], "queued")

    def test_stale_heartbeat_and_hard_ceiling_reclaimed(self):
        a = signed(self.client, "POST", "/v1/jobs", job_body()).json()["job"]["id"]
        b = signed(self.client, "POST", "/v1/jobs", job_body(key="nickstire-reel-1-b9-mock-a0")).json()["job"]["id"]
        st = self.forge.store
        st.claim_next()
        st._db.execute("UPDATE jobs SET heartbeat_at = heartbeat_at - 10000 WHERE id = ?", (a,))
        st._db.execute("UPDATE jobs SET created_at = created_at - 100000 WHERE id = ?", (b,))
        self.forge.sweep()
        self.assertEqual(st.get(a)["error_code"], "stale_heartbeat")
        self.assertEqual(st.get(b)["error_code"], "hard_ceiling")

    def test_backend_failure_is_classified_not_crashing(self):
        os.environ["FORGE_LTX_CMD"] = "python -c \"import sys; sys.stderr.write('torch.OutOfMemoryError: CUDA out of memory'); sys.exit(1)\""
        try:
            self.forge.profiles["ltx-2.5-distilled"]["license_state"] = "APPROVED_WITH_CONDITIONS"
            jid = signed(self.client, "POST", "/v1/jobs", job_body(profile="ltx-2.5-distilled")).json()["job"]["id"]
            self.forge.run_one()
            job = self.forge.store.get(jid)
            self.assertEqual(job["status"], "failed")
            self.assertEqual(job["error_code"], "oom")
        finally:
            os.environ.pop("FORGE_LTX_CMD", None)


class ProfileParityTests(unittest.TestCase):
    def test_profiles_have_required_fields(self):
        from forge.app import load_profiles
        for pid, p in load_profiles().items():
            for f in ("backend", "license_state", "rollout", "durations", "max_long", "max_short", "hard_ceiling_s", "stale_heartbeat_s"):
                self.assertIn(f, p, pid)


if __name__ == "__main__":
    unittest.main()
