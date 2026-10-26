"""Launcher for the dormant Railway copy of the sign producer (lot vision v2, phase 3).

Order matters. The V380 relay IS the camera session (it logs in to the V380 cloud), and whether
the cloud serves two sessions to one device is unknown, so the relay must not run while the shop
PC holds the lease. The launcher starts MediaMTX and the edge first; the edge heartbeats dormant
until the shop elects it, writes the elected marker, and only then do the relay and the crop
start. Any child dying takes the whole copy down with a nonzero code, so Railway's on-failure
restart brings it back dormant. One process tree, no second supervisor inside.

Design: camera-bridge/docs/LOT-VISION-V2-DESIGN-2026-10-26.md section 4.
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
from typing import Callable, Dict, List, Mapping

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Production NicksMax crop (scripts/nicksmax/run-sign-crop.ps1), middle lens: lensY = 1080.
LENS_Y = 1080
RELAY_RTSP = "rtsp://127.0.0.1:8554/live"
SIGN_RTSP = "rtsp://127.0.0.1:8555/sign"


class LauncherConfigError(RuntimeError):
    """A missing setting that would make the copy run blind; refuse instead."""


def _need(env: Mapping[str, str], key: str) -> str:
    value = (env.get(key) or "").strip()
    if not value:
        raise LauncherConfigError(f"{key} is not set")
    return value


def relay_args(env: Mapping[str, str]) -> List[str]:
    # The relay takes its device login on the command line; it never leaves the container.
    return [
        env.get("RELAY_BIN") or "/opt/relay/V380Decoder.bin",
        "--id", _need(env, "V380_DEVICE_ID"),
        "--username", _need(env, "V380_USERNAME"),
        "--password", _need(env, "V380_PASSWORD"),
        "--source", "cloud",
        "--rtsp-port", "8554",
    ]


def crop_args(ffmpeg: str = "ffmpeg") -> List[str]:
    return [
        ffmpeg, "-hide_banner", "-loglevel", "warning",
        "-use_wallclock_as_timestamps", "1",
        "-fflags", "+genpts+discardcorrupt",
        "-rtsp_transport", "tcp", "-timeout", "5000000",
        "-i", RELAY_RTSP,
        "-an",
        "-vf", f"crop=1920:1080:0:{LENS_Y},scale=640:360,fps=4,setpts=N/(4*TB)",
        "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-pix_fmt", "yuv420p",
        "-g", "8", "-keyint_min", "8", "-sc_threshold", "0", "-fps_mode", "cfr",
        "-f", "rtsp", "-rtsp_transport", "tcp", SIGN_RTSP,
    ]


def mediamtx_config() -> str:
    # The relay owns 8554; MediaMTX serves the crop on 8555, as on NicksMax.
    return "rtspAddress: :8555\nhls: no\nwebrtc: no\nsrt: no\nrtmp: no\npaths:\n  sign:\n    source: publisher\n"


def edge_args(env: Mapping[str, str], *, elected_file: str, ledger: str) -> List[str]:
    calibration = _need(env, "EDGE_CALIBRATION")
    if not os.path.isfile(calibration):
        # Without calibration the edge runs in census mode and claims no arrivals: a silent zero.
        raise LauncherConfigError(f"EDGE_CALIBRATION {calibration} does not exist")
    args = [
        sys.executable, os.path.join(HERE, "edge_main.py"),
        "--config", env.get("EDGE_CONFIG") or os.path.join(HERE, "cloud", "config.cloud.yaml"),
        "--ledger", ledger,
        "--source", "rtsp", "--camera", "sign",
        "--calibration", calibration,
        "--dormant-until-authoritative",
        "--elected-file", elected_file,
    ]
    if env.get("VISION_OV_MODEL"):
        args += ["--model", env["VISION_OV_MODEL"]]
    return args


def supervise(
    start: Callable[[str], object],
    *,
    elected_file: str,
    sleep: Callable[[float], None] = time.sleep,
    max_ticks: int = 0,
) -> int:
    """Run the copy. Returns the exit code for the container; never 0, so it always restarts."""
    procs: Dict[str, object] = {"mediamtx": start("mediamtx"), "edge": start("edge")}
    ticks = 0
    try:
        while True:
            if "relay" not in procs and os.path.exists(elected_file):
                procs["relay"] = start("relay")
                procs["crop"] = start("crop")
            for name, proc in procs.items():
                code = proc.poll()
                if code is not None:
                    # The edge's own code is the reason (4 = lease lost); anything else that
                    # dies, or a clean exit, still restarts the copy dormant.
                    return code if (name == "edge" and code) else 3
            ticks += 1
            if max_ticks and ticks >= max_ticks:
                return 3
            sleep(1.0)
    finally:
        for proc in procs.values():
            if proc.poll() is None:
                proc.terminate()


def main() -> int:
    env = os.environ
    workdir = tempfile.mkdtemp(prefix="lot-vision-")
    elected = os.path.join(workdir, "elected")
    mtx_cfg = os.path.join(workdir, "mediamtx.yml")
    with open(mtx_cfg, "w", encoding="utf-8") as fh:
        fh.write(mediamtx_config())
    try:
        commands = {
            "mediamtx": [env.get("MEDIAMTX_BIN") or "/opt/mediamtx/mediamtx", mtx_cfg],
            "edge": edge_args(env, elected_file=elected, ledger=os.path.join(workdir, "visitd.sqlite")),
            "relay": relay_args(env),
            "crop": crop_args(env.get("FFMPEG_BIN") or "ffmpeg"),
        }
    except LauncherConfigError as exc:
        print(f"lot-vision cloud: refusing to start: {exc}", file=sys.stderr)
        return 2
    return supervise(lambda name: subprocess.Popen(commands[name], cwd=HERE), elected_file=elected)


if __name__ == "__main__":
    raise SystemExit(main())
