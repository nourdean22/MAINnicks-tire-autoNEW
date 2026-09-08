"""The three JSONL fixtures used by `visitd --replay`, replayed with virtual time."""
from __future__ import annotations

import unittest

from helpers import T0, fixture, states, tracker

from visitd.contract import build_event
from visitd.replay import read_jsonl, replay


class ReplayFixtureTest(unittest.TestCase):
    def _run(self, name, tail=120.0):
        t = tracker()
        result = replay(t, read_jsonl(fixture(name)), tick_seconds=5.0, tail_seconds=tail)
        return t, result

    def test_arrival_and_leave(self) -> None:
        t, r = self._run("arrival_and_leave.jsonl")
        self.assertEqual(r.messages, 9)
        self.assertEqual(r.ignored, 0)
        self.assertEqual(states(r.emissions), ["ENTERED_ZONE", "ARRIVAL_CANDIDATE", "CONFIRMED_ARRIVAL", "CONFIRMED_ARRIVAL", "LEFT"])
        conf_est, conf_real, left = r.emissions[2], r.emissions[3], r.emissions[4]
        self.assertTrue(conf_est.estimated)
        self.assertFalse(conf_real.estimated)
        self.assertEqual(conf_real.priority, "high")
        self.assertEqual(left.at, T0 + 309.0)
        self.assertAlmostEqual(left.zone_dwell["front_lot"], 305.4)
        self.assertEqual(left.plate["status"], "CONFIRMED")
        self.assertEqual(left.plate["normalizedText"], "ABC1234")
        self.assertEqual(left.plate["reads"], 2)
        self.assertEqual(len({e.visit_id for e in r.emissions}), 1)
        self.assertEqual(t.open_visits(), [])
        ids = [build_event(e, "v380-shopinside", "Front Lot", {}, "0.17.2")["eventId"] for e in r.emissions]
        self.assertEqual(len(set(ids)), len(ids))

    def test_pass_through(self) -> None:
        t, r = self._run("pass_through.jsonl")
        self.assertEqual(states(r.emissions), ["ENTERED_ZONE", "PASS_THROUGH"])
        self.assertEqual(r.emissions[1].priority, "low")
        self.assertAlmostEqual(r.emissions[1].dwell_seconds, 3.4)
        self.assertEqual(t.counters["new_visits"], 1)

    def test_split_track_is_one_visit(self) -> None:
        t, r = self._run("split_track.jsonl")
        self.assertEqual(states(r.emissions), ["ENTERED_ZONE", "ARRIVAL_CANDIDATE", "ARRIVAL_CANDIDATE", "CONFIRMED_ARRIVAL", "CONFIRMED_ARRIVAL", "LEFT"])
        self.assertEqual(len({e.visit_id for e in r.emissions}), 1)
        self.assertEqual(t.counters["split_joins"], 1)
        self.assertEqual(t.counters["new_visits"], 1)
        left = r.emissions[-1]
        self.assertEqual(left.sighting_id, "1757347533.0-trackB")
        self.assertAlmostEqual(left.zone_dwell["front_lot"], 115.8)
        self.assertAlmostEqual(left.frigate_start_time, T0 + 168.88, places=3)

    def test_tail_flushes_grace_timers(self) -> None:
        t = tracker()
        records = read_jsonl(fixture("split_track.jsonl"))[:4]  # track A only, ends inside the zone
        result = replay(t, records, tick_seconds=5.0, tail_seconds=0.0)
        self.assertEqual(states(result.emissions)[-1], "CONFIRMED_ARRIVAL")
        self.assertEqual(len(t.open_visits()), 1)
        result = replay(t, [], tick_seconds=5.0, tail_seconds=0.0)
        self.assertEqual(result.emissions, [])
        promoted = t.tick(T0 + 168.88 + 30.0 + 21.0)
        self.assertEqual(states(promoted), ["LEFT"])
        self.assertTrue(promoted[0].estimated)


if __name__ == "__main__":
    unittest.main()
