"""visitd entry point: MQTT -> queue -> state machine -> ledger/outbox -> cloud.

    python -m visitd.main [--config config.yaml] [--dry-run] [--replay events.jsonl]

The main thread is the only consumer of the MQTT inbox queue and the only
writer of visit state. paho runs its own network thread (enqueue only) and
CloudClient runs its own delivery thread (outbox only).
"""
from __future__ import annotations

import argparse
import dataclasses
import json
import logging
import os
import queue
import signal
import sys
import threading
import time
from datetime import datetime, timezone
from typing import List, Optional, Sequence

from . import __version__
from .cloud_client import CloudClient, events_url
from .config import Config, ConfigError, load_config
from .contract import build_event
from .frigate_events import FrigateEvent, LprUpdate, parse_message
from .ledger import Ledger
from .metrics import REGISTRY, MetricsRegistry, MetricsServer
from .mqtt_client import MqttClient
from .replay import read_jsonl, replay
from .state_machine import Emission, VisitTracker

log = logging.getLogger("visitd")


def setup_logging(level: str) -> None:
    """Structured-ish key=value logging to stdout."""
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        stream=sys.stdout,
    )


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    """CLI flags."""
    parser = argparse.ArgumentParser(prog="visitd", description="Frigate -> statenour visit bridge")
    parser.add_argument("--config", default=os.environ.get("VISITD_CONFIG", "./config.yaml"), help="YAML config path")
    parser.add_argument("--dry-run", action="store_true", help="log event JSON instead of posting to the cloud")
    parser.add_argument("--replay", metavar="JSONL", help="feed a recorded MQTT JSONL through the pipeline with virtual time")
    parser.add_argument("--replay-tail-seconds", type=float, default=120.0, help="virtual seconds to tick after the last replayed message")
    parser.add_argument("--ledger", help="override the SQLite ledger path (':memory:' for throwaway runs)")
    parser.add_argument("--log-level", default=None, help="DEBUG|INFO|WARNING|ERROR (overrides config.logLevel)")
    parser.add_argument("--version", action="version", version=f"visitd {__version__}")
    return parser.parse_args(argv)


