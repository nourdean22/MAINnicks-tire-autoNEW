"""Visit state machine: exact timing, tick promotions, departures, E3 regression."""
from __future__ import annotations

import unittest

from helpers import T0, ev, states, ticks, tracker

from visitd.state_machine import (
    ARRIVAL_CANDIDATE,
    CONFIRMED_ARRIVAL,
    DEPARTING,
    ENTERED_ZONE,
    IN_SERVICE,
    LEFT,
    PASS_THROUGH,
    union_seconds,
    ZoneInterval,
)


class ArrivalTimelineTest(unittest.TestCase):
    def test_states_fire_at_exact_dwell_thresholds(self) -> None:
        t = tracker()
        self.assertEqual(t.handle_event(ev("new", "a", T0)), [])
        entered = t.handle_event(ev("update", "a", T0 + 1.0, ["front_lot"]))
        self.assertEqual(states(entered), [ENTERED_ZONE])
        self.assertEqual(entered[0].at, T0 + 1.0)
        self.assertEqual(entered[0].priority, "normal")
        self.assertEqual(entered[0].seq, 1)
        self.assertEqual(t.handle_event(ev("update", "a", T0 + 10.9, ["front_lot"])), [])
        cand = t.handle_event(ev("update", "a", T0 + 11.0, ["front_lot"]))
        self.assertEqual(states(cand), [ARRIVAL_CANDIDATE])
        self.assertAlmostEqual(cand[0].dwell_seconds, 10.0)
        self.assertFalse(cand[0].estimated)
        self.assertEqual(t.handle_event(ev("update", "a", T0 + 45.9, ["front_lot"])), [])
        conf = t.handle_event(ev("update", "a", T0 + 46.0, ["front_lot"]))
        self.assertEqual(states(conf), [CONFIRMED_ARRIVAL])
        self.assertAlmostEqual(conf[0].dwell_seconds, 45.0)
        self.assertEqual(conf[0].priority, "high")
        self.assertEqual(conf[0].at, T0 + 46.0)
        self.assertEqual(conf[0].seq, 3)
        self.assertEqual(conf[0].direction, "entering")

    def test_stationary_promotion_via_tick_is_estimated_then_confirmed_by_message(self) -> None:
        t = tracker()
        t.handle_event(ev("new", "a", T0))
        t.handle_event(ev("update", "a", T0 + 1.0, ["front_lot"]))
        cand = t.handle_event(ev("update", "a", T0 + 3.0, ["front_lot"], stationary=True))
        self.assertEqual(states(cand), [ARRIVAL_CANDIDATE])  # stationary in zone short-circuits the 10 s
        self.assertEqual(t.tick(T0 + 18.0), [])  # dwell 17 < 20
        promoted = t.tick(T0 + 23.0)  # dwell 22 >= 20 while stationary
        self.assertEqual(states(promoted), [CONFIRMED_ARRIVAL])
        self.assertTrue(promoted[0].estimated)
        self.assertEqual(promoted[0].at, T0 + 23.0)
        self.assertTrue(t.open_visits()[0].estimated)
        confirmed = t.handle_event(ev("update", "a", T0 + 25.0, ["front_lot"], stationary=True))
        self.assertEqual(states(confirmed), [CONFIRMED_ARRIVAL])
        self.assertFalse(confirmed[0].estimated)
        self.assertEqual(confirmed[0].seq, promoted[0].seq + 1)
        self.assertFalse(t.open_visits()[0].estimated)
        self.assertEqual(t.handle_event(ev("update", "a", T0 + 26.0, ["front_lot"], stationary=True)), [])

    def test_no_stationary_promotion_without_stationary_flag(self) -> None:
        t = tracker()
        t.handle_event(ev("new", "a", T0))
        t.handle_event(ev("update", "a", T0 + 1.0, ["front_lot"]))
        out = ticks(t, T0 + 1.0, T0 + 41.0)
        self.assertEqual(states(out), [ARRIVAL_CANDIDATE])
        self.assertEqual(states(t.tick(T0 + 47.0)), [CONFIRMED_ARRIVAL])


