"""Wan 2.2 backend (official generate.py): TI2V-5B economy, I2V-A14B quality.

Verified against upstream on 2026-10-03 (https://github.com/Wan-Video/Wan2.2):
  - SUPPORTED_SIZES: ti2v-5B {704*1280, 1280*704}; i2v-A14B {720*1280, 1280*720, 480*832, 832*480}
    (width*height, so portrait is "704*1280" / "720*1280")
  - ti2v-5B: 24 fps, 121 frames; A14B: 16 fps, 81 frames (shared config)
  - single-GPU low-VRAM flags: 5B `--offload_model True --convert_model_dtype --t5_cpu`,
    14B `--offload_model True --convert_model_dtype`; drop them on >= 80GB for speed.
FORGE_WAN_EXTRA overrides those flags. Argv is a list — the prompt is never shell-parsed.
"""
from __future__ import annotations

import os
import shlex
import subprocess
from typing import Any

from .base import Backend, BackendError, Heartbeat, RenderResult, _seed, run_supervised

SIZES = {"ti2v-5B": {(704, 1280), (1280, 704)}, "i2v-A14B": {(720, 1280), (1280, 720), (480, 832), (832, 480)}}
LOW_VRAM = {"ti2v-5B": "--offload_model True --convert_model_dtype --t5_cpu", "i2v-A14B": "--offload_model True --convert_model_dtype"}


def _vram_gb() -> float | None:
    """FORGE_GPU_VRAM_GB if set, else the card's total memory from nvidia-smi, else None."""
    raw = os.environ.get("FORGE_GPU_VRAM_GB")
    if raw:
        try:
            return float(raw)
        except ValueError:
            return None
    try:
        r = subprocess.run(["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
                           capture_output=True, text=True, timeout=5)
        return float(r.stdout.strip().splitlines()[0]) / 1024 if r.returncode == 0 and r.stdout.strip() else None
    except Exception:  # noqa: BLE001 — no driver / no binary: unknown
        return None


def build_argv(profile: dict[str, Any], req: dict[str, Any], out_path: str, start_image: str | None) -> list[str]:
    task = profile["pipeline"]
    if (req["width"], req["height"]) not in SIZES.get(task, set()):
        raise BackendError("unsupported_resolution", f"{task} supports {sorted(SIZES.get(task, set()))}")
    if task.startswith("i2v") and not start_image:
        raise BackendError("capability_mismatch", f"{task} is image-to-video only; a start image is required")
    frames = (int(req["duration_seconds"] * req["fps"]) // 4) * 4 + 1  # Wan: 4k+1
    wan_dir = os.environ.get("FORGE_WAN_DIR", "/opt/Wan2.2")
    ckpt = os.environ.get(f"FORGE_WAN_CKPT_{task.replace('-', '_').upper()}", f"/models/{profile['checkpoint'].split('/')[-1]}")
    runner = shlex.split(os.environ.get("FORGE_WAN_RUNNER", "python"))
    extra = os.environ.get("FORGE_WAN_EXTRA")
    if extra is None:
        vram = _vram_gb()
        # Unknown VRAM takes the low-memory path: an assumed 80GB card OOMs the
        # first render on a 24/48GB rental, the slow path merely runs slower.
        extra = "" if vram is not None and vram >= 78 else LOW_VRAM.get(task, "")  # "80GB" cards report 79.6 GiB
    argv = [*runner, os.path.join(wan_dir, "generate.py"), "--task", task, "--size", f"{req['width']}*{req['height']}",
            "--ckpt_dir", ckpt, "--frame_num", str(frames), "--base_seed", str(_seed(req))]
    argv += shlex.split(extra)
    if start_image:
        argv += ["--image", start_image]
    argv += ["--save_file", out_path, "--prompt", req["prompt"]]
    return argv


class Wan22Backend(Backend):
    name = "wan22"

    def render(self, profile: dict[str, Any], req: dict[str, Any], out_path: str, start_image: str | None, heartbeat: Heartbeat) -> RenderResult:
        argv = build_argv(profile, req, out_path, start_image)
        run_supervised(argv, heartbeat, timeout_s=profile["hard_ceiling_s"], cwd=os.environ.get("FORGE_WAN_DIR", "/opt/Wan2.2"))
        if not os.path.exists(out_path):
            raise BackendError("output_validation_failure", "generate.py exited 0 but wrote no file")
        return RenderResult(
            seed=_seed(req),
            model_version=f"{profile['checkpoint']}@{os.environ.get('FORGE_WAN_REV', 'unpinned')}",
            workflow_version=f"wan22-generate:{profile['pipeline']}@{os.environ.get('FORGE_WAN22_CODE_REV', 'unpinned')}",
        )
