"""SQLite ledger: visits, sightings, zone intervals and the cloud outbox (WAL, restart-safe).

One connection guarded by a lock so the main thread (visits, enqueue) and the
cloud worker (peek/ack) can share it safely.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Tuple

from .state_machine import TERMINAL_STATES, Visit, plate_summary, visit_to_dict, VisitPolicy

log = logging.getLogger("visitd.ledger")

SCHEMA = """
CREATE TABLE IF NOT EXISTS visits (
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
CREATE INDEX IF NOT EXISTS idx_visits_state ON visits(state);
CREATE INDEX IF NOT EXISTS idx_visits_created ON visits(created_at);
CREATE INDEX IF NOT EXISTS idx_visits_plate ON visits(plate_normalized);
CREATE TABLE IF NOT EXISTS sightings (
    visit_id TEXT NOT NULL,
    sighting_id TEXT NOT NULL,
    camera TEXT NOT NULL,
    label TEXT NOT NULL,
    start_time REAL NOT NULL,
    end_time REAL,
    best_score REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (visit_id, sighting_id)
);
CREATE TABLE IF NOT EXISTS visit_zone_intervals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visit_id TEXT NOT NULL,
    sighting_id TEXT NOT NULL,
    camera TEXT NOT NULL,
    zone TEXT NOT NULL,
    start REAL NOT NULL,
    end REAL
);
CREATE INDEX IF NOT EXISTS idx_intervals_visit ON visit_zone_intervals(visit_id);
CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    device_id TEXT NOT NULL,
    url TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at REAL NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


@dataclass(frozen=True)
class OutboxItem:
    """One queued cloud POST."""

    id: int
    event_id: str
    device_id: str
    url: str
    payload: Dict[str, object]
    attempts: int


