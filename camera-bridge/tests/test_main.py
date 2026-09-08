"""Pipeline (main.py) glue: frigate/available handling, atomic persistence, inbox timing, housekeeping."""
from __future__ import annotations

import dataclasses
import json
import os
import queue
import sqlite3
import tempfile
import unittest
from typing import Optional

from helpers import T0, FakeMqttMessage, event_payload, states

from visitd.cloud_client import CloudClient
from visitd.config import build_config
from visitd.contract import event_id
from visitd.ledger import Ledger
from visitd.main import Pipeline
from visitd.metrics import MetricsRegistry
from visitd.mqtt_client import MqttClient
from visitd.state_machine import ARRIVAL_CANDIDATE, CONFIRMED_ARRIVAL, DEPARTING, ENTERED_ZONE, LEFT

EVENTS = "frigate/events"
AVAILABLE = "frigate/available"
RAW = {
    "cameras": {"lot": {"cloudDeviceId": "dev-lot", "arrivalZones": ["front_lot"]}},
    "backend": {"outboxMaxDepth": 50},
}


def raw(kind: str, oid: str, at: float, zones=(), **kwargs) -> bytes:
    """frigate/events message bytes."""
    return json.dumps(event_payload(kind, oid, at, zones, **kwargs)).encode("utf-8")


def make_pipeline(ledger: Optional[Ledger] = None, **cfg_overrides) -> Pipeline:
    """Pipeline on an in-memory ledger with a dry-run cloud client (nothing leaves the process)."""
    cfg = dataclasses.replace(build_config(RAW, environ={}), **cfg_overrides)
    ledger = ledger or Ledger(":memory:", outbox_max_depth=cfg.backend.outbox_max_depth, policy=cfg.policy)
    metrics = MetricsRegistry()
    return Pipeline(cfg, ledger, CloudClient(cfg.backend, ledger, metrics, dry_run=True), metrics)


class FrigateAvailableTest(unittest.TestCase):
    def test_offline_flip_force_ends_open_sightings_and_counts_once(self) -> None:
        p = make_pipeline()
        p.process_message(EVENTS, raw("new", "a", T0), 1000.0)
        self.assertEqual(states(p.process_message(EVENTS, raw("update", "a", T0 + 1.0, ["front_lot"]), 1001.0)), [ENTERED_ZONE])
        self.assertEqual(states(p.process_message(EVENTS, raw("update", "a", T0 + 11.0, ["front_lot"]), 1011.0)), [ARRIVAL_CANDIDATE])
        counter = ("visitd_tracker_force_ended_total", {"reason": "frigate_restart"})
        self.assertEqual(p.process_message(AVAILABLE, b"online", 1012.0), [])  # the retained birth message: nothing to do
        self.assertTrue(p.frigate_available)
        self.assertEqual(p.metrics.get(*counter), 0)
        self.assertEqual(p.process_message(AVAILABLE, b"offline", 1030.0), [])  # estimate = T0+11 + 19 s wall
        self.assertFalse(p.frigate_available)
        visit = p.tracker.open_visits()[0]
        self.assertEqual(visit.state, DEPARTING)
        self.assertEqual(visit.sightings["a"].end_time, T0 + 30.0)
        self.assertEqual(p.metrics.get(*counter), 1)
        self.assertEqual(p.process_message(AVAILABLE, b"offline", 1031.0), [])  # repeated LWT: no second force-end
        self.assertEqual(p.metrics.get(*counter), 1)
        self.assertEqual(p.tick(1049.0), [])
        out = p.tick(1050.0)  # estimate T0+50 = end (T0+30) + 20 s grace
        self.assertEqual(states(out), [LEFT])
        self.assertTrue(out[0].estimated)
        self.assertEqual(p.tracker.open_visits(), [])
        self.assertEqual(p.ledger.outbox_depth(), 3)  # ENTERED_ZONE, ARRIVAL_CANDIDATE, LEFT
        self.assertEqual(p.ledger.count_visits([LEFT]), 1)
        # back online after the outage: the registry-lost path runs again but nothing is open
        self.assertEqual(p.process_message(AVAILABLE, b"online", 1060.0), [])
        self.assertEqual(p.metrics.get(*counter), 1)
        self.assertEqual(p.metrics.get("visitd_frigate_available"), 1)

    def test_online_after_offline_force_ends_what_was_open(self) -> None:
        p = make_pipeline()
        p.process_message(AVAILABLE, b"offline", 900.0)  # Frigate down at visitd start: no visits yet, nothing happens
        p.process_message(EVENTS, raw("new", "a", T0), 1000.0)
        p.process_message(EVENTS, raw("update", "a", T0 + 1.0, ["front_lot"]), 1001.0)
        self.assertEqual(p.process_message(AVAILABLE, b"online", 1005.0), [])
        self.assertEqual(p.tracker.open_visits()[0].sightings["a"].end_time, T0 + 5.0)
        self.assertEqual(p.metrics.get("visitd_tracker_force_ended_total", {"reason": "frigate_restart"}), 1)

    def test_restored_visits_get_an_estimate_from_their_last_activity(self) -> None:
        ledger = Ledger(":memory:")
        p1 = make_pipeline(ledger)
        p1.process_message(EVENTS, raw("new", "a", T0), 1000.0)
        p1.process_message(EVENTS, raw("update", "a", T0 + 1.0, ["front_lot"]), 1001.0)
        p2 = make_pipeline(ledger)  # restart: the visit reloads, no Frigate message has been seen yet
        self.assertEqual(len(p2.tracker.open_visits()), 1)
        self.assertIsNone(p2.estimated_frame_time(5000.0))
        self.assertEqual(p2.tick(5000.0), [])
        p2.process_message(AVAILABLE, b"offline", 5000.0)
        self.assertEqual(p2.tracker.open_visits()[0].sightings["a"].end_time, T0 + 1.0)
        out = p2.tick(5020.0)  # virtual time now runs from the restored activity
        self.assertEqual(states(out), ["PASS_THROUGH"])
        self.assertEqual(p2.metrics.get("visitd_tracker_force_ended_total", {"reason": "frigate_restart"}), 1)


