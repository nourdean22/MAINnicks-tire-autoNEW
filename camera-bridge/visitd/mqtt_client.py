"""paho-mqtt 2.1 subscriber whose only job is to parse-free enqueue raw messages.

on_message never blocks and never touches the state machine: it copies the
topic and payload bytes into a bounded queue.Queue and returns. Everything
else (parsing, state, persistence, HTTP) happens on the main thread.
"""
from __future__ import annotations

import logging
import queue
import threading
import time
from typing import Any, Optional, Tuple

from .config import MqttConfig
from .metrics import MetricsRegistry

log = logging.getLogger("visitd.mqtt")

InboxItem = Tuple[str, bytes, float]


class MqttClient:
    """Thin wrapper over paho with VERSION2 callbacks and auto-reconnect."""

    def __init__(self, cfg: MqttConfig, inbox: "queue.Queue[InboxItem]", metrics: MetricsRegistry) -> None:
        self.cfg = cfg
        self.inbox = inbox
        self.metrics = metrics
        self._connected = threading.Event()
        self._client: Optional[Any] = None

    @property
    def connected(self) -> bool:
        """True between a successful CONNACK and a disconnect."""
        return self._connected.is_set()

    def topics(self) -> Tuple[str, ...]:
        """Subscriptions visitd needs."""
        p = self.cfg.topic_prefix
        return (f"{p}/events", f"{p}/tracked_object_update", f"{p}/available")

    def start(self) -> None:
        """Connect asynchronously and run the network loop in paho's own thread."""
        import paho.mqtt.client as mqtt  # imported here so pure modules/tests never need paho

        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=self.cfg.client_id, clean_session=True)
        if self.cfg.username:
            client.username_pw_set(self.cfg.username, self.cfg.password)
        client.reconnect_delay_set(min_delay=1, max_delay=60)
        client.on_connect = self._on_connect
        client.on_disconnect = self._on_disconnect
        client.on_message = self._on_message
        self._client = client
        log.info("mqtt connecting host=%s port=%s user=%s", self.cfg.host, self.cfg.port, self.cfg.username or "-")
        client.connect_async(self.cfg.host, self.cfg.port, keepalive=self.cfg.keepalive)
        client.loop_start()

    def stop(self) -> None:
        """Stop the network loop."""
        if self._client is None:
            return
        try:
            self._client.disconnect()
        finally:
            self._client.loop_stop()
            self._connected.clear()

    # ---- paho callbacks (VERSION2 signatures)

    def _on_connect(self, client: Any, userdata: Any, flags: Any, reason_code: Any, properties: Any) -> None:
        """Subscribe on every (re)connect."""
        if getattr(reason_code, "is_failure", False):
            log.error("mqtt connect failed reason=%s", reason_code)
            self.metrics.inc("visitd_mqtt_connect_failures_total")
            return
        client.subscribe([(topic, 0) for topic in self.topics()])
        self._connected.set()
        self.metrics.inc("visitd_mqtt_connects_total")
        self.metrics.set("visitd_mqtt_connected", 1)
        log.info("mqtt connected topics=%s", ",".join(self.topics()))

    def _on_disconnect(self, client: Any, userdata: Any, flags: Any, reason_code: Any, properties: Any) -> None:
        """Mark disconnected; paho reconnects on its own."""
        self._connected.clear()
        self.metrics.set("visitd_mqtt_connected", 0)
        self.metrics.inc("visitd_mqtt_disconnects_total")
        log.warning("mqtt disconnected reason=%s", reason_code)

    def _on_message(self, client: Any, userdata: Any, msg: Any) -> None:
        """Enqueue only; never parse, never block."""
        try:
            self.inbox.put_nowait((msg.topic, bytes(msg.payload), time.time()))
            self.metrics.inc("visitd_mqtt_messages_total")
        except queue.Full:
            self.metrics.inc("visitd_mqtt_dropped_total")
