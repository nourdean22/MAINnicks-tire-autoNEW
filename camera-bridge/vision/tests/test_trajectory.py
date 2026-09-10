"""Commissioning geometry from real traffic: the tool must be refusable and must be right.

Two failure modes, opposite and both silent. A commissioner that always answers hands over a
polygon that came out of a tool and therefore gets believed. One that never answers is a
button nobody presses. So the suite is built around a CONTROL -- a known rectangle it must
recover to within the inset -- and a set of refusals it must produce for named reasons.
"""
from __future__ import annotations

import os
import random
import sys
import tempfile
import unittest
from types import SimpleNamespace

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import vision.trajectory as T                                              # noqa: E402
from vision.trajectory import (TrajectoryCommissioner, TrajectoryStore,     # noqa: E402
                               write_proposal)

CANON = (779, 438)


def _track(tid, x, y, still=0.0):
    return SimpleNamespace(track_id=tid, box=(x - 30, y - 50, x + 30, y),
                           ground_point=(x, y), stationary_for=lambda _n, s=still: s)


def _store(**kw):
    return TrajectoryStore(os.path.join(tempfile.mkdtemp(), "traj.sqlite"), **kw)


def _fill_rect(store, rect, tracks=200, per_track=40, seed=3, still=0.0, scene="s"):
    """`tracks` vehicles scattered uniformly over `rect`. The ground truth for the control.

    All tracks are handed to ONE `observe` per timestep. The store autocommits, so the
    obvious one-track-per-call loop makes 8,000 separate transactions per fixture and took
    this suite to 6m40s; batching is the same data in 40 transactions.
    """
    x0, y0, x1, y1 = rect
    rng = random.Random(seed)
    ts = 1000.0
    for _ in range(per_track):
        store.observe(ts, [_track(tid, rng.uniform(x0, x1), rng.uniform(y0, y1), still)
                           for tid in range(1, tracks + 1)],
                      scene=scene, generation="g1")
        ts += 1.0
    return store


class StoreTest(unittest.TestCase):

    def test_points_are_DOWNSAMPLED_per_track(self):
        """At 4 fps a single parked car contributes 14,400 identical points an hour and
        outvotes every car that actually moved. The store keeps one per track per second."""
        s = _store(min_interval=1.0)
        for i in range(20):                      # 20 frames inside one second
            s.observe(1000.0 + i * 0.05, [_track(1, 100, 200)], scene="s", generation="g")
        self.assertEqual(len(s.points("s")), 1)
        s.observe(1002.0, [_track(1, 100, 200)], scene="s", generation="g")
        self.assertEqual(len(s.points("s")), 2)

    def test_each_track_is_sampled_INDEPENDENTLY(self):
        """A shared clock would let a busy frame starve every track but the first."""
        s = _store(min_interval=1.0)
        s.observe(1000.0, [_track(1, 10, 10), _track(2, 20, 20), _track(3, 30, 30)],
                  scene="s", generation="g")
        self.assertEqual(len(s.points("s")), 3)

    def test_the_row_cap_EVICTS_oldest_first(self):
        # Eviction is amortised every 5,000 inserts, so the run has to cross that mark once.
        s = _store(min_interval=0.0, max_rows=200)
        ts = 1000.0
        for i in range(5200):
            s.observe(ts, [_track(1, i % 700, 200)], scene="s", generation="g")
            ts += 0.5
        self.assertGreater(s.stats.evicted, 0, "the row cap was never enforced")
        self.assertLess(len(s.points("s")), 5200, "nothing was actually removed")

    def test_a_store_that_cannot_OPEN_never_raises_at_the_caller(self):
        d = tempfile.mkdtemp()
        blocked = os.path.join(d, "traj.sqlite")
        os.makedirs(blocked)                     # a directory where the db should be
        s = TrajectoryStore(blocked)
        self.assertFalse(s.open)
        self.assertEqual(s.observe(1.0, [_track(1, 1, 1)], scene="s", generation="g"), 0)
        self.assertEqual(s.points("s"), [])
        self.assertFalse(s.stats.healthy)

    def test_HEALTHY_is_not_has_points(self):
        """A shop with no traffic yet is not a broken store. Conflating the two is the
        failure this codebase keeps removing."""
        s = _store()
        self.assertEqual(s.points("s"), [])
        self.assertTrue(s.stats.healthy)

    def test_a_MALFORMED_track_is_skipped_and_counted_not_fatal(self):
        s = _store()
        bad = SimpleNamespace(track_id=9)         # no box, no ground_point
        n = s.observe(1000.0, [bad, _track(2, 50, 50)], scene="s", generation="g")
        self.assertEqual(n, 1)
        self.assertEqual(s.stats.dropped, 1)


