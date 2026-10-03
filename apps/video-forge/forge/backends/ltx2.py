"""LTX-2.5 backend (Lightricks official pipelines) — UNVERIFIED until a GPU canary.

STATUS: BUILT-UNWIRED to hardware. No GPU spend was authorized when this was
written (2026-10-03), so the exact CLI below has not been executed. The command is
a template read from FORGE_LTX_CMD so the canary can correct it without a code
change; the default follows the upstream repo's documented pipeline modules
(https://github.com/Lightricks/LTX-2). Verify on an 80GB GPU first (no FP8 /
offload) so precision is not a confounder, then pin the checkpoint sha256 in
profiles.json + mediaModelRegistry.ts.

Placeholders: {pipeline} {prompt_file} {negative_file} {image} {width} {height}
{frames} {fps} {seed} {out}
"""
from __future__ import annotations

import os
import shlex
import tempfile
from pathlib import Path
from typing import Any

from .base import Backend, BackendError, Heartbeat, RenderResult, run_supervised

DEFAULT_CMD = (
    "python -m ltx_pipelines.{pipeline} --prompt-file {prompt_file} --negative-prompt-file {negative_file} "
    "{image_flag} --width {width} --height {height} --num-frames {frames} --frame-rate {fps} --seed {seed} --output {out}"
)


class Ltx2Backend(Backend):
    name = "ltx2"

    def render(self, profile: dict[str, Any], req: dict[str, Any], out_path: str, start_image: str | None, heartbeat: Heartbeat) -> RenderResult:
        template = os.environ.get("FORGE_LTX_CMD", DEFAULT_CMD)
        seed = int(req.get("seed") or 42)
        # LTX frame counts are 8k+1.
        frames = (int(req["duration_seconds"] * req["fps"]) // 8) * 8 + 1
        with tempfile.TemporaryDirectory() as td:
            pf = os.path.join(td, "prompt.txt")
            nf = os.path.join(td, "negative.txt")
            Path(pf).write_text(req["prompt"])
            Path(nf).write_text(req.get("negative_prompt") or "")
            cmd = template.format(
                pipeline=profile["pipeline"], prompt_file=shlex.quote(pf), negative_file=shlex.quote(nf),
                image_flag=f"--image {shlex.quote(start_image)}" if start_image else "",
                width=req["width"], height=req["height"], frames=frames, fps=req["fps"], seed=seed, out=shlex.quote(out_path),
            )
            run_supervised(shlex.split(cmd), heartbeat, timeout_s=profile["hard_ceiling_s"])
        if not os.path.exists(out_path):
            raise BackendError("output_validation_failure", "pipeline exited 0 but wrote no file")
        return RenderResult(seed=seed, model_version=f"{profile['checkpoint']}:{profile['pipeline']}", workflow_version=os.environ.get("FORGE_LTX_WORKFLOW_VERSION", "ltx2-cli@unverified"))
