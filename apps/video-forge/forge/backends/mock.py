"""CPU test backend: an ffmpeg test pattern at the requested shape.

Exists so the whole contract (auth, idempotency, heartbeats, cancel, restart
recovery, output verification, nickstire re-hosting) is exercised in CI without
a GPU. It is license_state UNKNOWN in the registry, so it can never serve a
production reel.
"""
from __future__ import annotations

import subprocess
from typing import Any

from .base import Backend, BackendError, Heartbeat, RenderResult


class MockBackend(Backend):
    name = "mock"

    def render(self, profile: dict[str, Any], req: dict[str, Any], out_path: str, start_image: str | None, heartbeat: Heartbeat) -> RenderResult:
        if not heartbeat(0.1):
            raise BackendError("cancelled", "cancelled before render")
        w, h, d, fps = req["width"], req["height"], req["duration_seconds"], req["fps"]
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", f"testsrc2=size={w}x{h}:rate={fps}:duration={d}",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out_path,
        ]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            raise BackendError("inference_failure", r.stderr[-400:])
        heartbeat(0.9)
        return RenderResult(seed=req.get("seed"), model_version="mock-testpattern@1", workflow_version="ffmpeg-testsrc2@1")