class _FailingConn:
    """sqlite3 connection proxy that raises on the n-th outbox INSERT (a crash between two writes)."""

    def __init__(self, conn: sqlite3.Connection, fail_on: int) -> None:
        self._conn = conn
        self._fail_on = fail_on
        self.inserts = 0

    def execute(self, sql: str, *args):
        if sql.lstrip().upper().startswith("INSERT") and "INTO OUTBOX" in sql.upper():
            self.inserts += 1
            if self.inserts == self._fail_on:
                raise sqlite3.OperationalError("disk I/O error")
        return self._conn.execute(sql, *args)

    def __getattr__(self, name: str):
        return getattr(self._conn, name)


class AtomicPersistenceTest(unittest.TestCase):
    def test_visit_update_and_its_outbox_rows_commit_together_or_not_at_all(self) -> None:
        ledger = Ledger(":memory:")
        p = make_pipeline(ledger)
        p.process_message(EVENTS, raw("new", "a", T0), 1000.0)
        visit_id = p.tracker.open_visits()[0].visit_id
        self.assertEqual(ledger.load_open_visits()["visits"][0]["seq"], 0)
        ledger._conn = _FailingConn(ledger._conn, fail_on=2)
        with self.assertRaises(sqlite3.OperationalError):
            # stationary inside the zone: ENTERED_ZONE + ARRIVAL_CANDIDATE in one step; the second row fails
            p.process_message(EVENTS, raw("update", "a", T0 + 1.0, ["front_lot"], stationary=True), 1001.0)
        self.assertEqual(ledger._conn.inserts, 2)
        self.assertEqual(p.tracker.open_visits()[0].seq, 2)  # memory moved on; the ledger must not be half-way
        self.assertEqual(ledger.outbox_depth(), 0)
        row = ledger._conn.execute("SELECT state, seq FROM visits WHERE visit_id = ?", (visit_id,)).fetchone()
        self.assertEqual((row["state"], row["seq"]), ("DETECTED", 0))
        self.assertEqual(ledger.load_open_visits()["visits"][0]["seq"], 0)


