"""SQLite ledger: restart recovery, outbox order, bounded drop, retention prune."""
from __future__ import annotations

import os
import tempfile
import unittest

from helpers import T0, ev, states, tracker

from visitd.ledger import Ledger
from visitd.state_machine import ARRIVAL_CANDIDATE, CONFIRMED_ARRIVAL, ENTERED_ZONE, LEFT, Visit, VisitPolicy

DAY = 86400.0


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
        self.assertEqual(t2.handle_event(ev("end", "a", T0 + 103.0, [], end=T0 + 103.0)), [])
        out = t2.tick(T0 + 125.0)  # grace after the end
        self.assertEqual(states(out), [LEFT])
        self.assertEqual(out[0].visit_id, visit.visit_id)
        self.assertEqual(out[0].seq, 4)
        self.assertAlmostEqual(out[0].zone_dwell["front_lot"], 99.0)
        self.assertEqual(out[0].plate["status"], "CONFIRMED")
        ledger2.save_visits(t2.open_visits() + t2.drain_closed())
        self.assertEqual(ledger2.count_visits([LEFT]), 1)
        self.assertEqual(ledger2.load_open_visits(), {"visits": []})
        ledger2.close()

    def test_older_schema_gains_the_new_outbox_columns_on_open(self) -> None:
        import sqlite3

        conn = sqlite3.connect(self.path)
        conn.execute(
            "CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, device_id TEXT NOT NULL,"
            " url TEXT NOT NULL, payload TEXT NOT NULL, created_at REAL NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT)"
        )
        conn.execute("INSERT INTO outbox (event_id, device_id, url, payload, created_at) VALUES ('old', 'dev', 'u', '{}', 1.0)")
        conn.commit()
        conn.close()
        ledger = Ledger(self.path)
        item = ledger.outbox_peek()
        self.assertEqual((item.event_id, item.http_failures), ("old", 0))
        ledger.outbox_fail(item.id, "503", counted=True)
        self.assertEqual(ledger.outbox_peek().http_failures, 1)
        ledger.close()

    def test_closed_visits_are_not_restored(self) -> None:
        t1 = tracker()
        t1.handle_event(ev("new", "a", T0))
        t1.handle_event(ev("update", "a", T0 + 1.0, ["front_lot"]))
        self.assertEqual(t1.handle_event(ev("end", "a", T0 + 4.0, [], end=T0 + 4.0)), [])
        self.assertEqual(states(t1.tick(T0 + 30.0)), ["PASS_THROUGH"])  # closed once the grace after the end expires
        ledger = Ledger(self.path)
        ledger.save_visits(t1.open_visits() + t1.drain_closed())
        t2 = tracker()
        self.assertEqual(t2.restore_state(ledger.load_open_visits()), 0)
        self.assertEqual(ledger.count_visits(), 1)
        ledger.close()


class PruneTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "visitd.sqlite")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    @staticmethod
    def _left(t, oid: str, base: float) -> None:
        """One visit on `t`: enters front_lot, becomes a candidate, track ends in zone, LEFT after the grace."""
        t.handle_event(ev("new", oid, base))
        t.handle_event(ev("update", oid, base + 1.0, ["front_lot"]))
        assert states(t.handle_event(ev("update", oid, base + 12.0, ["front_lot"]))) == [ARRIVAL_CANDIDATE]
        assert t.handle_event(ev("end", oid, base + 33.0, ["front_lot"], end=base + 33.0)) == []
        assert states(t.tick(base + 60.0)) == [LEFT]

    @staticmethod
    def _rows(ledger: Ledger, table: str) -> int:
        return int(ledger._conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])

    def test_prune_terminal_visits_cascades_and_spares_open_and_recent_visits(self) -> None:
        now = T0 + 200 * DAY
        t = tracker()
        self._left(t, "old", T0)  # closed ~200 days before `now`
        self._left(t, "recent", now - 1 * DAY)
        t.handle_event(ev("new", "open", now - 100.0))
        t.handle_event(ev("update", "open", now - 99.0, ["front_lot"]))
        ledger = Ledger(self.path)
        ledger.save_visits(t.open_visits() + t.drain_closed())
        self.assertEqual((ledger.count_visits(), self._rows(ledger, "sightings"), self._rows(ledger, "visit_zone_intervals")), (3, 3, 3))
        self.assertEqual(ledger.prune_terminal_visits(90 * DAY, now), 1)
        self.assertEqual((ledger.count_visits(), self._rows(ledger, "sightings"), self._rows(ledger, "visit_zone_intervals")), (2, 2, 2))
        self.assertEqual(ledger.count_visits([LEFT]), 1)
        self.assertEqual(len(ledger.load_open_visits()["visits"]), 1)
        self.assertEqual(ledger.prune_terminal_visits(90 * DAY, now), 0)  # idempotent
        self.assertEqual(ledger.prune_terminal_visits(0.5 * DAY, now), 1)  # the recent one once it ages out
        self.assertEqual(ledger.prune_terminal_visits(0.0, now + 1000 * DAY), 0)  # an open visit is never pruned
        self.assertEqual(ledger.count_visits(), 1)
        self.assertEqual(len(ledger.load_open_visits()["visits"]), 1)
        ledger.checkpoint()
        self.assertEqual(os.path.getsize(self.path + "-wal"), 0)
        ledger.close()

    def test_prune_dead_letter_by_parked_age(self) -> None:
        ledger = Ledger(":memory:")
        ledger.enqueue("p1", "dev", "u", {})
        ledger.enqueue("p2", "dev", "u", {})
        ledger.outbox_dead_letter(ledger.outbox_peek().id, 500, "boom", parked_at=1000.0)
        ledger.outbox_dead_letter(ledger.outbox_peek().id, 503, "down", parked_at=5000.0)
        self.assertEqual(ledger.dead_letter_depth(), 2)
        self.assertEqual(ledger.prune_dead_letter(7 * DAY, now=1000.0 + 7 * DAY), 0)
        self.assertEqual(ledger.prune_dead_letter(7 * DAY, now=1000.0 + 7 * DAY + 1.0), 1)
        self.assertEqual([r["event_id"] for r in ledger.dead_letter_rows()], ["p2"])
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


