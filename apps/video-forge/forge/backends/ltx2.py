"""LTX-2.5 backend (Lightricks official ltx_pipelines CLIs).

Command shape verified against the upstream README + utils/args.py on
2026-10-03 (https://github.com/Lightricks/LTX-2):

    uv run python -m ltx_pipelines.distilled | ltx_pipelines.dfr_pipeline
        --transformer-path  diffusion_models/ltx-2.5-22b-distilled-transformer-bf16.safetensors
        --text-encoder-path text_encoders/gemma4-12b-with-proj-ltx-2.5-bf16.safetensors
        --video-vae-path    vae/ltx-2.5-video-vae-bf16.safetensors
        --audio-vae-path    vae/ltx-2.5-audio-vae-bf16.safetensors
        --spatial-upsampler-path latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors
        [--detailing-lora <LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler repo>/ltx-2.5-22b-ic-lora-pixel-spatial-upscaler-x2-1.0.safetensors]   # DFR only
        --num-frames 8k+1 --height H --width W --frame-rate F --seed S
        [--image PATH FRAME_IDX STRENGTH] --output-path out.mp4 --prompt "..."

DFR uses the SAME distilled transformer plus the detailing IC-LoRA (upstream:
"Do not pass the full (dev) transformer"). Neither pipeline is guided, so no
negative prompt is passed. Two-stage output dims must be divisible by 64.
FORGE_LTX_EXTRA appends flags (e.g. "--quantization fp8-cast --offload cpu" for
<80GB cards). Argv is built as a list — no shell, prompt text is never parsed.
"""
from __future__ import annotations

import os
import shlex
from typing import Any

from .base import Backend, BackendError, Heartbeat, RenderResult, _seed, run_supervised

COMPONENTS = {
    "--transformer-path": "diffusion_models/ltx-2.5-22b-distilled-transformer-bf16.safetensors",
    "--text-encoder-path": "text_encoders/gemma4-12b-with-proj-ltx-2.5-bf16.safetensors",
    "--video-vae-path": "vae/ltx-2.5-video-vae-bf16.safetensors",
    "--audio-vae-path": "vae/ltx-2.5-audio-vae-bf16.safetensors",
    "--spatial-upsampler-path": "latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",
}
# The DFR detailing IC-LoRA lives in its OWN Hugging Face repo, not under LTX-2.5/loras/
# (upstream README, 2026-10-03). scripts/fetch_models.sh puts it beside the main weights.
DFR_LORA_DEFAULT = "/models/LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler/ltx-2.5-22b-ic-lora-pixel-spatial-upscaler-x2-1.0.safetensors"
MODULES = {"distilled": "ltx_pipelines.distilled", "dfr": "ltx_pipelines.dfr_pipeline"}


def build_argv(profile: dict[str, Any], req: dict[str, Any], out_path: str, start_image: str | None) -> list[str]:
    models = os.environ.get("FORGE_LTX_MODELS", "/models/LTX-2.5")  # where scripts/fetch_models.sh puts it
    runner = shlex.split(os.environ.get("FORGE_LTX_RUNNER", "uv run --project /opt/LTX-2 python"))
    if req["width"] % 64 or req["height"] % 64:
        raise BackendError("unsupported_resolution", "LTX two-stage output must be divisible by 64")
    frames = (int(req["duration_seconds"] * req["fps"]) // 8) * 8 + 1
    argv = [*runner, "-m", MODULES[profile["pipeline"]]]
    for flag, rel in COMPONENTS.items():
        argv += [flag, os.path.join(models, rel)]
    if profile["pipeline"] == "dfr":
        argv += ["--detailing-lora", os.environ.get("FORGE_LTX_DFR_LORA", DFR_LORA_DEFAULT)]
    argv += [
        "--num-frames", str(frames), "--height", str(req["height"]), "--width", str(req["width"]),
        "--frame-rate", str(req["fps"]), "--seed", str(_seed(req)),
    ]
    if start_image:
        argv += ["--image", start_image, "0", os.environ.get("FORGE_LTX_IMAGE_STRENGTH", "1.0")]
    argv += shlex.split(os.environ.get("FORGE_LTX_EXTRA", ""))
    argv += ["--output-path", out_path, "--prompt", req["prompt"]]
    return argv


class Ltx2Backend(Backend):
    name = "ltx2"

    def render(self, profile: dict[str, Any], req: dict[str, Any], out_path: str, start_image: str | None, heartbeat: Heartbeat) -> RenderResult:
        argv = build_argv(profile, req, out_path, start_image)
        run_supervised(argv, heartbeat, timeout_s=profile["hard_ceiling_s"], cwd=os.environ.get("FORGE_LTX_DIR", "/opt/LTX-2"))
        if not os.path.exists(out_path):
            raise BackendError("output_validation_failure", "pipeline exited 0 but wrote no file")
        return RenderResult(
            seed=_seed(req),
            model_version=f"{profile['checkpoint']}@{os.environ.get('FORGE_LTX_REV', 'unpinned')}:{profile['pipeline']}",
            workflow_version=f"ltx_pipelines.{profile['pipeline']}@{os.environ.get('FORGE_LTX2_CODE_REV', 'unpinned')}",
        )