class CommitFailureTest(unittest.TestCase):
    def test_closed_visit_and_its_rows_are_held_through_a_failed_commit_and_land_on_the_next_step(self) -> None:
        ledger = Ledger(":memory:")
        p = make_pipeline(ledger)
        p.process_message(EVENTS, raw("new", "a", T0), 1000.0)
        p.process_message(EVENTS, raw("update", "a", T0 + 1.0, ["front_lot"]), 1001.0)
        p.process_message(EVENTS, raw("update", "a", T0 + 12.0, ["front_lot"]), 1012.0)
        p.process_message(EVENTS, raw("end", "a", T0 + 33.0, ["front_lot"], end=T0 + 33.0), 1033.0)
        visit_id = p.tracker.open_visits()[0].visit_id
        commit = ledger.commit_step
        failures = [sqlite3.OperationalError("disk I/O error")]

        def flaky_commit(visits, rows):
            if failures:
                raise failures.pop()
            return commit(visits, rows)

        ledger.commit_step = flaky_commit
        with self.assertLogs("visitd", level="ERROR"):
            with self.assertRaises(sqlite3.OperationalError):
                p.tick(1060.0)  # LEFT (estimated) closes the visit in memory; the ledger write fails
        self.assertEqual(p.tracker.open_visits(), [])
        self.assertEqual([v.visit_id for v in p.tracker.closed_visits()], [visit_id])  # still buffered, not lost
        self.assertEqual(ledger.count_visits([LEFT]), 0)
        self.assertEqual(ledger.outbox_depth(), 2)  # ENTERED_ZONE, ARRIVAL_CANDIDATE
        self.assertEqual(len(ledger.load_open_visits()["visits"]), 1)  # a restart right now would resurrect it
        self.assertEqual(p.tick(1065.0), [])  # quiet step: the held visit and its LEFT row commit together
        self.assertEqual(p.tracker.closed_visits(), [])
        self.assertEqual(ledger.load_open_visits()["visits"], [])
        self.assertEqual(ledger.count_visits([LEFT]), 1)
        self.assertEqual(ledger.outbox_depth(), 3)
        row = ledger._conn.execute("SELECT state, seq FROM visits WHERE visit_id = ?", (visit_id,)).fetchone()
        self.assertEqual((row["state"], row["seq"]), (LEFT, 3))
        queued = ledger._conn.execute("SELECT event_id FROM outbox WHERE visit_state = ?", (LEFT,)).fetchone()
        self.assertEqual(queued["event_id"], event_id(visit_id, LEFT, 3))  # same seq, same idempotency key


