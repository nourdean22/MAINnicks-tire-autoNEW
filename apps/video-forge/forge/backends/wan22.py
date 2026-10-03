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
from typing import Any

from .base import Backend, BackendError, Heartbeat, RenderResult, run_supervised

SIZES = {"ti2v-5B": {(704, 1280), (1280, 704)}, "i2v-A14B": {(720, 1280), (1280, 720), (480, 832), (832, 480)}}
LOW_VRAM = {"ti2v-5B": "--offload_model True --convert_model_dtype --t5_cpu", "i2v-A14B": "--offload_model True --convert_model_dtype"}


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
        try:
            vram = int(os.environ.get("FORGE_GPU_VRAM_GB", "80"))
        except ValueError:
            vram = 0  # unknown VRAM: take the safe low-memory path
        extra = "" if vram >= 80 else LOW_VRAM.get(task, "")
    argv = [*runner, os.path.join(wan_dir, "generate.py"), "--task", task, "--size", f"{req['width']}*{req['height']}",
            "--ckpt_dir", ckpt, "--frame_num", str(frames), "--base_seed", str(int(req.get("seed") or 42))]
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
            seed=int(req.get("seed") or 42),
            model_version=f"{profile['checkpoint']}@{os.environ.get('FORGE_WAN_REV', 'unpinned')}",
            workflow_version=f"wan22-generate:{profile['pipeline']}@{os.environ.get('FORGE_WAN22_CODE_REV', 'unpinned')}",
        )
