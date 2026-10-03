"""Backend contract. A backend turns one validated request into one MP4 on disk.

Backends are internal: nickstire never sees node IDs, workflow JSON, CLI flags or
checkpoint paths. Swapping a direct pipeline for a pinned ComfyUI graph (or a new
model) is a backend change only.
"""
from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from typing import Any, Callable

Heartbeat = Callable[[float | None], bool]  # returns False => cancellation requested


class BackendError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass
class RenderResult:
    seed: int | None
    model_version: str
    workflow_version: str


OOM_RE = re.compile(r"(CUDA out of memory|OutOfMemoryError|torch\.OutOfMemoryError)", re.I)
LOAD_RE = re.compile(r"(No such file or directory.*(ckpt|safetensors)|Error\(s\) in loading state_dict|checkpoint not found|FileNotFoundError)", re.I)


def classify_stderr(stderr: str) -> str:
    if OOM_RE.search(stderr):
        return "oom"
    if LOAD_RE.search(stderr):
        return "model_load_failure"
    return "inference_failure"


def _seed(req: dict[str, Any]) -> int:
    """`seed or 42` turned a requested seed of 0 into 42; only a MISSING seed defaults."""
    seed = req.get("seed")
    return 42 if seed is None else int(seed)


def run_supervised(cmd: list[str], heartbeat: Heartbeat, timeout_s: float, env: dict[str, str] | None = None, cwd: str | None = None) -> None:
    """Run a generator subprocess, heartbeating every few seconds; kill on cancel/timeout."""
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env, cwd=cwd if cwd and os.path.isdir(cwd) else None)
    waited = 0.0
    while True:
        try:
            _, err = proc.communicate(timeout=5)
            break
        except subprocess.TimeoutExpired:
            waited += 5
            if not heartbeat(None):
                proc.kill()
                proc.communicate()
                raise BackendError("cancelled", "cancelled during render")
            if waited > timeout_s:
                proc.kill()
                proc.communicate()
                raise BackendError("hard_ceiling", f"render exceeded {int(timeout_s)}s")
    if proc.returncode != 0:
        tail = (err or "")[-2000:]
        raise BackendError(classify_stderr(tail), tail[-500:] or f"exit {proc.returncode}")


class Backend:
    name = "base"

    def render(self, profile: dict[str, Any], req: dict[str, Any], out_path: str, start_image: str | None, heartbeat: Heartbeat) -> RenderResult:  # pragma: no cover
        raise NotImplementedError


def get_backend(name: str) -> Backend:
    if name == "mock":
        from .mock import MockBackend
        return MockBackend()
    if name == "ltx2":
        from .ltx2 import Ltx2Backend
        return Ltx2Backend()
    if name == "wan22":
        from .wan22 import Wan22Backend
        return Wan22Backend()
    raise BackendError("config_unavailable", f"no backend '{name}' in this build")
