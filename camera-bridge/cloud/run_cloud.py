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


def ledger_path(env: Mapping[str, str]) -> str:
    # On the Railway volume: an outbox that has not drained must survive a launcher or container
    # restart (Codex on #3313). Only the election marker is per-launch.
    return os.path.join(env.get("LEDGER_DIR") or os.path.join("/data", "lot-vision"), "visitd.sqlite")


def _check_calibration(path: str) -> None:
    """Refuse any calibration the edge would run in census mode: it would claim 0 arrivals."""
    if not os.path.isfile(path):
        raise LauncherConfigError(f"EDGE_CALIBRATION {path} does not exist")
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    from edge_main import load_calibration  # the edge's own loader, so the two can never disagree

    cal = load_calibration(path)
    if cal.fault or cal.version is None or not cal.portal:
        raise LauncherConfigError(f"EDGE_CALIBRATION {path} cannot count arrivals: {cal.fault or 'no portal'}")


def edge_args(env: Mapping[str, str], *, elected_file: str, ledger: str) -> List[str]:
    # Without the shop key the heartbeat never reaches the shop, so the copy could never be elected.
    _need(env, "CAMERA_INGEST_KEY")
    calibration = _need(env, "EDGE_CALIBRATION")
    _check_calibration(calibration)
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


#: One tick is one second. A crop that ends because no frame has arrived yet (camera asleep, relay
#: warming up) is retried in place; a relay that ends is retried after a longer wait, so a refused
#: V380 login is not hammered (the NicksMax supervisor holds retries for the same reason).
CROP_RETRY_TICKS = 10
RELAY_RETRY_TICKS = 60
LEASE_LOST = 4


def supervise(
    start: Callable[[str], object],
    *,
    elected_file: str,
    sleep: Callable[[float], None] = time.sleep,
    max_ticks: int = 0,
) -> int:
    """Run the copy. Returns the container's exit code, never 0, only on a fault the copy cannot
    heal in place: MediaMTX dying, or the edge exiting for any reason but a lost lease. A lost lease
    goes back to dormant here, because Railway caps On-Failure restarts (Codex on #3313)."""
    if os.path.exists(elected_file):
        os.remove(elected_file)  # a marker from an earlier run must not start the relay
    procs: Dict[str, object] = {"mediamtx": start("mediamtx"), "edge": start("edge")}
    retry_at: Dict[str, int] = {}
    ticks = 0

    def stop(name: str) -> None:
        proc = procs.pop(name, None)
        if proc is not None and proc.poll() is None:
            proc.terminate()

    try:
        while True:
            if "relay" not in procs and "relay" not in retry_at and os.path.exists(elected_file):
                procs["relay"] = start("relay")
                procs["crop"] = start("crop")
            for name, due in list(retry_at.items()):
                if ticks >= due:
                    del retry_at[name]
                    procs[name] = start(name)
            for name in list(procs):
                if name not in procs:  # stopped by an earlier branch on this tick
                    continue
                code = procs[name].poll()
                if code is None:
                    continue
                if name == "edge" and code == LEASE_LOST:
                    for n in ("crop", "relay"):
                        stop(n)
                        retry_at.pop(n, None)
                    if os.path.exists(elected_file):
                        os.remove(elected_file)
                    procs["edge"] = start("edge")
                elif name == "crop":
                    del procs["crop"]
                    retry_at["crop"] = ticks + CROP_RETRY_TICKS
                elif name == "relay":
                    del procs["relay"]
                    stop("crop")
                    retry_at.pop("crop", None)
                    retry_at["relay"] = ticks + RELAY_RETRY_TICKS
                    retry_at["crop"] = ticks + RELAY_RETRY_TICKS + CROP_RETRY_TICKS
                else:
                    return code or 3
            ticks += 1
            if max_ticks and ticks >= max_ticks:
                return 3
            sleep(1.0)
    finally:
        for name in list(procs):
            stop(name)


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
            "edge": edge_args(env, elected_file=elected, ledger=ledger_path(env)),
            "relay": relay_args(env),
            "crop": crop_args(env.get("FFMPEG_BIN") or "ffmpeg"),
        }
    except LauncherConfigError as exc:
        print(f"lot-vision cloud: refusing to start: {exc}", file=sys.stderr)
        return 2
    os.makedirs(os.path.dirname(ledger_path(env)), exist_ok=True)
    return supervise(lambda name: subprocess.Popen(commands[name], cwd=HERE), elected_file=elected)


if __name__ == "__main__":
    raise SystemExit(main())
