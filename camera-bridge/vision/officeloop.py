"""Run the office capture on shop hours: 08:00-18:00 America/New_York, every day.

`officepost.py` handles ONE window. This is the loop around it, and its whole job is knowing
when NOT to run. Outside shop hours the office is a private room, and the cheapest way to keep
it that way is to never open the stream.

WHY A LOOP AND NOT A CRON ENTRY. The capture is stateful for the length of a window -- ffmpeg
holds the RTSP session open for the whole `--seconds` -- so a scheduler that fires every N
minutes would either overlap itself or leave gaps between windows. One long-lived process that
asks "am I in the window?" before each cycle has neither problem, and it is a single Windows
scheduled task set to run at boot.

DST IS HANDLED BY THE ZONE, NEVER BY AN OFFSET. `America/New_York` is -05:00 for part of the
year and -04:00 for the rest. Computing the window from a fixed offset silently shifts the
shop's hours by an hour twice a year -- which is how a capture ends up running at 7am in March.
`zoneinfo` resolves the offset for each instant instead, so 8am means 8am in both halves.

THE WINDOW EDGE IS TRIMMED, NOT OVERRUN. A 300-second capture starting at 17:58 would run to
18:03. Rather than skip it (losing the last two minutes of the day) or let it overrun (recording
after hours), the loop shortens the final capture to land exactly on the boundary.
"""
from __future__ import annotations

import json
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime, time as dtime, timedelta
from typing import List, Optional

try:
    from zoneinfo import ZoneInfo
except ImportError:                                              # pragma: no cover - py<3.9
    ZoneInfo = None                                              # type: ignore[assignment]

#: The shop's clock. Never a fixed offset -- see the module docstring.
SHOP_TZ = "America/New_York"

DEFAULT_OPEN = dtime(8, 0)
DEFAULT_CLOSE = dtime(18, 0)

#: Longest single sleep. A loop that sleeps eight hours in one call misses a clock change, a
#: laptop suspend, and any chance to notice it was asked to stop. Re-checking costs nothing.
MAX_SLEEP_S = 300.0

#: A capture shorter than this is not worth opening the stream for; the tail of the day just
#: ends a few seconds early instead.
MIN_TAIL_S = 30.0


class TimezoneDataMissing(RuntimeError):
    """The tz database is absent. Named so the shop PC reports the fix, not a stack trace."""


def _zone(tz: str = SHOP_TZ):
    """Resolve the shop's zone, or fail LOUDLY.

    WINDOWS SHIPS NO SYSTEM TZ DATABASE. Stdlib `zoneinfo` raises ZoneInfoNotFoundError for
    "America/New_York" unless the `tzdata` package is installed -- measured on this box,
    Python 3.14.4, 2026-09-22. It is in vision/requirements.txt for that reason.

    There is deliberately NO fallback to a fixed UTC offset. A silent fallback would work for
    most of the year and then shift the shop's hours by an hour on the two DST days, which is
    the failure that is hardest to notice and worst to have: recording before the shop opens.
    """
    if ZoneInfo is None:
        raise TimezoneDataMissing("zoneinfo is unavailable; python 3.9+ is required for correct DST")
    try:
        return ZoneInfo(tz)
    except Exception as exc:                                     # noqa: BLE001
        raise TimezoneDataMissing(
            f"no tz database entry for {tz!r}. On Windows: pip install tzdata "
            "(stdlib zoneinfo has no bundled database there)"
        ) from exc


def now_local(tz: str = SHOP_TZ) -> datetime:
    return datetime.now(_zone(tz))


@dataclass
class WindowState:
    """Where `when` sits relative to the shop's open hours."""
    is_open: bool
    #: Seconds until the window opens. 0 while open.
    seconds_until_open: float
    #: Seconds until the window closes. 0 while closed.
    seconds_until_close: float


def window_state(when: datetime, open_at: dtime = DEFAULT_OPEN,
                 close_at: dtime = DEFAULT_CLOSE) -> WindowState:
    """Classify one instant against the daily window.

    `when` must be timezone-aware and already in the shop's zone; the caller owns the
    conversion so this function stays pure and testable across DST boundaries.
    """
    today_open = when.replace(hour=open_at.hour, minute=open_at.minute, second=0, microsecond=0)
    today_close = when.replace(hour=close_at.hour, minute=close_at.minute, second=0, microsecond=0)

    if today_open <= when < today_close:
        return WindowState(True, 0.0, (today_close - when).total_seconds())
    # Before open today, or after close -- in which case the next opening is tomorrow.
    nxt = today_open if when < today_open else (today_open + timedelta(days=1))
    return WindowState(False, (nxt - when).total_seconds(), 0.0)


def capture_seconds(state: WindowState, requested: float,
                    min_tail: float = MIN_TAIL_S) -> Optional[float]:
    """How long the NEXT capture should run, trimmed so it cannot outlive the window.

    Returns None when the remaining time is too short to be worth opening the stream.
    """
    if not state.is_open:
        return None
    if state.seconds_until_close >= requested:
        return requested
    return state.seconds_until_close if state.seconds_until_close >= min_tail else None


