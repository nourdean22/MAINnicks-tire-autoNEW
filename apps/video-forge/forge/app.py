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
from .model_manifest import ModelManifestError, verify_model_manifest
from .store import IdempotencyConflict, JobStore, view

PROFILES_PATH = Path(__file__).with_name("profiles.json")
APPROVED = {"APPROVED_COMMERCIAL", "APPROVED_WITH_CONDITIONS"}
MAX_IMAGE_BYTES = 8 * 1024 * 1024
# Two base64 images at the cap (4/3 expansion) plus JSON headroom.
MAX_BODY_BYTES = 2 * (MAX_IMAGE_BYTES * 4 // 3 + 4) + 64 * 1024
MIN_SECRET_LEN = 32
# Backends that actually pass an end frame to the model. None do yet.
END_FRAME_BACKENDS: frozenset[str] = frozenset()


def _size_problem(p: dict[str, Any], width: int, height: int) -> str | None:
    """Per-backend size rule, checked at submit so a bad size never claims the GPU.

    A global multiple-of-32 rule rejected Wan i2v-A14B's only portrait size
    (720*1280: 720 % 32 == 16) while letting LTX sizes through that its two-stage
    pipeline refuses (it needs multiples of 64)."""
    if p["backend"] == "wan22":
        from .backends.wan22 import SIZES
        allowed = SIZES.get(p["pipeline"], set())
        return None if (width, height) in allowed else f"{p['pipeline']} supports {sorted(allowed)}"
    step = 64 if p["backend"] == "ltx2" else 32
    return None if not (width % step or height % step) else f"width/height must be multiples of {step}"
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


def _verify_enabled_model_artifacts(
    profiles: dict[str, dict[str, Any]],
    enabled: set[str],
) -> None:
    """Fail closed before serving paid backends unless mounted bytes prove provenance."""
    if os.environ.get("FORGE_REQUIRE_VERIFIED_MODELS") != "1":
        return
    for profile_id in enabled:
        profile = profiles.get(profile_id)
        if not profile or profile.get("backend") not in {"wan22", "ltx2"}:
            continue
        if profile_id != "wan2.2-ti2v-5b":
            raise RuntimeError(
                f"profile {profile_id} has no verified runtime artifact contract; disable it until exact pins are added"
            )
        expected = os.environ.get("FORGE_WAN_5B_EXPECTED_REV", "")
        if not expected:
            raise RuntimeError("FORGE_WAN_5B_EXPECTED_REV is required for verified Wan 5B runtime")
        task = profile["pipeline"].replace("-", "_").upper()
        model_dir = Path(
            os.environ.get(
                f"FORGE_WAN_CKPT_{task}",
                f"/models/{profile['checkpoint'].split('/')[-1]}",
            )
        )
        try:
            manifest = verify_model_manifest(
                model_dir,
                expected_repo=profile["checkpoint"],
                expected_revision=expected,
            )
        except ModelManifestError as exc:
            raise RuntimeError(f"verified model startup failed for {profile_id}: {exc}") from exc
        # Attribution is derived from verified mounted bytes, never a build argument alone.
        os.environ["FORGE_WAN_REV"] = str(manifest["revision"])


class Forge:
    def __init__(self) -> None:
        self.secret = os.environ.get("FORGE_SECRET", "")
        # A short shared secret is a guessable one. Refuse to serve rather than accept it.
        self.secret_too_short = 0 < len(self.secret) < MIN_SECRET_LEN
        data = Path(os.environ.get("FORGE_DATA_DIR", "/data/forge"))
        (data / "outputs").mkdir(parents=True, exist_ok=True)
        (data / "inputs").mkdir(parents=True, exist_ok=True)
        self.data = data
        self.store = JobStore(str(data / "forge.db"), max_restarts=int(os.environ.get("FORGE_MAX_RESTARTS", "2")))
        self.profiles = load_profiles()
        self.allow_unapproved = os.environ.get("FORGE_ALLOW_UNAPPROVED_FOR_TESTS") == "1"
        enabled = os.environ.get("FORGE_ENABLED_PROFILES")
        self.enabled = {p.strip() for p in enabled.split(",") if p.strip()} if enabled else set(self.profiles)
        _verify_enabled_model_artifacts(self.profiles, self.enabled)
        self.gpu_type = os.environ.get("FORGE_GPU_TYPE") or _detect_gpu() or "UNKNOWN"
        self.recovered = self.store.recover_after_restart()
        self._stop = threading.Event()
        self.worker_alive_at: float | None = None
        self.loaded_backends: set[str] = set()
        self.last_loop_error: str | None = None
        self._seen: dict[str, float] = {}
        self._seen_lock = threading.Lock()

    # ── auth ─────────────────────────────────────────────────────────────
    def verify(self, method: str, path: str, ts: str | None, sig: str | None, body: bytes) -> None:
        if not self.secret:
            raise HTTPException(503, "FORGE_SECRET not configured — refusing all requests")
        if self.secret_too_short:
            raise HTTPException(503, f"FORGE_SECRET shorter than {MIN_SECRET_LEN} chars — refusing all requests")
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
        # Replay: reject duplicate signatures for non-idempotent POST actions.
        # POST /v1/jobs is deliberately exempt: its idempotency_key + request fingerprint
        # are the replay guard, and honest network retries can produce the same HMAC inside
        # one second. Blocking those here defeats the endpoint's retry contract.
        # GETs are read-only, and two honest identical GETs in one second sign identically.
        if method != "POST" or path == "/v1/jobs":
            return
        now = time.time()
        with self._seen_lock:
            for old_sig, at in list(self._seen.items()):
                if now - at > 600:
                    del self._seen[old_sig]
            if sig in self._seen:
                raise HTTPException(401, "replayed signature")
            self._seen[sig] = now

    # ── submit ───────────────────────────────────────────────────────────
    def submit(self, body: SubmitBody) -> tuple[dict[str, Any], bool]:
        p = self.profiles.get(body.profile)
        if not p or body.profile not in self.enabled:
            raise _bad("config_unavailable", f"profile {body.profile} not available on this worker")
        # TERRITORY_BLOCKED is a legal fact, not a rollout state: no test flag lifts it.
        if p["license_state"] == "TERRITORY_BLOCKED" or (p["license_state"] not in APPROVED and not self.allow_unapproved):
            raise _bad("license_blocked", f"profile {body.profile} license_state={p['license_state']}", status=403)
        if body.duration_seconds not in p["durations"]:
            raise _bad("unsupported_duration", f"{body.duration_seconds}s not in {p['durations']}")
        if max(body.width, body.height) > p["max_long"] or min(body.width, body.height) > p["max_short"]:
            raise _bad("unsupported_resolution", f"{body.width}x{body.height}")
        if p.get("fixed_fps") and body.fps != p["native"]["fps"]:
            raise _bad("unsupported_fps", f"{body.profile} renders at {p['native']['fps']} fps only")
        size_problem = _size_problem(p, body.width, body.height)
        if size_problem:
            raise _bad("unsupported_resolution", size_problem)
        if not body.start_image_b64 and not p.get("t2v", True):
            raise _bad("capability_mismatch", "profile is image-to-video only; start_image_b64 is required")
        if body.start_image_b64 and not p["i2v"]:
            raise _bad("capability_mismatch", "profile has no image-to-video")
        if body.end_image_b64 and not p["first_last"]:
            raise _bad("capability_mismatch", "profile has no first+last frame conditioning")
        if body.end_image_b64 and p["backend"] not in END_FRAME_BACKENDS:
            # The model may support it, but no backend passes the end frame through yet:
            # accepting it would render a clip that ignores it and still report success.
            raise _bad("capability_mismatch", f"end-frame conditioning is not wired for backend {p['backend']}")
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
        try:
            req = self.store.get_request(job["id"])
            p = self.profiles[job["profile"]]
        except Exception as e:  # noqa: BLE001 — a bad row must fail the job, not kill the worker thread
            self.store.fail(job["id"], "config_unavailable", f"cannot load job: {type(e).__name__}: {e}")
            return True
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
        # The worker is a daemon thread: an uncaught exception kills it silently, the
        # job it held stays 'running', and the sweep that would reclaim it lived in the
        # same dead loop. Every iteration is guarded; health reports a stuck worker.
        last_sweep = 0.0
        while not self._stop.is_set():
            self.worker_alive_at = time.time()
            try:
                if time.time() - last_sweep > 30:
                    last_sweep = time.time()
                    self.sweep()
                if not self.run_one():
                    self._stop.wait(1.0)
            except Exception as e:  # noqa: BLE001
                self.last_loop_error = f"{type(e).__name__}: {e}"[:300]
                self._stop.wait(5.0)

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
            "last_loop_error": self.last_loop_error,
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
        if request.url.path == "/livez":
            # Unauthenticated liveness for container probes: says nothing but "process up".
            return JSONResponse({"ok": True})
        # Reject BEFORE buffering the body: an unsigned request must not be able to
        # make the server read gigabytes into memory.
        if not request.headers.get("x-forge-signature") or not request.headers.get("x-forge-timestamp"):
            return JSONResponse({"detail": "missing signature"}, status_code=401)
        try:
            declared = int(request.headers.get("content-length") or 0)
        except ValueError:
            return JSONResponse({"detail": "bad content-length"}, status_code=400)
        if declared > MAX_BODY_BYTES:
            return JSONResponse({"detail": "body too large"}, status_code=413)
        body = await request.body()
        if len(body) > MAX_BODY_BYTES:
            return JSONResponse({"detail": "body too large"}, status_code=413)
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


# Modal imports this module as a factory, then calls create_app() itself. In that
# path FORGE_FACTORY_ONLY=1 prevents import-time construction of a second Forge
# (and a second full mounted-checkpoint verification) on every cold start.
app = (
    create_app(start_worker=os.environ.get("FORGE_START_WORKER", "1") == "1")
    if os.environ.get("FORGE_SECRET") and os.environ.get("FORGE_FACTORY_ONLY") != "1"
    else None
)
