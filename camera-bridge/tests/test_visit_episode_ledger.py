"""The visit's episode id in the visitd ledger: the column, its migration, its writer.

WHY IT EXISTS. The vision stitcher's episode id used to live only on emissions. An edge
restart that continued a parked car's visit therefore had no episode to give the continuing
track, and a later stitched re-acquisition of that car counted as a SECOND car on the shop's
Lot. The end-to-end proof is `test_restart_continuity.RestartEpisodeTest`; this file pins the
three ledger-side facts it depends on:

  1. the column is added to a ledger that ALREADY EXISTS with rows -- the box's ledger, with
     open visits, at the deploy that ships this -- without touching those rows, and adding it
     again is a no-op;
  2. a recorded episode survives every re-save of its visit, and the latest non-null wins;
  3. `Pipeline.after_step` (the edge's durable boundary) records what its emissions carry,
     including through a failed commit.
"""
from __future__ import annotations

import dataclasses
import json
import os
import sqlite3
import tempfile
import unittest

from helpers import T0, ev, tracker

from test_main import make_pipeline
from visitd.ledger import Ledger
from visitd.state_machine import visit_to_dict

#: The `visits` table exactly as every ledger created before the episode column has it.
PRE_EPISODE_VISITS = """
CREATE TABLE visits (
    visit_id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    seq INTEGER NOT NULL DEFAULT 0,
    primary_camera TEXT NOT NULL,
    last_camera TEXT NOT NULL,
    created_at REAL NOT NULL,
    last_activity REAL NOT NULL,
    left_at REAL,
    merged_into TEXT,
    emitted INTEGER NOT NULL DEFAULT 0,
    plate_normalized TEXT,
    plate_status TEXT,
    json TEXT NOT NULL,
    updated_at REAL NOT NULL
);
"""


def _open_visit():
    """A real open visit, confirmed in the zone and still parked."""
    t = tracker()
    t.handle_event(ev("new", "a", T0))
    t.handle_event(ev("update", "a", T0 + 1.0, ["front_lot"], stationary=True))
    t.handle_event(ev("update", "a", T0 + 46.0, ["front_lot"], stationary=True))
    visit = t.open_visits()[0]
    return t, visit


def _columns(path):
    conn = sqlite3.connect(path)
    try:
        return [r[1] for r in conn.execute("PRAGMA table_info(visits)").fetchall()]
    finally:
        conn.close()


class EpisodeColumnMigrationTest(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".sqlite")
        os.close(fd)

    def tearDown(self):
        for suffix in ("", "-wal", "-shm"):
            try:
                os.unlink(self.path + suffix)
            except OSError:
                pass

    def test_an_existing_ledger_gains_the_column_and_keeps_its_open_visit(self):
        _, visit = _open_visit()
        conn = sqlite3.connect(self.path)
        conn.executescript(PRE_EPISODE_VISITS)
        conn.execute(
            "INSERT INTO visits (visit_id, state, seq, primary_camera, last_camera, created_at, last_activity,"
            " emitted, json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
            (visit.visit_id, visit.state, visit.seq, visit.primary_camera, visit.last_camera,
             visit.created_at, visit.last_activity, json.dumps(visit_to_dict(visit)), T0),
        )
        conn.commit()
        conn.close()
        self.assertNotIn("episode_id", _columns(self.path), "precondition: the old schema")

        ledger = Ledger(self.path)
        try:
            self.assertEqual(_columns(self.path).count("episode_id"), 1)
            restored = ledger.load_open_visits()["visits"]
            self.assertEqual([v["visit_id"] for v in restored], [visit.visit_id],
                             "the open visit came through the migration intact")
            self.assertEqual(restored[0]["state"], visit.state)
            self.assertEqual(tracker().restore_state(ledger.load_open_visits()), 1)
            self.assertEqual(ledger.open_visit_episodes(), {},
                             "an existing visit has NO episode, never an invented one")
        finally:
            ledger.close()

        again = Ledger(self.path)                       # the next restart: already migrated
        try:
            self.assertEqual(_columns(self.path).count("episode_id"), 1, "idempotent")
            self.assertEqual(len(again.load_open_visits()["visits"]), 1)
        finally:
            again.close()

    def test_a_fresh_ledger_has_the_column_once(self):
        Ledger(self.path).close()
        self.assertEqual(_columns(self.path).count("episode_id"), 1)


