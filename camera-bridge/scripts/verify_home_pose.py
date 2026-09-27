#!/usr/bin/env python3
"""Verify a PTZ camera has visually returned to its trusted home view.

Exit codes:
  0  current frame visually matches home
  1  current frame was captured and visually does NOT match home
  2  verification could not be completed (capture/decode/registration/config)

A valid away verdict is still written as a receipt. An infrastructure failure is not:
leaving the prior receipt untouched lets the consumer reject it as older than the newest
ptzNotify rather than replacing evidence with a synthetic failure row.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import numpy as np

# The script is normally launched by StateNour using an absolute path from another
# working directory. Put camera-bridge itself on sys.path; never depend on caller cwd.
CAMERA_BRIDGE_ROOT = Path(__file__).resolve().parents[1]
if str(CAMERA_BRIDGE_ROOT) not in sys.path:
    sys.path.insert(0, str(CAMERA_BRIDGE_ROOT))

from vision.homepose import HomePoseError, verify_home_pose, write_receipt


def _redacted_url(raw: str) -> str:
    try:
        parts = urlsplit(raw)
        host = parts.hostname or ""
        if parts.port:
            host = f"{host}:{parts.port}"
        return urlunsplit((parts.scheme, host, parts.path, "", ""))
    except Exception:
        return "<media-url>"


def _decode(data: bytes):
    try:
        import cv2
    except ImportError as exc:
        raise HomePoseError("OpenCV is required to decode verification frames") from exc
    arr = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None:
        raise HomePoseError("image bytes could not be decoded")
    return image


def _read_image(path: str | Path):
    p = Path(path)
    if not p.is_file():
        raise HomePoseError(f"image not found: {p}")
    return _decode(p.read_bytes())


def _capture_rtsp(url: str, *, timeout_seconds: float):
    """Capture one frame in-process so a credentialed URL never appears in child argv.

    `evidence_at` is stamped BEFORE the media open. That is intentionally conservative:
    if a ptzNotify arrives anywhere during open/read/registration, the resulting receipt
    predates that motor event and the consumer rejects it rather than accepting ambiguous
    pixels.
    """
    if timeout_seconds <= 0:
        raise HomePoseError("capture timeout must be positive")
    try:
        import cv2
    except ImportError as exc:
        raise HomePoseError("OpenCV is required for live RTSP verification") from exc

    evidence_at = datetime.now(timezone.utc)
    timeout_ms = max(1, int(timeout_seconds * 1000))
    params = []
    if hasattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC"):
        params += [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, timeout_ms]
    if hasattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC"):
        params += [cv2.CAP_PROP_READ_TIMEOUT_MSEC, timeout_ms]

    os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")
    try:
        if params:
            cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG, params)
        else:
            cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    except Exception as exc:  # noqa: BLE001
        raise HomePoseError(
            f"media capture could not open {_redacted_url(url)}: {type(exc).__name__}"
        ) from exc

    try:
        if not cap.isOpened():
            raise HomePoseError(f"media capture did not open {_redacted_url(url)}")
        ok, image = cap.read()
        if not ok or image is None:
            raise HomePoseError(f"media capture returned no frame from {_redacted_url(url)}")
        return image, evidence_at
    finally:
        cap.release()

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Visually verify a PTZ camera against a trusted home reference."
    )
    parser.add_argument("--serial", required=True)
    parser.add_argument("--reference", required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--current", help="already-captured current JPEG/PNG")
    source.add_argument("--rtsp-url", help="live RTSP URL (prefer loopback go2rtc)")
    source.add_argument(
        "--rtsp-env",
        help="environment variable holding the live RTSP URL; preferred for credentialed URLs",
    )
    parser.add_argument("--receipt", required=True)
    parser.add_argument("--capture-timeout-seconds", type=float, default=12.0)
    parser.add_argument("--max-shift-px", type=float, default=6.0)
    parser.add_argument("--min-correlation-response", type=float, default=0.20)
    parser.add_argument("--max-changed-fraction", type=float, default=0.65)
    args = parser.parse_args(argv)

    try:
        reference = _read_image(args.reference)
        if args.current:
            current_path = Path(args.current)
            current = _read_image(current_path)
            evidence_at = datetime.fromtimestamp(
                current_path.stat().st_mtime,
                tz=timezone.utc,
            )
        else:
            media_url = args.rtsp_url
            if args.rtsp_env:
                media_url = os.environ.get(args.rtsp_env, "").strip()
                if not media_url:
                    raise HomePoseError(
                        f"RTSP environment variable {args.rtsp_env!r} is empty"
                    )
            current, evidence_at = _capture_rtsp(
                media_url,
                timeout_seconds=args.capture_timeout_seconds,
            )
        receipt = verify_home_pose(
            reference,
            current,
            serial=args.serial,
            max_shift_px=args.max_shift_px,
            min_correlation_response=args.min_correlation_response,
            max_changed_fraction=args.max_changed_fraction,
            evidence_at=evidence_at,
        )
        write_receipt(args.receipt, receipt)
    except (HomePoseError, OSError, ValueError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}), file=sys.stderr)
        return 2

    print(json.dumps({"ok": True, **receipt.__dict__}, sort_keys=True))
    return 0 if receipt.isHome else 1


if __name__ == "__main__":
    raise SystemExit(main())
