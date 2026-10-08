"""Restart continuity: a car parked through a producer restart keeps the visit it had.

THE DEFECT (measured 2026-10-08). Every sign-edge restart force-ended the restored visits,
and the cars still parked were then born inside the census's startup window, classed
`preexisting`, and never reached visitd. So a parked car's visit closed as LEFT at the
restart and the car stayed invisible until it left and re-entered: the 15:27 ET deploy
closed visit 856937fa (55 min, estimated) and `visitd_tracker_new_visits` read 0 four
minutes later. Business-hour edge restarts ran ~3.7/day the week before, and each one
truncated the dwell the owner's lot brief counts as long stays.

THE FIX, end to end through the REAL wiring (`edge_main.reconcile_restart` -> visitd
`hold_departures` -> `VisionPipeline.arm_restart_rebind` -> visitd's resurrect-on-update):
a still car where a restored visit's car last was continues that visit under the old
object id. Everything ambiguous refuses and departs exactly as before.

Each scenario runs TWO producer processes over one SQLite ledger file, wired the way
`build_edge` wires them: the vision pipeline drives the visitd pipeline's own tracker, and
every step commits through `after_step`, the durable boundary.

POSITIVE CONTROLS:
  * `test_without_continuity_the_parked_car_is_LOST` pins the defect with the window
    disabled (`rebind_seconds=0`), so the instrument is proven able to see it;
  * the main test was run with the object-id alias removed from `VisionPipeline._emit`:
    red, because the restored visit departed and nothing continued it.
"""
from __future__ import annotations

import logging
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import edge_main                                                         # noqa: E402
from helpers import ev                                                   # noqa: E402
from test_main import make_pipeline                                      # noqa: E402
from visitd.ledger import Ledger                                         # noqa: E402
from visitd.state_machine import union_seconds                           # noqa: E402

from vision.capture import SyntheticSource                               # noqa: E402
from vision.detector import DetectorCouncil, StubDetector               # noqa: E402
from vision.frame import Detection                                       # noqa: E402
from vision.framehealth import FrameHealth                               # noqa: E402
from vision.geometry import EntryPortal, LotMap, Zone                   # noqa: E402
from vision.pipeline import VisionPipeline                               # noqa: E402
from vision.tests.test_vision import H, LOT, PORTAL, W, car_box         # noqa: E402

SIGN = {"cameras": {"sign": {"cloudDeviceId": "dev-sign", "arrivalZones": ["front_lot"]}},
        "backend": {"outboxMaxDepth": 50}}
DRIVE_IN = [20.0, 50.0, 80.0, 110.0, 140.0, 170.0, 200.0, 230.0]
DRIVE_OUT = [200.0, 170.0, 140.0, 110.0, 80.0, 50.0, 20.0]
PARK = 230.0


def _box(x):
    return tuple(int(v) for v in car_box(x))


class Process:
    """One producer process: visitd pipeline + the vision pipeline driving ITS tracker."""

    def __init__(self, path, start_ts, restart=True, rebind_seconds=20.0, max_gap=120.0):
        self.pipe = make_pipeline(ledger=Ledger(path), raw=SIGN)
        self.vision = VisionPipeline(
            council=DetectorCouncil(primary=StubDetector([])),
            lot_map=LotMap().add("front_lot", LOT),
            entry_portal=EntryPortal(Zone("front_lot", LOT), portal_zone=Zone("portal", PORTAL)),
            camera="sign", frame_health=FrameHealth(freeze_run=10 ** 6, min_distinct=0),
            tracker=self.pipe.tracker,
        )
        if restart:
            edge_main.seed_track_ids(self.vision, self.pipe.tracker, "sign")
            edge_main.reconcile_restart(self.pipe, "sign", vision=self.vision,
                                        rebind_seconds=rebind_seconds,
                                        rebind_max_gap_seconds=max_gap)
        self.first_ts = start_ts
        self.ts = start_ts
        self.emissions = []
        self.outs = []

    def run(self, frames):
        """`frames`: per frame, the x positions of the cars in view (one detection each)."""
        src = SyntheticSource([[car_box(x) for x in xs] for xs in frames],
                              size=(W, H), fps=1.0, start_ts=self.ts)
        for xs in frames:
            f = src.read()
            assert f is not None
            dets = [Detection(car_box(x), 0.9, "vehicle", "stub") for x in xs]
            out = self.vision.step(f, detections=dets)
            self.outs.append(out)
            emissions = list(out["emissions"])
            self.pipe.after_step(emissions)          # the durable boundary, as EdgeLoop does
            self.emissions.extend(emissions)
            self.ts += 1.0
        assert self.vision.stats.suppressed_unhealthy == 0, "the replay clock broke"

    def states(self, *names):
        return [e for e in self.emissions if getattr(e, "state", None) in names]

    def continuations(self):
        return [c for o in self.outs for c in (o.get("restartContinuations") or [])]

    def closed(self):
        return [o["restartRebind"] for o in self.outs if o.get("restartRebind")]

    def close(self):
        self.pipe.ledger.close()