class EpisodeWriteTest(unittest.TestCase):
    def setUp(self):
        self.ledger = Ledger(":memory:")
        self.t, self.visit = _open_visit()

    def tearDown(self):
        self.ledger.close()

    def test_a_recorded_episode_survives_every_re_save_and_the_latest_wins(self):
        vid = self.visit.visit_id
        self.ledger.commit_step([self.visit], [], episodes={vid: "sign-1000-1"})
        self.assertEqual(self.ledger.open_visit_episodes(), {vid: "sign-1000-1"})

        # Every edge step re-saves every open visit; none of those may erase it.
        for _ in range(3):
            self.ledger.commit_step([self.visit], [])
            self.ledger.save_visits([self.visit])
        self.assertEqual(self.ledger.open_visit_episodes(), {vid: "sign-1000-1"})

        # The shop's own rule: a later non-null episode replaces the stored one.
        self.ledger.commit_step([self.visit], [], episodes={vid: "sign-1000-7"})
        self.assertEqual(self.ledger.open_visit_episodes(), {vid: "sign-1000-7"})

    def test_an_episode_for_an_unknown_visit_creates_nothing(self):
        self.ledger.commit_step([], [], episodes={"ghost": "sign-1-1"})
        self.assertEqual(self.ledger.count_visits(), 0)
        self.assertEqual(self.ledger.open_visit_episodes(), {})

    def test_a_terminal_visit_is_not_restored_with_an_episode(self):
        vid = self.visit.visit_id
        self.ledger.commit_step([self.visit], [], episodes={vid: "sign-1000-1"})
        self.t.handle_event(ev("end", "a", T0 + 60.0, [], end=T0 + 60.0))
        self.t.tick(T0 + 120.0)
        closed = self.t.drain_closed()
        self.assertEqual([v.visit_id for v in closed], [vid], "precondition: the visit closed")
        self.ledger.commit_step(closed, [])
        self.assertEqual(self.ledger.open_visit_episodes(), {})


class AfterStepEpisodeTest(unittest.TestCase):
    """The writer is `Pipeline.after_step`, the edge's durable boundary (EdgeLoop.step)."""

    def _stamped(self, p):
        emissions = p.tracker.handle_event(ev("new", "a", T0))
        emissions += p.tracker.handle_event(ev("update", "a", T0 + 1.0, ["front_lot"], stationary=True))
        self.assertTrue(emissions, "precondition: the step emitted")
        # What `VisionPipeline._emit` does for a stitched track: it stamps only the emissions of
        # ITS OWN sighting ("a"); another visit's emissions in the same answer keep their own.
        return [dataclasses.replace(e, episode_id="lot-1000-1") if e.sighting_id == "a" else e for e in emissions]

    def test_the_episode_its_emissions_carry_is_recorded_against_the_visit(self):
        p = make_pipeline(Ledger(":memory:"))
        p.after_step(self._stamped(p))
        vid = p.tracker.open_visits()[0].visit_id
        self.assertEqual(p.ledger.open_visit_episodes(), {vid: "lot-1000-1"})

    def test_unstamped_emissions_record_nothing(self):
        p = make_pipeline(Ledger(":memory:"))
        p.after_step(p.tracker.handle_event(ev("update", "a", T0 + 1.0, ["front_lot"], stationary=True)))
        self.assertTrue(p.tracker.open_visits(), "precondition: a visit exists")
        self.assertEqual(p.ledger.open_visit_episodes(), {})

    def test_the_episode_is_held_through_a_failed_commit_and_lands_on_the_next_step(self):
        ledger = Ledger(":memory:")
        p = make_pipeline(ledger)
        commit = ledger.commit_step
        failures = [sqlite3.OperationalError("disk I/O error")]

        def flaky_commit(visits, rows, shop_rows=(), episodes=None):
            if failures:
                raise failures.pop()
            return commit(visits, rows, shop_rows, episodes=episodes)

        ledger.commit_step = flaky_commit
        stamped = self._stamped(p)
        with self.assertLogs("visitd", level="ERROR"):
            with self.assertRaises(sqlite3.OperationalError):
                p.after_step(stamped)
        self.assertEqual(ledger.open_visit_episodes(), {}, "precondition: nothing landed")
        p.after_step([])                                   # a quiet step, as EdgeLoop commits
        vid = p.tracker.open_visits()[0].visit_id
        self.assertEqual(ledger.open_visit_episodes(), {vid: "lot-1000-1"})


if __name__ == "__main__":
    unittest.main()