class SceneAttributionTest(unittest.TestCase):
    """A scene nobody recorded is not a quiet scene.

    Both render as zero points, and "not enough traffic yet" tells an operator to wait for
    data that is arriving under another name -- or under no name, because of a typo. It
    happened on the first real run: the producer filed 7,228 points from 69 tracks under
    "default" because the hook read a `source.binding` that does not exist, and the
    commissioner answered "0/40 tracks" as though the shop were empty.
    """

    def test_an_UNRECORDED_scene_says_so_and_names_what_exists(self):
        s = _fill_rect(_store(min_interval=0.0), (150, 150, 650, 370), scene="shop-left")
        p = TrajectoryCommissioner(s, canonical=CANON).propose("shop-right")
        self.assertFalse(p["ready"])
        self.assertIn("no points are recorded", p["why"])
        self.assertIn("shop-left", p["why"], "the refusal did not name what IS recorded")
        self.assertNotIn("not enough traffic", p["why"])

    def test_an_EMPTY_store_says_nothing_is_being_recorded_at_all(self):
        """A different problem with a different fix: not 'wait longer' but 'the producer was
        never started with --trajectories'."""
        p = TrajectoryCommissioner(_store(), canonical=CANON).propose("shop-left")
        self.assertFalse(p["ready"])
        self.assertIn("NO points for any scene", p["why"])

    def test_scenes_lists_what_is_actually_stored(self):
        s = _store(min_interval=0.0)
        _fill_rect(s, (10, 10, 60, 60), tracks=3, per_track=2, scene="a")
        _fill_rect(s, (10, 10, 60, 60), tracks=9, per_track=2, scene="b")
        self.assertEqual(s.scenes()[0], "b", "scenes are not ordered by how much there is")
        self.assertEqual(set(s.scenes()), {"a", "b"})


class DiagnoseTest(unittest.TestCase):
    """A refusal that only says "too narrow" leaves the operator with no next move."""

    def test_it_reports_WHERE_the_traffic_actually_was(self):
        rect = (150, 150, 650, 370)
        s = _fill_rect(_store(min_interval=0.0), rect)
        d = T.diagnose(s, CANON, "s")
        self.assertGreater(d["tracks"], 0)
        b = d["bbox"]
        # Within a cell of the truth on every edge.
        for got, want in ((b["x0"], rect[0]), (b["y0"], rect[1]),
                          (b["x1"], rect[2]), (b["y1"], rect[3])):
            self.assertLess(abs(got - want), 2 * T.CELL_PX, f"{got} vs {want}")

    def test_it_names_which_insets_would_SURVIVE(self):
        """The actionable half. On the first real run only an 8px inset kept anything, and
        without this the operator would only have been told 45px did not."""
        s = _fill_rect(_store(min_interval=0.0), (150, 150, 650, 370))
        d = T.diagnose(s, CANON, "s")
        usable = [r["px"] for r in d["insets"] if r["usable"]]
        self.assertTrue(usable, "no inset was reported usable for a 500x220 region")
        self.assertEqual(usable, sorted(usable))
        # Monotonic: a bigger inset can never keep MORE than a smaller one.
        keeps = [r["keepsFraction"] for r in d["insets"]]
        self.assertEqual(keeps, sorted(keeps, reverse=True))

    def test_it_does_not_RAISE_on_a_store_with_no_region(self):
        d = T.diagnose(_store(), CANON, "nothing")
        self.assertIn("why", d)
        self.assertEqual(d["regionCells"], 0)