class RestartContinuityTest(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".sqlite")
        os.close(fd)
        logging.getLogger("edge").setLevel(logging.ERROR)

    def tearDown(self):
        try:
            os.unlink(self.path)
        except OSError:
            pass

    # ------------------------------------------------------------------ helpers
    def _park_through_the_first_process(self):
        """Process 1 watches a real arrival through the portal, then the car parks."""
        p1 = Process(self.path, 1_000_000.0, restart=False)
        p1.run([[]] * 10 + [[x] for x in DRIVE_IN] + [[PARK]] * 60)
        ids = {e.visit_id for e in p1.emissions}
        self.assertEqual(len(ids), 1, "precondition: exactly one visit")
        self.assertTrue(p1.states("CONFIRMED_ARRIVAL"), "precondition: the arrival confirmed")
        p1.close()
        return ids.pop(), p1.ts

    def _seed(self, cars, at=1000.0, last=1060.0):
        """Process 1 by direct visitd events: {object id: x}, each parked and confirmed."""
        pipe = make_pipeline(ledger=Ledger(self.path), raw=SIGN)
        for oid, x in cars.items():
            pipe.after_step(pipe.tracker.handle_event(
                ev("new", oid, at, ["front_lot"], camera="sign", box=_box(x))))
            pipe.after_step(pipe.tracker.handle_event(
                ev("update", oid, last, ["front_lot"], camera="sign", box=_box(x), stationary=True)))
        ids = {oid: v.visit_id for v in pipe.tracker.open_visits() for oid in v.sightings}
        self.assertEqual(set(ids), set(cars), "precondition: every car has an open visit")
        pipe.ledger.close()
        return ids

    # ------------------------------------------------------------------ the fix
    def test_a_car_parked_through_a_restart_KEEPS_its_visit(self):
        visit_id, last = self._park_through_the_first_process()

        p2 = Process(self.path, last + 30.0)        # a deploy restart: ~30 s unwatched
        p2.run([[PARK]] * 40)
        try:
            self.assertEqual(p2.states("LEFT", "PASS_THROUGH"), [],
                             "a car that never moved was declared gone at the restart")
            open_visits = p2.pipe.tracker.open_visits()
            self.assertEqual([v.visit_id for v in open_visits], [visit_id], "the SAME visit, still open")
            self.assertEqual(open_visits[0].state, "CONFIRMED_ARRIVAL", "in the state it had")
            self.assertEqual(p2.pipe.tracker.counters["new_visits"], 0, "no second visit minted")
            self.assertEqual(p2.vision.stats.restart_continuations, 1)
            self.assertEqual(p2.vision.stats.arrivals, 0, "a continuation is NOT an arrival")
            self.assertEqual(p2.vision.summary()["falseArrivalsFromPreexisting"], 0)
            self.assertEqual(p2.closed(), [{**p2.closed()[0], "continued": 1, "ended": 0}],
                             "one window, closed once, with the car continued")

            # It then really leaves: exactly one LEFT, on the ORIGINAL visit.
            p2.run([[x] for x in DRIVE_OUT] + [[]] * 60)
            self.assertEqual([e.visit_id for e in p2.states("LEFT")], [visit_id])
            self.assertEqual(p2.pipe.tracker.open_visits(), [])
        finally:
            p2.close()

    def test_without_continuity_the_parked_car_is_LOST(self):
        """POSITIVE CONTROL: the defect, with the window disabled. If this ever stops being
        true the scenario above no longer measures anything."""
        visit_id, last = self._park_through_the_first_process()
        p2 = Process(self.path, last + 30.0, rebind_seconds=0.0)
        p2.run([[PARK]] * 40)
        try:
            self.assertEqual([e.visit_id for e in p2.states("LEFT")], [visit_id],
                             "the parked car's visit departs at the restart")
            self.assertEqual(p2.pipe.tracker.open_visits(), [],
                             "and the car that never moved is on no visit at all")
            self.assertEqual(p2.vision.stats.restart_continuations, 0)
        finally:
            p2.close()

    def test_a_car_GONE_during_the_downtime_departs_when_the_window_closes(self):
        visit_id, last = self._park_through_the_first_process()
        p2 = Process(self.path, last + 30.0)
        restored = p2.pipe.tracker.open_visits()[0]
        frozen = union_seconds(restored.intervals(), restored.last_activity)
        p2.run([[]] * 30)
        try:
            left = p2.states("LEFT")
            self.assertEqual([e.visit_id for e in left], [visit_id])
            self.assertGreaterEqual(left[0].at, p2.first_ts + 20.0,
                                    "not before the window (20 s from the first frame) closed")
            self.assertAlmostEqual(left[0].dwell_seconds, round(frozen, 1), delta=0.2,
                                   msg="dwell frozen at the last activity: the downtime is not billed")
            self.assertEqual(p2.closed()[0]["ended"], 1)
        finally:
            p2.close()

    def test_two_parked_cars_each_resume_their_OWN_visit(self):
        ids = self._seed({"sign-1": 230.0, "sign-2": 420.0})
        p2 = Process(self.path, 1090.0)
        p2.run([[230.0, 420.0]] * 10)
        try:
            got = {c["objectId"]: c["visitId"] for c in p2.continuations()}
            self.assertEqual(got, ids, "each car resumed its own visit; nothing swapped")
            self.assertEqual(sorted(v.visit_id for v in p2.pipe.tracker.open_visits()),
                             sorted(ids.values()))
            self.assertEqual(p2.states("LEFT"), [])
        finally:
            p2.close()

    # ------------------------------------------------------------- the refusals
    def _refused(self, cars, frames, start=1090.0, max_gap=120.0):
        ids = self._seed(cars)
        p2 = Process(self.path, start, max_gap=max_gap)
        p2.run(frames + [[]] * 25)
        p2.close()
        self.assertEqual(p2.continuations(), [], "nothing may continue a visit here")
        self.assertEqual(sorted(e.visit_id for e in p2.states("LEFT")), sorted(ids.values()),
                         "every restored visit departs, exactly as before continuity existed")
        return p2.closed()[0]["refused"]

    def test_one_track_over_TWO_restored_cars_refuses_both(self):
        refused = self._refused({"sign-1": 230.0, "sign-2": 245.0}, [[238.0]] * 6)
        self.assertEqual(refused.get("ambiguous_track"), 1)

    def test_two_tracks_over_ONE_restored_car_refuses(self):
        refused = self._refused({"sign-1": 230.0}, [[230.0, 238.0]] * 6)
        self.assertEqual(refused.get("ambiguous_car"), 1)

    def test_a_contested_car_departs_when_the_window_closes_EARLY_not_20s_later(self):
        """Once every restored car is decided the window closes at once and the refused
        ones are RELEASED. The lapsing deadline alone would also depart them, 20 s late; this
        pins the release itself (a mutation that dropped it survived every other test here)."""
        self._seed({"sign-1": 230.0})
        p2 = Process(self.path, 1090.0)
        p2.run([[230.0, 238.0]] * 6 + [[]] * 25)
        p2.close()
        closed = p2.closed()
        self.assertEqual(len(closed), 1)
        self.assertLess(closed[0]["at"], p2.first_ts + 20.0, "precondition: it closed EARLY")
        left = p2.states("LEFT")
        self.assertEqual(len(left), 1)
        self.assertLess(left[0].at, p2.first_ts + 20.0,
                        "the released visit departed at the early close, not at the deadline")

    def test_after_a_long_blackout_the_spot_may_hold_a_DIFFERENT_car(self):
        refused = self._refused({"sign-1": 230.0}, [[230.0]] * 6, start=1060.0 + 300.0)
        self.assertEqual(refused.get("gap"), 1)

    def test_a_car_DRIVING_through_the_old_spot_is_not_the_parked_one(self):
        refused = self._refused({"sign-1": 230.0}, [[230.0], [250.0], [270.0], [290.0]])
        self.assertEqual(refused.get("moved"), 1)

    def test_the_downtime_is_measured_from_EACH_cars_own_last_sighting(self):
        """The restart force-end advances every sighting's last_frame_time to ONE shared
        anchor (the latest activity on the camera). Reading the downtime after it would
        make an old sighting look fresh. Car 1 was last seen 240 s before the restart; car 2,
        seen later, sets the anchor."""
        ids = self._seed({"sign-1": 230.0}, at=1000.0, last=1060.0)
        pipe = make_pipeline(ledger=Ledger(self.path), raw=SIGN)
        pipe.after_step(pipe.tracker.handle_event(
            ev("new", "sign-2", 1200.0, ["front_lot"], camera="sign", box=_box(420.0))))
        pipe.after_step(pipe.tracker.handle_event(
            ev("update", "sign-2", 1260.0, ["front_lot"], camera="sign", box=_box(420.0),
               stationary=True)))
        pipe.ledger.close()
        p2 = Process(self.path, 1300.0)
        p2.run([[230.0, 420.0]] * 10 + [[]] * 25)
        p2.close()
        got = {c["objectId"] for c in p2.continuations()}
        self.assertEqual(got, {"sign-2"}, "only the car seen 40 s ago continues")
        self.assertIn(ids["sign-1"], {e.visit_id for e in p2.states("LEFT")},
                      "the car unseen for 240 s departs")


