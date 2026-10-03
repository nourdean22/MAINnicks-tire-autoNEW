"""Durable job store for NOUR Video Forge (SQLite, WAL).

The store is the GPU service's single source of job truth. Three invariants:

1. Idempotency: ``idempotency_key`` is UNIQUE. Re-submitting the same key with
   the same request returns the existing job (any status, including succeeded);
   the same key with a DIFFERENT request is a 409 — never a second render.
2. Leases + heartbeats: a running job carries ``heartbeat_at``. A worker that
   dies stops heartbeating; ``reclaim_stale`` requeues (bounded) or fails it.
3. Restart recovery: on boot, every job left ``running`` by a previous process
   is requeued (bounded by ``max_restarts``) — accepted work is never silently
   orphaned, and a job is never left ``running`` forever.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any

TERMINAL = {"succeeded", "failed", "cancelled"}


def _now() -> float:
    return time.time()


def iso(ts: float | None) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def request_fingerprint(req: dict[str, Any]) -> str:
    """Hash of the render-relevant request (metadata excluded: tracing only)."""
    material = {k: v for k, v in req.items() if k not in ("metadata", "idempotency_key")}
    return hashlib.sha256(json.dumps(material, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class IdempotencyConflict(Exception):
    pass


class JobStore:
    def __init__(self, path: str, max_restarts: int = 2):
        self.path = path
        self.max_restarts = max_restarts
        self._lock = threading.Lock()
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute(
            """CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                idempotency_key TEXT NOT NULL UNIQUE,
                fingerprint TEXT NOT NULL,
                profile TEXT NOT NULL,
                request_json TEXT NOT NULL,
                status TEXT NOT NULL,
                progress REAL,
                created_at REAL NOT NULL,
                started_at REAL,
                heartbeat_at REAL,
                finished_at REAL,
                error_code TEXT,
                error_message TEXT,
                output_json TEXT,
                gpu_seconds REAL,
                gpu_type TEXT,
                model_version TEXT,
                workflow_version TEXT,
                seed INTEGER,
                restarts INTEGER NOT NULL DEFAULT 0,
                cancel_requested INTEGER NOT NULL DEFAULT 0
            )"""
        )

    # ── reads ────────────────────────────────────────────────────────────
    def get(self, job_id: str) -> dict[str, Any] | None:
        row = self._db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return dict(row) if row else None

    def get_request(self, job_id: str) -> dict[str, Any]:
        row = self._db.execute("SELECT request_json FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return json.loads(row["request_json"]) if row else {}

    def counts(self) -> dict[str, int]:
        rows = self._db.execute("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status").fetchall()
        return {r["status"]: r["n"] for r in rows}

    def recent_terminal(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self._db.execute(
            "SELECT status, profile, started_at, finished_at, gpu_seconds FROM jobs WHERE status IN ('succeeded','failed') ORDER BY finished_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

    # ── writes ───────────────────────────────────────────────────────────
    def submit(self, req: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        """Returns (job, created). Raises IdempotencyConflict on key reuse with a different request."""
        fp = request_fingerprint(req)
        with self._lock:
            existing = self._db.execute("SELECT * FROM jobs WHERE idempotency_key = ?", (req["idempotency_key"],)).fetchone()
            if existing:
                if existing["fingerprint"] != fp:
                    raise IdempotencyConflict(req["idempotency_key"])
                return dict(existing), False
            job_id = f"vf_{uuid.uuid4().hex[:20]}"
            self._db.execute(
                "INSERT INTO jobs (id, idempotency_key, fingerprint, profile, request_json, status, created_at) VALUES (?,?,?,?,?, 'queued', ?)",
                (job_id, req["idempotency_key"], fp, req["profile"], json.dumps(req), _now()),
            )
            return self.get(job_id), True  # type: ignore[return-value]

    def claim_next(self) -> dict[str, Any] | None:
        with self._lock:
            row = self._db.execute(
                "SELECT id FROM jobs WHERE status = 'queued' AND cancel_requested = 0 ORDER BY created_at LIMIT 1"
            ).fetchone()
            if not row:
                return None
            t = _now()
            cur = self._db.execute(
                "UPDATE jobs SET status='running', started_at=?, heartbeat_at=?, progress=0 WHERE id=? AND status='queued'",
                (t, t, row["id"]),
            )
            if cur.rowcount != 1:
                return None
            return self.get(row["id"])

    def heartbeat(self, job_id: str, progress: float | None = None) -> bool:
        """Returns False when cancellation was requested (the backend should stop)."""
        self._db.execute(
            "UPDATE jobs SET heartbeat_at=?, progress=COALESCE(?, progress) WHERE id=? AND status='running'",
            (_now(), progress, job_id),
        )
        row = self._db.execute("SELECT cancel_requested FROM jobs WHERE id=?", (job_id,)).fetchone()
        return not (row and row["cancel_requested"])

    def succeed(self, job_id: str, output: dict[str, Any], gpu_seconds: float, gpu_type: str, model_version: str, workflow_version: str, seed: int | None) -> None:
        self._db.execute(
            "UPDATE jobs SET status='succeeded', finished_at=?, progress=1, output_json=?, gpu_seconds=?, gpu_type=?, model_version=?, workflow_version=?, seed=? WHERE id=? AND status='running'",
            (_now(), json.dumps(output), gpu_seconds, gpu_type, model_version, workflow_version, seed, job_id),
        )

    def fail(self, job_id: str, code: str, message: str, gpu_seconds: float | None = None) -> None:
        self._db.execute(
            "UPDATE jobs SET status='failed', finished_at=?, error_code=?, error_message=?, gpu_seconds=COALESCE(?, gpu_seconds) WHERE id=? AND status NOT IN ('succeeded','failed','cancelled')",
            (_now(), code, message[:1000], gpu_seconds, job_id),
        )

    def cancel(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self.get(job_id)
            if not job or job["status"] in TERMINAL:
                return job
            if job["status"] == "queued":
                self._db.execute("UPDATE jobs SET status='cancelled', finished_at=?, error_code='cancelled' WHERE id=?", (_now(), job_id))
            else:
                # running: ask the backend to stop at its next heartbeat; mark terminal now so
                # pollers stop waiting. The worker's late success write is ignored (status guard).
                self._db.execute(
                    "UPDATE jobs SET cancel_requested=1, status='cancelled', finished_at=?, error_code='cancelled' WHERE id=?",
                    (_now(), job_id),
                )
            return self.get(job_id)

    def recover_after_restart(self) -> int:
        """Boot-time: jobs left 'running' by a dead process are requeued (bounded) or failed."""
        n = 0
        with self._lock:
            for row in self._db.execute("SELECT id, restarts FROM jobs WHERE status='running'").fetchall():
                n += 1
                if row["restarts"] >= self.max_restarts:
                    self._db.execute(
                        "UPDATE jobs SET status='failed', finished_at=?, error_code='worker_restart_lost', error_message='lost to repeated worker restarts' WHERE id=?",
                        (_now(), row["id"]),
                    )
                else:
                    self._db.execute(
                        "UPDATE jobs SET status='queued', started_at=NULL, heartbeat_at=NULL, progress=NULL, restarts=restarts+1 WHERE id=?",
                        (row["id"],),
                    )
        return n

    def reclaim_stale(self, stale_after_s: dict[str, float], hard_ceiling_s: dict[str, float]) -> list[str]:
        """Live-process sweep: silent or over-ceiling running jobs become failed (never zombies)."""
        t = _now()
        out = []
        for row in self._db.execute("SELECT id, profile, created_at, heartbeat_at FROM jobs WHERE status IN ('running','queued')").fetchall():
            ceiling = hard_ceiling_s.get(row["profile"], 1800)
            stale = stale_after_s.get(row["profile"], 180)
            if t - row["created_at"] > ceiling:
                self.fail(row["id"], "hard_ceiling", f"exceeded {int(ceiling)}s")
                out.append(row["id"])
            elif row["heartbeat_at"] is not None and t - row["heartbeat_at"] > stale:
                self.fail(row["id"], "stale_heartbeat", f"no heartbeat for {int(t - row['heartbeat_at'])}s")
                out.append(row["id"])
        return out


def view(job: dict[str, Any]) -> dict[str, Any]:
    """Public JSON shape — matches ForgeJobView in nickstire's videoForgeClient.ts."""
    return {
        "id": job["id"],
        "idempotency_key": job["idempotency_key"],
        "profile": job["profile"],
        "status": job["status"],
        "progress": job["progress"],
        "created_at": iso(job["created_at"]),
        "started_at": iso(job["started_at"]),
        "heartbeat_at": iso(job["heartbeat_at"]),
        "finished_at": iso(job["finished_at"]),
        "error_code": job["error_code"],
        "error_message": job["error_message"],
        "output": json.loads(job["output_json"]) if job["output_json"] else None,
        "gpu_seconds": job["gpu_seconds"],
        "gpu_type": job["gpu_type"],
        "model_version": job["model_version"],
        "workflow_version": job["workflow_version"],
        "seed": job["seed"],
    }
