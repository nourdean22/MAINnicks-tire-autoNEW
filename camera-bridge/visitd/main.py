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
import uuid
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional, Sequence, Tuple

from . import __version__
from .cloud_client import CloudClient, events_url
from .config import Config, ConfigError, load_config
from .contract import build_event
from .frigate_events import FrigateEvent, LprUpdate, parse_message
from .ledger import DEAD_LETTER_RETENTION_SECONDS, Ledger
from .metrics import REGISTRY, MetricsRegistry, MetricsServer
from .mqtt_client import InboxItem, MqttClient
from .replay import read_jsonl, replay
from .shop_mirror import ShopMirror
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

    def __init__(self, cfg: Config, ledger: Ledger, cloud: CloudClient, metrics: MetricsRegistry,
                 producer_instance_id: Optional[str] = None) -> None:
        self.cfg = cfg
        self.ledger = ledger
        self.cloud = cloud
        #: Identity of THIS process for the shop heartbeat's idempotency/authority key.
        #: Edge producers pass a priority-bearing id; generic visitd keeps the legacy
        #: opaque id so this change is backward compatible.
        self.producer_instance_id = producer_instance_id or uuid.uuid4().hex[:16]
        # Best-effort mirror into the shop's read model. Never blocks the outbox.
        self.shop = ShopMirror(
            cfg.backend.shop_url,
            cfg.backend.shop_sync_key,
            timeout_seconds=cfg.backend.timeout_seconds,
            bay_zones={name: frozenset(cam.bay_zones) for name, cam in cfg.cameras.items()},
            producer_instance_id=self.producer_instance_id,
        )
        self.metrics = metrics
        self.tracker = VisitTracker(cfg.policy, cfg.camera_specs())
        self.shop_heartbeat_seq = 0
        self.last_frame_time: Optional[float] = None
        self.wall_at_last_message: float = time.monotonic()
        self.last_event_at: Optional[str] = None
        self.frigate_available: Optional[bool] = None
        self.next_prune_at: float = 0.0  # wall (monotonic) time of the next ledger prune; first one runs at once
        self._pending_rows: List[Tuple[str, str, str, Dict[str, object]]] = []  # outbox rows of a step whose commit failed
        self._pending_episodes: Dict[str, str] = {}  # visit episode ids of a step whose commit failed
        self._continuations_counted = 0  # tracker max_age_continuations already added to the _total counter
        restored = self.tracker.restore_state(ledger.load_open_visits())
        self.metrics.set("visitd_open_visits", len(self.tracker.open_visits()))
        log.info("ledger restored open_visits=%s path=%s", restored, ledger.path)

    def process_inbox_item(self, item: InboxItem) -> List[Emission]:
        """Consume one (topic, payload, received_at) tuple from the MQTT inbox. `received_at` is the paho
        thread's monotonic stamp, so a backlog drained late still measures elapsed time from receipt."""
        topic, payload, received_at = item
        return self.process_message(topic, payload, received_at)

    def consume_inbox(self, inbox: "queue.Queue[InboxItem]", timeout: float) -> int:
        """Wait up to `timeout` for the first inbox item, then drain what was queued behind it, in receipt order.

        The tick that follows estimates frame time from the last message's receipt stamp; it must never run
        ahead of a message that is already queued (an exit followed by a quick re-entry, received while a
        heartbeat blocked the loop, would otherwise split one visit into two). The batch is bounded to what
        `inbox.qsize()` reports once the first item is in hand, capped at `mqtt.inboxBatchMax`: under sustained
        ingress a take-until-empty loop never returns and the tick, heartbeat and housekeeping behind it starve
        (stationary visits cannot advance, devices go OFFLINE while the bridge is busy). Messages still queued
        when the batch ends are consumed by the next loop pass. Returns the items processed.
        """
        processed = 0
        try:
            item: Optional[InboxItem] = inbox.get(timeout=timeout)
        except queue.Empty:
            return processed
        budget = min(1 + max(0, inbox.qsize()), self.cfg.mqtt.inbox_batch_max)
        while item is not None:
            processed += 1
            try:
                self.process_inbox_item(item)
            except Exception:  # keep consuming; one bad message must not kill the bridge
                self.metrics.inc("visitd_pipeline_errors_total")
                log.exception("pipeline error topic=%s", item[0])
            if processed >= budget:
                break
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

    def force_end_open_sightings(self, reason: str, wall_now: float,
                                 camera: Optional[str] = None) -> List[Emission]:
        """End every open sighting at the estimated frame time and let the grace timers run.

        `camera` scopes it to one producer's sightings; see `TrackGraph.force_end_open_sightings`.
        """
        at = self.estimated_frame_time(wall_now)
        if at is None:  # only ledger-restored visits exist: anchor virtual time on their last activity
            # Anchored on the visits this call can actually end. A scoped call must not borrow
            # ANOTHER camera's clock: that camera may have been running the whole time, so its
            # last_activity is ~now, and using it would stamp this camera's departures with a
            # time the car was demonstrably not there.
            at = max((v.last_activity for v in self.tracker.open_visits()
                      if camera is None or any(s.camera == camera for s in v.open_sightings())),
                     default=None)
            if at is None:
                return []
            self.last_frame_time, self.wall_at_last_message = at, wall_now
        emissions = self.tracker.force_end_open_sightings(at, reason, camera)
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
        # The edge stamps the stitcher's episode id on its emissions; record it against the visit
        # so a restart can hand it back (`Ledger.commit_step`, `edge_main.reconcile_restart`).
        # Held through a failed commit exactly like the rows: it is a fact of the same step.
        episodes = dict(self._pending_episodes)
        for emission in emissions:
            episode_id = getattr(emission, "episode_id", None)
            if episode_id:
                episodes[emission.visit_id] = str(episode_id)
        # The shop projection is queued in the SAME transaction as the ledger commit. Building the
        # tuples cannot touch the network and must not be able to fail the commit, so it is wrapped:
        # a mirror defect degrades the shop read model, never the authoritative lane.
        shop_rows = []
        if self.shop.enabled:
            try:
                for emission, row in rendered:
                    if row is None:
                        continue
                    cam = self.cfg.cameras.get(emission.camera)
                    queued = self.shop.queue_row(emission, cam.display_name if cam else None,
                                                 cam.provenance() if cam else None)
                    if queued is not None:
                        shop_rows.append(queued)
            except Exception as exc:
                log.warning("shop mirror raised while queueing error=%s; the outbox is unaffected", exc)
                shop_rows = []
        try:
            statuses, evicted = self.ledger.commit_step(list(self.tracker.open_visits()) + closed, rows, shop_rows,
                                                        episodes=episodes)
        except Exception as exc:
            self._pending_rows = rows
            self._pending_episodes = episodes
            log.error("ledger commit failed error=%s; %s closed visit(s) and %s outbox row(s) retry on the next step", exc, len(closed), len(rows))
            raise
        self._pending_rows = []
        self._pending_episodes = {}
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
                "transition visit=%s state=%s seq=%s camera=%s zone=%s dwell=%.1f estimated=%s plate=%s queued=%s continues=%s",
                emission.visit_id, emission.state, emission.seq, emission.camera, emission.zone, emission.dwell_seconds,
                emission.estimated, emission.plate.get("status"), status, emission.continues_visit_id,
            )
        for visit in closed:
            self.metrics.inc("visitd_visits_closed_total", labels={"state": visit.state})
        continued = self.tracker.counters["max_age_continuations"] - self._continuations_counted
        if continued:
            self._continuations_counted += continued
            self.metrics.inc("visitd_tracker_max_age_continuations_total", continued)
        if self.shop.enabled:
            self.metrics.set("visitd_shop_outbox_depth", self.ledger.shop_outbox_depth())
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

    def drain_shop(self, limit: int = 25) -> Dict[str, int]:
        """Deliver queued shop projection rows, oldest first. NEVER raises.

        Stops at the first unreachable row: when the WAN is down every subsequent attempt would
        also fail, and hammering a dead endpoint 25 times per tick buys nothing. A REJECTED row
        (4xx/5xx from a reachable server) does not stop the batch -- one poison visit must not
        block every other car on the lot -- it stays queued with its attempt count climbing, which
        is what surfaces as a stuck backlog in the admin.
        """
        result = {"sent": 0, "rejected": 0, "unreachable": 0, "stale_authority": 0}
        if not self.shop.enabled:
            return result
        try:
            batch = self.ledger.shop_outbox_batch(limit)
        except Exception as exc:
            log.warning("shop outbox read failed error=%s", exc)
            return result
        for item in batch:
            try:
                outcome = self.shop.deliver(item)
            except Exception as exc:  # deliver() is documented never to raise; belt and braces
                log.warning("shop mirror raised while delivering visit=%s error=%s", item.get("visit_id"), exc)
                outcome = "unreachable"
            result[outcome] = result.get(outcome, 0) + 1
            try:
                if outcome in {"sent", "stale_authority"}:
                    # A row from an expired authority epoch is intentionally discarded:
                    # replaying it after another producer took over can double-count cars.
                    self.ledger.shop_outbox_ack(str(item["visit_id"]), int(item["seq"]))
                else:
                    self.ledger.shop_outbox_fail(str(item["visit_id"]), outcome)
            except Exception as exc:
                log.warning("shop outbox bookkeeping failed visit=%s error=%s", item.get("visit_id"), exc)
            if outcome == "unreachable":
                break
        if result["sent"]:
            self.metrics.inc("visitd_shop_delivered_total", result["sent"])
        if result["rejected"]:
            self.metrics.inc("visitd_shop_rejected_total", result["rejected"])
        self.metrics.set("visitd_shop_outbox_depth", self.ledger.shop_outbox_depth())
        return result

    def shop_heartbeat_body(self, cam, mqtt_connected: bool) -> dict:
        """The producer's account of itself for the shop's `POST /api/camera/heartbeat`.

        visitd never sees pixels -- its "frames" are Frigate events over MQTT -- so it
        reports what it CAN know: whether its source (broker + Frigate) is connected and
        how its durable queue is doing. Frame fields stay None ("unknown"), never a
        guess, so a quiet lot cannot read as a dead camera.
        """
        self.shop_heartbeat_seq += 1
        prov = cam.provenance()
        body = {
            "camera": cam.name,
            "producerInstanceId": self.producer_instance_id,
            "producerVersion": f"visitd {__version__}",
            "heartbeatSeq": self.shop_heartbeat_seq,
            "observedAtEdge": datetime.now(tz=timezone.utc).isoformat(),
            "mode": "PRODUCTION",
            "sourceType": "mqtt",
            "sourceConnected": bool(mqtt_connected) and (self.frigate_available is not False),
            "openVisits": len(self.tracker.open_visits()),
            # The SHOP's own backlog, not StateNour's: this heartbeat is what turns into
            # CLOUD_BACKLOG on the shop admin, so it must measure the queue that feeds it.
            "outboxDepth": self.ledger.shop_outbox_depth(),
            "oldestOutboxAgeSeconds": (lambda a: None if a is None else int(a))(self.ledger.shop_outbox_oldest_age()),
            "deadLetterDepth": self.ledger.dead_letter_depth(),
        }
        body.update({k: v for k, v in prov.items() if v})
        return body

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