class OutboxEvictionTest(unittest.TestCase):
    """outboxMaxDepth evicts WHOLE terminal visits (oldest first); an open visit never loses a row."""

    def setUp(self) -> None:
        self.ledger = Ledger(":memory:", outbox_max_depth=4)

    def tearDown(self) -> None:
        self.ledger.close()

    def _enqueue(self, visit_id: str, state: str, seq: int):
        event_id = f"{visit_id}-{state}-{seq}"
        return self.ledger.enqueue(event_id, "dev", "u", {"eventId": event_id, "data": {"visitId": visit_id, "state": state}})

    def _queued(self):
        return [r["event_id"] for r in self.ledger._conn.execute("SELECT event_id FROM outbox ORDER BY id").fetchall()]

    def test_terminal_visits_leave_together_oldest_first_and_the_open_visit_keeps_every_row(self) -> None:
        # "old" is terminal per the visits table (its LEFT was already delivered); "gone" is terminal per its own LEFT row.
        self.ledger.save_visits([Visit("old", T0, T0 + 5.0, "lot", "lot", state=LEFT, seq=3, left_at=T0 + 5.0)])
        self.assertEqual(self._enqueue("old", ENTERED_ZONE, 1), (True, 0))
        self.assertEqual(self._enqueue("open", ENTERED_ZONE, 1), (True, 0))
        self.assertEqual(self._enqueue("gone", ENTERED_ZONE, 1), (True, 0))
        self.assertEqual(self._enqueue("gone", LEFT, 2), (True, 0))
        self.assertEqual(self.ledger.outbox_depth(), 4)
        self.assertEqual(self._enqueue("open", ARRIVAL_CANDIDATE, 2), (True, 1))  # evicts "old" (1 row), not the oldest row alone
        self.assertEqual(self._queued(), ["open-ENTERED_ZONE-1", "gone-ENTERED_ZONE-1", "gone-LEFT-2", "open-ARRIVAL_CANDIDATE-2"])
        self.assertEqual(self._enqueue("open", CONFIRMED_ARRIVAL, 3), (True, 2))  # "gone" leaves as a unit
        self.assertEqual(self._queued(), ["open-ENTERED_ZONE-1", "open-ARRIVAL_CANDIDATE-2", "open-CONFIRMED_ARRIVAL-3"])
        self.assertEqual(self.ledger.dropped_total, 3)
        self.assertEqual(self.ledger.refused_total, 0)

    def test_only_open_visits_queued_refuses_the_new_row_and_evicts_nothing(self) -> None:
        for visit_id in ("a", "b"):
            self._enqueue(visit_id, ENTERED_ZONE, 1)
            self._enqueue(visit_id, ARRIVAL_CANDIDATE, 2)
        before = self._queued()
        with self.assertLogs("visitd.ledger", level="WARNING") as logs:
            self.assertEqual(self._enqueue("c", ENTERED_ZONE, 1), (False, 0))
        self.assertTrue(any("refused" in line and "c-ENTERED_ZONE-1" in line for line in logs.output))
        self.assertEqual(self._queued(), before)
        self.assertEqual(self.ledger.refused_total, 1)
        self.assertEqual(self.ledger.dropped_total, 0)
        self.assertEqual(self.ledger.outbox_depth(), 4)


if __name__ == "__main__":
    unittest.main()