class DepartureTest(unittest.TestCase):
    def _confirmed(self):
        t = tracker()
        t.handle_event(ev("new", "a", T0))
        t.handle_event(ev("update", "a", T0 + 1.0, ["front_lot"]))
        t.handle_event(ev("update", "a", T0 + 11.0, ["front_lot"]))
        t.handle_event(ev("update", "a", T0 + 46.0, ["front_lot"]))
        self.assertEqual(t.open_visits()[0].state, CONFIRMED_ARRIVAL)
        return t

    def test_end_with_empty_current_zones_enters_departing_and_left_follows_after_the_grace_from_the_last_known_zone(self) -> None:
        """Regression for E3 (the v1 bridge indexed current_zones[0] on `end` and crashed) and rule 1: an `end`
        never emits LEFT by itself, so a split track within splitTrackSeconds can still rejoin the visit."""
        t = self._confirmed()
        self.assertEqual(t.handle_event(ev("end", "a", T0 + 60.0, [], end=T0 + 60.0)), [])
        visit = t.open_visits()[0]
        self.assertEqual(visit.state, DEPARTING)
        self.assertEqual(visit.sightings["a"].end_time, T0 + 60.0)
        self.assertEqual(t.tick(T0 + 79.9), [])
        out = t.tick(T0 + 80.0)
        self.assertEqual(states(out), [LEFT])
        left = out[0]
        self.assertTrue(left.estimated)
        self.assertEqual(left.zone, "front_lot")
        self.assertEqual(left.direction, "leaving")
        self.assertEqual(left.at, T0 + 80.0)
        self.assertEqual(left.frigate_end_time, T0 + 60.0)
        self.assertAlmostEqual(left.dwell_seconds, 59.0)
        self.assertAlmostEqual(left.zone_dwell["front_lot"], 59.0)
        self.assertEqual(t.open_visits(), [])
        self.assertEqual([v.state for v in t.drain_closed()], [LEFT])

    def test_new_track_within_split_window_after_an_end_outside_the_zone_rejoins_the_same_visit(self) -> None:
        t = self._confirmed()
        visit_id = t.open_visits()[0].visit_id
        self.assertEqual(t.handle_event(ev("end", "a", T0 + 60.0, [], end=T0 + 60.0)), [])
        self.assertEqual(t.handle_event(ev("new", "b", T0 + 65.0, start=T0 + 65.0)), [])  # same box, 5 s after the end
        self.assertEqual(t.counters["split_joins"], 1)
        self.assertEqual(t.counters["new_visits"], 1)
        self.assertEqual([v.visit_id for v in t.open_visits()], [visit_id])
        self.assertIn("b", t.open_visits()[0].sightings)
        self.assertEqual(t.handle_event(ev("update", "b", T0 + 65.6, ["front_lot"], start=T0 + 65.0)), [])  # no LEFT, no new ENTERED_ZONE
        self.assertEqual(t.open_visits()[0].state, CONFIRMED_ARRIVAL)
        self.assertEqual(ticks(t, T0 + 65.6, T0 + 200.0), [])
        self.assertEqual(t.drain_closed(), [])

    def test_end_uses_frame_time_when_end_time_missing(self) -> None:
        t = self._confirmed()
        self.assertEqual(t.handle_event(ev("end", "a", T0 + 61.5, [])), [])
        self.assertEqual(t.open_visits()[0].sightings["a"].end_time, T0 + 61.5)
        self.assertEqual(t.tick(T0 + 81.4), [])
        out = t.tick(T0 + 81.6)
        self.assertEqual(states(out), [LEFT])
        self.assertEqual(out[0].frigate_end_time, T0 + 61.5)

    def test_pass_through_is_low_priority_and_terminal(self) -> None:
        t = tracker()
        t.handle_event(ev("new", "a", T0))
        entered = t.handle_event(ev("update", "a", T0 + 1.0, ["front_lot"]))
        self.assertEqual(states(entered), [ENTERED_ZONE])
        self.assertEqual(t.handle_event(ev("update", "a", T0 + 4.0, [])), [])
        self.assertEqual(t.handle_event(ev("end", "a", T0 + 7.0, [], end=T0 + 7.0)), [])  # the grace runs from the end
        self.assertEqual(t.tick(T0 + 26.9), [])
        out = t.tick(T0 + 27.0)
        self.assertEqual(states(out), [PASS_THROUGH])
        self.assertTrue(out[0].estimated)
        self.assertEqual(out[0].priority, "low")
        self.assertEqual(out[0].direction, "leaving")
        self.assertAlmostEqual(out[0].dwell_seconds, 3.0)
        self.assertEqual(t.open_visits(), [])

    def test_zone_reentry_within_grace_cancels_departing(self) -> None:
        t = self._confirmed()
        self.assertEqual(t.handle_event(ev("update", "a", T0 + 60.0, [])), [])
        self.assertEqual(t.open_visits()[0].state, DEPARTING)
        self.assertEqual(t.tick(T0 + 70.0), [])
        self.assertEqual(t.handle_event(ev("update", "a", T0 + 75.0, ["front_lot"])), [])
        self.assertEqual(t.open_visits()[0].state, CONFIRMED_ARRIVAL)
        self.assertEqual(ticks(t, T0 + 75.0, T0 + 200.0), [])
        self.assertEqual(t.handle_event(ev("end", "a", T0 + 210.0, [], end=T0 + 210.0)), [])
        out = ticks(t, T0 + 210.0, T0 + 235.0)
        self.assertEqual(states(out), [LEFT])
        self.assertAlmostEqual(out[0].zone_dwell["front_lot"], 59.0 + 135.0)

    def test_grace_expiry_via_tick_emits_estimated_left(self) -> None:
        t = self._confirmed()
        t.handle_event(ev("update", "a", T0 + 60.0, []))
        self.assertEqual(t.tick(T0 + 79.9), [])
        out = t.tick(T0 + 80.0)
        self.assertEqual(states(out), [LEFT])
        self.assertTrue(out[0].estimated)
        self.assertIsNone(out[0].frigate_end_time)
        self.assertAlmostEqual(out[0].dwell_seconds, 59.0)
        # the still-alive track ending later is not an error and emits nothing more
        self.assertEqual(t.handle_event(ev("end", "a", T0 + 85.0, [], end=T0 + 85.0)), [])

    def test_end_inside_zone_waits_for_grace_before_left(self) -> None:
        t = self._confirmed()
        self.assertEqual(t.handle_event(ev("end", "a", T0 + 60.0, ["front_lot"], end=T0 + 60.0)), [])
        self.assertEqual(t.open_visits()[0].state, DEPARTING)
        self.assertEqual(t.tick(T0 + 79.0), [])
        out = t.tick(T0 + 81.0)
        self.assertEqual(states(out), [LEFT])
        self.assertAlmostEqual(out[0].zone_dwell["front_lot"], 59.0)

    def test_detected_only_visit_closes_silently(self) -> None:
        t = tracker()
        t.handle_event(ev("new", "a", T0))
        t.handle_event(ev("update", "a", T0 + 2.0, []))
        self.assertEqual(t.handle_event(ev("end", "a", T0 + 5.0, [], end=T0 + 5.0)), [])
        self.assertEqual(t.counters["unzoned_closed"], 1)
        closed = t.drain_closed()
        self.assertEqual(len(closed), 1)
        self.assertFalse(closed[0].emitted)


