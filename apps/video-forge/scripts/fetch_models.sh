#!/usr/bin/env bash
# Download model weights into the persistent /models volume at PINNED revisions.
# Fill the revisions at canary time and copy the resulting sha256s into
# forge/profiles.json + apps/nickstire/shared/mediaModelRegistry.ts (checkpointSha256).
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
: "${MODELS_DIR:=/models}"
: "${LTX25_REPO:=Lightricks/LTX-2.5}"
: "${FETCH_LTX:=1}"
: "${FETCH_WAN:=1}"

if [ "$FETCH_LTX" != "1" ] && [ "$FETCH_WAN" != "1" ]; then
  echo "refusing no-op fetch: enable FETCH_LTX=1 and/or FETCH_WAN=1" >&2
  exit 2
fi

pip install -q "huggingface_hub[cli]>=0.24,<1"

if [ "$FETCH_LTX" = "1" ]; then
  : "${LTX25_REV:?pin LTX25_REV when FETCH_LTX=1}"
  huggingface-cli download "$LTX25_REPO" --revision "$LTX25_REV" --local-dir "$MODELS_DIR/LTX-2.5"
  python3 "$SCRIPT_DIR/write_model_manifest.py" --model-dir "$MODELS_DIR/LTX-2.5" --repo "$LTX25_REPO" --revision "$LTX25_REV"
  # DFR's detailing IC-LoRA is a separate repo (needed only by the ltx-2.5-dfr profile).
  if [ -n "${LTX25_DFR_LORA_REV:-}" ]; then
    huggingface-cli download Lightricks/LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler --revision "$LTX25_DFR_LORA_REV" \
      --local-dir "$MODELS_DIR/LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler"
  fi
fi

if [ "$FETCH_WAN" = "1" ]; then
  : "${WAN22_REV:?pin WAN22_REV when FETCH_WAN=1}"
  huggingface-cli download Wan-AI/Wan2.2-TI2V-5B --revision "$WAN22_REV" --local-dir "$MODELS_DIR/Wan2.2-TI2V-5B"
  python3 "$SCRIPT_DIR/write_model_manifest.py" --model-dir "$MODELS_DIR/Wan2.2-TI2V-5B" --repo Wan-AI/Wan2.2-TI2V-5B --revision "$WAN22_REV"
  if [ -n "${WAN22_A14B_REV:-}" ]; then
    huggingface-cli download Wan-AI/Wan2.2-I2V-A14B --revision "$WAN22_A14B_REV" --local-dir "$MODELS_DIR/Wan2.2-I2V-A14B"
    python3 "$SCRIPT_DIR/write_model_manifest.py" --model-dir "$MODELS_DIR/Wan2.2-I2V-A14B" --repo Wan-AI/Wan2.2-I2V-A14B --revision "$WAN22_A14B_REV"
  fi
fi

# A future committed global checksum file can verify the complete model set.
# A selective canary intentionally does not require unrelated models to exist;
# each fetched model directory already carries its own MANIFEST.json + SHA256SUMS.
EXPECTED="$SCRIPT_DIR/../forge/SHA256SUMS.expected"
if [ "$FETCH_LTX" = "1" ] && [ "$FETCH_WAN" = "1" ] && [ -f "$EXPECTED" ]; then
  (cd / && sha256sum -c "$EXPECTED")
elif [ ! -f "$EXPECTED" ]; then
  find "$MODELS_DIR" -name '*.safetensors' -print0 | xargs -0 sha256sum | tee "$MODELS_DIR/SHA256SUMS"
  echo "NOTE: no forge/SHA256SUMS.expected yet - per-model manifests are authoritative for this canary" >&2
fi
