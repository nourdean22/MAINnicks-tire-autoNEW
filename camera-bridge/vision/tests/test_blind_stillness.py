"""Stillness must be credited only for time the tracker actually observed.

THE DEFECT. `Track.still_since` is a timestamp written in exactly one place -- the matched
branch of `TrackGraph.update()`, when a track moves further than `move_epsilon`. It does not
advance while the tracker is not being stepped. The CLOCK does. So `now - still_since`, which
is what decides whether a track is "parked", counted every blind interval as stillness.

WHY THAT IS EXPENSIVE. Stillness buys `parked_max_misses` (150 misses, ~37s at 4fps) instead
of `max_misses` (12, ~3s). A vehicle that was actively DRIVING when the camera lost the lot --
a PTZ pan, an unverified capture, an untrusted pose -- came back promoted to "parked" purely
because time passed while nobody was looking. If it left during the pan, its ghost was held on
the lot for ~37 seconds instead of ~3, sitting on the departed car's last position where the
next detection can be matched onto it by IoU. That merges two vehicles into one visit, which
is the mirror of the re-acquisition split the hard-case corpus was built to study.

WHAT MUST NOT REGRESS. The motion gate is NOT blind time. A gated frame means the motion
detector ran and reported nothing moving -- real evidence of stillness, and most of the day on
a quiet lot. `parked_after` exists because a flat 12-miss tolerance minted 40 track births for
~7 stationary vehicles in 14 minutes, and every one of those births was a chance to invent an
arrival. Subtracting gated time would bring that straight back, so the tests below assert both
directions: the driving car loses the promotion, and the parked car keeps it.
"""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from vision.frame import Detection                                    # noqa: E402
from vision.track import TrackGraph                                   # noqa: E402

FPS = 4.0
DT = 1.0 / FPS


def _det(x: float, y: float = 200.0, score: float = 0.9) -> Detection:
    """One confident 40x30 detection whose ground point is (x+20, y+30)."""
    return Detection(box=(x, y, x + 40.0, y + 30.0), score=score, label="car", source="test")


#: Big enough to count as a MOVE (`move_epsilon` is 14.0), small enough that consecutive
#: 40px-wide boxes still overlap above `match_iou` (0.25) and stay ONE track. At 40px the
#: boxes are disjoint, the tracker correctly mints a new track every frame, and a test
#: written that way measures track birth instead of movement.
STEP_PX = 18.0


def _drive(g: TrackGraph, t0: float, frames: int = 6) -> tuple[float, float]:
    """Move one car across the frame. Returns (last timestamp, last x)."""
    now, x = t0, 100.0
    for i in range(frames):
        now, x = t0 + i * DT, 100.0 + i * STEP_PX
        g.update([_det(x)], now)
    assert len(g.tracks) == 1, f"the drive split into {len(g.tracks)} tracks"
    return now, x