class ForceEndTest(unittest.TestCase):
    def _confirmed(self):
        t = tracker()
        t.handle_event(ev("new", "a", T0))
        t.handle_event(ev("update", "a", T0 + 1.0, ["front_lot"]))
        t.handle_event(ev("update", "a", T0 + 11.0, ["front_lot"]))
        t.handle_event(ev("update", "a", T0 + 46.0, ["front_lot"]))
        self.assertEqual(t.open_visits()[0].state, CONFIRMED_ARRIVAL)
        return t

    def test_frigate_restart_force_ends_open_sightings_then_left_follows_after_grace(self) -> None:
        t = self._confirmed()
        self.assertEqual(t.force_end_open_sightings(T0 + 70.0, "frigate_restart"), [])
        visit = t.open_visits()[0]
        self.assertEqual(visit.state, DEPARTING)
        self.assertEqual(visit.sightings["a"].end_time, T0 + 70.0)
        self.assertEqual(visit.open_sightings(), [])
        self.assertEqual(t.drain_force_ended(), {"frigate_restart": 1})
        self.assertEqual(t.drain_force_ended(), {})
        self.assertEqual(t.tick(T0 + 89.0), [])
        out = t.tick(T0 + 90.0)
        self.assertEqual(states(out), [LEFT])
        self.assertTrue(out[0].estimated)
        self.assertEqual(out[0].frigate_end_time, T0 + 70.0)
        self.assertAlmostEqual(out[0].zone_dwell["front_lot"], 69.0)
        self.assertEqual(t.open_visits(), [])
        # nothing open any more: a second force-end is a silent no-op
        self.assertEqual(t.force_end_open_sightings(T0 + 95.0, "frigate_restart"), [])
        self.assertEqual(t.drain_force_ended(), {})

    def test_force_ended_sighting_is_resurrected_when_frigate_keeps_tracking_it(self) -> None:
        """A broker blip also flips frigate/available; Frigate's registry survived, so its next update reopens the track."""
        t = self._confirmed()
        t.force_end_open_sightings(T0 + 70.0, "frigate_restart")
        self.assertEqual(t.handle_event(ev("update", "a", T0 + 75.0, ["front_lot"])), [])
        visit = t.open_visits()[0]
        self.assertEqual(visit.state, CONFIRMED_ARRIVAL)
        self.assertIsNone(visit.sightings["a"].end_time)
        self.assertEqual(ticks(t, T0 + 75.0, T0 + 200.0), [])

    def test_sighting_older_than_max_age_is_force_ended_by_tick(self) -> None:
        t = tracker(max_sighting_seconds=100.0)
        t.handle_event(ev("new", "a", T0))
        self.assertEqual(states(t.handle_event(ev("update", "a", T0 + 1.0, ["front_lot"], stationary=True))), [ENTERED_ZONE, ARRIVAL_CANDIDATE])
        self.assertEqual(states(ticks(t, T0 + 1.0, T0 + 96.0)), [CONFIRMED_ARRIVAL])
        self.assertEqual(t.tick(T0 + 99.9), [])
        self.assertEqual(t.tick(T0 + 100.0), [])  # age 100 s >= limit: the track is ended, the grace starts
        visit = t.open_visits()[0]
        self.assertEqual(visit.state, DEPARTING)
        self.assertEqual(visit.sightings["a"].end_time, T0 + 100.0)
        self.assertEqual(t.drain_force_ended(), {"max_age": 1})
        out = t.tick(T0 + 120.0)
        self.assertEqual(states(out), [LEFT])
        self.assertTrue(out[0].estimated)
        self.assertEqual(out[0].frigate_end_time, T0 + 100.0)
        self.assertAlmostEqual(out[0].zone_dwell["front_lot"], 99.0)

    def test_max_age_fires_once_per_track_so_a_resurrected_parked_car_stays_one_visit(self) -> None:
        """Frigate still updating the object after the max-age force-end means it is a real parked car."""
        t = tracker(max_sighting_seconds=100.0)
        t.handle_event(ev("new", "a", T0))
        t.handle_event(ev("update", "a", T0 + 1.0, ["front_lot"]))
        t.handle_event(ev("update", "a", T0 + 11.0, ["front_lot"]))
        t.handle_event(ev("update", "a", T0 + 46.0, ["front_lot"]))
        self.assertEqual(t.tick(T0 + 100.0), [])  # force-ended by age: DEPARTING, grace running
        self.assertEqual(t.drain_force_ended(), {"max_age": 1})
        visit_id = t.open_visits()[0].visit_id
        self.assertEqual(t.handle_event(ev("update", "a", T0 + 110.0, ["front_lot"])), [])  # 10 s later: resurrected
        visit = t.open_visits()[0]
        self.assertEqual(visit.state, CONFIRMED_ARRIVAL)
        self.assertIsNone(visit.sightings["a"].end_time)
        self.assertEqual(ticks(t, T0 + 110.0, T0 + 400.0), [])  # well past the grace: no second force-end, no LEFT
        self.assertEqual(t.drain_force_ended(), {})
        self.assertEqual([v.visit_id for v in t.open_visits()], [visit_id])
        self.assertIsNone(t.open_visits()[0].sightings["a"].end_time)
        self.assertEqual(t.counters["new_visits"], 1)

    def test_max_age_closed_track_that_updates_again_continues_the_old_visit_without_a_high_alert(self) -> None:
        """No update during the grace after the max-age force-end: the visit closes. A later update for the SAME
        object id (Frigate never sent `end`) must not resurrect it, but must not look like an unrelated car either."""
        t = tracker(max_sighting_seconds=100.0)
        t.handle_event(ev("new", "a", T0))
        t.handle_event(ev("update", "a", T0 + 1.0, ["front_lot"]))
        t.handle_event(ev("update", "a", T0 + 11.0, ["front_lot"]))
        t.handle_event(ev("update", "a", T0 + 46.0, ["front_lot"]))
        self.assertEqual(t.tick(T0 + 100.0), [])  # expiry: DEPARTING, grace running
        self.assertEqual(t.drain_force_ended(), {"max_age": 1})
        out = t.tick(T0 + 120.0)  # grace over, no update: closed
        self.assertEqual(states(out), [LEFT])
        first = out[0].visit_id
        self.assertEqual([v.visit_id for v in t.drain_closed()], [first])
        self.assertEqual(t.open_visits(), [])
        out = t.handle_event(ev("update", "a", T0 + 130.0, ["front_lot"], start=T0))  # the car is still there
        self.assertEqual(states(out), [ENTERED_ZONE])
        second = out[0].visit_id
        self.assertNotEqual(second, first)  # invariant: a terminal visit is never resurrected
        self.assertEqual(out[0].continues_visit_id, first)
        self.assertEqual(out[0].priority, "normal")
        self.assertEqual(t.counters["max_age_continuations"], 1)
        self.assertEqual(t.counters["split_joins"], 0)  # rule 1 never stitches into a terminal visit
        self.assertEqual(t.counters["new_visits"], 2)
        self.assertEqual([v.visit_id for v in t.open_visits()], [second])
        self.assertTrue(t.open_visits()[0].sightings["a"].max_age_fired)  # the reopened track is not ended again
        out = ticks(t, T0 + 130.0, T0 + 240.0)  # the continuation ramps again from its own zone entry
        self.assertEqual(states(out), [ARRIVAL_CANDIDATE, CONFIRMED_ARRIVAL])
        self.assertEqual([e.priority for e in out], ["normal", "normal"])  # no high-priority alert for the continuation
        self.assertEqual({e.continues_visit_id for e in out}, {first})
        self.assertEqual({e.visit_id for e in out}, {second})
        self.assertEqual(t.drain_force_ended(), {})  # 110 s past the 100 s limit: no second max-age force-end
        out = t.handle_event(ev("update", "a", T0 + 245.0, ["front_lot"], start=T0))
        self.assertEqual(states(out), [CONFIRMED_ARRIVAL])  # the estimated promotion confirmed by a message
        self.assertFalse(out[0].estimated)
        self.assertEqual(out[0].priority, "normal")
        self.assertEqual(out[0].continues_visit_id, first)
        self.assertEqual(t.counters["max_age_continuations"], 1)

    def test_max_age_closed_map_expires_after_the_ttl_and_is_consumed_once(self) -> None:
        t = tracker(max_sighting_seconds=100.0)
        t.handle_event(ev("new", "a", T0))
        t.handle_event(ev("update", "a", T0 + 1.0, ["front_lot"]))
        t.handle_event(ev("update", "a", T0 + 11.0, ["front_lot"]))
        t.tick(T0 + 100.0)
        self.assertEqual(states(t.tick(T0 + 120.0)), [LEFT])
        self.assertEqual(t.export_state()["max_age_closed"], [["a", "V1", T0 + 120.0]])
        out = t.handle_event(ev("update", "a", T0 + 221.0, ["front_lot"], start=T0))  # 101 s after the close: expired
        self.assertEqual(states(out), [ENTERED_ZONE])
        self.assertIsNone(out[0].continues_visit_id)
        self.assertEqual(t.counters["max_age_continuations"], 0)
        self.assertEqual(t.export_state()["max_age_closed"], [])  # consumed either way
        self.assertEqual(out[0].priority, "normal")

    def test_max_age_zero_disables_expiry(self) -> None:
        t = tracker(max_sighting_seconds=0.0)
        t.handle_event(ev("new", "a", T0))
        t.handle_event(ev("update", "a", T0 + 1.0, ["front_lot"], stationary=True))
        ticks(t, T0 + 1.0, T0 + 100000.0, step=5000.0)
        self.assertEqual(t.open_visits()[0].state, CONFIRMED_ARRIVAL)
        self.assertIsNone(t.open_visits()[0].sightings["a"].end_time)
        self.assertEqual(t.drain_force_ended(), {})


