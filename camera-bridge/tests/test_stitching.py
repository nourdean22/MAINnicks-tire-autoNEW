"""Identity stitching: split-track IoU, plate join + hard reject, topology, timeouts."""
from __future__ import annotations

import unittest

from helpers import T0, ev, lpr, states, ticks, tracker

from visitd.state_machine import CONFIRMED_ARRIVAL, DEPARTING, ENTERED_ZONE, LEFT, PASS_THROUGH, levenshtein, normalize_plate, plate_summary


def _parked_then_lost(t, plate=None, plate_score=None):
    """Track A parks in front_lot, is confirmed, then Frigate ends it INSIDE the zone (occlusion)."""
    t.handle_event(ev("new", "A", T0))
    t.handle_event(ev("update", "A", T0 + 1.0, ["front_lot"]))
    t.handle_event(ev("update", "A", T0 + 12.0, ["front_lot"], stationary=True, plate=plate, plate_score=plate_score))
    t.handle_event(ev("update", "A", T0 + 46.0, ["front_lot"], stationary=True, plate=plate, plate_score=plate_score))
    out = t.handle_event(ev("end", "A", T0 + 60.0, ["front_lot"], stationary=True, end=T0 + 60.0, plate=plate, plate_score=plate_score))
    assert out == []
    return t.open_visits()[0]


class SplitTrackTest(unittest.TestCase):
    def test_new_track_with_overlapping_box_joins_same_visit(self) -> None:
        t = tracker()
        visit = _parked_then_lost(t)
        self.assertEqual(visit.state, DEPARTING)
        out = t.handle_event(ev("new", "B", T0 + 63.0, start=T0 + 63.0, box=(405, 302, 702, 522)))
        self.assertEqual(out, [])
        self.assertEqual(t.counters["split_joins"], 1)
        self.assertEqual(len(t.open_visits()), 1)
        self.assertIn("B", t.open_visits()[0].sightings)
        out = t.handle_event(ev("update", "B", T0 + 63.6, ["front_lot"], start=T0 + 63.0, box=(405, 302, 702, 522)))
        self.assertEqual(out, [])  # re-entry restores CONFIRMED_ARRIVAL, no new ENTERED_ZONE
        self.assertEqual(t.open_visits()[0].state, CONFIRMED_ARRIVAL)
        t.handle_event(ev("update", "B", T0 + 120.0, [], start=T0 + 63.0, box=(900, 340, 1150, 560)))
        self.assertEqual(t.handle_event(ev("end", "B", T0 + 123.0, [], start=T0 + 63.0, end=T0 + 123.0)), [])
        left = ticks(t, T0 + 123.0, T0 + 148.0)  # LEFT after the grace, never on the `end` itself
        self.assertEqual(states(left), [LEFT])
        self.assertEqual(left[0].visit_id, visit.visit_id)
        self.assertAlmostEqual(left[0].zone_dwell["front_lot"], 59.0 + 56.4)
        self.assertEqual(t.counters["new_visits"], 1)

    def test_low_iou_starts_a_new_visit(self) -> None:
        t = tracker()
        _parked_then_lost(t)
        t.handle_event(ev("new", "B", T0 + 63.0, start=T0 + 63.0, box=(900, 300, 1200, 520)))
        self.assertEqual(t.counters["split_joins"], 0)
        self.assertEqual(len(t.open_visits()), 2)

    def test_outside_split_window_starts_a_new_visit(self) -> None:
        t = tracker()
        _parked_then_lost(t)
        t.handle_event(ev("new", "B", T0 + 75.0, start=T0 + 75.0, box=(400, 300, 700, 520)))
        self.assertEqual(t.counters["split_joins"], 0)
        self.assertEqual(len(t.open_visits()), 2)

    def test_conflicting_high_confidence_plates_veto_split_join(self) -> None:
        t = tracker()
        _parked_then_lost(t, plate="ABC1234", plate_score=0.95)
        t.handle_event(ev("new", "B", T0 + 63.0, start=T0 + 63.0, box=(400, 300, 700, 520), plate="XYZ9999", plate_score=0.95))
        self.assertEqual(t.counters["split_joins"], 0)
        self.assertEqual(len(t.open_visits()), 2)


