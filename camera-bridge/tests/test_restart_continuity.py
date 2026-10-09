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

THE EPISODE SEAM (`RestartEpisodeTest`, below). The stitcher's episode id lived only on
emissions, never in the ledger, so a continued car's track carried NO episode. When that
track later died and the car was re-acquired, the stitcher correctly called it the same
car -- and handed the new visit the fragment's FALLBACK id, `"{camera}-{track_id}"`. The
shop's Lot counts `COUNT(DISTINCT COALESCE(episodeId, visitId))`, so one car read as two.
Measured red on the unfixed code: Lot arrivals 2, episodes `sign-1000016-1` vs `sign-2`.
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

    def __init__(self, path, start_ts, restart=True, rebind_seconds=20.0, max_gap=120.0,
                 lot=None):
        self.lot = lot
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
            if self.lot is not None:
                for em in emissions:                  # this process's OWN mirror, as a restart leaves it
                    self.lot.deliver(self.pipe.shop.row_for(em))
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


class ShopLot:
    """The shop's side of the episode seam, reduced to what the Lot's car count reads.

    Rows are the producer's REAL `ShopMirror.row_for` output. They land the way the ingest
    lands them (apps/nickstire/server/routes/cameraVisitsRoutes.ts): a seq-guarded full-row
    replace in which `episodeId` is LEARNED_ONCE, i.e. `COALESCE(VALUES(episodeId), episodeId)`
    -- a null never erases a stored episode, a non-null replaces it. `arrivals()` is the Lot's
    `COUNT(DISTINCT CASE WHEN state <> 'PASS_THROUGH' THEN COALESCE(episodeId, visitId) END)`
    (apps/nickstire/server/routers/lot.ts).
    """

    def __init__(self):
        self.rows = {}

    def deliver(self, row):
        stored = self.rows.get(row["visitId"])
        if stored is not None and row["seq"] < stored["seq"]:
            return
        landed = dict(row)
        if stored is not None and landed.get("episodeId") is None:
            landed["episodeId"] = stored.get("episodeId")
        self.rows[row["visitId"]] = landed

    def arrivals(self):
        return len({r["episodeId"] or r["visitId"] for r in self.rows.values()
                    if r["state"] != "PASS_THROUGH"})


#: The car is unseen long enough for its PARKED track to die (parked_max_misses=150) and for
#: visitd to close the visit through its 20 s grace -- then it drives in again, inside the
#: stitcher's 60 s window from the death. visitd opens a SECOND visit (its own split-track
#: join is 10 s); the stitcher judges it the SAME car. Same shape as
#: vision/tests/test_vision.py::test_a_reacquired_car_keeps_its_original_arrival_instant.
LOST_THEN_BACK = [[]] * 180 + [[x] for x in DRIVE_IN] + [[PARK]] * 60


class RestartEpisodeTest(unittest.TestCase):
    """A car that CONTINUED its visit across a restart keeps its episode when it is re-acquired."""

    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".sqlite")
        os.close(fd)
        logging.getLogger("edge").setLevel(logging.ERROR)
        self.lot = ShopLot()

    def tearDown(self):
        try:
            os.unlink(self.path)
        except OSError:
            pass

    def _first_process(self):
        p1 = Process(self.path, 1_000_000.0, restart=False, lot=self.lot)
        p1.run([[]] * 10 + [[x] for x in DRIVE_IN] + [[PARK]] * 60)
        p1.close()
        episodes = {e.episode_id for e in p1.emissions}
        self.assertEqual(len(episodes), 1, "precondition: one visit, one episode")
        episode = episodes.pop()
        self.assertTrue(episode, "precondition: the stitcher stamped the arrival's episode")
        self.assertEqual(self.lot.arrivals(), 1)
        return p1, episode

    def _assert_one_car(self, last, episode, p1_visit):
        self.assertEqual(last.continuations()[0]["visitId"], p1_visit,
                         "precondition: the parked car continued its visit across the restart")
        self.assertEqual(last.vision.summary()["stitch"]["stitched"], 1,
                         "precondition: the stitcher judged the re-acquisition the SAME car")
        self.assertEqual(len(self.lot.rows), 2,
                         "precondition: visitd opened a second visit for the re-acquisition")
        got = {vid[:8]: r["episodeId"] for vid, r in self.lot.rows.items()}
        self.assertEqual(set(got.values()), {episode},
                         f"the re-acquired visit lost the car's episode: {got}")
        self.assertEqual(self.lot.arrivals(), 1, "ONE car on the Lot, counted twice")

    def test_a_continued_car_reacquired_after_its_track_dies_is_ONE_car_on_the_Lot(self):
        p1, episode = self._first_process()
        p2 = Process(self.path, p1.ts + 30.0, lot=self.lot)
        try:
            p2.run([[PARK]] * 40 + LOST_THEN_BACK)
            self._assert_one_car(p2, episode, p1.emissions[0].visit_id)
        finally:
            p2.close()

    def test_the_episode_survives_a_SECOND_restart(self):
        """The middle process continues the car but emits nothing for it, so the episode
        reaches the third only if every re-save of the visit left the ledger's copy alone."""
        p1, episode = self._first_process()
        p2 = Process(self.path, p1.ts + 30.0, lot=self.lot)
        p2.run([[PARK]] * 40)
        p2.close()
        self.assertEqual(p2.continuations()[0]["visitId"], p1.emissions[0].visit_id)
        p3 = Process(self.path, p2.ts + 30.0, lot=self.lot)
        try:
            p3.run([[PARK]] * 40 + LOST_THEN_BACK)
            self._assert_one_car(p3, episode, p1.emissions[0].visit_id)
        finally:
            p3.close()

    def test_without_a_restart_the_same_reacquisition_is_ONE_car(self):
        """CONTROL: the count this scenario must equal is the system's own, not the model's.
        One process, the same park / lost / back drive: the stitcher keeps the episode."""
        p = Process(self.path, 1_000_000.0, restart=False, lot=self.lot)
        try:
            p.run([[]] * 10 + [[x] for x in DRIVE_IN] + [[PARK]] * 100 + LOST_THEN_BACK)
            self.assertEqual(p.vision.summary()["stitch"]["stitched"], 1)
            self.assertEqual(len(self.lot.rows), 2, "visitd opened two visits")
            self.assertEqual(self.lot.arrivals(), 1)
        finally:
            p.close()

    def test_a_visit_with_NO_recorded_episode_still_continues(self):
        """A ledger written before the episode column (or a visit that never had one) restores
        with no episode: the car still continues its visit, exactly as before this fix."""
        p1, _ = self._first_process()
        led = Ledger(self.path)
        led._conn.execute("UPDATE visits SET episode_id = NULL")
        led.close()
        p2 = Process(self.path, p1.ts + 30.0, lot=self.lot)
        try:
            p2.run([[PARK]] * 40)
            self.assertEqual(p2.vision.stats.restart_continuations, 1)
            self.assertEqual(p2.states("LEFT"), [])
            self.assertEqual([tm.episode_id for tm in p2.vision.timings.values()], [None])
        finally:
            p2.close()


