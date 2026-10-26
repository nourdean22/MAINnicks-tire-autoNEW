# The dormant Railway copy of the sign producer (lot vision v2, phase 3).
# WRITTEN, NOT BUILT HERE: there is no Docker on the machine that wrote it; Railway's first build is its first run.
# Design: camera-bridge/docs/LOT-VISION-V2-DESIGN-2026-10-26.md section 4. Launcher: camera-bridge/cloud/run_cloud.py.
#
# The relay is the V380Decoder release binary, run as-is and never stored in this repo: upstream has no licence file,
# so it is run-only, never vendored or redistributed (Nour accepted the risk 2026-10-26, docs/UPSTREAMS.md).
# Both downloads are pinned by SHA-256 and byte count recorded from GitHub's release metadata, which matched the
# publisher's own .sha256 file. Kill criterion: if either hash changes under the same tag, this build fails closed
# and the lane stops until a person re-pins it.
FROM python:3.12-slim

ARG RELAY_URL=https://github.com/PyanSofyan/V380Decoder/releases/download/v1.0.4/V380Decoder-linux-x64.tar.gz
ARG RELAY_SHA256=fe896ea6319273b3c6942f294ec8f58a150f1eef315b81d4280b9259bca4275c
ARG RELAY_BYTES=10815382
ARG MEDIAMTX_URL=https://github.com/bluenviron/mediamtx/releases/download/v1.21.2/mediamtx_v1.21.2_linux_amd64.tar.gz
ARG MEDIAMTX_SHA256=121be6e00397e473a95d83c75f4fcd3819a6af3b0e1a50889cba43ab4fab6a27
ARG MEDIAMTX_BYTES=28345997

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Fail closed on any byte or hash mismatch.
RUN set -eu; \
    fetch() { curl -fsSL "$1" -o "$2"; test "$(stat -c %s "$2")" = "$3"; echo "$4  $2" | sha256sum -c -; }; \
    fetch "$RELAY_URL" /tmp/relay.tar.gz "$RELAY_BYTES" "$RELAY_SHA256"; \
    fetch "$MEDIAMTX_URL" /tmp/mediamtx.tar.gz "$MEDIAMTX_BYTES" "$MEDIAMTX_SHA256"; \
    mkdir -p /opt/relay /opt/mediamtx; \
    tar -xzf /tmp/relay.tar.gz -C /opt/relay; \
    tar -xzf /tmp/mediamtx.tar.gz -C /opt/mediamtx; \
    rm /tmp/relay.tar.gz /tmp/mediamtx.tar.gz; \
    RELAY_EXE="$(find /opt/relay -maxdepth 2 -type f -name 'V380Decoder' | head -1)"; \
    test -n "$RELAY_EXE"; chmod +x "$RELAY_EXE"; ln -sf "$RELAY_EXE" /opt/relay/V380Decoder.bin

WORKDIR /app
COPY requirements.txt /app/requirements.txt
COPY vision/requirements.txt /app/vision/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt -r vision/requirements.txt
COPY . /app
RUN python -m vision.fetch_models --dest /app/ov_models

ENV RELAY_BIN=/opt/relay/V380Decoder.bin \
    MEDIAMTX_BIN=/opt/mediamtx/mediamtx \
    EDGE_ROLE=cloud \
    CAMERA_SOURCE_URL=rtsp://127.0.0.1:8555/sign \
    VISION_OV_MODEL=/app/ov_models/vehicle-detection-0200/FP16/vehicle-detection-0200.xml \
    VISION_OV_DEVICE=CPU \
    DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 \
    PYTHONUNBUFFERED=1

# /data is the Railway volume: the visit ledger and its outboxes must survive a restart (LEDGER_DIR).
RUN useradd --create-home --uid 10001 counter && mkdir -p /data/lot-vision && chown -R counter /app /data
USER counter
CMD ["python", "-m", "cloud.run_cloud"]
