"""Is the producer actually analysing the lot, or just running?

THE FAILURE THIS EXISTS FOR
---------------------------
2026-09-16, 17:57-18:02. The producer process was up. Its scheduled task read `Running`.
The V380 client was up, logged in, showing SHOPSIGN's live view. `shop-pc-keepalive.ps1`
printed `chain OK`. Every signal in the system was green, and the lot was not being
counted at all: zero track points for twelve minutes.

What had happened is that the V380 window stopped being MAXIMISED. The producer captures
that window through Windows Graphics Capture, so it reads the window's own composited
surface -- burying it behind other windows is fine and is what makes headless operation
possible. But the channel box is resolved ONCE at startup, in window coordinates:

    channel 1: x=1084 y=65 552x310 ... of a 1920x1080 window

Un-maximise the window and the client re-flows its panes. That rectangle now frames
something else -- black letterbox, a sliver of the wrong lens -- and every frame after it
is garbage that happens to be well-formed. Nothing errors. The producer says so, once a
minute, in the only place that knew: a `POSE_OFF_HOME` hard case, meaning "what I am
looking at is not the scene this calibration was drawn against".

So the check is not "is the process alive" (it was) and not "has the ledger grown" (a
genuinely empty lot at 3am grows by nothing, and restarting on that would thrash the
machine all night). It is the producer's own, specific, unambiguous complaint.

WHY IT IS SCOPED TO THE CURRENT RUN
-----------------------------------
`edge.log` is append-only across restarts. The five `POSE_OFF_HOME` lines from a broken
run are still sitting in the file after a healthy restart, so a check that just greps the
tail would fire immediately against the producer that had already been repaired, restart
it, and fire again three minutes later -- for ever. Counting only what the CURRENT run has
said is the whole difference between a self-heal and a restart loop.

That is also why a missing run marker returns UNKNOWN rather than False. A check that
cannot tell which run it is reading must not get a vote.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import re
import sys
from typing import Optional, Tuple

#: The producer writes one of these per minute while its view does not match the
#: calibration. Nothing else in the log means "up, but looking at the wrong rectangle".
POSE_OFF_HOME = "POSE_OFF_HOME"

#: The wrapper writes this banner on every start, so it delimits runs within one log.
RUN_START = "==== edge start"

LOG_TS = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})[,.]\d+")

HEALTHY, STALLED, UNKNOWN = 0, 1, 2


def _stamp(line: str) -> Optional[_dt.datetime]:
    m = LOG_TS.match(line)
    if not m:
        return None
    return _dt.datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S")


def pose_stalled(log_text: str, now: _dt.datetime,
                 window_seconds: int = 300,
                 threshold: int = 3) -> Tuple[int, str]:
    """Verdict on the CURRENT run only.

    Returns one of HEALTHY / STALLED / UNKNOWN with a reason fit for a log line.

    `threshold` is in units of "complaints the current run has made", and the producer
    makes at most one per minute, so 3 means a run has to be visibly wrong for about
    three minutes before anything touches it. A producer restarted seconds ago cannot
    reach the threshold inside its own run, which is the grace period -- it falls out of
    the scoping rather than needing a clock of its own.
    """
    lines = log_text.splitlines()
    starts = [i for i, ln in enumerate(lines) if RUN_START in ln]
    if not starts:
        return UNKNOWN, (
            "no '%s' banner in the log, so the current run cannot be identified -- "
            "declining to judge rather than counting another run's complaints" % RUN_START)

    cutoff = now - _dt.timedelta(seconds=window_seconds)
    recent = 0
    latest = None
    for ln in lines[starts[-1]:]:
        if POSE_OFF_HOME not in ln:
            continue
        ts = _stamp(ln)
        if ts is None or ts < cutoff:
            continue
        recent += 1
        latest = ts

    if recent >= threshold:
        return STALLED, (
            "%d %s hard cases in the last %ds of the CURRENT run (latest %s) -- the "
            "producer is up but the rectangle it analyses is not the calibrated scene. "
            "Almost always: the V380 window is no longer maximised."
            % (recent, POSE_OFF_HOME, window_seconds,
               latest.strftime("%H:%M:%S") if latest else "?"))
    return HEALTHY, "%d %s in the last %ds of the current run" % (recent, POSE_OFF_HOME,
                                                                 window_seconds)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--log", required=True, help="path to edge.log")
    ap.add_argument("--window-seconds", type=int, default=300)
    ap.add_argument("--threshold", type=int, default=3)
    args = ap.parse_args(argv)
    try:
        with open(args.log, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    except OSError as exc:
        print("UNKNOWN cannot read %s: %s" % (args.log, exc))
        return UNKNOWN
    verdict, reason = pose_stalled(text, _dt.datetime.now(),
                                   args.window_seconds, args.threshold)
    print("%s %s" % ({HEALTHY: "HEALTHY", STALLED: "STALLED",
                      UNKNOWN: "UNKNOWN"}[verdict], reason))
    return verdict


if __name__ == "__main__":
    sys.exit(main())
