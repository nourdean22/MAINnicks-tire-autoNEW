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
from typing import Dict, List, Optional, Sequence, Tuple

from . import __version__
from .cloud_client import CloudClient, events_url
from .config import Config, ConfigError, load_config
from .contract import build_event
from .frigate_events import FrigateEvent, LprUpdate, parse_message
from .ledger import DEAD_LETTER_RETENTION_SECONDS, Ledger
from .metrics import REGISTRY, MetricsRegistry, MetricsServer
from .mqtt_client import InboxItem, MqttClient
from .replay import read_jsonl, replay
from .state_machine import Emission, VisitTracker

log = logging.getLogger("visitd")

PRUNE_INTERVAL_SECONDS = 3600.0


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
        self.next_prune_at: float = 0.0  # wall (monotonic) time of the next ledger prune; first one runs at once
        self._pending_rows: List[Tuple[str, str, str, Dict[str, object]]] = []  # outbox rows of a step whose commit failed
        restored = self.tracker.restore_state(ledger.load_open_visits())
        self.metrics.set("visitd_open_visits", len(self.tracker.open_visits()))
        log.info("ledger restored open_visits=%s path=%s", restored, ledger.path)

    def process_inbox_item(self, item: InboxItem) -> List[Emission]:
        """Consume one (topic, payload, received_at) tuple from the MQTT inbox. `received_at` is the paho
        thread's monotonic stamp, so a backlog drained late still measures elapsed time from receipt."""
        topic, payload, received_at = item
        return self.process_message(topic, payload, received_at)

    def consume_inbox(self, inbox: "queue.Queue[InboxItem]", timeout: float) -> int:
        """Wait up to `timeout` for the first inbox item, then drain EVERY queued item in receipt order.

        The tick that follows estimates frame time from the last message's receipt stamp; it must never run
        ahead of a message that is already queued (an exit followed by a quick re-entry, received while a
        heartbeat blocked the loop, would otherwise split one visit into two). Returns the items processed.
        """
        processed = 0
        try:
            item: Optional[InboxItem] = inbox.get(timeout=timeout)
        except queue.Empty:
            return processed
        while item is not None:
            processed += 1
            try:
                self.process_inbox_item(item)
            except Exception:  # keep consuming; one bad message must not kill the bridge
                self.metrics.inc("visitd_pipeline_errors_total")
                log.exception("pipeline error topic=%s", item[0])
            try:
                item = inbox.get_nowait()
            except queue.Empty:
                item = None
        return processed

    def process_message(self, topic: str, payload: bytes, wall_now: float) -> List[Emission]:
        """Parse one MQTT message and drive the tracker; `wall_now` is the monotonic time the message arrived."""
        prefix = self.cfg.mqtt.topic_prefix
        if topic == f"{prefix}/available":
            return self.frigate_availability(payload.decode("utf-8", errors="replace").strip().lower() == "online", wall_now)
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

    def frigate_availability(self, available: bool, wall_now: float) -> List[Emission]:
        """Track Frigate's LWT topic; an offline flip, and the online that follows it, mean its object
        registry is gone, so every open sighting is force-ended (it would never receive `end`)."""
        was = self.frigate_available
        self.frigate_available = available
        self.metrics.set("visitd_frigate_available", 1 if available else 0)
        log.info("frigate available=%s", available)
        registry_lost = (not available and was is not False) or (available and was is False)
        if not registry_lost:
            return []
        return self.force_end_open_sightings("frigate_restart", wall_now)

    def estimated_frame_time(self, wall_now: float) -> Optional[float]:
        """Last Frigate frame time plus the wall seconds since it arrived; None before any message."""
        if self.last_frame_time is None:
            return None
        return self.last_frame_time + (wall_now - self.wall_at_last_message)

    def force_end_open_sightings(self, reason: str, wall_now: float) -> List[Emission]:
        """End every open sighting at the estimated frame time and let the grace timers run."""
        at = self.estimated_frame_time(wall_now)
        if at is None:  # only ledger-restored visits exist: anchor virtual time on their last activity
            at = max((v.last_activity for v in self.tracker.open_visits()), default=None)
            if at is None:
                return []
            self.last_frame_time, self.wall_at_last_message = at, wall_now
        emissions = self.tracker.force_end_open_sightings(at, reason)
        self.after_step(emissions)
        return emissions

    def tick(self, wall_now: float) -> List[Emission]:
        """Evaluate timers with an estimated frame time (last frame time + wall elapsed)."""
        estimate = self.estimated_frame_time(wall_now)
        if estimate is None:
            return []
        emissions = self.tracker.tick(estimate)
        self.metrics.inc("visitd_ticks_total")
        self.after_step(emissions)
        return emissions

    def render_emission(self, emission: Emission) -> Optional[Tuple[str, str, str, Dict[str, object]]]:
        """Contract payload for one emission as an outbox row (event_id, device_id, url, payload); None when
        the camera is not configured."""
        cam = self.cfg.cameras.get(emission.camera)
        if cam is None:
            log.error("emission for unconfigured camera=%s visit=%s", emission.camera, emission.visit_id)
            return None
        payload = build_event(emission, cam.cloud_device_id, cam.display_name, cam.zone_names, self.cfg.frigate_version)
        return str(payload["eventId"]), cam.cloud_device_id, events_url(self.cfg.backend.base_url, cam.cloud_device_id), payload

    def after_step(self, emissions: List[Emission]) -> None:
        """Persist tracker state and this step's outbox rows in ONE ledger transaction, then wake the cloud worker.

        Closed visits are only drained from the tracker once the commit succeeded; when it fails they stay
        buffered and the step's rows are held, so the next step re-commits the same visit, seq and eventId
        instead of leaving a stale open visit in SQLite for the next restart to resurrect.
        """
        rendered = [(emission, self.render_emission(emission)) for emission in emissions]
        held = self._pending_rows
        rows = held + [row for _, row in rendered if row is not None]
        closed = self.tracker.closed_visits()
        try:
            statuses, evicted = self.ledger.commit_step(list(self.tracker.open_visits()) + closed, rows)
        except Exception as exc:
            self._pending_rows = rows
            log.error("ledger commit failed error=%s; %s closed visit(s) and %s outbox row(s) retry on the next step", exc, len(closed), len(rows))
            raise
        self._pending_rows = []
        self.tracker.drain_closed()
        if evicted:
            self.metrics.inc("visitd_outbox_dropped_total", evicted)
        for status in statuses:
            if status == "refused":
                self.metrics.inc("visitd_outbox_refused_total")
        remaining = iter(statuses[len(held):])
        for emission, row in rendered:
            status = next(remaining) if row is not None else "unconfigured"
            self.metrics.inc("visitd_transitions_total", labels={"state": emission.state})
            if emission.estimated:
                self.metrics.inc("visitd_tick_promotions_total", labels={"state": emission.state})
            if row is not None:
                self.last_event_at = str(row[3]["timestamp"])
            log.info(
                "transition visit=%s state=%s seq=%s camera=%s zone=%s dwell=%.1f estimated=%s plate=%s queued=%s",
                emission.visit_id, emission.state, emission.seq, emission.camera, emission.zone, emission.dwell_seconds,
                emission.estimated, emission.plate.get("status"), status,
            )
        for visit in closed:
            self.metrics.inc("visitd_visits_closed_total", labels={"state": visit.state})
        for reason, count in self.tracker.drain_force_ended().items():
            self.metrics.inc("visitd_tracker_force_ended_total", count, labels={"reason": reason})
            log.warning("force-ended open sightings count=%s reason=%s (visits depart through the normal grace)", count, reason)
        self.metrics.set("visitd_open_visits", len(self.tracker.open_visits()))
        self.metrics.set("visitd_outbox_depth", self.ledger.outbox_depth())
        for name, value in self.tracker.counters.items():
            self.metrics.set(f"visitd_tracker_{name}", value)
        if emissions:
            self.cloud.wake()

    def housekeeping(self, wall_now: float, epoch_now: float) -> int:
        """Hourly ledger pruning; both clocks are injected so replay/tests drive it with virtual time.

        Returns the number of rows removed (terminal visits past ledger.retentionDays plus dead_letter
        rows older than 7 days); a prune that deleted anything is followed by a WAL checkpoint.
        """
        if wall_now < self.next_prune_at:
            return 0
        self.next_prune_at = wall_now + PRUNE_INTERVAL_SECONDS
        visits = self.ledger.prune_terminal_visits(self.cfg.ledger_retention_days * 86400.0, epoch_now)
        parked = self.ledger.prune_dead_letter(DEAD_LETTER_RETENTION_SECONDS, epoch_now)
        if visits:
            self.metrics.inc("visitd_ledger_pruned_visits_total", visits)
        if visits or parked:
            self.ledger.checkpoint()
            log.info("ledger pruned visits=%s dead_letter=%s retention_days=%s", visits, parked, self.cfg.ledger_retention_days)
        return visits + parked

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
                "deadLetterDepth": self.ledger.dead_letter_depth(),
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
            pipeline.consume_inbox(inbox, timeout)  # everything queued, in receipt order, before any tick
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
            try:
                pipeline.housekeeping(now, time.time())
            except Exception:
                metrics.inc("visitd_pipeline_errors_total")
                log.exception("housekeeping error")
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
        topic_prefix=cfg.mqtt.topic_prefix, on_emission=lambda emission: pipeline.after_step([emission]),
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