class PlateTest(unittest.TestCase):
    def test_normalize_and_levenshtein(self) -> None:
        self.assertEqual(normalize_plate(" abc-1234 "), "ABC1234")
        self.assertEqual(levenshtein("ABC1234", "ABC1234"), 0)
        self.assertEqual(levenshtein("ABC1234", "ABC1235"), 1)
        self.assertEqual(levenshtein("ABC1234", "XYZ9999"), 7)

    def test_plate_read_on_second_camera_joins_open_visit_silently_when_unemitted(self) -> None:
        t = tracker()
        t.handle_event(ev("new", "A", T0))
        t.handle_event(ev("update", "A", T0 + 1.0, ["front_lot"], plate="ABC 1234", plate_score=0.92))
        t.handle_event(ev("update", "A", T0 + 12.0, ["front_lot"], stationary=True, plate="ABC 1234", plate_score=0.92))
        v1 = t.open_visits()[0]
        t.handle_event(ev("new", "S", T0 + 600.0, camera="sign", start=T0 + 600.0))  # DETECTED, nothing emitted yet
        self.assertEqual(len(t.open_visits()), 2)
        out = t.handle_lpr(lpr("S", "ABC1234", 0.91, T0 + 601.0, camera="sign"))
        self.assertEqual(out, [])  # absorbed visit never emitted -> no tombstone
        self.assertEqual(len(t.open_visits()), 1)
        self.assertIn("S", v1.sightings)
        self.assertEqual(t.counters["plate_joins"], 1)
        closed = t.drain_closed()
        self.assertEqual([c.merged_into for c in closed], [v1.visit_id])
        # a confirmed plate: two agreeing reads >= 0.9
        entered = t.handle_event(ev("update", "S", T0 + 602.0, ["bay_entrance"], camera="sign", start=T0 + 600.0))
        self.assertEqual(entered, [])  # visit already CONFIRMED; another zone adds dwell, no new state
        self.assertEqual(v1.state, CONFIRMED_ARRIVAL)

    def test_plate_join_after_emission_emits_merge_tombstone(self) -> None:
        t = tracker()
        t.handle_event(ev("new", "A", T0))
        t.handle_event(ev("update", "A", T0 + 1.0, ["front_lot"], plate="ABC1234", plate_score=0.96))
        v1 = t.open_visits()[0]
        t.handle_event(ev("new", "S", T0 + 30.0, camera="sign", start=T0 + 30.0))
        out = t.handle_event(ev("update", "S", T0 + 30.6, ["bay_entrance"], camera="sign", start=T0 + 30.0))
        self.assertEqual(states(out), [ENTERED_ZONE])
        v2_id = out[0].visit_id
        self.assertNotEqual(v2_id, v1.visit_id)
        out = t.handle_lpr(lpr("S", "ABC1234", 0.9, T0 + 31.0, camera="sign"))
        self.assertEqual(states(out), [LEFT])
        self.assertEqual(out[0].visit_id, v2_id)
        self.assertEqual(out[0].merged_into, v1.visit_id)
        self.assertEqual(len(t.open_visits()), 1)
        self.assertIn("S", v1.sightings)
        self.assertEqual(out[0].plate["status"], "CANDIDATE")  # tombstone carries the absorbed visit's own single read
        self.assertEqual(plate_summary(v1.reads(), t.policy)["status"], "CONFIRMED")  # 0.96 + 0.9 agreeing reads

    def test_plate_and_sub_label_on_one_snapshot_reparent_a_split_track_sighting_once(self) -> None:
        """P0 regression: Frigate sets recognized_license_plate AND sub_label on the same object, so one
        snapshot yields two reads; the second read must see the sighting's NEW visit, not the stale source
        (which raised KeyError in _move_sighting and dropped every later message for that object)."""
        t = tracker()
        t.handle_event(ev("new", "A1", T0))
        t.handle_event(ev("update", "A1", T0 + 1.0, ["front_lot"]))
        t.handle_event(ev("update", "A1", T0 + 12.0, ["front_lot"], stationary=True))
        t.handle_event(ev("update", "A1", T0 + 46.0, ["front_lot"], stationary=True))
        self.assertEqual(t.handle_event(ev("end", "A1", T0 + 60.0, ["front_lot"], stationary=True, end=T0 + 60.0)), [])
        src = t.open_visits()[0]
        self.assertEqual(t.handle_event(ev("new", "A2", T0 + 63.0, start=T0 + 63.0, box=(405, 302, 702, 522))), [])
        self.assertEqual(t.counters["split_joins"], 1)
        self.assertEqual(set(src.sightings), {"A1", "A2"})
        t.handle_event(ev("new", "S", T0 + 64.0, camera="sign", start=T0 + 64.0))
        t.handle_event(ev("update", "S", T0 + 64.5, ["bay_entrance"], camera="sign", start=T0 + 64.0, plate="ABC1234", plate_score=0.75))
        self.assertEqual(len(t.open_visits()), 2)
        dst = next(v for v in t.open_visits() if v.visit_id != src.visit_id)
        out = t.handle_event(
            ev("update", "A2", T0 + 65.0, ["front_lot"], start=T0 + 63.0, box=(405, 302, 702, 522), plate="ABC1234", plate_score=0.8, sub_label="ABC1234")
        )
        self.assertEqual(states(out), [])
        holders = [v.visit_id for v in t.open_visits() for sid in v.sightings if sid == "A2"]
        self.assertEqual(holders, [dst.visit_id])  # exactly once, in dst
        self.assertEqual(set(src.sightings), {"A1"})
        self.assertIsNone(src.merged_into)
        self.assertEqual(t.counters["plate_joins"], 1)
        self.assertEqual(len(t.open_visits()), 2)
        # the object keeps flowing into its new visit on later frames
        self.assertEqual(states(t.handle_event(ev("update", "A2", T0 + 66.0, ["front_lot"], start=T0 + 63.0, box=(405, 302, 702, 522)))), [])
        self.assertEqual(dst.sightings["A2"].last_frame_time, T0 + 66.0)

    def test_conflicting_high_confidence_plates_are_hard_rejected(self) -> None:
        t = tracker()
        t.handle_event(ev("new", "A", T0))
        t.handle_event(ev("update", "A", T0 + 1.0, ["front_lot"], plate="ABC1234", plate_score=0.95))
        t.handle_event(ev("new", "S", T0 + 30.0, camera="sign", start=T0 + 30.0))
        t.handle_lpr(lpr("S", "ABC1235", 0.95, T0 + 31.0, camera="sign"))  # distance 1: no match, no veto needed
        self.assertEqual(len(t.open_visits()), 2)
        t.handle_lpr(lpr("S", "XYZ9999", 0.95, T0 + 32.0, camera="sign"))
        self.assertEqual(len(t.open_visits()), 2)
        self.assertEqual(t.counters["plate_joins"], 0)

    def test_plate_status_ladder(self) -> None:
        t = tracker()
        t.handle_event(ev("new", "A", T0))
        e = t.handle_event(ev("update", "A", T0 + 1.0, ["front_lot"], plate="AB1234", plate_score=0.5))
        self.assertEqual(e[0].plate["status"], "UNREADABLE")
        t.handle_lpr(lpr("A", "ABC1234", 0.75, T0 + 2.0))
        e = t.handle_event(ev("update", "A", T0 + 11.0, ["front_lot"]))
        self.assertEqual(e[0].plate["status"], "CANDIDATE")
        t.handle_lpr(lpr("A", "ABC1234", 0.91, T0 + 12.0))
        t.handle_lpr(lpr("A", "ABC1234", 0.92, T0 + 13.0))
        e = t.handle_event(ev("update", "A", T0 + 46.0, ["front_lot"]))
        self.assertEqual(e[0].plate["status"], "CONFIRMED")
        self.assertEqual(e[0].plate["reads"], 4)
        self.assertEqual(e[0].plate["normalizedText"], "ABC1234")

    def test_known_plate_sub_label_confirms_and_names(self) -> None:
        t = tracker()
        t.handle_event(ev("new", "A", T0))
        e = t.handle_event(ev("update", "A", T0 + 1.0, ["front_lot"], plate="ABC1234", plate_score=0.8, sub_label="Shop Truck"))
        self.assertEqual(e[0].plate["status"], "CONFIRMED")
        self.assertEqual(e[0].plate["knownName"], "Shop Truck")
        self.assertEqual(e[0].plate["normalizedText"], "ABC1234")

    def test_reattach_window_limits_plate_join_to_recently_active_visits(self) -> None:
        for minutes, expected_visits in ((30.0, 1), (1.0, 2)):
            with self.subTest(reattach_minutes=minutes):
                t = tracker(topology=(), leave_grace_seconds=600.0, plate_reattach_minutes=minutes)
                _parked_then_lost(t, plate="ABC1234", plate_score=0.96)
                t.handle_event(ev("new", "S", T0 + 200.0, camera="sign", start=T0 + 200.0))
                t.handle_lpr(lpr("S", "ABC1234", 0.9, T0 + 201.0, camera="sign"))
                self.assertEqual(len(t.open_visits()), expected_visits)


