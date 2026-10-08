"""Phantom re-arrivals: one parked car, many visits.

The SHOPSIGN ledger carried track `sign-188` as a run of visits for one car that never moved
(2026-10-05/06). Mechanism, end to end, with the REAL visitd tracker:

  1. `LotMap.zones_at` is a point-in-polygon test on the box's bottom-centre. For a car parked ON
     the arrival-zone edge that point reads outside for long stretches and inside for a few
     frames.
  2. The pipeline reported the observed zones faithfully (`current_zones: []`), visitd closed the
     zone interval, went DEPARTING, waited its 20 s leave grace and emitted LEFT, which pops the
     visit.
  3. The track was still alive with `evidence == "arrival"`, so the next inside sample was sent
     as an "update" for an object id visitd no longer knew -- and visitd minted a brand-new visit
     for the same parked car. Repeat.

Two fixes, both in the pipeline (visitd stays a pure function of the stream it is fed):

  * zone hysteresis for ARRIVAL tracks: a parked car does not leave without moving, so the
    arrival zone is held while the track has not moved since its last inside sample, and a track
    that HAS moved still needs several consecutive outside samples before the zone is dropped;
  * a visit visitd closed (LEFT / PASS_THROUGH) ends the track's arrival authority: the track is
    demoted to a candidate with a cleared path and must perform a fresh portal crossing to open
    another visit. Until then it is occupancy, not a customer.

Positive control: both replay scenarios were run against the unfixed pipeline first and failed
(second visit minted; ghost open visit for a car on the street).
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from vision.capture import SyntheticSource  # noqa: E402
from vision.frame import Detection  # noqa: E402
from vision.tests.test_vision import H, W, car_box, make_pipeline  # noqa: E402

FPS = 1.0  # 30 px/frame at 1 fps stays under the 45 px/s path-continuity ceiling
EDGE_OUT = 164.0   # bottom-centre x = 199 -> one pixel OUTSIDE the lot polygon (x >= 200)
EDGE_IN = 166.0    # bottom-centre x = 201 -> one pixel INSIDE
DRIVE_IN = [20.0, 50.0, 80.0, 110.0, 140.0, 170.0, 200.0, 230.0]


class Replay:
    """One pipeline, one continuous clock.

    A fresh SyntheticSource per phase would restart its virtual timestamps, and FrameHealth
    (correctly) refuses frames from a camera that travels back in time -- which is how a first
    draft of this file passed its second phase without processing a single frame of it.
    """

    def __init__(self, pipe):
        self.pipe = pipe
        self.emissions = []
        self._ts = 0

    def run(self, xs):
        """Feed one detection per frame (None = empty frame). Returns this phase's emissions."""
        boxes = [[car_box(x)] if x is not None else [] for x in xs]
        src = SyntheticSource(boxes, size=(W, H), fps=FPS, start_ts=1_000_000.0 + self._ts / FPS)
        phase = []
        for x in xs:
            f = src.read()
            assert f is not None
            d = [Detection(car_box(x), 0.9, "vehicle", "stub")] if x is not None else []
            phase.extend(self.pipe.step(f, detections=d)["emissions"])
            self._ts += 1
        self.emissions.extend(phase)
        return phase

    def states(self, state):
        return _states(self.emissions, state)


def _states(emissions, state):
    return [e for e in emissions if getattr(e, "state", None) == state]


def test_a_car_parked_on_the_zone_edge_stays_one_visit():
    pipe = make_pipeline(startup_grace=0.0)
    rp = Replay(pipe)
    xs = [None] * 10 + DRIVE_IN            # enter through the portal
    xs += [200.0, 170.0]                   # roll back toward the edge, still inside
    xs += [EDGE_OUT] * 30                  # park straddling the edge, point one px OUTSIDE, 30 s
    xs += [EDGE_IN] * 15                   # the box settles one px INSIDE
    rp.run(xs)

    entered = rp.states("ENTERED_ZONE")
    assert len({e.visit_id for e in entered}) == 1, (
        "a parked car was minted a second visit: " + str([(e.visit_id, e.at) for e in entered])
    )
    assert rp.states("LEFT") == [], "a car that never moved was declared LEFT"
    assert pipe.stats.suppressed_unhealthy == 0, "the replay clock broke; nothing below is proven"
    assert pipe.stats.zone_exit_held > 0, "the hysteresis never fired, so this proved nothing"
    assert len(pipe.tracker.open_visits()) == 1
    assert rp.states("CONFIRMED_ARRIVAL"), "45 s parked inside the zone must confirm the arrival"

    # The SAME car then really drives out and off camera: exactly one LEFT, still one visit.
    rp.run([130.0, 100.0, 70.0, 40.0, 10.0] + [None] * 60)
    assert pipe.stats.suppressed_unhealthy == 0
    assert len(rp.states("LEFT")) == 1, pipe.summary()
    assert len({e.visit_id for e in rp.emissions if getattr(e, "visit_id", None)}) == 1
    assert pipe.tracker.open_visits() == []


