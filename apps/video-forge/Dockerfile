# NOUR Video Forge — GPU image (RunPod pod / any CUDA host).
# STATUS: BUILT, NOT YET BUILT ON A GPU HOST (no spend authorized 2026-10-03).
# Weights are NOT baked in: mount a persistent volume at /models and run
# scripts/fetch_models.sh once (pinned revisions). Jobs DB + outputs live on
# /data so a container restart recovers in-flight work (store.recover_after_restart).
FROM nvidia/cuda:12.8.0-cudnn-runtime-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv python3-pip git ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

# Model code at PINNED commits (set at canary time; never "main" at runtime).
ARG LTX2_REF=UNPINNED
ARG WAN22_REF=UNPINNED
RUN git clone https://github.com/Lightricks/LTX-2 /opt/LTX-2 && cd /opt/LTX-2 && \
      if [ "$LTX2_REF" != "UNPINNED" ]; then git checkout "$LTX2_REF"; fi && pip install -e .
RUN git clone https://github.com/Wan-Video/Wan2.2 /opt/Wan2.2 && cd /opt/Wan2.2 && \
      if [ "$WAN22_REF" != "UNPINNED" ]; then git checkout "$WAN22_REF"; fi && pip install -r requirements.txt

WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY forge ./forge
COPY scripts ./scripts

ENV FORGE_DATA_DIR=/data/forge FORGE_WAN_DIR=/opt/Wan2.2 FORGE_WAN_CKPT=/models/Wan2.2-TI2V-5B
EXPOSE 8787
# FORGE_SECRET must be injected; without it every request is refused (fail closed).
CMD ["uvicorn", "forge.app:app", "--host", "0.0.0.0", "--port", "8787", "--workers", "1"]
