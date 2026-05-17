# LiveKit operator-voice Dockerfile · Wave-200 Phase 4 (2026-05-17)
#
# Builds the apps/voice Python agent for Railway service
# statenour-voice. Multi-stage to keep the runtime image lean
# (Python 3.11 slim · no build tools · no caches).
#
# Build:
#   docker build -t statenour-voice -f apps/voice/Dockerfile apps/voice
#
# Run:
#   docker run -e LIVEKIT_URL=... -e LIVEKIT_API_KEY=... \
#              -e DEEPGRAM_API_KEY=... -e CARTESIA_API_KEY=... \
#              -e STATENOUR_OWNER_COOKIE=... \
#              statenour-voice
#
# Railway: point a new service at apps/voice/Dockerfile · no port
# needs to be exposed (LiveKit is outbound WebRTC) · healthcheck via
# `/health` if the worker exposes one (default LiveKit worker port).

# ─── stage 1 · build deps ──────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /app

# Install build tooling for any wheels that don't ship pure Python
# (silero, onnxruntime). Slim layer keeps runtime small.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install --user --no-cache-dir -r requirements.txt

# ─── stage 2 · runtime ─────────────────────────────────────────
FROM python:3.11-slim AS runtime

WORKDIR /app

# Copy installed packages from builder (avoid re-downloading +
# strip build tooling from the runtime).
COPY --from=builder /root/.local /root/.local
ENV PATH=/root/.local/bin:$PATH

# Required by silero VAD at runtime · onnxruntime needs libgomp.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# App code.
COPY agent.py .

# Run the LiveKit worker · `start` mode joins production
# (vs `dev` which polls for local jobs).
CMD ["python", "agent.py", "start"]