class ZoneDwellTest(unittest.TestCase):
    def test_per_zone_dwell_sums_multiple_intervals(self) -> None:
        t = tracker()
        t.handle_event(ev("new", "a", T0))
        t.handle_event(ev("update", "a", T0 + 1.0, ["front_lot"]))
        t.handle_event(ev("update", "a", T0 + 11.0, ["entrance_lane"]))
        t.handle_event(ev("update", "a", T0 + 16.0, ["front_lot"]))
        t.handle_event(ev("update", "a", T0 + 30.0, []))
        self.assertEqual(t.handle_event(ev("end", "a", T0 + 33.0, [], end=T0 + 33.0)), [])
        out = ticks(t, T0 + 33.0, T0 + 58.0)
        self.assertEqual(states(out), [LEFT])
        left = out[0]
        self.assertAlmostEqual(left.zone_dwell["front_lot"], 24.0)
        self.assertAlmostEqual(left.zone_dwell["entrance_lane"], 5.0)
        self.assertAlmostEqual(left.dwell_seconds, 29.0)

    def test_overlapping_arrival_zones_are_not_double_counted(self) -> None:
        ivs = [ZoneInterval("front_lot", 0.0, 10.0), ZoneInterval("entrance_lane", 5.0, 15.0), ZoneInterval("front_lot", 20.0, None)]
        self.assertAlmostEqual(union_seconds(ivs, 25.0), 20.0)

    def test_bay_zone_goes_in_service_and_left(self) -> None:
        t = tracker()
        t.handle_event(ev("new", "b", T0, camera="bay"))
        out = t.handle_event(ev("update", "b", T0 + 1.0, ["bay_1"], camera="bay"))
        self.assertEqual(states(out), [IN_SERVICE])
        t.handle_event(ev("update", "b", T0 + 600.0, [], camera="bay"))
        self.assertEqual(t.handle_event(ev("end", "b", T0 + 603.0, [], camera="bay", end=T0 + 603.0)), [])
        left = ticks(t, T0 + 603.0, T0 + 628.0)
        self.assertEqual(states(left), [LEFT])
        self.assertAlmostEqual(left[0].zone_dwell["bay_1"], 599.0)
        self.assertAlmostEqual(left[0].dwell_seconds, 0.0)


