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
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import numpy as np

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


def _capture_rtsp(url: str, *, ffmpeg: str, timeout_seconds: float):
    if timeout_seconds <= 0:
        raise HomePoseError("capture timeout must be positive")
    args = [
        ffmpeg,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-rtsp_transport",
        "tcp",
        "-i",
        url,
        "-frames:v",
        "1",
        "-an",
        "-f",
        "image2pipe",
        "-vcodec",
        "png",
        "pipe:1",
    ]
    try:
        proc = subprocess.run(
            args,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=float(timeout_seconds),
        )
    except subprocess.TimeoutExpired as exc:
        raise HomePoseError(
            f"media capture timed out after {timeout_seconds:g}s from {_redacted_url(url)}"
        ) from exc
    except OSError as exc:
        raise HomePoseError(f"ffmpeg could not start: {exc}") from exc

    if proc.returncode != 0 or not proc.stdout:
        detail = proc.stderr.decode("utf-8", errors="replace").strip()
        if len(detail) > 300:
            detail = detail[-300:]
        raise HomePoseError(
            f"media capture failed from {_redacted_url(url)}"
            + (f": {detail}" if detail else "")
        )
    return _decode(proc.stdout)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Visually verify a PTZ camera against a trusted home reference."
    )
    parser.add_argument("--serial", required=True)
    parser.add_argument("--reference", required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--current", help="already-captured current JPEG/PNG")
    source.add_argument("--rtsp-url", help="live RTSP URL (prefer loopback go2rtc)")
    parser.add_argument("--receipt", required=True)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--capture-timeout-seconds", type=float, default=12.0)
    parser.add_argument("--max-shift-px", type=float, default=6.0)
    parser.add_argument("--max-changed-fraction", type=float, default=0.65)
    args = parser.parse_args(argv)

    try:
        reference = _read_image(args.reference)
        current = (
            _read_image(args.current)
            if args.current
            else _capture_rtsp(
                args.rtsp_url,
                ffmpeg=args.ffmpeg,
                timeout_seconds=args.capture_timeout_seconds,
            )
        )
        receipt = verify_home_pose(
            reference,
            current,
            serial=args.serial,
            max_shift_px=args.max_shift_px,
            max_changed_fraction=args.max_changed_fraction,
        )
        write_receipt(args.receipt, receipt)
    except (HomePoseError, OSError, ValueError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 2

    print(json.dumps({"ok": True, **receipt.__dict__}, sort_keys=True))
    return 0 if receipt.isHome else 1


if __name__ == "__main__":
    raise SystemExit(main())
