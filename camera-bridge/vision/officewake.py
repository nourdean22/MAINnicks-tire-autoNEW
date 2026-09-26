"""Wake bounded office interaction capture from Eufy semantic events.

This process is a CLIENT of the already-authenticated Eufy bridge. It never logs in to
Eufy itself, never moves PTZ, and never treats motion/person as proof of identity or service.

Default mode is event-only commissioning. Audio capture requires ALL of:
- --capture
- OFFICE_INTERACTION_CAPTURE_ENABLED=1
- OFFICE_AUDIO_POLICY_ACK=1
- a verified OFFICE_MEDIA_URL
- an explicit local active-hours schedule
- CAMERA_INGEST_KEY unless --dry-run is used

Raw audio stays on the shop machine; the existing officepost route sends timed transcript
segments and evidence-backed facts, not the audio bytes.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional
from zoneinfo import ZoneInfo

DEFAULT_OFFICE_SERIAL = "T8410P522517180B"
DEFAULT_EVENTS = frozenset({"motion", "personDetected"})
FALSE_MARKERS = frozenset({"0", "false", "off", "clear", "cleared", "idle", "inactive", "none"})


class OfficeWakeError(RuntimeError):
    pass


@dataclass(frozen=True)
class ActiveWindow:
    start_minute: int
    end_minute: int


@dataclass(frozen=True)
class Trigger:
    received_at: float
    event: str
    device_sn: str


@dataclass(frozen=True)
class WakeDecision:
    action: str
    reason: str
    event: str
    device_sn: str
    received_at: float


@dataclass
class CaptureResult:
    status: str
    reason: str
    trigger: dict[str, Any]
    segments_found: int = 0
    episodes_prepared: int = 0
    episodes_posted: int = 0
    episodes_failed: int = 0
    coverages: Optional[list[Optional[float]]] = None


@dataclass
class OfficeWakeConfig:
    bridge_url: str
    office_serial: str
    event_names: frozenset[str]
    capture_mode: bool
    capture_enabled: bool
    policy_acknowledged: bool
    source_url: str
    out_dir: str
    source_name: str
    seconds: float
    silence_db: Optional[float]
    transcriber: str
    model: Optional[str]
    endpoint: str
    dry_run: bool
    timezone_name: str
    schedule: dict[int, tuple[ActiveWindow, ...]]
    cooldown_seconds: float
    retention_hours: float
    ingest_key_present: bool

    def startup_blockers(self) -> list[str]:
        blockers: list[str] = []
        if not self.bridge_url:
            blockers.append("EUFY bridge URL is not configured")
        if not self.capture_mode:
            return blockers
        if not self.capture_enabled:
            blockers.append("OFFICE_INTERACTION_CAPTURE_ENABLED is not 1")
        if not self.policy_acknowledged:
            blockers.append("OFFICE_AUDIO_POLICY_ACK is not 1")
        if not self.source_url:
            blockers.append("OFFICE_MEDIA_URL is not configured")
        if not self.schedule:
            blockers.append("OFFICE_ACTIVE_SCHEDULE_JSON is empty")
        if not self.dry_run and not self.ingest_key_present:
            blockers.append("CAMERA_INGEST_KEY is not configured")
        return blockers


class ReceiptLedger:
    """Compact local receipts. Raw bridge payloads are deliberately not persisted."""

    def __init__(self, path: str | Path | None) -> None:
        self.path = Path(path) if path else None

    def note(self, kind: str, payload: dict[str, Any]) -> None:
        row = {"at": round(time.time(), 3), "kind": kind, **payload}
        line = json.dumps(row, sort_keys=True)
        print(line, flush=True)
        if self.path is None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(line + "\n")


def _minute(raw: str) -> int:
    parts = str(raw).strip().split(":")
    if len(parts) != 2:
        raise ValueError(f"invalid HH:MM time {raw!r}")
    try:
        hour, minute = int(parts[0]), int(parts[1])
    except ValueError as exc:
        raise ValueError(f"invalid HH:MM time {raw!r}") from exc
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError(f"invalid HH:MM time {raw!r}")
    return hour * 60 + minute


def parse_schedule(raw: str) -> dict[int, tuple[ActiveWindow, ...]]:
    if not str(raw or "").strip():
        return {}
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"active schedule is invalid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError("active schedule must be a JSON object")

    days = {
        "mon": 0, "monday": 0,
        "tue": 1, "tues": 1, "tuesday": 1,
        "wed": 2, "wednesday": 2,
        "thu": 3, "thur": 3, "thurs": 3, "thursday": 3,
        "fri": 4, "friday": 4,
        "sat": 5, "saturday": 5,
        "sun": 6, "sunday": 6,
    }
    result: dict[int, list[ActiveWindow]] = {}
    for raw_day, spec in payload.items():
        day = days.get(str(raw_day).strip().lower())
        if day is None:
            raise ValueError(f"unknown weekday {raw_day!r}")
        if spec is None or (isinstance(spec, str) and spec.strip().lower() in {"closed", "none"}):
            continue
        values = spec if isinstance(spec, list) else [spec]
        for item in values:
            if not isinstance(item, str) or "-" not in item:
                raise ValueError(f"invalid schedule window {item!r} for {raw_day}")
            start_raw, end_raw = item.split("-", 1)
            start, end = _minute(start_raw), _minute(end_raw)
            if end <= start:
                raise ValueError(f"schedule window {item!r} must end after it starts")
            result.setdefault(day, []).append(ActiveWindow(start, end))
    return {
        day: tuple(sorted(windows, key=lambda item: item.start_minute))
        for day, windows in result.items()
    }


def schedule_allows(
    schedule: dict[int, tuple[ActiveWindow, ...]],
    *,
    at: float,
    timezone_name: str,
) -> bool:
    if not schedule:
        return False
    local = datetime.fromtimestamp(float(at), tz=ZoneInfo(timezone_name))
    minute = local.hour * 60 + local.minute
    return any(
        window.start_minute <= minute < window.end_minute
        for window in schedule.get(local.weekday(), ())
    )


def active_window_remaining_seconds(
    schedule: dict[int, tuple[ActiveWindow, ...]],
    *,
    at: float,
    timezone_name: str,
) -> float:
    """Seconds until the end of the currently-active local schedule window."""
    if not schedule:
        return 0.0
    local = datetime.fromtimestamp(float(at), tz=ZoneInfo(timezone_name))
    minute = local.hour * 60 + local.minute
    for window in schedule.get(local.weekday(), ()):
        if window.start_minute <= minute < window.end_minute:
            end_local = local.replace(
                hour=window.end_minute // 60,
                minute=window.end_minute % 60,
                second=0,
                microsecond=0,
            )
            return max(0.0, (end_local - local).total_seconds())
    return 0.0


def _false_marker(value: Any) -> bool:
    if value is False or value == 0:
        return True
    return isinstance(value, str) and value.strip().lower() in FALSE_MARKERS


def event_is_positive(event: dict[str, Any]) -> bool:
    """Reject explicit clear/off transitions; event pulses without such a marker are positive."""
    containers = [event, event.get("data"), event.get("payload")]
    for container in containers:
        if not isinstance(container, dict):
            continue
        for key in ("active", "detected", "state", "value"):
            if key in container and _false_marker(container.get(key)):
                return False
    return True


def trigger_from_event(event: dict[str, Any], *, at: float) -> Optional[Trigger]:
    name = str(event.get("event") or "").strip()
    serial = str(event.get("deviceSn") or "").strip()
    if not name or not serial:
        return None
    return Trigger(received_at=float(at), event=name, device_sn=serial)


def decide_event(
    config: OfficeWakeConfig,
    event: dict[str, Any],
    *,
    at: float,
) -> WakeDecision:
    trigger = trigger_from_event(event, at=at)
    if trigger is None:
        return WakeDecision("drop", "missing event/deviceSn", "", "", float(at))
    if trigger.device_sn != config.office_serial:
        return WakeDecision("drop", "different camera", trigger.event, trigger.device_sn, trigger.received_at)
    if trigger.event not in config.event_names:
        return WakeDecision("drop", "event not enabled", trigger.event, trigger.device_sn, trigger.received_at)
    if not event_is_positive(event):
        return WakeDecision("drop", "clear/inactive transition", trigger.event, trigger.device_sn, trigger.received_at)
    if not config.capture_mode:
        return WakeDecision("event_only", "semantic event observed", trigger.event, trigger.device_sn, trigger.received_at)

    blockers = config.startup_blockers()
    if blockers:
        return WakeDecision("drop", "; ".join(blockers), trigger.event, trigger.device_sn, trigger.received_at)
    if not schedule_allows(config.schedule, at=at, timezone_name=config.timezone_name):
        return WakeDecision("drop", "outside configured active hours", trigger.event, trigger.device_sn, trigger.received_at)
    return WakeDecision("capture", "eligible semantic wake", trigger.event, trigger.device_sn, trigger.received_at)


def _trigger_payload(trigger: Trigger) -> dict[str, Any]:
    return {
        "receivedAt": trigger.received_at,
        "event": trigger.event,
        "deviceSn": trigger.device_sn,
    }


def prune_audio(
    out_dir: str | Path,
    *,
    retention_hours: float,
    now: Optional[float] = None,
) -> int:
    if retention_hours <= 0:
        return 0
    root = Path(out_dir)
    if not root.exists():
        return 0
    cutoff = float(now if now is not None else time.time()) - retention_hours * 3600.0
    removed = 0
    for pattern in ("*.wav", "*.wav.json"):
        for path in root.glob(pattern):
            try:
                if path.stat().st_mtime < cutoff:
                    path.unlink()
                    removed += 1
            except OSError:
                continue
    return removed


def run_capture_once(
    config: OfficeWakeConfig,
    trigger: Trigger,
    *,
    capture_fn: Optional[Callable[..., list[Any]]] = None,
    transcribe_fn: Optional[Callable[..., Any]] = None,
    post_fn: Optional[Callable[..., dict[str, Any]]] = None,
    clock: Callable[[], float] = time.time,
) -> CaptureResult:
    from . import officeaudio, officepost

    capture_fn = capture_fn or officeaudio.capture_window
    transcribe_fn = transcribe_fn or officepost.transcribe
    post_fn = post_fn or officepost.post_episode

    kwargs: dict[str, Any] = {}
    if config.silence_db is not None:
        kwargs["silence_db"] = config.silence_db

    capture_seconds = float(config.seconds)
    if config.capture_mode:
        remaining = active_window_remaining_seconds(
            config.schedule,
            at=clock(),
            timezone_name=config.timezone_name,
        )
        if remaining <= 0:
            return CaptureResult(
                "capture_blocked",
                "outside configured active hours at capture start",
                _trigger_payload(trigger),
            )
        capture_seconds = min(capture_seconds, remaining)

    try:
        segments = capture_fn(
            config.source_url,
            config.out_dir,
            capture_seconds,
            source=config.source_name,
            **kwargs,
        )
    except Exception as exc:  # noqa: BLE001
        return CaptureResult(
            "capture_failed",
            f"{type(exc).__name__}: {exc}"[:500],
            _trigger_payload(trigger),
        )

    if not segments:
        return CaptureResult(
            "no_segments",
            "bounded capture returned no speech segments",
            _trigger_payload(trigger),
        )

    prepared = 0
    posted = 0
    failed = 0
    coverages: list[Optional[float]] = []
    errors: list[str] = []
    for segment in segments:
        try:
            transcript = transcribe_fn(
                segment.path,
                binary=config.transcriber,
                model=config.model,
            )
        except Exception as exc:  # noqa: BLE001
            failed += 1
            errors.append(f"transcribe: {type(exc).__name__}: {exc}"[:300])
            continue

        payload = officepost.build_payload(segment, transcript)
        prepared += 1
        total = float(payload.get("totalSeconds") or 0.0)
        covered = float(payload.get("coveredSeconds") or 0.0)
        coverages.append(round(covered / total, 3) if total > 0 else None)
        if config.dry_run:
            continue

        try:
            result = post_fn(payload, endpoint=config.endpoint)
        except Exception as exc:  # noqa: BLE001
            failed += 1
            errors.append(f"post: {type(exc).__name__}: {exc}"[:300])
            continue

        if result.get("posted"):
            posted += 1
        else:
            failed += 1
            errors.append(str(result.get("error") or "post failed")[:300])

    status = "ok" if failed == 0 else ("partial" if prepared > failed else "failed")
    reason = "capture/transcribe/post complete" if not errors else " | ".join(errors)[:500]
    return CaptureResult(
        status,
        reason,
        _trigger_payload(trigger),
        segments_found=len(segments),
        episodes_prepared=prepared,
        episodes_posted=posted,
        episodes_failed=failed,
        coverages=coverages,
    )


class OfficeWakeDaemon:
    """One Eufy event listener plus one capture worker; bursts coalesce to one pending wake."""

    def __init__(
        self,
        config: OfficeWakeConfig,
        *,
        ledger: ReceiptLedger,
        clock: Callable[[], float] = time.time,
        runner: Optional[Callable[[OfficeWakeConfig, Trigger], CaptureResult]] = None,
    ) -> None:
        self.config = config
        self.ledger = ledger
        self.clock = clock
        self.runner = runner or run_capture_once
        self.queue: asyncio.Queue[Trigger] = asyncio.Queue(maxsize=1)
        self.last_capture_started_at: Optional[float] = None

    async def offer(self, event: dict[str, Any]) -> WakeDecision:
        now = self.clock()
        decision = decide_event(self.config, event, at=now)
        self.ledger.note("wake_decision", asdict(decision))
        if decision.action != "capture":
            return decision

        trigger = trigger_from_event(event, at=now)
        if trigger is None:
            return decision

        if (
            self.last_capture_started_at is not None
            and now - self.last_capture_started_at < self.config.cooldown_seconds
            and self.queue.empty()
        ):
            dropped = WakeDecision(
                "drop",
                "within capture cooldown",
                trigger.event,
                trigger.device_sn,
                trigger.received_at,
            )
            self.ledger.note("wake_decision", asdict(dropped))
            return dropped

        if self.queue.full():
            try:
                prior = self.queue.get_nowait()
                self.queue.task_done()
                self.ledger.note(
                    "wake_coalesced",
                    {"dropped": _trigger_payload(prior), "kept": _trigger_payload(trigger)},
                )
            except asyncio.QueueEmpty:
                pass
        self.queue.put_nowait(trigger)
        return decision

    async def worker(self) -> None:
        while True:
            trigger = await self.queue.get()
            try:
                now = self.clock()
                decision = decide_event(
                    self.config,
                    {
                        "event": trigger.event,
                        "deviceSn": trigger.device_sn,
                    },
                    at=now,
                )
                if decision.action != "capture":
                    self.ledger.note("capture_skipped", asdict(decision))
                    continue
                if (
                    self.last_capture_started_at is not None
                    and now - self.last_capture_started_at < self.config.cooldown_seconds
                ):
                    self.ledger.note(
                        "capture_skipped",
                        {**asdict(decision), "reason": "within capture cooldown at worker start"},
                    )
                    continue

                self.last_capture_started_at = now
                self.ledger.note("capture_started", {"trigger": _trigger_payload(trigger)})
                try:
                    result = await asyncio.to_thread(self.runner, self.config, trigger)
                except Exception as exc:  # noqa: BLE001
                    result = CaptureResult(
                        "runner_failed",
                        f"{type(exc).__name__}: {exc}"[:500],
                        _trigger_payload(trigger),
                        episodes_failed=1,
                    )
                self.ledger.note("capture_finished", asdict(result))
            finally:
                self.queue.task_done()


async def retention_worker(
    config: OfficeWakeConfig,
    ledger: ReceiptLedger,
    *,
    interval_seconds: float = 3600.0,
) -> None:
    """Prune raw local artifacts at startup and periodically, independent of captures."""
    interval = max(0.01, float(interval_seconds))
    while True:
        try:
            removed = await asyncio.to_thread(
                prune_audio,
                config.out_dir,
                retention_hours=config.retention_hours,
            )
            if removed:
                ledger.note("retention_prune", {"filesRemoved": removed})
        except Exception as exc:  # noqa: BLE001
            ledger.note(
                "retention_error",
                {"error": f"{type(exc).__name__}: {exc}"[:500]},
            )
        await asyncio.sleep(interval)


async def listen_forever(
    daemon: OfficeWakeDaemon,
    *,
    max_events: int = 0,
) -> None:
    try:
        import websockets
    except ImportError as exc:
        raise OfficeWakeError("install requirements-office-wake.txt first") from exc

    worker_task = asyncio.create_task(daemon.worker())
    retention_task = asyncio.create_task(
        retention_worker(daemon.config, daemon.ledger)
    )
    seen = 0
    delay = 2.0
    try:
        while True:
            try:
                async with websockets.connect(
                    daemon.config.bridge_url,
                    open_timeout=10,
                    close_timeout=2,
                    ping_interval=20,
                    ping_timeout=20,
                    max_size=2 * 1024 * 1024,
                ) as ws:
                    daemon.ledger.note("bridge_connected", {"officeSerial": daemon.config.office_serial})
                    delay = 2.0
                    async for raw in ws:
                        try:
                            event = json.loads(raw)
                        except json.JSONDecodeError:
                            daemon.ledger.note("bridge_frame_dropped", {"reason": "invalid json"})
                            continue
                        if not isinstance(event, dict):
                            continue
                        trigger = trigger_from_event(event, at=daemon.clock())
                        if trigger is None:
                            continue
                        if (
                            trigger.device_sn != daemon.config.office_serial
                            or trigger.event not in daemon.config.event_names
                        ):
                            continue
                        seen += 1
                        await daemon.offer(event)
                        if max_events > 0 and seen >= max_events:
                            await daemon.queue.join()
                            return
            except Exception as exc:  # noqa: BLE001
                daemon.ledger.note(
                    "bridge_disconnected",
                    {"error": f"{type(exc).__name__}: {exc}"[:500], "retrySeconds": delay},
                )
                await asyncio.sleep(delay)
                delay = min(60.0, delay * 2)
    finally:
        worker_task.cancel()
        retention_task.cancel()
        for task in (worker_task, retention_task):
            try:
                await task
            except asyncio.CancelledError:
                pass


def _env_true(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def config_from_args(args: argparse.Namespace) -> OfficeWakeConfig:
    ZoneInfo(str(args.timezone))
    event_names = frozenset(
        item.strip()
        for item in str(args.events or "").split(",")
        if item.strip()
    ) or DEFAULT_EVENTS
    return OfficeWakeConfig(
        bridge_url=str(args.bridge_url or "").strip(),
        office_serial=str(args.office_serial or "").strip(),
        event_names=event_names,
        capture_mode=bool(args.capture),
        capture_enabled=_env_true("OFFICE_INTERACTION_CAPTURE_ENABLED"),
        policy_acknowledged=_env_true("OFFICE_AUDIO_POLICY_ACK"),
        source_url=str(args.source_url or "").strip(),
        out_dir=str(args.out_dir),
        source_name=str(args.source),
        seconds=max(10.0, float(args.seconds)),
        silence_db=args.silence_db,
        transcriber=str(args.transcriber),
        model=args.model,
        endpoint=str(args.endpoint),
        dry_run=bool(args.dry_run),
        timezone_name=str(args.timezone),
        schedule=parse_schedule(str(args.schedule_json or "")),
        cooldown_seconds=max(0.0, float(args.cooldown_seconds)),
        retention_hours=max(0.0, float(args.retention_hours)),
        ingest_key_present=bool(os.environ.get("CAMERA_INGEST_KEY", "").strip()),
    )


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Wake bounded office interaction capture from Eufy semantic events."
    )
    parser.add_argument("--bridge-url", default=os.environ.get("EUFY_BRIDGE_URL", ""))
    parser.add_argument(
        "--office-serial",
        default=os.environ.get("EUFY_OFFICE_CAMERA_SERIAL", DEFAULT_OFFICE_SERIAL),
    )
    parser.add_argument("--events", default="motion,personDetected")
    parser.add_argument(
        "--capture",
        action="store_true",
        help="enable capture path; default is event-only commissioning",
    )
    parser.add_argument("--max-events", type=int, default=0)
    parser.add_argument("--source-url", default=os.environ.get("OFFICE_MEDIA_URL", ""))
    parser.add_argument("--out-dir", default=os.environ.get("OFFICE_INTERACTION_DIR", "data/office"))
    parser.add_argument("--ledger", default=os.environ.get("OFFICE_WAKE_LEDGER", ""))
    parser.add_argument("--source", default="eufy-office")
    parser.add_argument("--seconds", type=float, default=120.0)
    parser.add_argument("--silence-db", type=float, default=None)
    parser.add_argument("--transcriber", default="whisper-cli")
    parser.add_argument("--model", default=None)
    parser.add_argument("--endpoint", default="https://nickstire.org/api/conversation-episodes")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--timezone", default="America/New_York")
    parser.add_argument(
        "--schedule-json",
        default=os.environ.get("OFFICE_ACTIVE_SCHEDULE_JSON", ""),
    )
    parser.add_argument("--cooldown-seconds", type=float, default=30.0)
    parser.add_argument("--retention-hours", type=float, default=24.0)
    args = parser.parse_args(argv)

    try:
        config = config_from_args(args)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": "invalid_config", "detail": str(exc)[:500]}))
        return 2

    blockers = config.startup_blockers()
    if blockers:
        print(json.dumps({"error": "blocked", "blockers": blockers}))
        return 3

    ledger = ReceiptLedger(args.ledger or None)
    ledger.note(
        "startup",
        {
            "mode": "capture" if config.capture_mode else "events_only",
            "officeSerial": config.office_serial,
            "events": sorted(config.event_names),
            "captureEnabled": config.capture_enabled,
            "policyAcknowledged": config.policy_acknowledged,
            "mediaConfigured": bool(config.source_url),
            "scheduleConfigured": bool(config.schedule),
            "dryRun": config.dry_run,
            "retentionHours": config.retention_hours,
        },
    )
    daemon = OfficeWakeDaemon(config, ledger=ledger)
    try:
        asyncio.run(listen_forever(daemon, max_events=max(0, int(args.max_events))))
    except KeyboardInterrupt:
        return 130
    except OfficeWakeError as exc:
        print(json.dumps({"error": "office_wake_failed", "detail": str(exc)}))
        return 4
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
