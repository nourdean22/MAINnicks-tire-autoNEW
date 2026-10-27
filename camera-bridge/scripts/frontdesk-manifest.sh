#!/usr/bin/env bash
# Writes camera-bridge/scripts/frontdesk-files.txt from the STAGED blobs (what GitHub's raw URLs serve),
# never the working tree (core.autocrlf rewrites line endings there).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
out=camera-bridge/scripts/frontdesk-files.txt
tmp=$(mktemp)
{
  echo "# Front-desk sign counter runtime files: SHA-256, bytes, path under camera-bridge/, at the commit that last changed this file."
  echo "# Read by the phase 4 paste block (shop-pc-remote-session section 4). Regenerate for a new install; never hand-edit."
  git ls-files -- camera-bridge \
    | grep -E '^camera-bridge/(edge_main\.py|edge_health\.py|requirements\.txt|cloud/|visitd/|vision/|scripts/(install|run)-frontdesk-sign\.ps1$)' \
    | grep -v -E '^camera-bridge/vision/tests/' \
    | while read -r p; do
        git show ":$p" > "$tmp"
        printf '%s %s %s\n' "$(sha256sum "$tmp" | cut -d' ' -f1)" "$(wc -c < "$tmp" | tr -d ' ')" "${p#camera-bridge/}"
      done
} > "$out"
rm -f "$tmp"
echo "$(grep -vc '^#' "$out") files -> $out"