class RestartHoldTest(unittest.TestCase):
    """`hold_departures`: the window an edge restart needs to look for a parked car.

    The edge force-ends a restored sighting (dwell freezes at the last activity, the visit
    goes DEPARTING) and holds the visit while its census looks for the car. Each test names
    the way the hold could be wrong.
    """

    def _parked(self, t):
        t.handle_event(ev("new", "o1", T0, ["front_lot"]))
        t.handle_event(ev("update", "o1", T0 + 60, ["front_lot"], stationary=True))
        visit = t.open_visits()[0]
        self.assertEqual(visit.state, CONFIRMED_ARRIVAL, "precondition: a confirmed, parked car")
        return visit

    def test_a_held_visit_is_not_declared_LEFT_before_the_hold(self):
        t = tracker()
        v = self._parked(t)
        t.force_end_open_sightings(T0 + 60, "producer_restart")
        self.assertEqual(t.hold_departures([v.visit_id], T0 + 200), 1)
        self.assertNotIn(LEFT, states(ticks(t, T0 + 60, T0 + 195)),
                         "the 20 s grace alone would have departed it at T0+80")
        self.assertEqual(states(ticks(t, T0 + 195, T0 + 205)).count(LEFT), 1)

    def test_a_hold_never_SHORTENS_the_grace(self):
        t = tracker()
        v = self._parked(t)
        t.force_end_open_sightings(T0 + 60, "producer_restart")
        t.hold_departures([v.visit_id], T0 + 61)
        self.assertNotIn(LEFT, states(ticks(t, T0 + 60, T0 + 75)))
        self.assertIn(LEFT, states(ticks(t, T0 + 75, T0 + 85)))

    def test_releasing_the_hold_restores_the_normal_grace(self):
        t = tracker()
        v = self._parked(t)
        t.force_end_open_sightings(T0 + 60, "producer_restart")
        t.hold_departures([v.visit_id], float("inf"))
        self.assertNotIn(LEFT, states(ticks(t, T0 + 60, T0 + 500)))
        t.hold_departures([v.visit_id], None)
        self.assertIn(LEFT, states(t.tick(T0 + 505)))

    def test_an_update_under_the_OLD_id_resurrects_the_visit_and_clears_the_hold(self):
        t = tracker()
        v = self._parked(t)
        t.force_end_open_sightings(T0 + 60, "producer_restart")
        t.hold_departures([v.visit_id], float("inf"))
        self.assertEqual(v.state, DEPARTING, "precondition: the force-end sent it DEPARTING")
        out = t.handle_event(ev("update", "o1", T0 + 90, ["front_lot"], stationary=True))
        self.assertNotIn(LEFT, states(out))
        v = t.open_visits()[0]
        self.assertEqual(v.state, CONFIRMED_ARRIVAL, "back in the state it had before the restart")
        self.assertIsNone(v.sightings["o1"].end_time, "the sighting is resurrected")
        self.assertIsNone(v.restart_hold_until,
                          "a later REAL departure must get the normal grace, not the old hold")
        t.handle_event(ev("end", "o1", T0 + 120, []))
        self.assertIn(LEFT, states(ticks(t, T0 + 120, T0 + 145)))

    def test_the_hold_is_NEVER_persisted(self):
        """A persisted hold whose producer died before releasing it would keep a departed
        car on the lot forever: the next restart only touches OPEN sightings."""
        t = tracker()
        v = self._parked(t)
        t.hold_departures([v.visit_id], float("inf"))
        state = t.export_state()
        self.assertNotIn("restart_hold_until", state["visits"][0])
        restored = tracker()
        restored.restore_state(state)
        self.assertIsNone(restored.open_visits()[0].restart_hold_until)

    def test_an_unknown_visit_is_ignored(self):
        self.assertEqual(tracker().hold_departures(["nope"], T0), 0)


if __name__ == "__main__":
    unittest.main()
