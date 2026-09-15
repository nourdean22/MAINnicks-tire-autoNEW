#!/usr/bin/env bash
# Real-device canary — sitespeed.io driving Chrome on a physical Android phone
# over USB/ADB (or over Tailscale with `adb connect <tailnet-ip>:5555`).
#
# ONE qualitative signal, not a fleet sample: one phone, one radio, one
# thermal envelope. It catches what headless Chrome on a CI runner cannot —
# real network, real paint, real jank — and nothing else. Never read one
# device's number as "mobile users".
#
# Runs on LINUX only (sitespeed.io's Android path is Docker-on-Linux; not
# macOS/Windows Docker). Prereqs on the host:
#   · docker, adb; phone with USB debugging on, Chrome installed
#   · phone unlocked, on Wi-Fi, NOT charging-hot (sitespeed pre-checks battery temp)
#   · adb devices  -> shows the phone
#
# Usage: sitespeed/android-canary.sh [runs=3]
set -euo pipefail
RUNS="${1:-3}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../test-results/sitespeed-android"
mkdir -p "$OUT"

if ! adb devices | grep -qE "device$"; then
  echo "no Android device visible to adb — plug it in or 'adb connect <ip>:5555' over the tailnet" >&2
  exit 2
fi

# Pinned tag per docs/UPSTREAMS.md row (verify the current release before bumping).
docker run --rm --privileged \
  -v /dev/bus/usb:/dev/bus/usb \
  -v "$OUT":/sitespeed.io \
  -v "$HERE":/config:ro \
  sitespeedio/sitespeed.io:42.7.0 \
  --android \
  --browser chrome \
  -n "$RUNS" \
  --budget.configPath /config/budget.json \
  --plugins.add analysisstorer \
  --outputFolder /sitespeed.io \
  /config/urls.txt

echo "results: $OUT (HAR + video + CWV per run). Compare against the desktop canary in test-results/sitespeed-desktop before drawing a conclusion."
