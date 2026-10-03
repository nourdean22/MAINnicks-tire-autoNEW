# NOUR Video Forge — GPU image (RunPod pod / any CUDA host).
# STATUS: BUILT, NOT YET BUILT ON A GPU HOST (no spend authorized 2026-10-03).
# Weights are NOT baked in: mount a persistent volume at /models and run
# scripts/fetch_models.sh once (pinned revisions). Jobs DB + outputs live on
# /data so a container restart recovers in-flight work (store.recover_after_restart).
# -devel, not -runtime: Wan2.2's requirements include flash_attn, which compiles
# against nvcc and an already-installed torch. The runtime image has no nvcc.
FROM nvidia/cuda:12.8.0-cudnn-devel-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv python3-pip python3-dev git ffmpeg ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv
ENV PATH=/opt/venv/bin:/root/.local/bin:$PATH
# uv: the LTX backend runs `uv run --project /opt/LTX-2 python` (FORGE_LTX_RUNNER).
RUN pip install "uv>=0.4,<1"

# Model code at PINNED commits. An unpinned build silently tracks upstream main,
# so it is refused unless ALLOW_UNPINNED=1 is passed on purpose (local experiments).
# INSTALL_LTX / INSTALL_WAN let a canary build only the backend it tests: the LTX
# weights are license-gated on Hugging Face, Wan 2.2 (Apache-2.0) is not.
ARG LTX2_REF=UNPINNED
ARG WAN22_REF=UNPINNED
ARG WAN22_WEIGHT_REV=UNPINNED
ARG ALLOW_UNPINNED=0
ARG INSTALL_LTX=1
ARG INSTALL_WAN=1
ARG ENABLED_PROFILES=wan2.2-ti2v-5b
RUN if [ "$ALLOW_UNPINNED" != "1" ] && { { [ "$INSTALL_LTX" = "1" ] && [ "$LTX2_REF" = "UNPINNED" ]; } || \
      { [ "$INSTALL_WAN" = "1" ] && { [ "$WAN22_REF" = "UNPINNED" ] || [ "$WAN22_WEIGHT_REV" = "UNPINNED" ]; }; }; }; then \
      echo "pin LTX2_REF plus WAN22_REF/WAN22_WEIGHT_REV for each installed backend (or pass ALLOW_UNPINNED=1)" >&2; exit 1; fi
ENV FORGE_WAN22_CODE_REV=$WAN22_REF FORGE_WAN_5B_EXPECTED_REV=$WAN22_WEIGHT_REV FORGE_LTX2_CODE_REV=$LTX2_REF FORGE_REQUIRE_VERIFIED_MODELS=1 FORGE_ENABLED_PROFILES=$ENABLED_PROFILES
# LTX-2 is a uv workspace (root pyproject has no [project]); `pip install -e .` at the
# root does not install ltx_pipelines. uv sync builds the workspace env uv run uses.
RUN if [ "$INSTALL_LTX" = "1" ]; then \
      git clone https://github.com/Lightricks/LTX-2 /opt/LTX-2 && cd /opt/LTX-2 && \
      { [ "$LTX2_REF" = "UNPINNED" ] || git checkout "$LTX2_REF"; } && \
      { uv sync --frozen || uv sync; }; fi
# Wan: torch pinned to a version with a PREBUILT flash_attn wheel (cu12 / torch2.8 /
# cp312 / cxx11abi, verified 2026-10-03). `pip install flash_attn` otherwise compiles
# from source for hours. Wan's model calls flash_attention directly (no SDPA fallback).
ARG FLASH_ATTN_WHEEL=https://github.com/Dao-AILab/flash-attention/releases/download/v2.8.3/flash_attn-2.8.3+cu12torch2.8cxx11abiTRUE-cp312-cp312-linux_x86_64.whl
ARG FLASH_ATTN_SHA256=f25da18657a87fc83dc1bfb8b7751b82246e9db355510226b674fd437c34b5fb
RUN if [ "$INSTALL_WAN" = "1" ]; then \
      git clone https://github.com/Wan-Video/Wan2.2 /opt/Wan2.2 && cd /opt/Wan2.2 && \
      { [ "$WAN22_REF" = "UNPINNED" ] || git checkout "$WAN22_REF"; } && \
      pip install "torch==2.8.0" "torchvision==0.23.0" "torchaudio==2.8.0" && \
      grep -v '^flash_attn' requirements.txt > /tmp/wan-req.txt && pip install -r /tmp/wan-req.txt && \
      curl -fsSL "$FLASH_ATTN_WHEEL" -o /tmp/flash_attn.whl && \
      echo "$FLASH_ATTN_SHA256  /tmp/flash_attn.whl" | sha256sum -c - && \
      pip install /tmp/flash_attn.whl && rm /tmp/flash_attn.whl; fi

WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY forge ./forge
COPY scripts ./scripts

ENV FORGE_DATA_DIR=/data/forge FORGE_WAN_DIR=/opt/Wan2.2 FORGE_LTX_DIR=/opt/LTX-2 FORGE_LTX_MODELS=/models/LTX-2.5
EXPOSE 8787
# FORGE_SECRET must be injected; without it every request is refused (fail closed).
CMD ["uvicorn", "forge.app:app", "--host", "0.0.0.0", "--port", "8787", "--workers", "1"]
