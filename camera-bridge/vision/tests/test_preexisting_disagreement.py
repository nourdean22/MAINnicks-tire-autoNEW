"""The census could not be observed to be WRONG, and its error is an under-count.

Every other guard in this package stops the shop's arrival count going UP for a car that
never arrived. `preexisting` is the strongest of them: a track born inside the startup or
reconnect blind window is never tested against the entry portal, so a boot census cannot
invent a lot full of arrivals. That is correct and it must stay.

It is also unfalsifiable. `pipeline.py` short-circuited on `if t.evidence != "candidate":
continue`, so the portal was never asked about a preexisting track and the two could never be
seen to disagree. A metric one screen down said as much in a comment --
`falseArrivalsFromPreexisting = 0  # structural: preexisting never reaches visitd` -- a
hardcoded zero that is true, and true because nothing can measure it.

The error it hides has the sign flipped. A vehicle that GENUINELY DROVE IN during a blind
window is classed preexisting and its arrival is lost, silently and permanently. The blind
windows are real: 8.5 seconds of continuous pose suppression measured on recorded pixels,
plus every capture reconnect.

So the portal is asked anyway, FOR THE RECORD ONLY. A preexisting track that goes on to
perform a full outside -> inside crossing is a car the system watched drive in while counting
it as already-there. The clip is what lets a person decide which of the two was right -- and
both readings are defensible for any single clip, which is exactly why it is a clip for a
human and not a threshold.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from test_vision import CAR_W, car_box, make_pipeline                 # noqa: E402
from vision.frame import Detection, Frame                             # noqa: E402

import numpy as np                                                    # noqa: E402


def _frame(ts: float, seq: int) -> Frame:
    return Frame(ts=ts, image=np.zeros((360, 640, 3), np.uint8), seq=seq, source="test",
                 meta={"window_verified": True})


def _drive_in(pipe, *, start_ts: float, x0: float = 100.0, steps: int = 14,
              step_px: float = 12.0, seq0: int = 0):
    """Walk a car from OUTSIDE the lot across the portal band, one detection per frame.

    `EntryPortal` wants >=2 ground-point samples outside the lot and then >=2 inside it. The
    lot starts at x=200 and the ground point is `x1 + CAR_W/2`, so x0=100 puts the first
    samples at x=135 -- genuinely outside -- and 12px steps carry it across 200 and into the
    portal band (200-320) while keeping consecutive 70px boxes overlapping enough to stay ONE
    track. Starting at x0=210 puts the ground point at 245, already inside, and produces no
    crossing at all: the tell is that the CANDIDATE control fails the same way.
    """
    last = None
    for i in range(steps):
        box = car_box(x0 + i * step_px)
        last = pipe.step(_frame(start_ts + i, seq0 + i),
                         detections=[Detection(box, 0.9, "vehicle", "stub")])
    return last


class TestPreexistingIsRecordedNotPromoted:

    def test_a_preexisting_track_that_crosses_is_RECORDED(self):
        """The measurement that did not exist. `startup_grace` is wide enough that the track
        is born inside the blind window and classed preexisting, and it then drives across
        the portal anyway."""
        pipe = make_pipeline(startup_grace=1000.0)
        out = _drive_in(pipe, start_ts=1000.0)
        assert pipe.stats.preexisting >= 1, "the control: the census must have claimed it"
        assert pipe.stats.preexisting_crossed == 1, (
            "the portal saw a full crossing by a track the census called already-there, and "
            "nothing recorded it")
        assert len(out.get("preexistingCrossed") or []) in (0, 1)

    def test_it_is_NOT_promoted_to_an_arrival(self):
        """THE LOAD-BEARING ASSERTION. Promoting would hand the boot census exactly the
        portal authority it was denied -- the false-arrival class this package exists to
        prevent -- and it would do it on the tracks least likely to be real crossings."""
        pipe = make_pipeline(startup_grace=1000.0)
        _drive_in(pipe, start_ts=2000.0)
        assert pipe.stats.preexisting_crossed == 1, "the control: the disagreement happened"
        assert pipe.stats.arrivals == 0, "a recorded disagreement must not mint an arrival"
        evidences = {t.evidence for t in pipe.tracks.tracks.values()}
        assert evidences == {"preexisting"}, f"evidence was mutated: {evidences}"

    def test_it_emits_NOTHING_to_visitd(self):
        """The consumer seam. `stats.arrivals` staying 0 is necessary and not sufficient --
        what actually reaches the shop is the emission list."""
        pipe = make_pipeline(startup_grace=1000.0)
        emitted = []
        for i in range(14):
            box = car_box(100.0 + i * 12.0)
            out = pipe.step(_frame(3000.0 + i, i),
                            detections=[Detection(box, 0.9, "vehicle", "stub")])
            emitted.extend(out.get("emissions") or [])
        assert pipe.stats.preexisting_crossed == 1, "the control"
        assert emitted == [], f"a preexisting crossing reached visitd: {emitted}"

    def test_it_is_recorded_ONCE_PER_CAR_not_once_per_frame(self):
        """The path keeps satisfying the portal on every later frame. Without the seen-set
        the counter measures FRAMES and the corpus fills with one vehicle."""
        pipe = make_pipeline(startup_grace=1000.0)
        _drive_in(pipe, start_ts=4000.0, steps=40)
        assert pipe.stats.preexisting_crossed == 1

    def test_a_preexisting_car_that_NEVER_CROSSES_records_nothing(self):
        """The canary. A gate that fired on every preexisting track would be a rename of
        `stats.preexisting`, and it would read as a fleet-wide census failure."""
        pipe = make_pipeline(startup_grace=1000.0)
        parked = car_box(400.0)                      # deep inside the lot, never outside it
        for i in range(40):
            pipe.step(_frame(5000.0 + i, i),
                      detections=[Detection(parked, 0.9, "vehicle", "stub")])
        assert pipe.stats.preexisting >= 1, "the control: it WAS classed preexisting"
        assert pipe.stats.preexisting_crossed == 0

    def test_a_CANDIDATE_that_crosses_still_becomes_an_arrival(self):
        """The other canary, and the regression that would matter most. The observation-only
        branch sits directly above the promotion branch; breaking arrivals to add a counter
        would take the lot down while every new test here stayed green."""
        pipe = make_pipeline(startup_grace=0.0)      # no blind window: births are candidates
        _drive_in(pipe, start_ts=6000.0)
        assert pipe.stats.preexisting == 0, "the control: nothing was classed preexisting"
        assert pipe.stats.arrivals == 1, "a real arrival must still be promoted"
        assert pipe.stats.preexisting_crossed == 0
