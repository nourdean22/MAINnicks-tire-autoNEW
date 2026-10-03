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
ARG LTX2_REF=UNPINNED
ARG WAN22_REF=UNPINNED
ARG ALLOW_UNPINNED=0
RUN if [ "$ALLOW_UNPINNED" != "1" ] && { [ "$LTX2_REF" = "UNPINNED" ] || [ "$WAN22_REF" = "UNPINNED" ]; }; then \
      echo "pin LTX2_REF and WAN22_REF (or pass ALLOW_UNPINNED=1)" >&2; exit 1; fi
# LTX-2 is a uv workspace (root pyproject has no [project]); `pip install -e .` at the
# root does not install ltx_pipelines. uv sync builds the workspace env uv run uses.
RUN git clone https://github.com/Lightricks/LTX-2 /opt/LTX-2 && cd /opt/LTX-2 && \
      if [ "$LTX2_REF" != "UNPINNED" ]; then git checkout "$LTX2_REF"; fi && uv sync --frozen || uv sync
# torch first so flash_attn (in Wan's requirements) can build against it.
RUN git clone https://github.com/Wan-Video/Wan2.2 /opt/Wan2.2 && cd /opt/Wan2.2 && \
      if [ "$WAN22_REF" != "UNPINNED" ]; then git checkout "$WAN22_REF"; fi && \
      pip install "torch>=2.4.0" torchvision && \
      grep -v '^flash_attn' requirements.txt > /tmp/wan-req.txt && pip install -r /tmp/wan-req.txt && \
      pip install flash_attn --no-build-isolation

WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY forge ./forge
COPY scripts ./scripts

ENV FORGE_DATA_DIR=/data/forge FORGE_WAN_DIR=/opt/Wan2.2 FORGE_LTX_DIR=/opt/LTX-2 FORGE_LTX_MODELS=/models/LTX-2.5
EXPOSE 8787
# FORGE_SECRET must be injected; without it every request is refused (fail closed).
CMD ["uvicorn", "forge.app:app", "--host", "0.0.0.0", "--port", "8787", "--workers", "1"]
