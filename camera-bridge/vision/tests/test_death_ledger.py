"""A re-acquisition rate needs a denominator, and nothing was recording one.

`TrackGraph.update()` returns a `died` list every frame. It had exactly two consumers: a
departure emission for tracks whose evidence is `arrival` (`pipeline.py`), and
`_note_reacquisition`, which records only the deaths that happened to coincide with a birth
nearby in space and time. Every other death was discarded.

So the hard-case corpus held a NUMERATOR -- "here are 12 re-acquisitions" -- against nothing.
Whether 12 is alarming or unremarkable depends entirely on how many tracks died in total and
how they were being treated when they did, and neither number existed anywhere.

WHY NOT RECONSTRUCT IT FROM `track_points`. Because it does not work, and it fails in the
way that is hardest to notice: it produces confident numbers. `_note_trajectory` skips every
SUPPRESSED frame, and the motion gate suppresses precisely when a car is holding still, so
the point table has recording gaps over a minute long -- one real track has a 71-second gap
while its `still` climbs from 2.3s to 73.0s uninterrupted. Two different windowing heuristics
over that table returned 76.7% and 73.1% for the same quantity, and both were artifacts of
the windowing rather than facts about the tracker.
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from vision.frame import Detection                                    # noqa: E402
from vision.track import TrackGraph                                   # noqa: E402
from vision.trajectory import (                                       # noqa: E402
    MIN_DEATHS_PER_BAND, TrajectoryStore, reacquisition_rates,
)

FPS = 4.0
DT = 1.0 / FPS


def _store() -> TrajectoryStore:
    s = TrajectoryStore(os.path.join(tempfile.mkdtemp(), "t.sqlite"))
    assert s.open, "the store must open for these tests to mean anything"
    return s


def _det(x: float, y: float = 200.0) -> Detection:
    return Detection(box=(x, y, x + 40.0, y + 30.0), score=0.9, label="car", source="test")


def _kill(g: TrackGraph, t0: float, *, still_frames: int) -> tuple[list, float]:
    """Birth a car, hold it still for `still_frames`, then starve it until it is retired."""
    now = t0
    for i in range(max(1, still_frames)):
        now = t0 + i * DT
        g.update([_det(300.0)], now)
    dead: list = []
    while not dead:
        now += DT
        _born, dead = g.update([], now)
        if now - t0 > 300.0:
            raise AssertionError("the track never died")
    return dead, now


class LedgerWritesEveryDeathTest(unittest.TestCase):

    def test_a_death_with_no_re_acquisition_is_still_recorded(self):
        """THE WHOLE POINT. This is the row that did not exist before, and it is the one the
        denominator is made of."""
        st, g = _store(), TrackGraph()
        dead, now = _kill(g, 1000.0, still_frames=4)
        self.assertEqual(st.note_deaths(now, dead, scene="shop-left", generation="0.0.1"), 1)
        rows = st.deaths()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][1], "shop-left")
        self.assertEqual(rows[0][14], 0, "0 is 'the detector looked and found nothing'")

    def test_the_row_records_the_TOLERANCE_THE_TRACKER_APPLIED(self):
        """`allowed` rather than a re-derived threshold. A reader that recomputed the band
        from `still_s` and `parked_after` would start lying the day either constant moved,
        and the rows already on disk would silently change meaning."""
        st, g = _store(), TrackGraph()
        dead, now = _kill(g, 2000.0, still_frames=4)          # ~1s still: the SHORT tolerance
        st.note_deaths(now, dead, scene="s", generation="g")
        self.assertEqual(st.deaths()[0][8], g.max_misses)

        st2, g2 = _store(), TrackGraph()
        dead2, now2 = _kill(g2, 3000.0, still_frames=int(40.0 * FPS))   # 40s still: PARKED
        st2.note_deaths(now2, dead2, scene="s", generation="g")
        self.assertEqual(st2.deaths()[0][8], g2.parked_max_misses)

    def test_a_track_that_was_never_retired_is_REFUSED_not_guessed(self):
        """`retired_allowed` is None on a live track. Writing a plausible tolerance would put
        a fabricated decision in the one table that exists to hold real ones."""
        st, g = _store(), TrackGraph()
        g.update([_det(300.0)], 4000.0)
        alive = list(g.tracks.values())
        self.assertEqual(st.note_deaths(4000.0, alive, scene="s", generation="g"), 0)
        self.assertEqual(st.deaths(), [])
        self.assertEqual(st.stats.dropped, 1)
        self.assertIn("un-retired", st.stats.last_error or "")

    def test_still_s_is_OBSERVED_stillness(self):
        """The ledger inherits the blind-interval correction. If it recorded raw wall-clock
        it would file cars as parked that the tracker itself did not treat as parked, and the
        two columns of the same row would disagree."""
        st, g = _store(), TrackGraph()
        t0 = 5000.0
        g.update([_det(300.0)], t0)
        for i in range(120):                                  # 30s blind
            g.mark_degraded(t0 + DT + i * DT)
        now = t0 + DT + 120 * DT
        g.update([_det(300.0)], now)
        dead = []
        while not dead:
            now += DT
            _b, dead = g.update([], now)
        st.note_deaths(now, dead, scene="s", generation="g")
        row = st.deaths()[0]
        self.assertLess(row[5], 25.0, "30 unobserved seconds are not stillness")
        self.assertGreater(row[4], 25.0, "but the track really is that old")
        self.assertEqual(row[8], g.max_misses, "so it died on the SHORT tolerance")

    def test_deaths_are_never_downsampled(self):
        """`observe()` throttles to 1 Hz per track because a parked car would otherwise
        outvote every car that moved. A death is an EVENT, not a sample -- dropping one
        loses the thing itself."""
        st = _store()
        rows = 0
        for i in range(5):                                    # five deaths inside one second
            g = TrackGraph()
            dead, now = _kill(g, 6000.0 + i * 0.05, still_frames=2)
            rows += st.note_deaths(6000.0, dead, scene="s", generation="g")
        self.assertEqual(rows, 5)
        self.assertEqual(len(st.deaths()), 5)


class ReacquisitionFlagTest(unittest.TestCase):

    def test_marking_a_death_re_acquired_finds_it_by_id_AND_time(self):
        st, g = _store(), TrackGraph()
        dead, now = _kill(g, 7000.0, still_frames=4)
        st.note_deaths(now, dead, scene="shop-left", generation="g")
        tid = dead[0].track_id
        self.assertTrue(st.mark_reacquired("shop-left", tid, now))
        self.assertEqual(st.deaths()[0][14], 1)
        self.assertEqual(st.stats.reacquired, 1)

    def test_the_WRONG_scene_does_not_match(self):
        """Two lenses are two pixel spaces and their track ids are independent counters.
        Matching across them would flag a death that was never re-acquired."""
        st, g = _store(), TrackGraph()
        dead, now = _kill(g, 8000.0, still_frames=4)
        st.note_deaths(now, dead, scene="shop-left", generation="g")
        self.assertFalse(st.mark_reacquired("shop-right", dead[0].track_id, now))
        self.assertEqual(st.deaths()[0][14], 0)

    def test_a_REUSED_track_id_from_another_run_does_not_match(self):
        """Ids restart at 1 on every producer restart and the ledger outlives a restart by
        design, so id alone would flag an unrelated car from hours earlier."""
        st, g = _store(), TrackGraph()
        dead, now = _kill(g, 9000.0, still_frames=4)
        st.note_deaths(now, dead, scene="s", generation="g")
        self.assertFalse(st.mark_reacquired("s", dead[0].track_id, now + 3600.0))
        self.assertEqual(st.deaths()[0][14], 0)

    def test_no_matching_death_is_FALSE_not_an_error(self):
        """A producer whose ledger was switched on mid-run has re-acquisitions whose deaths
        predate the table. That is a real zero, and it must not be counted as a failure."""
        st = _store()
        self.assertFalse(st.mark_reacquired("s", 42, 1234.0))
        self.assertEqual(st.stats.dropped, 0, "a miss is not a write failure")
        self.assertTrue(st.stats.healthy)


class RatesRefuseToGuessTest(unittest.TestCase):

    def _seed(self, st, band_allowed: int, deaths: int, reacquired: int, t0: float) -> None:
        """Write rows straight to the table: this is a test OF the reporting arithmetic."""
        for i in range(deaths):
            st._conn.execute(
                "INSERT INTO track_deaths(ts,scene,generation,track_id,age_s,still_s,hits,"
                "misses,allowed,evidence,degraded,score,x,y,reacquired) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (t0 + i, "s", "g", i, 10.0, 5.0, 5, band_allowed + 1, band_allowed,
                 "candidate", 0, 0.8, 1.0, 2.0, 1 if i < reacquired else 0))

    def test_a_thin_band_returns_INSUFFICIENT_rather_than_a_rate(self):
        """THE REFUSAL, and the reason this file exists rather than a one-line SQL query.
        Two small proportions always differ, and a number that came out of a tool gets
        quoted whether or not it means anything."""
        st = _store()
        self._seed(st, 12, MIN_DEATHS_PER_BAND, MIN_DEATHS_PER_BAND, 1.0)
        self._seed(st, 150, MIN_DEATHS_PER_BAND - 1, 0, 10_000.0)
        r = reacquisition_rates(st)
        self.assertEqual(r["verdict"], "insufficient")
        self.assertIn("parked", r["why"])
        self.assertNotIn("ratio", r)

    def test_with_enough_of_both_it_reports_the_comparison(self):
        st = _store()
        self._seed(st, 12, 100, 40, 1.0)                      # settling: 40%
        self._seed(st, 150, 100, 10, 10_000.0)                # parked:   10%
        r = reacquisition_rates(st)
        self.assertEqual(r["verdict"], "settling-window-loses-more")
        self.assertAlmostEqual(r["bands"]["settling"]["rate"], 0.40)
        self.assertAlmostEqual(r["bands"]["parked"]["rate"], 0.10)
        self.assertAlmostEqual(r["ratio"], 4.0)

    def test_it_does_not_invent_a_penalty_that_is_not_there(self):
        """The canary for the verdict. A report that could only ever say
        'the settling window loses more' would be a conclusion with a data-collection
        ceremony attached."""
        st = _store()
        self._seed(st, 12, 100, 10, 1.0)
        self._seed(st, 150, 100, 40, 10_000.0)
        self.assertEqual(reacquisition_rates(st)["verdict"], "no-settling-penalty")

    def test_an_EMPTY_band_rate_is_None_and_never_zero(self):
        """A rate of zero out of zero renders as 'we never lose these', which is the
        opposite of 'we have not seen one yet'."""
        st = _store()
        r = reacquisition_rates(st)
        self.assertIsNone(r["bands"]["settling"]["rate"])
        self.assertEqual(r["verdict"], "insufficient")


if __name__ == "__main__":
    unittest.main()