class CommissionerControlTest(unittest.TestCase):
    """THE positive control. Without it every refusal test below passes on a tool that has
    only ever learned to say no."""

    def test_it_RECOVERS_a_known_rectangle_inset_by_the_configured_margin(self):
        rect = (150, 150, 650, 370)
        p = TrajectoryCommissioner(_fill_rect(_store(min_interval=0.0), rect),
                                   canonical=CANON).propose("s")
        self.assertTrue(p["ready"], p.get("why"))
        xs = [q[0] for q in p["lot"]]
        ys = [q[1] for q in p["lot"]]
        # Inset by INSET_PX, plus up to one CELL_PX of grid quantisation on each side.
        lo, hi = T.INSET_PX, T.INSET_PX + 2 * T.CELL_PX
        self.assertTrue(lo <= min(xs) - rect[0] <= hi, f"left edge inset {min(xs) - rect[0]}")
        self.assertTrue(lo <= rect[2] - max(xs) <= hi, f"right edge inset {rect[2] - max(xs)}")
        self.assertTrue(lo <= min(ys) - rect[1] <= hi, f"top edge inset {min(ys) - rect[1]}")
        self.assertTrue(lo <= rect[3] - max(ys) <= hi, f"bottom edge inset {rect[3] - max(ys)}")

    def test_the_proposal_reports_the_MEASURED_width_of_the_ground(self):
        """`regionInradiusPx` replaced a metric this module invented and then believed --
        lost-cells over a guessed perimeter, which reported a comfortable 55.6px band for a
        region the inset had already destroyed."""
        p = TrajectoryCommissioner(_fill_rect(_store(min_interval=0.0), (150, 150, 650, 370)),
                                   canonical=CANON).propose("s")
        # Half the 220px height is the true inradius of that rectangle.
        self.assertAlmostEqual(p["regionInradiusPx"], 110, delta=20)


class CommissionerRefusalTest(unittest.TestCase):

    def test_it_REFUSES_on_too_little_traffic_and_says_which_floor(self):
        s = _fill_rect(_store(min_interval=0.0), (150, 150, 650, 370), tracks=5, per_track=5)
        p = TrajectoryCommissioner(s, canonical=CANON).propose("s")
        self.assertFalse(p["ready"])
        self.assertIn("tracks", p["why"])
        self.assertNotIn("lot", p)

    def test_it_REFUSES_a_SLIVER_that_survived_the_inset(self):
        """The false-green this check exists for. Erosion that leaves a FRAGMENT still
        passes a "did it vanish?" test -- measured on frontage traffic it produced a READY
        proposal of 768 px against a 93,407 px polygon in force, with a fabricated
        "approach band" of 55.6px printed beside it.

        The shape and inset here are measured, not guessed: at 150px deep and a 60px inset
        the region survives erosion (so the vanish and no-contour branches do NOT fire) and
        retains 12%, which only the retained-fraction check rejects. Two earlier attempts at
        this test hit a neighbouring refusal and looked like they were testing this one.
        """
        thin = _fill_rect(_store(min_interval=0.0), (100, 200, 700, 350))
        p = TrajectoryCommissioner(thin, canonical=CANON, inset_px=60.0).propose("s")
        self.assertFalse(p["ready"], "a sliver survived the inset and was proposed anyway")
        self.assertIn("leaves only", p["why"])
        self.assertIn("deep at its widest", p["why"])

    def test_the_SAME_region_is_proposable_at_a_smaller_inset(self):
        """The matched control. A refusal that fired on this shape regardless of the inset
        would be a tool that never works rather than a tool that is careful -- and every
        other refusal test in this class would still pass."""
        same = _fill_rect(_store(min_interval=0.0), (100, 200, 700, 350))
        p = TrajectoryCommissioner(same, canonical=CANON, inset_px=45.0).propose("s")
        self.assertTrue(p["ready"], p.get("why"))
        self.assertGreater(p["retainedFraction"], T.MIN_RETAINED_FRACTION)

    def test_ONE_car_parked_forever_does_not_mint_a_region(self):
        """Cells count DISTINCT TRACKS, never samples. Parked cars are the majority of what
        this camera sees, and a week of one of them would otherwise become high-confidence
        'drivable' ground that nothing ever drove through."""
        # 500, not 50,000: the claim is "samples never substitute for distinct tracks", and
        # 500 is already 166x the MIN_TRACKS_PER_CELL floor. The larger number proved nothing
        # extra and turned one assertion into 50,000 SQLite round-trips.
        s = _store(min_interval=0.0)
        ts = 1000.0
        for _ in range(500):
            s.observe(ts, [_track(1, 400, 300, still=99999)], scene="s", generation="g")
            ts += 1.0
        grid = T._occupancy(s.points("s"), CANON)
        self.assertEqual(int(np.count_nonzero(grid)), 0,
                         "50,000 samples from ONE track created drivable ground")


