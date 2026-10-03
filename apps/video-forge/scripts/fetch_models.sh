#!/usr/bin/env bash
# Download model weights into the persistent /models volume at PINNED revisions.
# Fill the revisions at canary time and copy the resulting sha256s into
# forge/profiles.json + apps/nickstire/shared/mediaModelRegistry.ts (checkpointSha256).
set -euo pipefail
: "${MODELS_DIR:=/models}"
: "${LTX25_REPO:=Lightricks/LTX-2.5}"      # VERIFY exact HF repo id at canary time
: "${LTX25_REV:?pin a revision}"
: "${WAN22_REV:?pin a revision}"
pip install -q "huggingface_hub[cli]>=0.24"
huggingface-cli download "$LTX25_REPO" --revision "$LTX25_REV" --local-dir "$MODELS_DIR/LTX-2.5"
huggingface-cli download Wan-AI/Wan2.2-TI2V-5B --revision "$WAN22_REV" --local-dir "$MODELS_DIR/Wan2.2-TI2V-5B"
find "$MODELS_DIR" -name '*.safetensors' -print0 | xargs -0 sha256sum | tee "$MODELS_DIR/SHA256SUMS"
