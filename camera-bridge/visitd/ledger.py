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
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

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
    last_error TEXT,
    http_failures INTEGER NOT NULL DEFAULT 0,
    visit_id TEXT,
    visit_state TEXT
);
CREATE TABLE IF NOT EXISTS dead_letter (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    device_id TEXT NOT NULL,
    url TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at REAL NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    http_failures INTEGER NOT NULL DEFAULT 0,
    last_status INTEGER NOT NULL,
    last_error TEXT,
    parked_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

# Columns added after the first release; applied to ledgers created by an older schema.
MIGRATIONS = (
    ("outbox", "http_failures", "INTEGER NOT NULL DEFAULT 0"),
    ("outbox", "visit_id", "TEXT"),
    ("outbox", "visit_state", "TEXT"),
)

DEAD_LETTER_RETENTION_SECONDS = 7 * 86400.0
_TERMINAL_PLACEHOLDERS = ",".join("?" for _ in TERMINAL_STATES)


@dataclass(frozen=True)
class OutboxItem:
    """One queued cloud POST."""

    id: int
    event_id: str
    device_id: str
    url: str
    payload: Dict[str, object]
    attempts: int
    http_failures: int


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
        for table, column, ddl in MIGRATIONS:
            self._ensure_column(table, column, ddl)
        # after the migrations: the column may be new on an older ledger
        self._conn.execute("CREATE INDEX IF NOT EXISTS idx_outbox_visit ON outbox(visit_id)")
        self.dropped_total = 0
        self.refused_total = 0

    def _ensure_column(self, table: str, column: str, ddl: str) -> None:
        """Add a column to a table created by an older schema (CREATE TABLE IF NOT EXISTS never alters)."""
        present = {row["name"] for row in self._conn.execute(f"PRAGMA table_info({table})").fetchall()}
        if column not in present:
            self._conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")

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

    def commit_step(self, visits: Iterable[Visit], rows: Sequence[Tuple[str, str, str, Dict[str, object]]]) -> Tuple[List[str], int]:
        """Persist one pipeline step atomically: the visits it touched AND the outbox rows it emitted share
        one transaction, so a crash can never leave a reloaded visit one seq behind what is already queued.

        `rows` are (event_id, device_id, url, payload). Returns (per-row status in order: 'inserted' |
        'duplicate' | 'refused', total rows evicted to make room).
        """
        with self._lock:
            self._conn.execute("BEGIN")
            try:
                for visit in visits:
                    self._save_visit(visit)
                statuses: List[str] = []
                evicted = 0
                for event_id, device_id, url, payload in rows:
                    status, n = self._enqueue_row(event_id, device_id, url, payload)
                    statuses.append(status)
                    evicted += n
                self._conn.execute("COMMIT")
                return statuses, evicted
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
        """State dict for VisitTracker.restore_state(): every non-terminal visit, plus the max-age continuation
        map recomputed from the terminal visits (`max_age_closed`: [sighting id, visit id, closed at] rows)."""
        with self._lock:
            rows = self._conn.execute(
                f"SELECT json FROM visits WHERE state NOT IN ({_TERMINAL_PLACEHOLDERS}) ORDER BY created_at", tuple(TERMINAL_STATES)
            ).fetchall()
            closed = self._max_age_closed_rows()
        return {"visits": [json.loads(r["json"]) for r in rows], "max_age_closed": closed}

    def _max_age_closed_rows(self) -> List[List[object]]:
        """Max-aged, ended sightings of terminal visits closed within maxSightingSeconds of the newest close,
        oldest first (the tracker's continuation map survives a restart without a second write path)."""
        ttl = self.policy.max_sighting_seconds
        if ttl <= 0:
            return []
        closed_at = "COALESCE(left_at, last_activity)"
        newest = self._conn.execute(
            f"SELECT MAX({closed_at}) FROM visits WHERE state IN ({_TERMINAL_PLACEHOLDERS})", tuple(TERMINAL_STATES)
        ).fetchone()[0]
        if newest is None:
            return []
        rows = self._conn.execute(
            f"SELECT visit_id, {closed_at} AS closed_at, json FROM visits"
            f" WHERE state IN ({_TERMINAL_PLACEHOLDERS}) AND {closed_at} >= ? ORDER BY closed_at, visit_id",
            (*TERMINAL_STATES, float(newest) - ttl),
        ).fetchall()
        out: List[List[object]] = []
        for r in rows:
            for s in json.loads(r["json"]).get("sightings", []):
                if s.get("max_age_fired") and s.get("end_time") is not None:
                    out.append([str(s["id"]), str(r["visit_id"]), float(r["closed_at"])])
        return out

    def prune_terminal_visits(self, older_than_seconds: float, now: float) -> int:
        """Delete terminal visits closed more than `older_than_seconds` before `now` (frame-time epoch),
        cascading to their sightings and zone intervals. The cloud is the canonical ledger."""
        cutoff = now - older_than_seconds
        where = f"state IN ({_TERMINAL_PLACEHOLDERS}) AND COALESCE(left_at, last_activity) < ?"
        params = (*TERMINAL_STATES, cutoff)
        with self._lock:
            self._conn.execute("BEGIN")
            try:
                for table in ("sightings", "visit_zone_intervals"):
                    self._conn.execute(f"DELETE FROM {table} WHERE visit_id IN (SELECT visit_id FROM visits WHERE {where})", params)
                deleted = self._conn.execute(f"DELETE FROM visits WHERE {where}", params).rowcount
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise
        return int(deleted)

    def prune_dead_letter(self, older_than_seconds: float, now: float) -> int:
        """Delete parked items older than `older_than_seconds` (parked_at is a wall-clock epoch)."""
        with self._lock:
            return int(self._conn.execute("DELETE FROM dead_letter WHERE parked_at < ?", (now - older_than_seconds,)).rowcount)

    def checkpoint(self) -> None:
        """Fold the WAL into the main file and truncate it (after a prune that deleted rows)."""
        with self._lock:
            self._conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")

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
        """Append to the outbox in its own transaction; returns (inserted, evicted_rows).

        Duplicate event ids are ignored. At outboxMaxDepth whole TERMINAL visits are evicted, oldest first;
        when only open visits are queued the new row is refused instead (see _enqueue_row).
        """
        with self._lock:
            self._conn.execute("BEGIN")
            try:
                status, evicted = self._enqueue_row(event_id, device_id, url, payload)
                self._conn.execute("COMMIT")
                return status == "inserted", evicted
            except Exception:
                self._conn.execute("ROLLBACK")
                raise

    def _enqueue_row(self, event_id: str, device_id: str, url: str, payload: Dict[str, object]) -> Tuple[str, int]:
        """Insert one outbox row inside an open transaction: ('inserted' | 'duplicate' | 'refused', evicted_rows).

        Room is made by evicting the OLDEST TERMINAL VISIT as a unit (every undelivered row of it), so the cloud
        never sees a LEFT for a visit whose arrival was thrown away. A visit is terminal when the visits table
        says LEFT / PASS_THROUGH or one of its queued rows carries that state. Rows without a visit id (legacy
        schema) are evicted singly. If nothing terminal is queued, the new row is refused and counted in
        refused_total rather than orphaning an open visit.
        """
        data = payload.get("data")
        visit_id = data.get("visitId") if isinstance(data, dict) else None
        visit_state = data.get("state") if isinstance(data, dict) else None
        if self._conn.execute("SELECT 1 FROM outbox WHERE event_id = ?", (event_id,)).fetchone() is not None:
            return "duplicate", 0
        evicted = 0
        while True:
            depth = int(self._conn.execute("SELECT COUNT(*) FROM outbox").fetchone()[0])
            if depth < self.outbox_max_depth:
                break
            removed = self._evict_oldest_terminal_visit(exclude=visit_id)
            if removed == 0:
                self.refused_total += 1
                log.warning(
                    "outbox full depth=%s refused event_id=%s visit=%s state=%s (only open visits queued; nothing evicted)",
                    depth, event_id, visit_id, visit_state,
                )
                return "refused", evicted
            evicted += removed
        if evicted:
            self.dropped_total += evicted
            log.warning("outbox full evicted=%s rows of the oldest terminal visits to queue event_id=%s", evicted, event_id)
        self._conn.execute(
            "INSERT INTO outbox (event_id, device_id, url, payload, created_at, visit_id, visit_state) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (event_id, device_id, url, json.dumps(payload, separators=(",", ":")), time.time(), visit_id, visit_state),
        )
        return "inserted", evicted

    def _evict_oldest_terminal_visit(self, exclude: Optional[str]) -> int:
        """Delete every queued row of the terminal visit whose first row is oldest (never `exclude`, the visit
        being queued); a legacy row without a visit id counts as its own group. Returns rows deleted."""
        row = self._conn.execute(
            f"""SELECT MIN(o.id) AS first_id, MAX(o.visit_id) AS visit_id
                FROM outbox o
                WHERE o.visit_id IS NULL
                   OR (o.visit_id IS NOT ? AND (o.visit_state IN ({_TERMINAL_PLACEHOLDERS})
                       OR o.visit_id IN (SELECT visit_id FROM visits WHERE state IN ({_TERMINAL_PLACEHOLDERS}))))
                GROUP BY COALESCE(o.visit_id, '#' || o.id)
                ORDER BY first_id ASC LIMIT 1""",
            (exclude, *TERMINAL_STATES, *TERMINAL_STATES),
        ).fetchone()
        if row is None:
            return 0
        if row["visit_id"] is None:
            return int(self._conn.execute("DELETE FROM outbox WHERE id = ?", (row["first_id"],)).rowcount)
        return int(self._conn.execute("DELETE FROM outbox WHERE visit_id = ?", (row["visit_id"],)).rowcount)

    def outbox_depth(self) -> int:
        """Pending items."""
        with self._lock:
            return int(self._conn.execute("SELECT COUNT(*) FROM outbox").fetchone()[0])

    def outbox_peek(self) -> Optional[OutboxItem]:
        """Oldest pending item, or None."""
        with self._lock:
            row = self._conn.execute(
                "SELECT id, event_id, device_id, url, payload, attempts, http_failures FROM outbox ORDER BY id ASC LIMIT 1"
            ).fetchone()
        if row is None:
            return None
        return OutboxItem(
            id=int(row["id"]), event_id=row["event_id"], device_id=row["device_id"], url=row["url"],
            payload=json.loads(row["payload"]), attempts=int(row["attempts"]), http_failures=int(row["http_failures"]),
        )

    def outbox_ack(self, item_id: int) -> None:
        """Delete a delivered item."""
        with self._lock:
            self._conn.execute("DELETE FROM outbox WHERE id = ?", (item_id,))

    def outbox_fail(self, item_id: int, error: str, permanent: bool = False, counted: bool = True) -> None:
        """Record a failed attempt; permanent failures are removed so the queue keeps flowing.

        `counted` failures (an HTTP response came back) advance http_failures, the dead-letter
        cap; transport failures (WAN down, DNS) never do, so an outage cannot park events.
        """
        with self._lock:
            if permanent:
                self._conn.execute("DELETE FROM outbox WHERE id = ?", (item_id,))
            else:
                self._conn.execute(
                    "UPDATE outbox SET attempts = attempts + 1, http_failures = http_failures + ?, last_error = ? WHERE id = ?",
                    (1 if counted else 0, error[:500], item_id),
                )

    def outbox_dead_letter(self, item_id: int, last_status: int, error: str, parked_at: Optional[float] = None) -> None:
        """Park a poison item in dead_letter (same columns plus last_status/last_error/parked_at) and drop it from the outbox."""
        with self._lock:
            self._conn.execute("BEGIN")
            try:
                self._conn.execute(
                    """INSERT OR REPLACE INTO dead_letter
                         (event_id, device_id, url, payload, created_at, attempts, http_failures, last_status, last_error, parked_at)
                       SELECT event_id, device_id, url, payload, created_at, attempts, http_failures, ?, ?, ?
                       FROM outbox WHERE id = ?""",
                    (int(last_status), error[:500], time.time() if parked_at is None else parked_at, item_id),
                )
                self._conn.execute("DELETE FROM outbox WHERE id = ?", (item_id,))
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise

    def dead_letter_depth(self) -> int:
        """Parked items."""
        with self._lock:
            return int(self._conn.execute("SELECT COUNT(*) FROM dead_letter").fetchone()[0])

    def dead_letter_rows(self, limit: int = 50) -> List[Dict[str, object]]:
        """Newest parked items first (diagnostics/tests): event_id, device_id, last_status, last_error, attempts, parked_at."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT event_id, device_id, last_status, last_error, attempts, http_failures, parked_at FROM dead_letter ORDER BY id DESC LIMIT ?",
                (int(limit),),
            ).fetchall()
        return [dict(r) for r in rows]

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