class DiffTest(unittest.TestCase):
    """The number an operator actually acts on."""

    def test_it_names_BOTH_directions_of_a_wrong_polygon(self):
        rect = (150, 150, 650, 370)
        s = _fill_rect(_store(min_interval=0.0), rect)
        # A polygon in force that is half right: it covers the left of the lot and a large
        # region of tarmac to the right that no vehicle has ever been on.
        current = {"lot": [[150, 150], [400, 150], [400, 370], [150, 370]]}
        p = TrajectoryCommissioner(s, canonical=CANON).propose("s", current=current)
        d = p["diff"]
        self.assertLess(d["deadFraction"], 0.15, "it claims dead ground that is not dead")
        self.assertGreater(d["missedFraction"], 0.3,
                           "half the measured lot is outside the polygon and it did not say so")
        self.assertIn("%", d["reading"])

    def test_NO_current_polygon_is_a_stated_absence_not_a_zero(self):
        s = _fill_rect(_store(min_interval=0.0), (150, 150, 650, 370))
        p = TrajectoryCommissioner(s, canonical=CANON).propose("s", current={"lot": []})
        self.assertEqual(p["diff"]["current"], "none")
        self.assertNotIn("deadFraction", p["diff"])


class NeverAppliesTest(unittest.TestCase):
    """The promise the module makes in its first paragraph, asserted by trying to break it."""

    def test_writing_a_proposal_over_a_CALIBRATION_name_is_refused(self):
        d = tempfile.mkdtemp()
        for name in ("calib-shop-left.json", "CALIB-shop-right.json", "shop.calib.json"):
            with self.assertRaises(ValueError, msg=f"{name} was accepted"):
                write_proposal({"ready": True}, os.path.join(d, name))
            self.assertFalse(os.path.exists(os.path.join(d, name)),
                             f"{name} was written before the refusal")

    def test_a_proposal_filename_IS_accepted(self):
        """Positive control: a refusal that rejected every path would make the module
        unusable while looking maximally safe."""
        d = tempfile.mkdtemp()
        out = write_proposal({"ready": True}, os.path.join(d, "proposal-shop-left.json"))
        self.assertTrue(os.path.exists(out))

    # A third test here used to grep the module source for "calib-shop" and friends. It
    # went red on the module's own DOCSTRING, which names the calibration it exists to
    # replace -- and this repo bans presence assertions for exactly that reason: "is this
    # string still in the file" measures nothing about what the code does. The two
    # behavioural tests above are the guard.


if __name__ == "__main__":
    unittest.main()