def run_forever(source_url: str, out_dir: str, *, seconds: float = 300.0,
                source: str = "eufy-office", transcriber: str = "whisper-cli",
                model: Optional[str] = None, endpoint: Optional[str] = None,
                input_format: str = "auto",
                open_at: dtime = DEFAULT_OPEN, close_at: dtime = DEFAULT_CLOSE,
                tz: str = SHOP_TZ, silence_db: Optional[float] = None,
                max_cycles: Optional[int] = None, sleeper=time.sleep) -> int:
    """Capture-transcribe-post on a loop, only inside the window. Returns an exit code.

    `max_cycles` and `sleeper` exist so a test can drive this without real time passing.
    """
    from officeaudio import FfmpegMissing, capture_window
    from officepost import (DEFAULT_ENDPOINT, TranscriberMissing, build_payload, post_episode,
                            transcribe)

    endpoint = endpoint or DEFAULT_ENDPOINT
    cycles = 0
    consecutive_failures = 0

    while max_cycles is None or cycles < max_cycles:
        cycles += 1
        state = window_state(now_local(tz), open_at, close_at)
        if not state.is_open:
            # Bounded sleep, then re-check. Never one long sleep to the open time.
            sleeper(min(state.seconds_until_open, MAX_SLEEP_S))
            continue

        dur = capture_seconds(state, seconds)
        if dur is None:
            sleeper(min(max(state.seconds_until_close, 1.0), MAX_SLEEP_S))
            continue

        kw = {} if silence_db is None else {"silence_db": silence_db}
        try:
            segs = capture_window(
                source_url,
                out_dir,
                dur,
                source=source,
                input_format=input_format,
                **kw,
            )
        except FfmpegMissing as exc:
            # Unrecoverable and operator-fixable. Spinning on it would hide it.
            _log({"event": "ffmpeg_missing", "detail": str(exc)})
            return 3
        except Exception as exc:                                 # noqa: BLE001
            consecutive_failures += 1
            _log({"event": "capture_failed", "detail": str(exc)[:300],
                  "consecutiveFailures": consecutive_failures})
            sleeper(_backoff(consecutive_failures))
            continue

        for seg in segs:
            try:
                tr = transcribe(seg.path, binary=transcriber, model=model)
            except TranscriberMissing as exc:
                _log({"event": "transcriber_missing", "detail": str(exc)})
                return 6
            payload = build_payload(seg, tr)
            result = post_episode(payload, endpoint=endpoint)
            _log({"event": "episode", "episodeId": payload["episodeId"],
                  "coverage": round(payload["coveredSeconds"] / payload["totalSeconds"], 3)
                  if payload["totalSeconds"] else None,
                  "transcriptError": tr.error, "posted": result.get("posted"),
                  "reply": result.get("reply") or result.get("error")})

        # A window that produced NO segments is normal (a quiet stretch) and is logged as such
        # so a silent producer and a quiet room stay distinguishable in the log.
        if not segs:
            _log({"event": "no_segments", "seconds": dur})
        consecutive_failures = 0

    return 0


def _backoff(failures: int) -> float:
    """Capped exponential backoff. Keeps retrying -- a shop that reopens should recover."""
    return float(min(MAX_SLEEP_S, 5.0 * (2 ** min(failures, 6))))


def _log(obj: dict) -> None:
    obj["ts"] = datetime.now(_zone()).isoformat()
    print(json.dumps(obj), flush=True)


def _parse_hhmm(raw: str) -> dtime:
    hh, mm = raw.split(":")
    return dtime(int(hh), int(mm))


def main(argv: List[str]) -> int:
    import argparse

    ap = argparse.ArgumentParser(description="office capture on shop hours")
    ap.add_argument(
        "--source-url",
        default=os.environ.get("NICK_OFFICE_AUDIO_SOURCE")
        or os.environ.get("NICK_OFFICE_RTSP")
        or "",
        help="audio source; defaults to NICK_OFFICE_AUDIO_SOURCE (legacy NICK_OFFICE_RTSP fallback)",
    )
    ap.add_argument(
        "--input-format",
        choices=("auto", "rtsp", "dshow", "generic"),
        default=os.environ.get("NICK_OFFICE_AUDIO_INPUT_FORMAT", "auto").strip().lower(),
    )
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--seconds", type=float, default=300.0)
    ap.add_argument("--source", default="eufy-office")
    ap.add_argument("--transcriber", default="whisper-cli")
    ap.add_argument("--model", default=None)
    ap.add_argument("--endpoint", default=None)
    ap.add_argument("--open", dest="open_at", default="08:00")
    ap.add_argument("--close", dest="close_at", default="18:00")
    ap.add_argument("--tz", default=SHOP_TZ)
    ap.add_argument("--silence-db", type=float, default=None)
    ap.add_argument("--once", action="store_true",
                    help="run a single cycle and exit (for a smoke test)")
    args = ap.parse_args(argv)
    if not args.source_url:
        ap.error("--source-url or NICK_OFFICE_AUDIO_SOURCE is required")
    if args.input_format not in {"auto", "rtsp", "dshow", "generic"}:
        ap.error("NICK_OFFICE_AUDIO_INPUT_FORMAT must be auto, rtsp, dshow, or generic")

    return run_forever(
        args.source_url, args.out_dir, seconds=args.seconds, source=args.source,
        transcriber=args.transcriber, model=args.model, endpoint=args.endpoint,
        open_at=_parse_hhmm(args.open_at), close_at=_parse_hhmm(args.close_at),
        tz=args.tz, silence_db=args.silence_db, input_format=args.input_format,
        max_cycles=1 if args.once else None,
    )


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
