"""Modal deployment of NOUR Video Forge (scale-to-zero option).

STATUS: BUILT, NOT DEPLOYED (no spend authorized 2026-10-03). Mirrors the
repo's existing Modal pattern (apps/nickstire/scripts/training/modal_finetune_nickgpt.py).

    modal secret create video-forge FORGE_SECRET=...
    modal deploy apps/video-forge/modal_app.py

Design notes:
- ONE container (max_containers=1) owns the SQLite job store on a Modal Volume, so
  idempotency and restart recovery hold exactly as on RunPod. Scale-out would need
  the store moved to Postgres first — do not raise max_containers before that.
- scaledown_window keeps the model warm between beats of the same reel; the
  cold-start cost is measured in the bake-off, not assumed.
- UNVERIFIED: Modal Volumes persist on commit/reload, and SQLite WAL on a
  network volume is not a proven combination. The canary must test a forced
  container restart mid-render; if recovery fails, keep the DB on local disk
  and checkpoint it, or move the store to Postgres.
- 80GB GPU first (quality proof without FP8/offload confounders).
"""
import modal

image = (
    modal.Image.from_registry("nvidia/cuda:12.8.0-cudnn-runtime-ubuntu24.04", add_python="3.12")
    .apt_install("git", "ffmpeg")
    .pip_install("fastapi>=0.115,<1", "uvicorn>=0.30,<1", "pydantic>=2.7,<3")
    .add_local_dir("apps/video-forge/forge", "/srv/forge")
)
models = modal.Volume.from_name("video-forge-models", create_if_missing=True)
data = modal.Volume.from_name("video-forge-data", create_if_missing=True)
app = modal.App("nour-video-forge", image=image)


@app.function(
    gpu="A100-80GB",
    volumes={"/models": models, "/data": data},
    secrets=[modal.Secret.from_name("video-forge")],
    max_containers=1,
    scaledown_window=300,
    timeout=60 * 60,
)
@modal.asgi_app()
def forge():
    import os
    import sys

    sys.path.insert(0, "/srv")
    os.environ.setdefault("FORGE_DATA_DIR", "/data/forge")
    from forge.app import create_app

    return create_app(start_worker=True)