class TopologyTest(unittest.TestCase):
    def _sign_pass(self, t):
        t.handle_event(ev("new", "S", T0, camera="sign"))
        out = t.handle_event(ev("update", "S", T0 + 1.0, ["bay_entrance"], camera="sign"))
        self.assertEqual(states(out), [ENTERED_ZONE])
        self.assertEqual(t.handle_event(ev("update", "S", T0 + 5.0, [], camera="sign")), [])
        self.assertEqual(t.handle_event(ev("end", "S", T0 + 8.0, [], camera="sign", end=T0 + 8.0)), [])
        self.assertEqual(t.open_visits()[0].state, DEPARTING)
        return out[0].visit_id

    def test_sign_then_lot_within_window_joins(self) -> None:
        t = tracker()
        vid = self._sign_pass(t)
        self.assertEqual(ticks(t, T0 + 8.0, T0 + 28.0), [])  # topology hold (90 s) keeps the visit open
        t.handle_event(ev("new", "L", T0 + 30.0, camera="lot", start=T0 + 30.0))
        self.assertEqual(t.counters["topology_joins"], 1)
        self.assertEqual(len(t.open_visits()), 1)
        out = t.handle_event(ev("update", "L", T0 + 30.6, ["front_lot"], camera="lot", start=T0 + 30.0))
        self.assertEqual(out, [])  # DEPARTING cancelled, state back to ENTERED_ZONE
        self.assertEqual(t.open_visits()[0].state, ENTERED_ZONE)
        cand = t.handle_event(ev("update", "L", T0 + 37.0, ["front_lot"], camera="lot", start=T0 + 30.0))
        self.assertEqual(states(cand), ["ARRIVAL_CANDIDATE"])  # 4 s on sign + 6.4 s on lot >= 10 s
        self.assertEqual(cand[0].visit_id, vid)
        self.assertEqual(cand[0].camera, "lot")

    def test_outside_window_is_a_new_visit_and_sign_visit_passes_through(self) -> None:
        t = tracker()
        vid = self._sign_pass(t)
        out = ticks(t, T0 + 8.0, T0 + 100.0)
        self.assertEqual(states(out), [PASS_THROUGH])
        self.assertEqual(out[0].visit_id, vid)
        self.assertTrue(out[0].estimated)
        t.handle_event(ev("new", "L", T0 + 105.0, camera="lot", start=T0 + 105.0))
        self.assertEqual(t.counters["topology_joins"], 0)
        self.assertEqual(t.counters["new_visits"], 2)

    def test_previous_visit_with_open_sighting_does_not_join(self) -> None:
        t = tracker()
        t.handle_event(ev("new", "S", T0, camera="sign"))
        t.handle_event(ev("update", "S", T0 + 1.0, ["bay_entrance"], camera="sign"))
        t.handle_event(ev("new", "L", T0 + 10.0, camera="lot", start=T0 + 10.0))
        self.assertEqual(t.counters["topology_joins"], 0)
        self.assertEqual(len(t.open_visits()), 2)


if __name__ == "__main__":
    unittest.main()