class Pipeline:
    """Owns the tracker and turns emissions into ledger rows + outbox items."""

    def __init__(self, cfg: Config, ledger: Ledger, cloud: CloudClient, metrics: MetricsRegistry) -> None:
        self.cfg = cfg
        self.ledger = ledger
        self.cloud = cloud
        self.metrics = metrics
        self.tracker = VisitTracker(cfg.policy, cfg.camera_specs())
        self.last_frame_time: Optional[float] = None
        self.wall_at_last_message: float = time.monotonic()
        self.last_event_at: Optional[str] = None
        self.frigate_available: Optional[bool] = None
        restored = self.tracker.restore_state(ledger.load_open_visits())
        self.metrics.set("visitd_open_visits", len(self.tracker.open_visits()))
        log.info("ledger restored open_visits=%s path=%s", restored, ledger.path)

    def process_message(self, topic: str, payload: bytes, wall_now: float) -> List[Emission]:
        """Parse one MQTT message and drive the tracker."""
        prefix = self.cfg.mqtt.topic_prefix
        if topic == f"{prefix}/available":
            self.frigate_available = payload.decode("utf-8", errors="replace").strip().lower() == "online"
            self.metrics.set("visitd_frigate_available", 1 if self.frigate_available else 0)
            log.info("frigate available=%s", self.frigate_available)
            return []
        try:
            message = parse_message(topic, payload, topic_prefix=prefix)
        except (ValueError, json.JSONDecodeError) as exc:
            self.metrics.inc("visitd_parse_errors_total")
            log.warning("parse error topic=%s error=%s", topic, exc)
            return []
        if message is None:
            return []
        if isinstance(message, FrigateEvent):
            emissions = self.tracker.handle_event(message)
            self.last_frame_time = message.time if self.last_frame_time is None else max(self.last_frame_time, message.time)
            self.wall_at_last_message = wall_now
            self.metrics.inc("visitd_frigate_events_total", labels={"type": message.type})
        elif isinstance(message, LprUpdate):
            emissions = self.tracker.handle_lpr(message)
            self.metrics.inc("visitd_lpr_updates_total")
        else:
            return []
        self.after_step(emissions)
        return emissions

    def tick(self, wall_now: float) -> List[Emission]:
        """Evaluate timers with an estimated frame time (last frame time + wall elapsed)."""
        if self.last_frame_time is None:
            return []
        estimate = self.last_frame_time + (wall_now - self.wall_at_last_message)
        emissions = self.tracker.tick(estimate)
        self.metrics.inc("visitd_ticks_total")
        self.after_step(emissions)
        return emissions

    def handle_emission(self, emission: Emission) -> None:
        """Render the contract payload and queue it for the cloud."""
        cam = self.cfg.cameras.get(emission.camera)
        if cam is None:
            log.error("emission for unconfigured camera=%s visit=%s", emission.camera, emission.visit_id)
            return
        payload = build_event(emission, cam.cloud_device_id, cam.display_name, cam.zone_names, self.cfg.frigate_version)
        url = events_url(self.cfg.backend.base_url, cam.cloud_device_id)
        inserted, dropped = self.ledger.enqueue(str(payload["eventId"]), cam.cloud_device_id, url, payload)
        if dropped:
            self.metrics.inc("visitd_outbox_dropped_total", dropped)
        self.metrics.inc("visitd_transitions_total", labels={"state": emission.state})
        if emission.estimated:
            self.metrics.inc("visitd_tick_promotions_total", labels={"state": emission.state})
        self.last_event_at = str(payload["timestamp"])
        log.info(
            "transition visit=%s state=%s seq=%s camera=%s zone=%s dwell=%.1f estimated=%s plate=%s queued=%s",
            emission.visit_id, emission.state, emission.seq, emission.camera, emission.zone, emission.dwell_seconds,
            emission.estimated, emission.plate.get("status"), inserted,
        )

    def after_step(self, emissions: List[Emission]) -> None:
        """Persist tracker state and wake the cloud worker when something was emitted."""
        for emission in emissions:
            self.handle_emission(emission)
        closed = self.tracker.drain_closed()
        self.ledger.save_visits(list(self.tracker.open_visits()) + closed)
        for visit in closed:
            self.metrics.inc("visitd_visits_closed_total", labels={"state": visit.state})
        self.metrics.set("visitd_open_visits", len(self.tracker.open_visits()))
        self.metrics.set("visitd_outbox_depth", self.ledger.outbox_depth())
        for name, value in self.tracker.counters.items():
            self.metrics.set(f"visitd_tracker_{name}", value)
        if emissions:
            self.cloud.wake()

    def heartbeat_body(self, mqtt_connected: bool) -> dict:
        """PATCH payload for every configured device."""
        return {
            "status": "ONLINE",
            "lastSeenAt": datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "currentState": {
                "bridgeVersion": __version__,
                "frigateVersion": self.cfg.frigate_version,
                "mqttConnected": mqtt_connected,
                "frigateAvailable": self.frigate_available,
                "outboxDepth": self.ledger.outbox_depth(),
                "lastEventAt": self.last_event_at,
                "openVisits": len(self.tracker.open_visits()),
                "metrics": self.metrics.snapshot(),
            },
        }


