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
- First canary pins the 40GB A100 + upstream offload path; later LTX quality proof uses 80GB.
"""
import modal

# Built FROM THE SAME Dockerfile as the RunPod image. The first version installed
# only fastapi/uvicorn/pydantic, so every LTX/Wan job would have died with
# "No module named ltx_pipelines" / "generate.py not found". Pin the model code:
#   LTX2_REF=<sha> WAN22_REF=<sha> modal deploy apps/video-forge/modal_app.py
import os as _os

from scripts.canary_config import load_profile_registry, validate_enabled_profiles

LTX_CODE_REF = _os.environ.get("LTX2_REF", "UNPINNED")
WAN_CODE_REF = _os.environ.get("WAN22_REF", "UNPINNED")
WAN_5B_REVISION = "921dbaf3f1674a56f47e83fb80a34bac8a8f203e"
INSTALL_LTX = _os.environ.get("FORGE_INSTALL_LTX", "1")
INSTALL_WAN = _os.environ.get("FORGE_INSTALL_WAN", "1")
ENABLED_PROFILES = _os.environ.get("FORGE_ENABLED_PROFILES", "wan2.2-ti2v-5b")

_profile_registry = load_profile_registry()
_enabled = validate_enabled_profiles(
    ENABLED_PROFILES,
    INSTALL_LTX,
    INSTALL_WAN,
    profiles=_profile_registry,
)

image = modal.Image.from_dockerfile(
    "apps/video-forge/Dockerfile",
    context_dir="apps/video-forge",
    build_args={
        "LTX2_REF": LTX_CODE_REF,
        "WAN22_REF": WAN_CODE_REF,
        "WAN22_WEIGHT_REV": WAN_5B_REVISION,
        # Build and expose only what this deployment is prepared to serve.
        "INSTALL_LTX": INSTALL_LTX,
        "INSTALL_WAN": INSTALL_WAN,
        "ENABLED_PROFILES": ENABLED_PROFILES,
    },
)
models = modal.Volume.from_name("video-forge-models", create_if_missing=True)
data = modal.Volume.from_name("video-forge-data", create_if_missing=True)
app = modal.App("nour-video-forge", image=image)

# Weights fetch runs on a tiny CPU image — never on the GPU image or a GPU.
fetch_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("huggingface_hub>=0.24,<1")
    .add_local_python_source("scripts.write_model_manifest", "forge.model_manifest")
)

# Wan 2.2 TI2V-5B: Apache-2.0, ungated. Revision pinned (HF commit) so a canary is reproducible.
WAN_5B = {"repo": "Wan-AI/Wan2.2-TI2V-5B", "revision": WAN_5B_REVISION, "dir": "/models/Wan2.2-TI2V-5B"}


@app.function(image=fetch_image, volumes={"/models": models}, timeout=2 * 60 * 60, cpu=2.0, memory=4096)
def fetch_wan_5b() -> dict:
    """Download the pinned Wan 5B checkpoint and hash every inference-visible artifact.

    Skips upstream docs/example images and Hugging Face's local transport cache.
    Idempotent: hf_hub skips files already present.
    """
    import pathlib

    from huggingface_hub import snapshot_download
    from scripts.write_model_manifest import write_manifest

    root = pathlib.Path(WAN_5B["dir"])
    snapshot_download(
        WAN_5B["repo"], revision=WAN_5B["revision"], local_dir=str(root),
        ignore_patterns=["assets/*", "examples/*", "*.md", ".msc", ".mv"],
    )
    manifest = write_manifest(root, WAN_5B["repo"], WAN_5B["revision"])
    models.commit()
    return {
        "files": len(manifest["files"]),
        "bytes": manifest["total_bytes"],
        "revision": WAN_5B["revision"],
    }


@app.function(
    # Pin the exact 40 GB SKU for reproducible first-canary behavior. Modal also accepts "A100".
    gpu=_os.environ.get("FORGE_MODAL_GPU", "A100-40GB"),
    # Wan 5B's low-VRAM path offloads the model/T5 to host RAM; reserve it explicitly.
    cpu=float(_os.environ.get("FORGE_MODAL_CPU", "4")),
    memory=int(_os.environ.get("FORGE_MODAL_MEMORY_MB", "98304")),
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
    # This module owns ASGI construction on Modal. Prevent forge.app from also
    # creating its module-level app during the factory import (which would hash
    # the full mounted checkpoint and open the job store a second time).
    os.environ["FORGE_FACTORY_ONLY"] = "1"
    os.environ.setdefault("FORGE_ENABLED_PROFILES", ENABLED_PROFILES)
    os.environ.setdefault("FORGE_REQUIRE_VERIFIED_MODELS", "1")
    os.environ.setdefault("FORGE_WAN_5B_EXPECTED_REV", WAN_5B["revision"])
    if WAN_CODE_REF != "UNPINNED":
        os.environ.setdefault("FORGE_WAN22_CODE_REV", WAN_CODE_REF)
    if LTX_CODE_REF != "UNPINNED":
        os.environ.setdefault("FORGE_LTX2_CODE_REV", LTX_CODE_REF)
    from forge.app import create_app

    return create_app(start_worker=True)