class ReconcileWithoutContinuityTest(unittest.TestCase):
    """Callers that pass no vision pipeline (or switch it off) keep the old behaviour."""

    def _restored(self):
        pipe = make_pipeline(raw=SIGN)
        pipe.tracker.handle_event(ev("new", "sign-1", 1000.0, ["front_lot"], camera="sign",
                                     box=_box(230.0)))
        return pipe

    def test_no_vision_means_no_hold(self):
        pipe = self._restored()
        self.assertEqual(edge_main.reconcile_restart(pipe, "sign"), 1)
        self.assertIsNone(pipe.tracker.open_visits()[0].restart_hold_until)

    def test_a_zero_window_means_no_hold(self):
        pipe = self._restored()
        vision = Process.__new__(Process)  # never used: the window is off
        self.assertEqual(edge_main.reconcile_restart(pipe, "sign", vision=vision, rebind_seconds=0.0), 1)
        self.assertIsNone(pipe.tracker.open_visits()[0].restart_hold_until)

    def test_a_failure_to_ARM_releases_the_holds(self):
        """A held visit nobody will ever release is a departed car kept on the lot."""
        pipe = self._restored()

        class Broken:
            def arm_restart_rebind(self, *_a, **_kw):
                raise RuntimeError("boom")

            def close_restart_rebind(self, _now):
                return None

        with self.assertLogs("edge", level="ERROR"):
            edge_main.reconcile_restart(pipe, "sign", vision=Broken(), rebind_seconds=20.0)
        self.assertIsNone(pipe.tracker.open_visits()[0].restart_hold_until)


if __name__ == "__main__":
    unittest.main()