def run_live(cfg: Config, dry_run: bool) -> int:
    """Live mode: MQTT in, cloud out, until SIGINT/SIGTERM."""
    metrics = REGISTRY
    inbox: "queue.Queue" = queue.Queue(maxsize=cfg.mqtt.queue_max)
    ledger = Ledger(cfg.ledger_path, outbox_max_depth=cfg.backend.outbox_max_depth, policy=cfg.policy)
    cloud = CloudClient(cfg.backend, ledger, metrics, dry_run=dry_run)
    pipeline = Pipeline(cfg, ledger, cloud, metrics)
    mqtt = MqttClient(cfg.mqtt, inbox, metrics)
    server: Optional[MetricsServer] = None
    try:
        server = MetricsServer(cfg.metrics_host, cfg.metrics_port, metrics)
        server.start()
    except OSError as exc:
        log.error("metrics server unavailable host=%s port=%s error=%s", cfg.metrics_host, cfg.metrics_port, exc)
    stop = threading.Event()

    def _signal(signum: int, frame: object) -> None:
        log.info("shutdown signal=%s", signum)
        stop.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, _signal)
    log.info("visitd start version=%s dry_run=%s cameras=%s backend=%s", __version__, dry_run, ",".join(cfg.cameras), cfg.backend.base_url)
    if not dry_run and not cfg.backend.sync_key:
        log.error("STATENOUR_SYNC_KEY is not set; events will queue in the outbox until it is")
    cloud.start()
    mqtt.start()
    next_tick = time.monotonic() + cfg.tick_seconds
    next_heartbeat = time.monotonic() + 5.0
    try:
        while not stop.is_set():
            timeout = max(0.05, min(next_tick, next_heartbeat) - time.monotonic())
            try:
                topic, payload, wall = inbox.get(timeout=timeout)
            except queue.Empty:
                topic = None
            if topic is not None:
                try:
                    pipeline.process_message(topic, payload, time.monotonic())
                except Exception:  # keep consuming; one bad message must not kill the bridge
                    metrics.inc("visitd_pipeline_errors_total")
                    log.exception("pipeline error topic=%s", topic)
            now = time.monotonic()
            if now >= next_tick:
                next_tick = now + cfg.tick_seconds
                try:
                    pipeline.tick(now)
                except Exception:
                    metrics.inc("visitd_pipeline_errors_total")
                    log.exception("tick error")
            if now >= next_heartbeat:
                next_heartbeat = now + cfg.backend.heartbeat_seconds
                body = pipeline.heartbeat_body(mqtt.connected)
                for cam in cfg.cameras.values():
                    cloud.heartbeat(cam.cloud_device_id, body)
    finally:
        log.info("visitd stopping")
        mqtt.stop()
        cloud.stop()
        pipeline.after_step([])
        ledger.close()
        if server is not None:
            server.stop()
    return 0


def run_replay(cfg: Config, path: str, tail_seconds: float, ledger_path: Optional[str]) -> int:
    """Replay mode: JSONL in, dry-run event JSON out, summary at the end."""
    metrics = REGISTRY
    ledger = Ledger(ledger_path or ":memory:", outbox_max_depth=cfg.backend.outbox_max_depth, policy=cfg.policy)
    cloud = CloudClient(cfg.backend, ledger, metrics, dry_run=True)
    pipeline = Pipeline(cfg, ledger, cloud, metrics)
    records = read_jsonl(path)
    log.info("replay start file=%s records=%s tick=%.1fs tail=%.0fs", path, len(records), cfg.tick_seconds, tail_seconds)
    result = replay(
        pipeline.tracker, records, tick_seconds=cfg.tick_seconds, tail_seconds=tail_seconds,
        topic_prefix=cfg.mqtt.topic_prefix, on_emission=pipeline.handle_emission,
    )
    pipeline.after_step([])
    while cloud.deliver_once() == "sent":
        pass
    by_state: dict = {}
    for e in result.emissions:
        by_state[e.state] = by_state.get(e.state, 0) + 1
    log.info(
        "replay done messages=%s ignored=%s ticks=%s emissions=%s by_state=%s open_visits=%s counters=%s",
        result.messages, result.ignored, result.ticks, len(result.emissions), json.dumps(by_state, sort_keys=True),
        len(pipeline.tracker.open_visits()), json.dumps(pipeline.tracker.counters, sort_keys=True),
    )
    ledger.close()
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    """CLI entry."""
    args = parse_args(argv)
    try:
        from dotenv import load_dotenv

        load_dotenv()
    except ImportError:
        pass
    try:
        cfg = load_config(args.config)
    except (ConfigError, OSError) as exc:
        print(f"visitd: config error: {exc}", file=sys.stderr)
        return 2
    if args.ledger:
        cfg = dataclasses.replace(cfg, ledger_path=args.ledger)
    setup_logging(args.log_level or cfg.log_level)
    if args.replay:
        return run_replay(cfg, args.replay, args.replay_tail_seconds, args.ledger)
    return run_live(cfg, args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