class BlindTimeIsNotStillnessTest(unittest.TestCase):

    def test_a_blind_interval_does_not_make_a_MOVING_car_look_parked(self):
        """THE BUG, stated as arithmetic. Drive a car, go blind for 30s, come back.

        30s exceeds `parked_after` (25s), so before the fix the very first frame after the
        blind interval reported the car as parked -- on the strength of nothing but the
        clock.
        """
        g = TrackGraph()
        now, x = _drive(g, 1000.0)
        track = next(iter(g.tracks.values()))
        self.assertLess(track.stationary_for(now), 1.0, "it was moving every frame")

        blind_start = now + DT
        for i in range(120):                       # 30s of pose-suppressed frames at 4fps
            g.mark_degraded(blind_start + i * DT)
        back = blind_start + 120 * DT

        self.assertGreaterEqual(back - track.still_since, g.parked_after,
                                "the control: raw wall-clock DOES cross the parked threshold, "
                                "which is exactly why the old expression was wrong")
        g.update([_det(x)], back)                  # the same car, still there
        self.assertLess(track.stationary_for(back), 1.0,
                        "30 unobserved seconds are not 30 seconds of observed stillness")

    def test_a_car_that_leaves_during_the_blind_interval_dies_on_the_SHORT_tolerance(self):
        """The consequence the fix is actually for.

        A moving car that vanishes gets `max_misses` (12), so it is retired in ~3s. Promoted
        to parked it would get `parked_max_misses` (150) and linger ~37s as a ghost.
        """
        g = TrackGraph()
        now, _x = _drive(g, 2000.0)
        blind_start = now + DT
        for i in range(120):
            g.mark_degraded(blind_start + i * DT)
        now = blind_start + 120 * DT

        for i in range(g.max_misses + 1):          # the car is gone: empty detections
            now += DT
            _born, died = g.update([], now)
            if died:
                break
        self.assertTrue(died, "a car lost while moving must be retired on the short tolerance")
        self.assertLessEqual(i + 1, g.max_misses + 1)

    def test_a_GENUINELY_parked_car_keeps_its_protection_across_a_blind_interval(self):
        """THE CANARY, and the regression that a naive fix would have shipped.

        Re-basing stillness on every blind frame -- the obvious one-line "fix" -- would strip
        parked protection from cars that really were parked, and `parked_after` exists
        precisely because that churn invents arrivals. Here the car holds still for 40s
        OBSERVED, then the camera goes blind for 30s. It is still parked.
        """
        g = TrackGraph()
        t0 = 3000.0
        now = t0
        for i in range(int(40.0 * FPS)):           # 40s of observed stillness, same box
            now = t0 + i * DT
            g.update([_det(500.0)], now)
        track = next(iter(g.tracks.values()))
        self.assertGreaterEqual(track.stationary_for(now), g.parked_after)

        blind_start = now + DT
        for i in range(120):                       # 30s blind
            g.mark_degraded(blind_start + i * DT)
        now = blind_start + 120 * DT
        g.update([_det(500.0)], now)
        self.assertGreaterEqual(track.stationary_for(now), g.parked_after,
                                "40 observed seconds of stillness survive a blind interval")

        for _ in range(g.max_misses + 4):          # a dropout longer than the short tolerance
            now += DT
            _b, died = g.update([], now)
            self.assertFalse(died, "a parked car must not be retired on 12 misses")

    def test_the_motion_gate_is_not_blind_time(self):
        """A gated frame is an OBSERVATION of stillness, and must still count as one.

        The motion-gate branch in `pipeline.step()` returns without calling either `update()`
        or `mark_degraded()`, so this asserts the property at the seam that matters: a stretch
        of frames the tracker was never told about costs nothing, because nothing charged it.
        """
        g = TrackGraph()
        t0 = 4000.0
        g.update([_det(600.0)], t0)
        track = next(iter(g.tracks.values()))
        gated_until = t0 + 40.0                    # 40s where the gate skipped the detector
        g.update([_det(600.0)], gated_until)
        self.assertGreaterEqual(track.stationary_for(gated_until), g.parked_after,
                                "gated time is observed stillness; only mark_degraded() charges")

    def test_a_track_BORN_after_the_blind_interval_owes_nothing(self):
        """The debt belongs to tracks that lived through it, not to whatever arrives next.

        Charging a newborn would make a car that has just driven in read as having been
        stationary for negative time -- clamped to zero, so invisible, but it would also
        poison the first stillness it legitimately accumulates.
        """
        g = TrackGraph()
        t0 = 5000.0
        g.update([_det(100.0)], t0)
        for i in range(120):
            g.mark_degraded(t0 + DT + i * DT)
        back = t0 + DT + 120 * DT
        born, _died = g.update([_det(100.0), _det(700.0)], back)
        self.assertEqual(len(born), 1, "the second detection is a new car")
        self.assertEqual(born[0].blind_seconds, 0.0)

    def test_moving_again_clears_the_debt(self):
        """Otherwise an old blind interval is subtracted from stillness that started later.

        A car that pans out of view, comes back, drives on and THEN parks would carry the
        pan's 30 seconds forever and could never accumulate enough observed stillness to be
        treated as parked -- the original bug, inverted.
        """
        g = TrackGraph()
        t0 = 6000.0
        g.update([_det(100.0)], t0)
        for i in range(120):
            g.mark_degraded(t0 + DT + i * DT)
        now = t0 + DT + 120 * DT
        track = next(iter(g.tracks.values()))
        g.update([_det(100.0)], now)
        self.assertGreater(track.blind_seconds, 25.0, "the control: the debt was charged")

        now += DT
        g.update([_det(100.0 + STEP_PX)], now)     # a real move, past move_epsilon
        self.assertEqual(track.blind_seconds, 0.0)
        for i in range(int(30.0 * FPS)):           # 30s of observed stillness afterwards
            now += DT
            g.update([_det(100.0 + STEP_PX)], now)
        self.assertGreaterEqual(track.stationary_for(now), g.parked_after,
                                "stillness measured after the move must not pay an old debt")