class LiveLoop:
    """One pass of the live loop: a bounded inbox batch, then the periodic work (tick, heartbeat, housekeeping).

    Both clocks are injected so a test can run exactly one pass with an inbox that never empties and prove the
    periodic section still executes.
    """

    def __init__(
        self,
        cfg: Config,
        pipeline: Pipeline,
        inbox: "queue.Queue[InboxItem]",
        mqtt_connected: Callable[[], bool],
        clock: Callable[[], float] = time.monotonic,
        epoch: Callable[[], float] = time.time,
    ) -> None:
        self.cfg = cfg
        self.pipeline = pipeline
        self.inbox = inbox
        self.mqtt_connected = mqtt_connected
        self.clock = clock
        self.epoch = epoch
        self.next_tick = clock() + cfg.tick_seconds
        self.next_heartbeat = clock() + 5.0

    def step(self) -> None:
        """Consume one inbox batch (waiting until the next timer is due), then run whatever timer is due."""
        pipeline, metrics = self.pipeline, self.pipeline.metrics
        timeout = max(0.05, min(self.next_tick, self.next_heartbeat) - self.clock())
        pipeline.consume_inbox(self.inbox, timeout)  # what was queued, in receipt order, before any tick
        now = self.clock()
        if now >= self.next_tick:
            self.next_tick = now + self.cfg.tick_seconds
            try:
                pipeline.tick(now)
            except Exception:
                metrics.inc("visitd_pipeline_errors_total")
                log.exception("tick error")
        if now >= self.next_heartbeat:
            self.next_heartbeat = now + self.cfg.backend.heartbeat_seconds
            body = pipeline.heartbeat_body(self.mqtt_connected())
            for cam in self.cfg.cameras.values():
                pipeline.cloud.heartbeat(cam.cloud_device_id, body)
                if pipeline.shop.enabled:
                    # The shop's infrastructure fact, apart from visits. Best effort;
                    # ShopMirror.heartbeat never raises, so the loop cannot stall on it.
                    pipeline.shop.heartbeat(pipeline.shop_heartbeat_body(cam, self.mqtt_connected()))
        try:
            pipeline.drain_shop()
        except Exception:
            metrics.inc("visitd_pipeline_errors_total")
            log.exception("shop drain error")
        try:
            pipeline.housekeeping(now, self.epoch())
        except Exception:
            metrics.inc("visitd_pipeline_errors_total")
            log.exception("housekeeping error")


def run_live(cfg: Config, dry_run: bool) -> int:
    """Live mode: MQTT in, cloud out, until SIGINT/SIGTERM."""
    metrics = REGISTRY
    inbox: "queue.Queue" = queue.Queue(maxsize=cfg.mqtt.queue_max)
    ledger = Ledger(cfg.ledger_path, outbox_max_depth=cfg.backend.outbox_max_depth, policy=cfg.policy)
    cloud = CloudClient(cfg.backend, ledger, metrics, dry_run=dry_run)
    pipeline = Pipeline(cfg, ledger, cloud, metrics)
    if pipeline.shop.enabled:
        log.info("shop mirror enabled url=%s (best effort; the outbox is unaffected)", cfg.backend.shop_url)
    elif cfg.backend.shop_url:
        log.warning("shop mirror configured but its key is missing; the shop read model will not update")
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
    loop = LiveLoop(cfg, pipeline, inbox, lambda: mqtt.connected)
    try:
        while not stop.is_set():
            loop.step()
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
