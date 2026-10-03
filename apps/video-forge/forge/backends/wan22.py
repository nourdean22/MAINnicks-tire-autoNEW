"""Wan 2.2 TI2V-5B backend (official generate.py) — UNVERIFIED until a GPU canary.

Same status as ltx2.py: written without GPU access; command is overridable via
FORGE_WAN_CMD. Upstream documents `generate.py --task ti2v-5B --size 1280*704`
(portrait 704*1280) and reports a 5 s 720p render in < 9 min on one 24GB GPU
with --offload_model True --convert_model_dtype --t5_cpu
(https://github.com/Wan-Video/Wan2.2).
"""
from __future__ import annotations

import os
import shlex
import tempfile
from typing import Any

from .base import Backend, BackendError, Heartbeat, RenderResult, run_supervised

DEFAULT_CMD = (
    "python {wan_dir}/generate.py --task ti2v-5B --size {width}*{height} --ckpt_dir {ckpt_dir} "
    "--offload_model True --convert_model_dtype --t5_cpu --frame_num {frames} --base_seed {seed} "
    "{image_flag} --prompt {prompt} --save_file {out}"
)


class Wan22Backend(Backend):
    name = "wan22"

    def render(self, profile: dict[str, Any], req: dict[str, Any], out_path: str, start_image: str | None, heartbeat: Heartbeat) -> RenderResult:
        template = os.environ.get("FORGE_WAN_CMD", DEFAULT_CMD)
        seed = int(req.get("seed") or 42)
        frames = (int(req["duration_seconds"] * req["fps"]) // 4) * 4 + 1  # Wan: 4k+1
        cmd = template.format(
            wan_dir=os.environ.get("FORGE_WAN_DIR", "/opt/Wan2.2"), ckpt_dir=os.environ.get("FORGE_WAN_CKPT", "/models/Wan2.2-TI2V-5B"),
            width=req["width"], height=req["height"], frames=frames, seed=seed,
            image_flag=f"--image {shlex.quote(start_image)}" if start_image else "",
            prompt=shlex.quote(req["prompt"]), out=shlex.quote(out_path),
        )
        run_supervised(shlex.split(cmd), heartbeat, timeout_s=profile["hard_ceiling_s"])
        if not os.path.exists(out_path):
            raise BackendError("output_validation_failure", "generate.py exited 0 but wrote no file")
        return RenderResult(seed=seed, model_version=profile["checkpoint"], workflow_version=os.environ.get("FORGE_WAN_WORKFLOW_VERSION", "wan22-generate@unverified"))