class Ledger:
    """Durable state for visitd."""

    def __init__(self, path: str, outbox_max_depth: int = 5000, policy: Optional[VisitPolicy] = None) -> None:
        self.path = path
        self.outbox_max_depth = max(1, outbox_max_depth)
        self.policy = policy or VisitPolicy()
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(SCHEMA)
        self.dropped_total = 0

    def close(self) -> None:
        """Close the connection."""
        with self._lock:
            self._conn.close()

    # ---- visits

    def save_visits(self, visits: Iterable[Visit]) -> None:
        """Upsert visits (plus their sightings and intervals) in one transaction."""
        with self._lock:
            self._conn.execute("BEGIN")
            try:
                for visit in visits:
                    self._save_visit(visit)
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise

    def _save_visit(self, visit: Visit) -> None:
        """Upsert one visit inside an open transaction."""
        plate = plate_summary(visit.reads(), self.policy)
        payload = json.dumps(visit_to_dict(visit), separators=(",", ":"))
        self._conn.execute(
            """INSERT INTO visits (visit_id, state, seq, primary_camera, last_camera, created_at, last_activity,
                                   left_at, merged_into, emitted, plate_normalized, plate_status, json, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(visit_id) DO UPDATE SET
                 state=excluded.state, seq=excluded.seq, last_camera=excluded.last_camera,
                 last_activity=excluded.last_activity, left_at=excluded.left_at, merged_into=excluded.merged_into,
                 emitted=excluded.emitted, plate_normalized=excluded.plate_normalized,
                 plate_status=excluded.plate_status, json=excluded.json, updated_at=excluded.updated_at""",
            (
                visit.visit_id, visit.state, visit.seq, visit.primary_camera, visit.last_camera, visit.created_at,
                visit.last_activity, visit.left_at, visit.merged_into, int(visit.emitted), plate.get("normalizedText"),
                plate.get("status"), payload, time.time(),
            ),
        )
        self._conn.execute("DELETE FROM sightings WHERE visit_id = ?", (visit.visit_id,))
        self._conn.execute("DELETE FROM visit_zone_intervals WHERE visit_id = ?", (visit.visit_id,))
        for s in visit.sightings.values():
            self._conn.execute(
                "INSERT INTO sightings (visit_id, sighting_id, camera, label, start_time, end_time, best_score) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (visit.visit_id, s.id, s.camera, s.label, s.start_time, s.end_time, s.best_score),
            )
            for iv in s.intervals:
                self._conn.execute(
                    "INSERT INTO visit_zone_intervals (visit_id, sighting_id, camera, zone, start, end) VALUES (?, ?, ?, ?, ?, ?)",
                    (visit.visit_id, s.id, s.camera, iv.zone, iv.start, iv.end),
                )

    def load_open_visits(self) -> Dict[str, object]:
        """State dict for VisitTracker.restore_state(): every non-terminal visit."""
        placeholders = ",".join("?" for _ in TERMINAL_STATES)
        with self._lock:
            rows = self._conn.execute(
                f"SELECT json FROM visits WHERE state NOT IN ({placeholders}) ORDER BY created_at", tuple(TERMINAL_STATES)
            ).fetchall()
        return {"visits": [json.loads(r["json"]) for r in rows]}

    def count_visits(self, states: Optional[Iterable[str]] = None) -> int:
        """Number of visits, optionally filtered by state."""
        with self._lock:
            if states is None:
                return int(self._conn.execute("SELECT COUNT(*) FROM visits").fetchone()[0])
            wanted = tuple(states)
            placeholders = ",".join("?" for _ in wanted)
            return int(self._conn.execute(f"SELECT COUNT(*) FROM visits WHERE state IN ({placeholders})", wanted).fetchone()[0])

    # ---- outbox

    def enqueue(self, event_id: str, device_id: str, url: str, payload: Dict[str, object]) -> Tuple[bool, int]:
        """Append to the outbox; returns (inserted, dropped_oldest). Duplicate event ids are ignored."""
        with self._lock:
            self._conn.execute("BEGIN")
            try:
                depth = int(self._conn.execute("SELECT COUNT(*) FROM outbox").fetchone()[0])
                dropped = 0
                if depth >= self.outbox_max_depth:
                    dropped = depth - self.outbox_max_depth + 1
                    self._conn.execute(
                        "DELETE FROM outbox WHERE id IN (SELECT id FROM outbox ORDER BY id ASC LIMIT ?)", (dropped,)
                    )
                    self.dropped_total += dropped
                    log.warning("outbox full depth=%s dropped_oldest=%s", depth, dropped)
                cur = self._conn.execute(
                    "INSERT OR IGNORE INTO outbox (event_id, device_id, url, payload, created_at) VALUES (?, ?, ?, ?, ?)",
                    (event_id, device_id, url, json.dumps(payload, separators=(",", ":")), time.time()),
                )
                self._conn.execute("COMMIT")
                return cur.rowcount == 1, dropped
            except Exception:
                self._conn.execute("ROLLBACK")
                raise

    def outbox_depth(self) -> int:
        """Pending items."""
        with self._lock:
            return int(self._conn.execute("SELECT COUNT(*) FROM outbox").fetchone()[0])

    def outbox_peek(self) -> Optional[OutboxItem]:
        """Oldest pending item, or None."""
        with self._lock:
            row = self._conn.execute(
                "SELECT id, event_id, device_id, url, payload, attempts FROM outbox ORDER BY id ASC LIMIT 1"
            ).fetchone()
        if row is None:
            return None
        return OutboxItem(
            id=int(row["id"]), event_id=row["event_id"], device_id=row["device_id"], url=row["url"],
            payload=json.loads(row["payload"]), attempts=int(row["attempts"]),
        )

    def outbox_ack(self, item_id: int) -> None:
        """Delete a delivered item."""
        with self._lock:
            self._conn.execute("DELETE FROM outbox WHERE id = ?", (item_id,))

    def outbox_fail(self, item_id: int, error: str, permanent: bool = False) -> None:
        """Record a failed attempt; permanent failures are removed so the queue keeps flowing."""
        with self._lock:
            if permanent:
                self._conn.execute("DELETE FROM outbox WHERE id = ?", (item_id,))
            else:
                self._conn.execute(
                    "UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?", (error[:500], item_id)
                )

    def outbox_ids(self) -> List[int]:
        """Pending ids in delivery order (diagnostics/tests)."""
        with self._lock:
            return [int(r["id"]) for r in self._conn.execute("SELECT id FROM outbox ORDER BY id ASC").fetchall()]

    # ---- meta

    def set_meta(self, key: str, value: str) -> None:
        """Upsert a meta value."""
        with self._lock:
            self._conn.execute(
                "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value)
            )

    def get_meta(self, key: str) -> Optional[str]:
        """Read a meta value."""
        with self._lock:
            row = self._conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return None if row is None else str(row["value"])
