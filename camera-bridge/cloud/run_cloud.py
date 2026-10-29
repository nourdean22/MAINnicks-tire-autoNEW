"""Launcher for the dormant Railway copy of the sign producer (lot vision v2, phase 3).

Order matters. The V380 relay IS the camera session (it logs in to the V380 cloud), and whether
the cloud serves two sessions to one device is unknown, so the relay must not run while the shop
PC holds the lease. The launcher starts MediaMTX and the edge first; the edge heartbeats dormant
until the shop elects it, writes the elected marker, and only then do the relay and the crop
start. Any child dying takes the whole copy down with a nonzero code, so Railway's on-failure
restart brings it back dormant. One process tree, no second supervisor inside.

The front-desk PC (p1) runs the same launcher with --primary (scripts/run-frontdesk-sign.ps1):
no election, relay and crop at once, and no edge until a calibration is installed.

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


def edge_args(env: Mapping[str, str], *, elected_file: str, ledger: str, primary: bool = False) -> List[str]:
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
    ]
    if not primary:
        args += ["--dormant-until-authoritative", "--elected-file", elected_file]
    if env.get("VISION_OV_MODEL"):
        args += ["--model", env["VISION_OV_MODEL"]]
    return args


#: One tick is one second. A crop that ends because no frame has arrived yet (camera asleep, relay
#: warming up) is retried in place; a relay that ends is retried after a longer wait, so a refused
#: V380 login is not hammered (the NicksMax supervisor holds retries for the same reason).
CROP_RETRY_TICKS = 10
RELAY_RETRY_TICKS = 60
#: A relay that dies within RELAY_FAST_EXIT_TICKS of starting, three times running, is a refused
#: V380 login (code 1002: bad login, or the solar camera asleep). After that, one login per 30
#: minutes, as NicksMax learned (2026-10-02/03: ~120 logins an hour for 11 h risked the account).
RELAY_FAST_EXIT_TICKS = 120
RELAY_FAST_EXITS_BEFORE_HOLD = 3
RELAY_LOGIN_HOLD_TICKS = 30 * 60
LEASE_LOST = 4
EDGE_STALL_EXIT = 3  # edge_main: no frame for --stall-exit-seconds


def _utc(seconds_from_now: float = 0.0) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + seconds_from_now))


def _say(msg: str) -> None:
    # stdout is frontdesk-sign.stdout.log on the front desk: the login-hold kill criterion is read from these lines.
    try:
        print(f"{_utc()} run_cloud {msg}", flush=True)
    except (OSError, ValueError):
        pass  # a full or closed log must never stop the launcher before it can end its children


def supervise(
    start: Callable[[str], object],
    *,
    elected_file: str,
    sleep: Callable[[float], None] = time.sleep,
    max_ticks: int = 0,
    primary: bool = False,
    run_edge: bool = True,
) -> int:
    """Run the copy. Returns the container's exit code, never 0, only on a fault the copy cannot
    heal in place: MediaMTX dying, or the edge exiting for any reason but a lost lease. A lost lease
    goes back to dormant here, because Railway caps On-Failure restarts (Codex on #3313).

    primary (the front-desk PC, p1): the relay and crop start at once, and any edge exit ends the
    run so the scheduled task restarts it, except a stall while the relay is down or still logging
    in. run_edge=False streams only (install day, before the calibration exists)."""
    if os.path.exists(elected_file):
        os.remove(elected_file)  # a marker from an earlier run must not start the relay
    procs: Dict[str, object] = {"mediamtx": start("mediamtx")}
    if run_edge:
        procs["edge"] = start("edge")
    if primary:
        procs["relay"] = start("relay")
        procs["crop"] = start("crop")
        _say("relay start fast_exits=0 hold_until=none")
    retry_at: Dict[str, int] = {}
    ticks = 0
    relay_started_at = 0  # the primary's first relay starts at tick 0
    relay_fast_exits = 0
    relay_hold_until = "none"

    def relay_started() -> None:
        nonlocal relay_started_at
        relay_started_at = ticks
        _say(f"relay start fast_exits={relay_fast_exits} hold_until={relay_hold_until}")

    def stop(name: str) -> None:
        proc = procs.pop(name, None)
        if proc is not None and proc.poll() is None:
            proc.terminate()

    def elected() -> bool:
        # The marker is stale until a lease-lost exit is polled, so a standby also needs a live edge.
        edge = procs.get("edge")
        return edge is not None and edge.poll() is None and os.path.exists(elected_file)

    def relay_ended() -> None:
        # The relay exited, or is being stopped young: one that ends within RELAY_FAST_EXIT_TICKS is a
        # refused (or cut) login and counts toward the hold, wherever the end was noticed.
        nonlocal relay_fast_exits, relay_hold_until
        stop("relay")
        stop("crop")
        fast = ticks - relay_started_at < RELAY_FAST_EXIT_TICKS
        relay_fast_exits = relay_fast_exits + 1 if fast else 0
        held = relay_fast_exits >= RELAY_FAST_EXITS_BEFORE_HOLD
        wait = RELAY_LOGIN_HOLD_TICKS if held else RELAY_RETRY_TICKS
        retry_at["relay"] = ticks + wait
        retry_at["crop"] = ticks + wait + CROP_RETRY_TICKS
        relay_hold_until = _utc(wait)  # a tick is at least a second, so the next login is no sooner
        _say(f"relay ended fast_exits={relay_fast_exits} wait={'hold' if held else 'retry'} "
             f"next_login_after={relay_hold_until}")

    try:
        while True:
            if "relay" not in procs and "relay" not in retry_at and elected():
                procs["relay"] = start("relay")
                procs["crop"] = start("crop")
                relay_started()
            for name, due in list(retry_at.items()):
                if ticks >= due:
                    if not primary and name in ("relay", "crop") and not elected():
                        continue  # a standby that lost its election waits for the next one
                    del retry_at[name]
                    procs[name] = start(name)
                    if name == "relay":
                        relay_started()
            for name in list(procs):
                if name not in procs:  # stopped by an earlier branch on this tick
                    continue
                code = procs[name].poll()
                if code is None:
                    continue
                if name == "edge" and code == LEASE_LOST and not primary:
                    relay = procs.get("relay")
                    # A relay that exited this same tick, or one still logging in, is a login the
                    # re-election must not repeat at once. A working (old) relay is stopped uncounted.
                    if relay is not None and (relay.poll() is not None or ticks - relay_started_at < RELAY_FAST_EXIT_TICKS):
                        relay_ended()
                    elif relay is not None:
                        _say(f"relay stopped reason=lease_lost fast_exits={relay_fast_exits}")
                    for n in ("crop", "relay"):
                        stop(n)
                    # A held relay retry stays held through re-election; a crop retry with no relay
                    # retry behind it is dropped, because the relay restarts with its own crop.
                    if "relay" not in retry_at:
                        retry_at.pop("crop", None)
                    if os.path.exists(elected_file):
                        os.remove(elected_file)
                    procs["edge"] = start("edge")
                elif name == "edge" and code == EDGE_STALL_EXIT and (
                        ("relay" not in procs and "relay" in retry_at)
                        or ("relay" in procs and ticks - relay_started_at < RELAY_FAST_EXIT_TICKS)):
                    # No relay, or one still logging in, so no frames: the edge's own stall exit
                    # (180 s) is expected here, not a fault. Ending the run would let the restart
                    # reset the fast-exit count and log in to V380 again every few minutes, defeating
                    # the 30-minute hold. The primary's relay keeps logging in and its own exit decides
                    # the hold; a standby's young relay is stopped and counted instead, because it
                    # would run unelected. A standby also drops its election: the new edge must win it
                    # again before the held relay may log in, or a primary that took the lease
                    # meanwhile gets a second session.
                    if not primary and "relay" in procs:
                        relay_ended()
                    if os.path.exists(elected_file):
                        os.remove(elected_file)
                    del procs["edge"]
                    retry_at["edge"] = ticks + CROP_RETRY_TICKS
                elif name == "crop":
                    del procs["crop"]
                    retry_at["crop"] = ticks + CROP_RETRY_TICKS
                elif name == "relay":
                    relay_ended()
                else:
                    return code or 3
            ticks += 1
            if max_ticks and ticks >= max_ticks:
                return 3
            sleep(1.0)
    finally:
        if "relay" in procs:
            _say(f"relay stopped reason=launcher_exit fast_exits={relay_fast_exits}")
        for name in list(procs):
            stop(name)


def build_commands(env: Mapping[str, str], *, primary: bool, elected_file: str, mtx_cfg: str) -> Dict[str, List[str]]:
    commands = {
        "mediamtx": [env.get("MEDIAMTX_BIN") or "/opt/mediamtx/mediamtx", mtx_cfg],
        "relay": relay_args(env),
        "crop": crop_args(env.get("FFMPEG_BIN") or "ffmpeg"),
    }
    # Only the primary may stream with no edge, and only while no calibration is installed yet.
    if not primary or (env.get("EDGE_CALIBRATION") or "").strip():
        commands["edge"] = edge_args(env, elected_file=elected_file, ledger=ledger_path(env), primary=primary)
    return commands


def main(argv: List[str] | None = None) -> int:
    env = os.environ
    primary = "--primary" in (sys.argv[1:] if argv is None else argv)
    workdir = tempfile.mkdtemp(prefix="lot-vision-")
    elected = os.path.join(workdir, "elected")
    mtx_cfg = os.path.join(workdir, "mediamtx.yml")
    with open(mtx_cfg, "w", encoding="utf-8") as fh:
        fh.write(mediamtx_config())
    try:
        commands = build_commands(env, primary=primary, elected_file=elected, mtx_cfg=mtx_cfg)
    except LauncherConfigError as exc:
        print(f"lot-vision: refusing to start: {exc}", file=sys.stderr)
        return 2
    if "edge" not in commands:
        print("lot-vision: no EDGE_CALIBRATION yet: relay and crop only, nothing is counted", file=sys.stderr)
    os.makedirs(os.path.dirname(ledger_path(env)), exist_ok=True)
    return supervise(lambda name: subprocess.Popen(commands[name], cwd=HERE), elected_file=elected,
                     primary=primary, run_edge="edge" in commands)


if __name__ == "__main__":
    raise SystemExit(main())
