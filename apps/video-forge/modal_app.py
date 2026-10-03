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

# Built FROM THE SAME Dockerfile as the RunPod image. The first version installed
# only fastapi/uvicorn/pydantic, so every LTX/Wan job would have died with
# "No module named ltx_pipelines" / "generate.py not found". Pin the model code:
#   LTX2_REF=<sha> WAN22_REF=<sha> modal deploy apps/video-forge/modal_app.py
import os as _os

image = modal.Image.from_dockerfile(
    "apps/video-forge/Dockerfile",
    context_dir="apps/video-forge",
    build_args={
        "LTX2_REF": _os.environ.get("LTX2_REF", "UNPINNED"),
        "WAN22_REF": _os.environ.get("WAN22_REF", "UNPINNED"),
        # Build only what is being served (FORGE_INSTALL_LTX=0 for a Wan-only canary).
        "INSTALL_LTX": _os.environ.get("FORGE_INSTALL_LTX", "1"),
        "INSTALL_WAN": _os.environ.get("FORGE_INSTALL_WAN", "1"),
    },
)
models = modal.Volume.from_name("video-forge-models", create_if_missing=True)
data = modal.Volume.from_name("video-forge-data", create_if_missing=True)
app = modal.App("nour-video-forge", image=image)

# Weights fetch runs on a tiny CPU image — never on the GPU image or a GPU.
fetch_image = modal.Image.debian_slim(python_version="3.12").pip_install("huggingface_hub>=0.24,<1")

# Wan 2.2 TI2V-5B: Apache-2.0, ungated. Revision pinned (HF commit) so a canary is reproducible.
WAN_5B = {"repo": "Wan-AI/Wan2.2-TI2V-5B", "revision": "921dbaf3f1674a56f47e83fb80a34bac8a8f203e", "dir": "/models/Wan2.2-TI2V-5B"}


@app.function(image=fetch_image, volumes={"/models": models}, timeout=2 * 60 * 60, cpu=2.0, memory=4096)
def fetch_wan_5b() -> dict:
    """Download the pinned Wan 5B weights into the models volume and record sha256s.

    Skips the repo's docs/example images. Idempotent: hf_hub skips files already present.
    """
    import hashlib
    import pathlib

    from huggingface_hub import snapshot_download

    snapshot_download(
        WAN_5B["repo"], revision=WAN_5B["revision"], local_dir=WAN_5B["dir"],
        ignore_patterns=["assets/*", "examples/*", "*.md", ".msc", ".mv"],
    )
    sums = {}
    for f in sorted(pathlib.Path(WAN_5B["dir"]).rglob("*")):
        if f.is_file() and f.suffix in (".safetensors", ".pth"):
            h = hashlib.sha256()
            with open(f, "rb") as fh:
                for chunk in iter(lambda: fh.read(1 << 24), b""):
                    h.update(chunk)
            sums[str(f)] = h.hexdigest()
    pathlib.Path(WAN_5B["dir"], "SHA256SUMS").write_text("".join(f"{v}  {k}\n" for k, v in sums.items()))
    models.commit()
    return {"files": len(sums), "bytes": sum(pathlib.Path(k).stat().st_size for k in sums)}


@app.function(
    # 80GB is the LTX quality baseline; a Wan 5B canary fits a 40GB card (FORGE_MODAL_GPU=A100-40GB).
    gpu=_os.environ.get("FORGE_MODAL_GPU", "A100-80GB"),
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