class InboxTimingTest(unittest.TestCase):
    def test_receipt_monotonic_travels_with_the_message_and_drives_elapsed_time(self) -> None:
        p = make_pipeline()
        inbox: "queue.Queue" = queue.Queue()
        now = [1000.0]
        client = MqttClient(build_config(RAW, environ={}).mqtt, inbox, p.metrics, clock=lambda: now[0])
        client._on_message(None, None, FakeMqttMessage(EVENTS, raw("new", "a", T0)))
        now[0] = 1010.0
        client._on_message(None, None, FakeMqttMessage(EVENTS, raw("update", "a", T0 + 1.0, ["front_lot"])))
        self.assertEqual([item[2] for item in list(inbox.queue)], [1000.0, 1010.0])
        drained = []
        while not inbox.empty():  # backlog drained in one go, long after receipt
            drained.append(states(p.process_inbox_item(inbox.get_nowait())))
        self.assertEqual(drained, [[], [ENTERED_ZONE]])
        self.assertEqual(p.wall_at_last_message, 1010.0)
        self.assertEqual(p.estimated_frame_time(1030.0), T0 + 1.0 + 20.0)

    def test_every_queued_message_is_consumed_before_a_tick_so_exit_and_quick_reentry_stay_one_visit(self) -> None:
        p = make_pipeline()
        p.process_message(EVENTS, raw("new", "a", T0), 1000.0)
        p.process_message(EVENTS, raw("update", "a", T0 + 1.0, ["front_lot"]), 1001.0)
        self.assertEqual(states(p.process_message(EVENTS, raw("update", "a", T0 + 12.0, ["front_lot"]), 1012.0)), [ARRIVAL_CANDIDATE])
        inbox: "queue.Queue" = queue.Queue()
        inbox.put((EVENTS, raw("update", "a", T0 + 20.0, []), 1020.0))  # rolled out of the zone...
        inbox.put((EVENTS, raw("update", "a", T0 + 25.0, ["front_lot"]), 1025.0))  # ...and back 5 s later
        # both were received while a blocking heartbeat held the loop; one loop iteration runs 30 s later
        processed = p.consume_inbox(inbox, timeout=0.0)
        # estimate T0+55: the tick must not run ahead of the queued re-entry (LEFT); with both messages read the
        # arrival dwell is 19 s + 30 s >= 45 s, so the SAME visit is promoted instead
        out = p.tick(1055.0)
        self.assertEqual(states(out), [CONFIRMED_ARRIVAL])
        self.assertTrue(out[0].estimated)
        self.assertEqual([v.state for v in p.tracker.open_visits()], [CONFIRMED_ARRIVAL])
        self.assertEqual(p.ledger.count_visits([LEFT]), 0)
        self.assertEqual(p.tracker.counters["new_visits"], 1)
        self.assertEqual(processed, 2)
        self.assertTrue(inbox.empty())
        self.assertEqual(p.wall_at_last_message, 1025.0)

    def test_consume_inbox_survives_a_poison_item_and_keeps_draining(self) -> None:
        p = make_pipeline()
        inbox: "queue.Queue" = queue.Queue()
        inbox.put((EVENTS, raw("new", "poison", T0), 1000.0))
        inbox.put((EVENTS, raw("new", "a", T0), 1001.0))
        handle_event = p.tracker.handle_event

        def blow_up_once(event):  # the first message crashes deep inside the step; the second must still be read
            p.tracker.handle_event = handle_event
            raise RuntimeError("boom")

        p.tracker.handle_event = blow_up_once
        with self.assertLogs("visitd", level="ERROR"):
            self.assertEqual(p.consume_inbox(inbox, timeout=0.0), 2)
        self.assertEqual(p.metrics.get("visitd_pipeline_errors_total"), 1)
        self.assertEqual(len(p.tracker.open_visits()), 1)
        self.assertEqual(p.consume_inbox(inbox, timeout=0.0), 0)


class HousekeepingTest(unittest.TestCase):
    def test_hourly_prune_with_injected_clocks_then_wal_checkpoint(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = os.path.join(tmp.name, "visitd.sqlite")
        ledger = Ledger(path)
        self.addCleanup(ledger.close)
        p = make_pipeline(ledger, ledger_retention_days=1.0)
        p.process_message(EVENTS, raw("new", "a", T0), 1000.0)
        p.process_message(EVENTS, raw("update", "a", T0 + 1.0, ["front_lot"]), 1001.0)
        p.process_message(EVENTS, raw("update", "a", T0 + 12.0, ["front_lot"]), 1012.0)
        p.process_message(EVENTS, raw("end", "a", T0 + 33.0, ["front_lot"], end=T0 + 33.0), 1033.0)
        self.assertEqual(states(p.tick(1060.0)), [LEFT])
        self.assertEqual(ledger.count_visits([LEFT]), 1)
        self.assertEqual(p.housekeeping(2000.0, T0 + 3600.0), 0)  # first run happens at once; nothing old enough
        self.assertEqual(p.housekeeping(2000.0 + 3599.0, T0 + 2 * 86400.0), 0)  # not due for another hour
        self.assertEqual(ledger.count_visits(), 1)
        self.assertEqual(p.housekeeping(2000.0 + 3600.0, T0 + 2 * 86400.0), 1)  # due, and past retention
        self.assertEqual(ledger.count_visits(), 0)
        self.assertEqual(p.metrics.get("visitd_ledger_pruned_visits_total"), 1)
        self.assertEqual(os.path.getsize(path + "-wal"), 0)  # wal_checkpoint(TRUNCATE) ran after the delete
        self.assertEqual(p.housekeeping(2000.0 + 7200.0, T0 + 2 * 86400.0), 0)


if __name__ == "__main__":
    unittest.main()