#: A second car's path: in through the portal and on to x=500, clear of a car parked at PARK.
DRIVE_IN_FAR = DRIVE_IN + [260.0, 290.0, 320.0, 350.0, 380.0, 410.0, 440.0, 470.0, 500.0]
FAR = 500.0


class TwoCarEpisodeTest(unittest.TestCase):
    """Each car keeps ITS OWN episode when two cars share the lot (review of 2026-10-09).

    `VisionPipeline._emit` stamped the calling track's episode onto EVERY emission visitd
    returned for that event, including other visits' timer-driven promotions. So a second car's
    CONFIRMED_ARRIVAL carried the first car's episode, the shop's COALESCE took it, and two cars
    counted as one on the Lot. The ledger then kept the wrong episode, and a restart handed it to
    the continuation.
    """

    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".sqlite")
        os.close(fd)
        logging.getLogger("edge").setLevel(logging.ERROR)
        self.lot = ShopLot()

    def tearDown(self):
        try:
            os.unlink(self.path)
        except OSError:
            pass

    def _own_episodes(self, proc):
        led = Ledger(self.path)
        try:
            return led.open_visit_episodes()
        finally:
            led.close()

    def test_two_overlapping_arrivals_are_TWO_cars_without_a_restart(self):
        p = Process(self.path, 1_000_000.0, restart=False, lot=self.lot)
        try:
            p.run([[]] * 10 + [[x] for x in DRIVE_IN_FAR] + [[FAR]] * 30
                  + [[FAR, x] for x in DRIVE_IN] + [[FAR, PARK]] * 60)
            self.assertEqual(len(self.lot.rows), 2, "precondition: two visits")
            self.assertEqual(self.lot.arrivals(), 2, f"two cars counted as one: {self.lot.rows}")
            p.pipe.ledger._conn.commit()
        finally:
            p.close()
        episodes = self._own_episodes(p)
        self.assertEqual(len(set(episodes.values())), 2, f"each visit must keep its own episode: {episodes}")

    def test_a_car_arriving_after_a_restart_is_not_merged_with_the_continued_one(self):
        p1 = Process(self.path, 1_000_000.0, restart=False, lot=self.lot)
        p1.run([[]] * 10 + [[x] for x in DRIVE_IN_FAR] + [[FAR]] * 60)
        p1.close()
        self.assertEqual(self.lot.arrivals(), 1)
        p2 = Process(self.path, p1.ts + 30.0, lot=self.lot)
        try:
            p2.run([[FAR]] * 40 + [[FAR, x] for x in DRIVE_IN] + [[FAR, PARK]] * 60)
            self.assertEqual(p2.vision.stats.restart_continuations, 1, "precondition: the parked car continued")
            self.assertEqual(len(self.lot.rows), 2)
            self.assertEqual(self.lot.arrivals(), 2, f"the new arrival took the continued car's episode: {self.lot.rows}")
        finally:
            p2.close()
        episodes = self._own_episodes(p2)
        self.assertEqual(len(set(episodes.values())), 2, f"each visit must keep its own episode: {episodes}")


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
