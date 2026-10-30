"""How many candidate paths each blind-frame gate clears, and how many portal crossings that erased.

NicksMax, 2026-10-30: a replay of the portal rule on the box's recorded ground points found 1-17
geometric crossings a day since 10-23 against ZERO arrivals, and about 85% lost before that.
`TrackGraph.mark_degraded()` clears every candidate's path on any blind frame, on purpose (a
crossing nobody observed must not count), so one blind frame between a car's outside hits and its
inside run erases the crossing. Which gate does it was unknown because nothing counted it. These
counters are RECORD ONLY: nothing here promotes a track.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from test_vision import car_box, frames, make_pipeline  # noqa: E402
from vision.frame import Detection  # noqa: E402


def _drive_in(blind_at=None, enter=True):
    """A car from outside the lot across the portal and into it; one unverified frame at `blind_at`."""
    n_empty, n_move, n_park = 10, 7, 20
    boxes, dets = [], []
    for _ in range(n_empty):
        boxes.append([])
        dets.append([])
    x = 20.0
    for _ in range(n_move):
        b = car_box(x)
        boxes.append([b])
        dets.append([Detection(b, 0.9, "vehicle", "stub")])
        x += 30.0 if enter else 0.0
    last = car_box(x - (30.0 if enter else 0.0))
    for _ in range(n_park):
        boxes.append([last])
        dets.append([Detection(last, 0.9, "vehicle", "stub")])
    pipe = make_pipeline()
    for i, (f, d) in enumerate(zip(frames(len(boxes), boxes), dets)):
        if blind_at is not None and i == blind_at:
            f.meta["window_verified"] = False
        pipe.step(f, detections=d)
    return pipe


def test_a_clean_crossing_clears_nothing_and_counts_one_arrival():
    pipe = _drive_in()
    s = pipe.summary()
    assert s["arrivals"] == 1, s
    assert s["pathClears"] == {}, s
    assert s["crossingsErased"] == {}, s


def test_one_blind_frame_mid_crossing_is_counted_as_a_clear_AND_an_erased_crossing():
    # Frames 10-14 put the ground point outside the lot (x 55..175); frame 15 is the first
    # inside sample. A blind frame there wipes the outside history the crossing needs.
    pipe = _drive_in(blind_at=15)
    s = pipe.summary()
    assert s["arrivals"] == 0, "precondition: the blind frame really erased this arrival"
    assert s["pathClears"] == {"unverified": 1}, s
    assert s["crossingsErased"] == {"unverified": 1}, s


def test_a_clear_on_a_car_that_never_enters_is_not_an_erased_crossing():
    pipe = _drive_in(blind_at=13, enter=False)
    s = pipe.summary()
    assert s["arrivals"] == 0
    assert s["pathClears"].get("unverified") == 1, s
    assert s["crossingsErased"] == {}, s


def test_a_counting_failure_still_clears_paths_and_never_stops_the_frame_loop():
    """The instrument must not change what it measures (manager review of #3394): if the
    counting throws, mark_degraded still runs and the next frames still process."""
    boxes = [[]] * 10
    dets = [[]] * 10
    x = 20.0
    for _ in range(7):
        b = car_box(x)
        boxes.append([b])
        dets.append([Detection(b, 0.9, "vehicle", "stub")])
        x += 30.0
    pipe = make_pipeline()

    def boom(_pt):
        raise RuntimeError("counting broke")

    for i, (f, d) in enumerate(zip(frames(len(boxes), boxes), dets)):
        if i == 15:
            f.meta["window_verified"] = False
            pipe.portal.inside_zone.contains = boom
        if i == 16:
            del pipe.portal.inside_zone.contains   # the portal works again for the rest
            pipe._erased_watch[999] = ("unverified", None, f.ts)   # an entry that makes the check throw
        pipe.step(f, detections=d)
        if i == 15:
            assert all(len(t.path) <= 1 for t in pipe.tracks.tracks.values()), "paths were not cleared"
    assert pipe.stats.frames == len(boxes), "the frame loop stopped"
    assert pipe.stats.gate_stats_errors >= 2, pipe.stats.gate_stats_errors


def test_a_persistent_counting_failure_logs_a_traceback_once_then_one_line_per_ten_minutes(caplog):
    """At 4 fps a failure on every blind frame would write ~700 MB of tracebacks a day on a
    box that had 1.26 GB free (manager, #3394 follow-up). First failure: one traceback. Then
    at most one summary line per GATE_ERROR_LOG_SECONDS, carrying the running count."""
    import logging
    from vision.frame import Frame
    from vision import pipeline as pl

    pipe = make_pipeline(startup_grace=0.0)

    def boom(_pt):
        raise RuntimeError("counting broke")

    # A candidate with a path, so every blind frame has something to count.
    for f, d in zip(frames(12, [[car_box(20.0)]] * 12), [[Detection(car_box(20.0), 0.9, "vehicle", "stub")]] * 12):
        pipe.step(f, detections=d)
    base = f.ts
    pipe.portal.inside_zone.contains = boom      # only the blind frames below use it
    caplog.set_level(logging.INFO, logger="vision.pipeline")
    n = int(getattr(pl, "GATE_ERROR_LOG_SECONDS", 600.0) * 2.5)   # 25 minutes of blind frames at 1 fps
    for i in range(1, n + 1):
        t = pipe.tracks.tracks
        for tr in t.values():                       # give each track a path again to count
            tr.path.append(tr.ground_point)
        blind = Frame(ts=base + i, seq=0, source="test", image=f.image, meta={"window_verified": False})
        pipe.step(blind)
    records = [r for r in caplog.records if r.name == "vision.pipeline"]
    tracebacks = [r for r in records if r.exc_info]
    assert len(tracebacks) == 1, [r.getMessage() for r in records]
    assert 2 <= len(records) <= 3, [r.getMessage() for r in records]
    assert "still failing" in records[-1].getMessage(), records[-1].getMessage()
    assert pipe.stats.gate_stats_errors == n, "every failure is still counted"
