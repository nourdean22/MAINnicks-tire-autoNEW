"""MqttClient callback: monotonic receipt stamp, bounded inbox, rate-limited drop warning."""
from __future__ import annotations

import queue
import unittest

from helpers import FakeMqttMessage

from visitd.config import build_config
from visitd.metrics import MetricsRegistry
from visitd.mqtt_client import MqttClient

RAW = {"cameras": {"lot": {"cloudDeviceId": "dev-lot", "arrivalZones": ["front_lot"]}}}


class OnMessageTest(unittest.TestCase):
    def _client(self, inbox: "queue.Queue", now: list) -> MqttClient:
        return MqttClient(build_config(RAW, environ={}).mqtt, inbox, MetricsRegistry(), clock=lambda: now[0])

    def test_queues_the_injected_monotonic_receipt_time(self) -> None:
        inbox: "queue.Queue" = queue.Queue()
        client = self._client(inbox, [1234.5])
        client._on_message(None, None, FakeMqttMessage("frigate/events", b"{}"))
        self.assertEqual(inbox.get_nowait(), ("frigate/events", b"{}", 1234.5))
        self.assertEqual(client.metrics.get("visitd_mqtt_messages_total"), 1)

    def test_inbox_full_warning_is_rate_limited_to_one_per_minute_and_carries_the_drop_count(self) -> None:
        inbox: "queue.Queue" = queue.Queue(maxsize=1)
        now = [100.0]
        client = self._client(inbox, now)
        msg = FakeMqttMessage("frigate/events", b"{}")
        client._on_message(None, None, msg)  # fills the inbox
        with self.assertLogs("visitd.mqtt", level="WARNING") as logs:
            client._on_message(None, None, msg)  # first drop warns at once
        self.assertEqual(len(logs.output), 1)
        self.assertIn("dropped=1", logs.output[0])
        now[0] = 130.0
        with self.assertNoLogs("visitd.mqtt", level="WARNING"):
            client._on_message(None, None, msg)
            client._on_message(None, None, msg)
        now[0] = 159.9
        with self.assertNoLogs("visitd.mqtt", level="WARNING"):
            client._on_message(None, None, msg)
        now[0] = 160.0
        with self.assertLogs("visitd.mqtt", level="WARNING") as logs:
            client._on_message(None, None, msg)
        self.assertEqual(len(logs.output), 1)
        self.assertIn("dropped=4", logs.output[0])  # everything since the previous warning
        self.assertEqual(client.metrics.get("visitd_mqtt_dropped_total"), 5)
        self.assertEqual(inbox.qsize(), 1)


if __name__ == "__main__":
    unittest.main()
