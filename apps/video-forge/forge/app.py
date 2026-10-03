"""NOUR Video Forge HTTP API.

    POST /v1/jobs              submit (idempotent on idempotency_key)
    GET  /v1/jobs/{id}         status, heartbeat, receipt
    GET  /v1/jobs/{id}/output  the verified MP4 (signed request)
    POST /v1/jobs/{id}/cancel  cancel queued/running work
    GET  /v1/capabilities      profiles, license + rollout state
    GET  /health               worker/GPU/queue truth (UNKNOWN, never invented zeros)

Every route is HMAC-signed (x-forge-timestamp, x-forge-signature over
"{ts}.{METHOD}.{path}.{sha256(body)}"), ±300 s skew. The service never fetches a
URL supplied by a client (reference images arrive as bounded base64), never
executes client-supplied workflow JSON, and never holds a storage credential —
nickstire pulls the output and re-hosts it.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import shutil
import statistics
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator

from .backends import BackendError, get_backend
from .store import IdempotencyConflict, JobStore, view

PROFILES_PATH = Path(__file__).with_name("profiles.json")
APPROVED = {"APPROVED_COMMERCIAL", "APPROVED_WITH_CONDITIONS"}
MAX_IMAGE_BYTES = 8 * 1024 * 1024
KEY_RE = re.compile(r"^[A-Za-z0-9._:-]{8,200}$")


def load_profiles() -> dict[str, dict[str, Any]]:
    return json.loads(PROFILES_PATH.read_text())["profiles"]


class SubmitBody(BaseModel):
    idempotency_key: str
    profile: str
    prompt: str = Field(min_length=1, max_length=4000)
    negative_prompt: str | None = Field(default=None, max_length=2000)
    start_image_b64: str | None = Field(default=None, max_length=12 * 1024 * 1024)
    end_image_b64: str | None = Field(default=None, max_length=12 * 1024 * 1024)
    seed: int | None = Field(default=None, ge=0, le=2**31 - 1)
    duration_seconds: int = Field(ge=1, le=10)
    width: int = Field(ge=256, le=1920)
    height: int = Field(ge=256, le=1920)
    fps: int = Field(ge=8, le=30)
    metadata: dict[str, str | int] | None = None

    @field_validator("idempotency_key")
    @classmethod
    def _key(cls, v: str) -> str:
        if not KEY_RE.match(v):
            raise ValueError("idempotency_key must match [A-Za-z0-9._:-]{8,200}")
        return v

    @field_validator("metadata")
    @classmethod
    def _meta(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        if v and (len(v) > 20 or any(len(str(x)) > 200 for x in v.values())):
            raise ValueError("metadata too large")
        return v


def _image_kind(buf: bytes) -> str | None:
    if buf.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if buf[:3] == b"\xff\xd8\xff":
        return "jpg"
    if buf[:4] == b"RIFF" and buf[8:12] == b"WEBP":
        return "webp"
    return None


def _bad(code: str, detail: str, status: int = 400) -> HTTPException:
    return HTTPException(status_code=status, detail={"error_code": code, "detail": detail})


def ffprobe(path: str) -> dict[str, Any]:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=codec_name,width,height,r_frame_rate:format=duration", "-of", "json", path],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        raise BackendError("output_validation_failure", f"ffprobe failed: {r.stderr[-200:]}")
    j = json.loads(r.stdout)
    s = (j.get("streams") or [{}])[0]
    num, _, den = str(s.get("r_frame_rate", "0/1")).partition("/")
    fps = float(num) / float(den or 1) if float(den or 1) else 0.0
    return {"codec": s.get("codec_name"), "width": s.get("width"), "height": s.get("height"), "fps": fps, "duration": float(j.get("format", {}).get("duration", 0))}


class Forge:
    def __init__(self) -> None:
        self.secret = os.environ.get("FORGE_SECRET", "")
        data = Path(os.environ.get("FORGE_DATA_DIR", "/data/forge"))
        (data / "outputs").mkdir(parents=True, exist_ok=True)
        (data / "inputs").mkdir(parents=True, exist_ok=True)
        self.data = data
        self.store = JobStore(str(data / "forge.db"), max_restarts=int(os.environ.get("FORGE_MAX_RESTARTS", "2")))
        self.profiles = load_profiles()
        self.allow_unapproved = os.environ.get("FORGE_ALLOW_UNAPPROVED_FOR_TESTS") == "1"
        enabled = os.environ.get("FORGE_ENABLED_PROFILES")
        self.enabled = set(enabled.split(",")) if enabled else set(self.profiles)
        self.gpu_type = os.environ.get("FORGE_GPU_TYPE") or _detect_gpu() or "UNKNOWN"
        self.recovered = self.store.recover_after_restart()
        self._stop = threading.Event()
        self.worker_alive_at: float | None = None
        self.loaded_backends: set[str] = set()

    # ── auth ─────────────────────────────────────────────────────────────
    def verify(self, method: str, path: str, ts: str | None, sig: str | None, body: bytes) -> None:
        if not self.secret:
            raise HTTPException(503, "FORGE_SECRET not configured — refusing all requests")
        if not ts or not sig:
            raise HTTPException(401, "missing signature")
        try:
            skew = abs(time.time() - int(ts))
        except ValueError:
            raise HTTPException(401, "bad timestamp")
        if skew > 300:
            raise HTTPException(401, "stale signature")
        expect = hmac.new(self.secret.encode(), f"{ts}.{method}.{path}.{hashlib.sha256(body).hexdigest()}".encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expect, sig):
            raise HTTPException(401, "bad signature")

    # ── submit ───────────────────────────────────────────────────────────
    def submit(self, body: SubmitBody) -> tuple[dict[str, Any], bool]:
        p = self.profiles.get(body.profile)
        if not p or body.profile not in self.enabled:
            raise _bad("config_unavailable", f"profile {body.profile} not available on this worker")
        if p["license_state"] not in APPROVED and not self.allow_unapproved:
            raise _bad("license_blocked", f"profile {body.profile} license_state={p['license_state']}", status=403)
        if body.duration_seconds not in p["durations"]:
            raise _bad("unsupported_duration", f"{body.duration_seconds}s not in {p['durations']}")
        if max(body.width, body.height) > p["max_long"] or min(body.width, body.height) > p["max_short"]:
            raise _bad("unsupported_resolution", f"{body.width}x{body.height}")
        if body.width % 32 or body.height % 32:
            raise _bad("unsupported_resolution", "width/height must be multiples of 32")
        if body.start_image_b64 and not p["i2v"]:
            raise _bad("capability_mismatch", "profile has no image-to-video")
        if body.end_image_b64 and not p["first_last"]:
            raise _bad("capability_mismatch", "profile has no first+last frame conditioning")
        req = body.model_dump()
        for field in ("start_image_b64", "end_image_b64"):
            b64 = req.pop(field)
            if b64:
                try:
                    buf = base64.b64decode(b64, validate=True)
                except Exception:
                    raise _bad("invalid_reference_image", f"{field} is not base64")
                kind = _image_kind(buf)
                if len(buf) > MAX_IMAGE_BYTES or not kind:
                    raise _bad("invalid_reference_image", f"{field} must be png/jpg/webp <= 8MB")
                digest = hashlib.sha256(buf).hexdigest()
                (self.data / "inputs" / f"{digest}.{kind}").write_bytes(buf)
                req[field.replace("_b64", "_sha256")] = f"{digest}.{kind}"
        try:
            return self.store.submit(req)
        except IdempotencyConflict:
            raise HTTPException(409, "idempotency_key reused with a different request")

    # ── worker ───────────────────────────────────────────────────────────
    def run_one(self) -> bool:
        job = self.store.claim_next()
        if not job:
            return False
        req = self.store.get_request(job["id"])
        p = self.profiles[job["profile"]]
        start_image = str(self.data / "inputs" / req["start_image_sha256"]) if req.get("start_image_sha256") else None
        t0 = time.time()
        tmp = tempfile.mkdtemp(prefix="forge-")
        out_tmp = os.path.join(tmp, "out.mp4")
        try:
            # Test-only: render ANY profile with the CPU mock so the nickstire
            # client can be exercised end-to-end over real HTTP without a GPU.
            # Honoured only alongside FORGE_ALLOW_UNAPPROVED_FOR_TESTS=1.
            backend_name = p["backend"]
            if self.allow_unapproved and os.environ.get("FORGE_BACKEND_OVERRIDE"):
                backend_name = os.environ["FORGE_BACKEND_OVERRIDE"]
            backend = get_backend(backend_name)
            self.loaded_backends.add(backend_name)
            res = backend.render(p, req, out_tmp, start_image, lambda prog: self.store.heartbeat(job["id"], prog))
            probe = ffprobe(out_tmp)
            problems = []
            if probe["codec"] != "h264":
                problems.append(f"codec {probe['codec']}")
            if (probe["width"], probe["height"]) != (req["width"], req["height"]):
                problems.append(f"dims {probe['width']}x{probe['height']}")
            if abs(probe["fps"] - req["fps"]) > 0.5:
                problems.append(f"fps {probe['fps']:.2f}")
            if abs(probe["duration"] - req["duration_seconds"]) > 0.75:
                problems.append(f"duration {probe['duration']:.2f}s")
            if problems:
                raise BackendError("output_validation_failure", "; ".join(problems))
            final = self.data / "outputs" / f"{job['id']}.mp4"
            shutil.move(out_tmp, final)
            blob = final.read_bytes()
            output = {
                "sha256": hashlib.sha256(blob).hexdigest(), "bytes": len(blob), "mime": "video/mp4",
                "width": probe["width"], "height": probe["height"], "fps": round(probe["fps"], 3), "duration_seconds": round(probe["duration"], 3),
            }
            # gpu_seconds = wall seconds the GPU was held for this job (what rental bills).
            self.store.succeed(job["id"], output, round(time.time() - t0, 2), self.gpu_type, res.model_version, res.workflow_version, res.seed)
        except BackendError as e:
            self.store.fail(job["id"], e.code, str(e), gpu_seconds=round(time.time() - t0, 2))
        except Exception as e:  # noqa: BLE001 — classify, never crash the worker
            self.store.fail(job["id"], "inference_failure", f"{type(e).__name__}: {e}", gpu_seconds=round(time.time() - t0, 2))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        return True

    def sweep(self) -> None:
        self.store.reclaim_stale(
            {k: v["stale_heartbeat_s"] for k, v in self.profiles.items()},
            {k: v["hard_ceiling_s"] for k, v in self.profiles.items()},
        )

    def loop(self) -> None:
        last_sweep = 0.0
        while not self._stop.is_set():
            self.worker_alive_at = time.time()
            if time.time() - last_sweep > 30:
                self.sweep()
                last_sweep = time.time()
            if not self.run_one():
                self._stop.wait(1.0)

    def health(self) -> dict[str, Any]:
        counts = self.store.counts()
        recent = self.store.recent_terminal(50)
        lat = [r["finished_at"] - r["started_at"] for r in recent if r["status"] == "succeeded" and r["started_at"] and r["finished_at"]]
        worker_ok = self.worker_alive_at is not None and time.time() - self.worker_alive_at < 120
        return {
            "status": "ready" if worker_ok else "degraded",
            "worker_alive": worker_ok,
            "gpu_type": self.gpu_type,
            "vram": _vram() or "UNKNOWN",
            "queue_depth": counts.get("queued", 0),
            "running": counts.get("running", 0),
            "loaded_backends": sorted(self.loaded_backends) or "UNKNOWN (cold)",
            "recent_success_rate": (sum(r["status"] == "succeeded" for r in recent) / len(recent)) if recent else "UNKNOWN",
            "p50_latency_s": statistics.median(lat) if lat else "UNKNOWN",
            "p95_latency_s": (sorted(lat)[max(0, int(len(lat) * 0.95) - 1)] if lat else "UNKNOWN"),
            "recovered_on_boot": self.recovered,
            "profiles": {k: {"license_state": v["license_state"], "rollout": v["rollout"], "enabled": k in self.enabled} for k, v in self.profiles.items()},
        }


def _detect_gpu() -> str | None:
    try:
        r = subprocess.run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"], capture_output=True, text=True, timeout=5)
        return r.stdout.strip().splitlines()[0] if r.returncode == 0 and r.stdout.strip() else None
    except Exception:
        return None


def _vram() -> str | None:
    try:
        r = subprocess.run(["nvidia-smi", "--query-gpu=memory.used,memory.total", "--format=csv,noheader"], capture_output=True, text=True, timeout=5)
        return r.stdout.strip() if r.returncode == 0 else None
    except Exception:
        return None


def create_app(start_worker: bool = True) -> FastAPI:
    forge = Forge()
    app = FastAPI(title="NOUR Video Forge", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.forge = forge

    @app.middleware("http")
    async def auth(request: Request, call_next):
        body = await request.body()
        try:
            forge.verify(request.method, request.url.path, request.headers.get("x-forge-timestamp"), request.headers.get("x-forge-signature"), body)
        except HTTPException as e:
            return JSONResponse({"detail": e.detail}, status_code=e.status_code)
        return await call_next(request)

    @app.exception_handler(HTTPException)
    async def http_exc(_: Request, e: HTTPException):
        if isinstance(e.detail, dict):
            return JSONResponse(e.detail, status_code=e.status_code)
        return JSONResponse({"detail": e.detail}, status_code=e.status_code)

    @app.post("/v1/jobs")
    async def submit(body: SubmitBody):
        job, created = forge.submit(body)
        return JSONResponse({"job": view(job), "created": created}, status_code=202 if created else 200)

    @app.get("/v1/jobs/{job_id}")
    async def get_job(job_id: str):
        job = forge.store.get(job_id)
        if not job:
            raise HTTPException(404, "not found")
        return {"job": view(job)}

    @app.get("/v1/jobs/{job_id}/output")
    async def output(job_id: str):
        job = forge.store.get(job_id)
        if not job or job["status"] != "succeeded":
            raise HTTPException(404, "no output")
        return FileResponse(forge.data / "outputs" / f"{job_id}.mp4", media_type="video/mp4")

    @app.post("/v1/jobs/{job_id}/cancel")
    async def cancel(job_id: str):
        job = forge.store.cancel(job_id)
        if not job:
            raise HTTPException(404, "not found")
        return {"job": view(job)}

    @app.get("/v1/capabilities")
    async def capabilities():
        return {"profiles": forge.profiles, "enabled": sorted(forge.enabled)}

    @app.get("/health")
    async def health():
        return forge.health()

    if start_worker:
        threading.Thread(target=forge.loop, name="forge-worker", daemon=True).start()
    return app


app = create_app(start_worker=os.environ.get("FORGE_START_WORKER", "1") == "1") if os.environ.get("FORGE_SECRET") else None