class GenerationBreakTest(unittest.TestCase):

    def test_a_generation_break_degrades_the_path_but_not_the_stillness(self):
        """`edge_main` calls `mark_degraded()` with no timestamp on a capture failover.

        A window restore swaps which pixels arrive; it is not a claim that nothing was
        observed, and the cars in the new generation are overwhelmingly the same cars parked
        where they were. Charging them would churn every one of them on every restore. The
        PATH is still discarded -- that hazard is real and unchanged.
        """
        g = TrackGraph()
        t0 = 7000.0
        now = t0
        for i in range(int(40.0 * FPS)):
            now = t0 + i * DT
            g.update([_det(500.0)], now)
        track = next(iter(g.tracks.values()))
        before = track.stationary_for(now)

        g.mark_degraded()                          # no timestamp: the generation-break caller
        self.assertEqual(len(track.path), 1, "the path is still discarded")
        g.update([_det(500.0)], now + DT)
        self.assertAlmostEqual(track.stationary_for(now + DT), before + DT, places=6)
        self.assertTrue(track.degraded)


if __name__ == "__main__":
    unittest.main()


class VisitdIsToldTheTruthTest(unittest.TestCase):
    """The consumer seam, and the reason this defect was expensive rather than cosmetic.

    `VisionPipeline._emit` hands visitd `"stationary": track.stationary_for(now) > 3.0`, and
    visitd's state machine treats that flag as an OR-branch past its own dwell requirements
    (`visitd/state_machine.py:750,752`):

        ENTERED_ZONE      -> ARRIVAL_CANDIDATE   when dwell >= 10s  OR stationary
        ARRIVAL_CANDIDATE -> CONFIRMED_ARRIVAL   when dwell >= 45s  OR (stationary and dwell >= 20s)

    So the threshold that mattered was never `parked_after` (25s). It was THREE SECONDS. Any
    blind interval longer than that reported a moving vehicle as stationary, which skipped the
    10-second candidate gate outright and cut confirmation from 45s to 20s -- for a car that
    was driving. Inventing an arrival for a vehicle that drove past is the exact failure this
    package exists to prevent, and the longest blind run measured on real recorded pixels was
    8.5 seconds.
    """

    #: `_emit`'s threshold. Duplicated deliberately: if the pipeline changes it, this test
    #: should be re-read by a person rather than silently track it.
    STATIONARY_AFTER = 3.0

    def test_a_blind_interval_alone_never_reports_a_moving_car_as_stationary(self):
        g = TrackGraph()
        now, x = _drive(g, 8000.0)
        track = next(iter(g.tracks.values()))

        blind_start = now + DT
        for i in range(40):                        # 10s blind: past 3s, under parked_after
            g.mark_degraded(blind_start + i * DT)
        back = blind_start + 40 * DT

        self.assertGreater(back - track.still_since, self.STATIONARY_AFTER,
                           "the control: raw wall-clock DOES cross the flag's threshold")
        g.update([_det(x)], back)
        self.assertFalse(track.stationary_for(back) > self.STATIONARY_AFTER,
                         "visitd must not be told a driving car held still, because that "
                         "flag alone promotes it to ARRIVAL_CANDIDATE")

    def test_a_car_that_really_did_hold_still_is_still_reported_stationary(self):
        """The other half. Suppressing the flag for genuinely parked cars would break
        arrival confirmation for every vehicle that parks quickly, which is most of them."""
        g = TrackGraph()
        t0 = 9000.0
        now = t0
        for i in range(int(8.0 * FPS)):            # 8s of observed stillness
            now = t0 + i * DT
            g.update([_det(500.0)], now)
        track = next(iter(g.tracks.values()))
        self.assertTrue(track.stationary_for(now) > self.STATIONARY_AFTER)
