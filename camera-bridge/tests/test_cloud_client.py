"""Cloud worker with a fake transport: retry order, 401 drop, dry-run, secret hygiene."""
from __future__ import annotations

import logging
import unittest
from typing import Dict, List, Tuple

import helpers  # noqa: F401  (sys.path)

from visitd.cloud_client import CloudClient, device_url, events_url, is_permanent
from visitd.config import BackendConfig
from visitd.ledger import Ledger
from visitd.metrics import MetricsRegistry

KEY = "super-secret-sync-key"


class FakeTransport:
    """Scripted HTTP responses; records every call."""

    def __init__(self, responses: List[Tuple[int, str]]) -> None:
        self.responses = list(responses)
        self.calls: List[Tuple[str, str, Dict[str, object], Dict[str, str]]] = []

    def __call__(self, method, url, payload, headers, timeout):
        self.calls.append((method, url, payload, headers))
        if not self.responses:
            raise ConnectionError("no route to host")
        return self.responses.pop(0)


class CloudClientTest(unittest.TestCase):
    def setUp(self) -> None:
        self.ledger = Ledger(":memory:")
        self.metrics = MetricsRegistry()
        self.backend = BackendConfig(base_url="https://bdnick.info", sync_key=KEY, retry_min_seconds=1.0, retry_max_seconds=8.0)

    def tearDown(self) -> None:
        self.ledger.close()

    def _client(self, transport, dry_run=False, backend=None) -> CloudClient:
        return CloudClient(backend or self.backend, self.ledger, self.metrics, dry_run=dry_run, transport=transport)

    def test_urls(self) -> None:
        self.assertEqual(events_url("https://bdnick.info/", "v380-shopsign"), "https://bdnick.info/api/devices/v380-shopsign/events")
        self.assertEqual(device_url("https://bdnick.info", "v380-shopsign"), "https://bdnick.info/api/devices/v380-shopsign")
        self.assertTrue(is_permanent(401) and is_permanent(404) and is_permanent(400))
        self.assertFalse(is_permanent(429) or is_permanent(503) or is_permanent(408))

    def test_retry_keeps_order_and_backs_off(self) -> None:
        transport = FakeTransport([(503, "down"), (200, "ok"), (201, "ok")])
        client = self._client(transport)
        self.ledger.enqueue("e1", "dev", events_url(self.backend.base_url, "dev"), {"eventId": "e1"})
        self.ledger.enqueue("e2", "dev", events_url(self.backend.base_url, "dev"), {"eventId": "e2"})
        self.assertEqual(client.deliver_once(), "retry")
        self.assertEqual(client._backoff, 2.0)
        self.assertEqual(client.deliver_once(), "sent")
        self.assertEqual(client._backoff, 1.0)
        self.assertEqual(client.deliver_once(), "sent")
        self.assertEqual(client.deliver_once(), "idle")
        self.assertEqual([c[2]["eventId"] for c in transport.calls], ["e1", "e1", "e2"])
        self.assertEqual(transport.calls[0][3]["x-sync-key"], KEY)
        self.assertEqual(self.metrics.get("visitd_cloud_events_total", {"result": "ok"}), 2)

    def test_401_drops_item_and_moves_on(self) -> None:
        transport = FakeTransport([(401, "unauthorized"), (200, "ok")])
        client = self._client(transport)
        self.ledger.enqueue("bad", "dev", "u", {"eventId": "bad"})
        self.ledger.enqueue("good", "dev", "u", {"eventId": "good"})
        with self.assertLogs("visitd.cloud", level="ERROR") as logs:
            self.assertEqual(client.deliver_once(), "dropped")
        self.assertTrue(any("sync_key_rejected" in line for line in logs.output))
        self.assertFalse(any(KEY in line for line in logs.output))
        self.assertEqual(self.ledger.outbox_depth(), 1)
        self.assertEqual(client.deliver_once(), "sent")
        self.assertEqual(self.metrics.get("visitd_cloud_dropped_total", {"reason": "sync_key_rejected"}), 1)

    def test_network_exception_is_a_retry(self) -> None:
        transport = FakeTransport([])
        client = self._client(transport)
        self.ledger.enqueue("e1", "dev", "u", {})
        with self.assertLogs("visitd.cloud", level="WARNING") as logs:
            self.assertEqual(client.deliver_once(), "retry")
        self.assertTrue(any("ConnectionError" in line for line in logs.output))
        self.assertEqual(self.ledger.outbox_peek().attempts, 1)

    def test_dry_run_logs_json_and_acks_without_transport(self) -> None:
        transport = FakeTransport([(200, "never")])
        client = self._client(transport, dry_run=True)
        self.ledger.enqueue("e1", "dev", "u", {"eventId": "e1", "data": {"state": "LEFT"}})
        with self.assertLogs("visitd.cloud", level="INFO") as logs:
            self.assertEqual(client.deliver_once(), "sent")
        self.assertTrue(any('"state":"LEFT"' in line for line in logs.output))
        self.assertEqual(transport.calls, [])
        self.assertEqual(self.ledger.outbox_depth(), 0)

    def test_missing_key_blocks_without_dropping(self) -> None:
        transport = FakeTransport([(200, "ok")])
        client = self._client(transport, backend=BackendConfig(sync_key=None))
        self.ledger.enqueue("e1", "dev", "u", {})
        self.assertEqual(client.deliver_once(), "blocked")
        self.assertEqual(self.ledger.outbox_depth(), 1)
        self.assertEqual(transport.calls, [])

    def test_heartbeat_patches_device_url(self) -> None:
        transport = FakeTransport([(200, "ok"), (500, "boom")])
        client = self._client(transport)
        self.assertTrue(client.heartbeat("v380-shopsign", {"status": "ONLINE"}))
        self.assertFalse(client.heartbeat("v380-shopsign", {"status": "ONLINE"}))
        method, url, payload, headers = transport.calls[0]
        self.assertEqual((method, url), ("PATCH", "https://bdnick.info/api/devices/v380-shopsign"))
        self.assertEqual(payload["status"], "ONLINE")
        self.assertEqual(headers["x-sync-key"], KEY)
        self.assertEqual(self.metrics.get("visitd_heartbeats_total", {"result": "error"}), 1)


if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG)
    unittest.main()
