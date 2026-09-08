"""SQLite ledger: restart recovery, outbox order, bounded drop."""
from __future__ import annotations

import os
import tempfile
import unittest

from helpers import T0, ev, states, tracker

from visitd.ledger import Ledger
from visitd.state_machine import CONFIRMED_ARRIVAL, LEFT, VisitPolicy


class RestartRecoveryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "visitd.sqlite")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_open_visit_is_reloaded_and_continues_with_same_id_and_seq(self) -> None:
        t1 = tracker()
        t1.handle_event(ev("new", "a", T0))
        t1.handle_event(ev("update", "a", T0 + 1.0, ["front_lot"]))
        t1.handle_event(ev("update", "a", T0 + 11.0, ["front_lot"]))
        t1.handle_event(ev("update", "a", T0 + 46.0, ["front_lot"], plate="ABC1234", plate_score=0.96))
        visit = t1.open_visits()[0]
        self.assertEqual(visit.state, CONFIRMED_ARRIVAL)
        ledger = Ledger(self.path, policy=VisitPolicy())
        ledger.save_visits(t1.open_visits() + t1.drain_closed())
        ledger.close()

        ledger2 = Ledger(self.path, policy=VisitPolicy())
        t2 = tracker()
        self.assertEqual(t2.restore_state(ledger2.load_open_visits()), 1)
        restored = t2.open_visits()[0]
        self.assertEqual(restored.visit_id, visit.visit_id)
        self.assertEqual(restored.state, CONFIRMED_ARRIVAL)
        self.assertEqual(restored.seq, 3)
        self.assertEqual(t2.handle_event(ev("update", "a", T0 + 100.0, [])), [])
        out = t2.handle_event(ev("end", "a", T0 + 103.0, [], end=T0 + 103.0))
        self.assertEqual(states(out), [LEFT])
        self.assertEqual(out[0].visit_id, visit.visit_id)
        self.assertEqual(out[0].seq, 4)
        self.assertAlmostEqual(out[0].zone_dwell["front_lot"], 99.0)
        self.assertEqual(out[0].plate["status"], "CONFIRMED")
        ledger2.save_visits(t2.open_visits() + t2.drain_closed())
        self.assertEqual(ledger2.count_visits([LEFT]), 1)
        self.assertEqual(ledger2.load_open_visits(), {"visits": []})
        ledger2.close()

    def test_closed_visits_are_not_restored(self) -> None:
        t1 = tracker()
        t1.handle_event(ev("new", "a", T0))
        t1.handle_event(ev("update", "a", T0 + 1.0, ["front_lot"]))
        t1.handle_event(ev("end", "a", T0 + 4.0, [], end=T0 + 4.0))
        ledger = Ledger(self.path)
        ledger.save_visits(t1.open_visits() + t1.drain_closed())
        t2 = tracker()
        self.assertEqual(t2.restore_state(ledger.load_open_visits()), 0)
        self.assertEqual(ledger.count_visits(), 1)
        ledger.close()


class OutboxTest(unittest.TestCase):
    def setUp(self) -> None:
        self.ledger = Ledger(":memory:", outbox_max_depth=5)

    def tearDown(self) -> None:
        self.ledger.close()

    def test_order_and_bounded_oldest_first_drop(self) -> None:
        for i in range(7):
            inserted, dropped = self.ledger.enqueue(f"e{i}", "dev", "http://x/events", {"n": i})
            self.assertTrue(inserted)
            self.assertEqual(dropped, 1 if i >= 5 else 0)
        self.assertEqual(self.ledger.outbox_depth(), 5)
        self.assertEqual(self.ledger.dropped_total, 2)
        head = self.ledger.outbox_peek()
        self.assertIsNotNone(head)
        self.assertEqual(head.event_id, "e2")
        self.assertEqual(head.payload, {"n": 2})
        seen = []
        while True:
            item = self.ledger.outbox_peek()
            if item is None:
                break
            seen.append(item.event_id)
            self.ledger.outbox_ack(item.id)
        self.assertEqual(seen, ["e2", "e3", "e4", "e5", "e6"])

    def test_duplicate_event_id_is_ignored(self) -> None:
        self.assertEqual(self.ledger.enqueue("dup", "dev", "u", {"a": 1}), (True, 0))
        self.assertEqual(self.ledger.enqueue("dup", "dev", "u", {"a": 2}), (False, 0))
        self.assertEqual(self.ledger.outbox_depth(), 1)

    def test_fail_modes(self) -> None:
        self.ledger.enqueue("e1", "dev", "u", {})
        self.ledger.enqueue("e2", "dev", "u", {})
        first = self.ledger.outbox_peek()
        self.ledger.outbox_fail(first.id, "503", permanent=False)
        again = self.ledger.outbox_peek()
        self.assertEqual(again.event_id, "e1")
        self.assertEqual(again.attempts, 1)
        self.ledger.outbox_fail(again.id, "401", permanent=True)
        self.assertEqual(self.ledger.outbox_peek().event_id, "e2")

    def test_meta_roundtrip(self) -> None:
        self.assertIsNone(self.ledger.get_meta("k"))
        self.ledger.set_meta("k", "v1")
        self.ledger.set_meta("k", "v2")
        self.assertEqual(self.ledger.get_meta("k"), "v2")


if __name__ == "__main__":
    unittest.main()
