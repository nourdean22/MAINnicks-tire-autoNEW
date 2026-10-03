#!/usr/bin/env bash
# Download model weights into the persistent /models volume at PINNED revisions.
# Fill the revisions at canary time and copy the resulting sha256s into
# forge/profiles.json + apps/nickstire/shared/mediaModelRegistry.ts (checkpointSha256).
set -euo pipefail
: "${MODELS_DIR:=/models}"
: "${LTX25_REPO:=Lightricks/LTX-2.5}"      # VERIFY exact HF repo id at canary time
: "${LTX25_REV:?pin a revision}"
: "${WAN22_REV:?pin a revision}"
pip install -q "huggingface_hub[cli]>=0.24,<1"
huggingface-cli download "$LTX25_REPO" --revision "$LTX25_REV" --local-dir "$MODELS_DIR/LTX-2.5"
# DFR's detailing IC-LoRA is a separate repo (needed only by the ltx-2.5-dfr profile).
if [ -n "${LTX25_DFR_LORA_REV:-}" ]; then
  huggingface-cli download Lightricks/LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler --revision "$LTX25_DFR_LORA_REV" \
    --local-dir "$MODELS_DIR/LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler"
fi
huggingface-cli download Wan-AI/Wan2.2-TI2V-5B --revision "$WAN22_REV" --local-dir "$MODELS_DIR/Wan2.2-TI2V-5B"
if [ -n "${WAN22_A14B_REV:-}" ]; then
  huggingface-cli download Wan-AI/Wan2.2-I2V-A14B --revision "$WAN22_A14B_REV" --local-dir "$MODELS_DIR/Wan2.2-I2V-A14B"
fi
# Verify against committed sums when they exist; otherwise record them for pinning.
EXPECTED="$(dirname "$0")/../forge/SHA256SUMS.expected"
if [ -f "$EXPECTED" ]; then
  (cd / && sha256sum -c "$EXPECTED")   # fails the fetch on any mismatch
else
  find "$MODELS_DIR" -name '*.safetensors' -print0 | xargs -0 sha256sum | tee "$MODELS_DIR/SHA256SUMS"
  echo "NOTE: no forge/SHA256SUMS.expected yet — commit $MODELS_DIR/SHA256SUMS as it after the canary" >&2
fi
