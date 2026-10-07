"""Cloud worker with a fake transport: retry order, 401 drop, dead-letter cap, dry-run, secret hygiene."""
from __future__ import annotations

import dataclasses
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

    def test_a_permanent_4xx_parks_the_payload_in_dead_letter_instead_of_deleting_it(self) -> None:
        """The cloud's refusal is evidence, and deadLetterDepth is how the shop learns of it.

        Until 2026-10-07 a 401/400/404 DELETED the row: the heartbeat kept reporting
        deadLetterDepth=0 and a camera whose every event was being rejected read HEALTHY."""
        transport = FakeTransport([(400, '{"error":"invalid body","fieldErrors":{"data":["bad state"]}}'), (401, "unauthorized")])
        client = self._client(transport)
        self.ledger.enqueue("malformed", "dev-a", "u", {"eventId": "malformed"})
        self.ledger.enqueue("unauthorized", "dev-b", "u", {"eventId": "unauthorized"})
        with self.assertLogs("visitd.cloud", level="ERROR") as logs:
            self.assertEqual(client.deliver_once(), "dropped")
            self.assertEqual(client.deliver_once(), "dropped")
        self.assertTrue(all("parked in dead_letter" in line for line in logs.output))
        self.assertEqual(self.ledger.outbox_depth(), 0)
        self.assertEqual(self.ledger.dead_letter_depth(), 2)
        parked = {r["event_id"]: r for r in self.ledger.dead_letter_rows()}
        self.assertEqual(parked["malformed"]["last_status"], 400)
        self.assertIn("bad state", parked["malformed"]["last_error"])
        self.assertEqual(parked["unauthorized"]["last_status"], 401)
        self.assertEqual(self.metrics.get("visitd_outbox_dead_lettered_total"), 2)
        self.assertEqual(self.metrics.get("visitd_cloud_dropped_total", {"reason": "http_400"}), 1)
        self.assertEqual(self.metrics.get("visitd_cloud_dropped_total", {"reason": "sync_key_rejected"}), 1)
        # Retention still applies: housekeeping prunes a parked 4xx like any other dead letter.
        self.assertEqual(self.ledger.prune_dead_letter(0.0, now=self.ledger.dead_letter_rows()[0]["parked_at"] + 1.0), 2)

    def test_network_exception_is_a_retry(self) -> None:
        transport = FakeTransport([])
        client = self._client(transport)
        self.ledger.enqueue("e1", "dev", "u", {})
        with self.assertLogs("visitd.cloud", level="WARNING") as logs:
            self.assertEqual(client.deliver_once(), "retry")
        self.assertTrue(any("ConnectionError" in line for line in logs.output))
        self.assertEqual(self.ledger.outbox_peek().attempts, 1)

    def test_poison_head_is_dead_lettered_after_cap_and_the_healthy_item_behind_it_flows(self) -> None:
        backend = dataclasses.replace(self.backend, outbox_max_attempts=3)
        transport = FakeTransport([(500, "boom")] * 3 + [(200, "ok")])
        client = self._client(transport, backend=backend)
        self.ledger.enqueue("poison", "dev-a", "u", {"eventId": "poison"})
        self.ledger.enqueue("good", "dev-b", "u", {"eventId": "good"})
        self.assertEqual(client.deliver_once(), "retry")
        self.assertEqual(client.deliver_once(), "retry")
        self.assertEqual(self.ledger.outbox_peek().http_failures, 2)
        with self.assertLogs("visitd.cloud", level="ERROR") as logs:
            self.assertEqual(client.deliver_once(), "dead_lettered")
        self.assertTrue(any("dead-lettered" in line and "event_id=poison" in line for line in logs.output))
        self.assertEqual(client._backoff, backend.retry_min_seconds)
        self.assertEqual(client.deliver_once(), "sent")
        self.assertEqual(client.deliver_once(), "idle")
        self.assertEqual([c[2]["eventId"] for c in transport.calls], ["poison", "poison", "poison", "good"])
        self.assertEqual(self.ledger.outbox_depth(), 0)
        self.assertEqual(self.ledger.dead_letter_depth(), 1)
        parked = self.ledger.dead_letter_rows()
        self.assertEqual(len(parked), 1)
        self.assertEqual((parked[0]["event_id"], parked[0]["device_id"], parked[0]["last_status"], parked[0]["http_failures"]), ("poison", "dev-a", 500, 3))
        self.assertIn("boom", parked[0]["last_error"])
        self.assertEqual(self.metrics.get("visitd_outbox_dead_lettered_total"), 1)
        self.assertEqual(self.metrics.get("visitd_cloud_events_total", {"result": "retry"}), 3)
        self.assertEqual(self.metrics.get("visitd_cloud_events_total", {"result": "ok"}), 1)

    def test_transport_failures_never_count_toward_the_dead_letter_cap(self) -> None:
        """WAN down must flush in order once it ends: only HTTP error responses advance the cap."""
        backend = dataclasses.replace(self.backend, outbox_max_attempts=2)
        transport = FakeTransport([])  # every call raises ConnectionError
        client = self._client(transport, backend=backend)
        self.ledger.enqueue("e1", "dev", "u", {"eventId": "e1"})
        for _ in range(5):
            self.assertEqual(client.deliver_once(), "retry")
        item = self.ledger.outbox_peek()
        self.assertEqual((item.event_id, item.attempts, item.http_failures), ("e1", 5, 0))
        self.assertEqual(self.ledger.dead_letter_depth(), 0)
        self.assertEqual(self.metrics.get("visitd_outbox_dead_lettered_total"), 0)
        transport.responses = [(200, "ok")]
        self.assertEqual(client.deliver_once(), "sent")

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