def test_a_departed_car_parked_on_the_street_does_not_reopen_a_visit():
    pipe = make_pipeline(startup_grace=0.0)
    rp = Replay(pipe)
    xs = [None] * 10 + DRIVE_IN
    xs += [230.0] * 25                         # a real customer: parks inside long enough to confirm
    xs += [200.0, 170.0, 140.0, 110.0, 80.0]   # drives out through the portal lane
    xs += [80.0] * 60                          # parks on the street, in view, for a minute
    rp.run(xs)

    assert pipe.stats.suppressed_unhealthy == 0
    assert rp.states("CONFIRMED_ARRIVAL"), pipe.summary()
    left = rp.states("LEFT")
    assert len(left) == 1, pipe.summary()
    # Before the fix a DETECTED visit was silently opened for the car on the street the frame
    # after LEFT, and sat there as an open visit that had never entered a zone.
    assert pipe.tracker.open_visits() == [], "a ghost visit is open for a car on the street"
    assert pipe.stats.rearmed_after_terminal == 1
    track = next(iter(pipe.tracks.tracks.values()))
    assert track.evidence == "candidate", "the departed track kept arrival authority"

    # It drives back in: a REAL second arrival, through the portal, timed from the re-entry --
    # not from the original birth 90 seconds earlier.
    rp.run([110.0, 140.0, 170.0, 200.0, 230.0])
    assert pipe.stats.suppressed_unhealthy == 0
    entered = rp.states("ENTERED_ZONE")
    assert len({e.visit_id for e in entered}) == 2, pipe.summary()
    second = entered[-1]
    assert second.visit_id != left[0].visit_id
    assert second.frigate_start_time >= left[0].at, (
        f"second visit starts at {second.frigate_start_time}, before it LEFT at {left[0].at}"
    )
    assert pipe.stats.arrivals == 2


def test_a_moving_car_that_leaves_the_zone_is_reported_outside_promptly():
    """The control for the hysteresis: it must not turn a real exit into a phantom presence."""
    pipe = make_pipeline(startup_grace=0.0)
    rp = Replay(pipe)
    rp.run([None] * 10 + DRIVE_IN + [200.0, 170.0, 140.0, 110.0, 80.0, 50.0])
    track = next(iter(pipe.tracks.tracks.values()))
    assert track.evidence == "arrival"
    assert "front_lot" not in track.zones, "a car well outside the lot is still reported inside"
    assert pipe.stats.zone_exit_held == 0, "a moving car must not be held in the zone"


def test_hysteresis_holds_only_an_arrival_that_has_not_moved():
    pipe = make_pipeline(startup_grace=0.0)
    rp = Replay(pipe)
    rp.run([None] * 10 + DRIVE_IN + [200.0, 170.0])
    track = next(iter(pipe.tracks.tracks.values()))
    assert track.evidence == "arrival" and "front_lot" in track.zones

    # Not moved since the last inside sample: held, every frame, for as long as it sits there.
    rp.run([EDGE_OUT] * 5)
    assert pipe.stats.suppressed_unhealthy == 0
    assert "front_lot" in track.zones
    assert pipe.stats.zone_exit_held >= 5

    # A candidate (not yet an arrival) gets no hysteresis at all: zones are what was observed.
    pipe2 = make_pipeline(startup_grace=0.0)
    Replay(pipe2).run([None] * 10 + [EDGE_IN, EDGE_IN, EDGE_OUT])
    cand = next(iter(pipe2.tracks.tracks.values()))
    assert cand.evidence == "candidate"
    assert cand.zones == []
    assert pipe2.stats.zone_exit_held == 0
