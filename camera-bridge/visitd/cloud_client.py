"""Cloud delivery worker: drains the SQLite outbox in order and sends heartbeats.

POST {baseUrl}/api/devices/{cloudDeviceId}/events  (header x-sync-key)
PATCH {baseUrl}/api/devices/{cloudDeviceId}         (heartbeat, not queued)

Retry policy: network errors, 408/425/429 and 5xx retry with exponential
backoff (never skipping ahead, so order is preserved); any other 4xx is
permanent - the item is logged and removed so one bad payload cannot wedge
the queue. 401 additionally names the likely cause (sync key mismatch).
The sync key is never logged.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from typing import Callable, Dict, Optional, Tuple

from .config import BackendConfig
from .ledger import Ledger
from .metrics import MetricsRegistry

log = logging.getLogger("visitd.cloud")

Transport = Callable[[str, str, Dict[str, object], Dict[str, str], float], Tuple[int, str]]

RETRYABLE_STATUSES = frozenset({408, 425, 429})


def requests_transport(method: str, url: str, payload: Dict[str, object], headers: Dict[str, str], timeout: float) -> Tuple[int, str]:
    """Default transport built on requests (imported lazily so tests never need it)."""
    import requests

    resp = requests.request(method, url, json=payload, headers=headers, timeout=timeout)
    return resp.status_code, resp.text[:300]


def events_url(base_url: str, cloud_device_id: str) -> str:
    """POST target for a device."""
    return f"{base_url.rstrip('/')}/api/devices/{cloud_device_id}/events"


def device_url(base_url: str, cloud_device_id: str) -> str:
    """PATCH target for a device heartbeat."""
    return f"{base_url.rstrip('/')}/api/devices/{cloud_device_id}"


def is_permanent(status: int) -> bool:
    """4xx other than the retryable trio never succeeds on retry."""
    return 400 <= status < 500 and status not in RETRYABLE_STATUSES


class CloudClient:
    """Background worker draining the outbox; also sends heartbeats synchronously."""

    def __init__(
        self,
        backend: BackendConfig,
        ledger: Ledger,
        metrics: MetricsRegistry,
        dry_run: bool = False,
        transport: Optional[Transport] = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.backend = backend
        self.ledger = ledger
        self.metrics = metrics
        self.dry_run = dry_run
        self.transport = transport or requests_transport
        self._sleep = sleep
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread = threading.Thread(target=self._run, name="visitd-cloud", daemon=True)
        self._backoff = backend.retry_min_seconds
        self._missing_key_logged = 0.0

    # ---- lifecycle

    def start(self) -> None:
        """Start the worker thread."""
        self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        """Ask the worker to stop and wait for it."""
        self._stop.set()
        self._wake.set()
        if self._thread.is_alive():
            self._thread.join(timeout)

    def wake(self) -> None:
        """Signal that the outbox has new work."""
        self._wake.set()

    def _run(self) -> None:
        """Worker loop: deliver while there is work, otherwise wait for a wake-up."""
        while not self._stop.is_set():
            outcome = self.deliver_once()
            if outcome == "sent":
                continue
            wait = self._backoff if outcome == "retry" else 1.0
            self._wake.wait(wait)
            self._wake.clear()

    # ---- delivery

    def _headers(self) -> Dict[str, str]:
        """Auth + content headers."""
        return {"Content-Type": "application/json", "x-sync-key": self.backend.sync_key or ""}

    def deliver_once(self) -> str:
        """Try the oldest outbox item. Returns 'idle', 'sent', 'dropped', 'retry' or 'blocked'."""
        item = self.ledger.outbox_peek()
        if item is None:
            self.metrics.set("visitd_outbox_depth", 0)
            return "idle"
        if self.dry_run:
            log.info("dry-run event %s", json.dumps(item.payload, separators=(",", ":"), sort_keys=True))
            self.ledger.outbox_ack(item.id)
            self.metrics.inc("visitd_cloud_events_total", labels={"result": "dry_run"})
            self.metrics.set("visitd_outbox_depth", self.ledger.outbox_depth())
            return "sent"
        if not self.backend.sync_key:
            now = time.monotonic()
            if now - self._missing_key_logged > 60:
                log.error("cloud blocked reason=missing_sync_key outbox_depth=%s", self.ledger.outbox_depth())
                self._missing_key_logged = now
            return "blocked"
        try:
            status, text = self.transport("POST", item.url, item.payload, self._headers(), self.backend.timeout_seconds)
        except Exception as exc:  # network layer failed; retry
            status, text = 0, f"{type(exc).__name__}: {exc}"
        if 200 <= status < 300:
            self.ledger.outbox_ack(item.id)
            self._backoff = self.backend.retry_min_seconds
            self.metrics.inc("visitd_cloud_events_total", labels={"result": "ok"})
            log.info("cloud sent event_id=%s device=%s status=%s attempts=%s", item.event_id, item.device_id, status, item.attempts + 1)
            self.metrics.set("visitd_outbox_depth", self.ledger.outbox_depth())
            return "sent"
        if status and is_permanent(status):
            reason = "sync_key_rejected" if status == 401 else f"http_{status}"
            log.error("cloud dropped event_id=%s device=%s status=%s reason=%s body=%r", item.event_id, item.device_id, status, reason, text[:120])
            self.ledger.outbox_fail(item.id, f"{status}: {text}", permanent=True)
            self.metrics.inc("visitd_cloud_events_total", labels={"result": "dropped"})
            self.metrics.inc("visitd_cloud_dropped_total", labels={"reason": reason})
            self.metrics.set("visitd_outbox_depth", self.ledger.outbox_depth())
            return "dropped"
        self.ledger.outbox_fail(item.id, f"{status}: {text}", permanent=False)
        self.metrics.inc("visitd_cloud_events_total", labels={"result": "retry"})
        log.warning("cloud retry event_id=%s status=%s attempts=%s backoff=%.1fs error=%r", item.event_id, status, item.attempts + 1, self._backoff, text[:120])
        self._backoff = min(self._backoff * 2, self.backend.retry_max_seconds)
        return "retry"

    def heartbeat(self, cloud_device_id: str, body: Dict[str, object]) -> bool:
        """PATCH a device heartbeat; best effort, never queued."""
        url = device_url(self.backend.base_url, cloud_device_id)
        if self.dry_run:
            log.info("dry-run heartbeat device=%s body=%s", cloud_device_id, json.dumps(body, separators=(",", ":"), sort_keys=True))
            return True
        if not self.backend.sync_key:
            return False
        try:
            status, text = self.transport("PATCH", url, body, self._headers(), self.backend.timeout_seconds)
        except Exception as exc:
            log.warning("heartbeat failed device=%s error=%s", cloud_device_id, f"{type(exc).__name__}: {exc}")
            self.metrics.inc("visitd_heartbeats_total", labels={"result": "error"})
            return False
        ok = 200 <= status < 300
        self.metrics.inc("visitd_heartbeats_total", labels={"result": "ok" if ok else "error"})
        if not ok:
            log.warning("heartbeat rejected device=%s status=%s body=%r", cloud_device_id, status, text[:120])
        return ok
