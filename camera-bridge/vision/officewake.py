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
import shutil
import time
from collections import deque
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional
from zoneinfo import ZoneInfo

DEFAULT_OFFICE_SERIAL = "T8410P5225154105"
DEFAULT_EVENTS = frozenset({"motion", "personDetected"})
FALSE_MARKERS = frozenset({"0", "false", "off", "clear", "cleared", "idle", "inactive", "none"})
#: Run outcomes the worker reports as DEGRADED (and counts in conversationFailuresToday).
FAILED_STATUSES = frozenset({"capture_failed", "runner_failed", "partial", "failed"})


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
    episodes_transcribed: int = 0
    episodes_posted: int = 0
    episodes_failed: int = 0
    facts_stored: int = 0
    summaries_stored: int = 0
    stt_latency_ms: Optional[int] = None
    coverages: Optional[list[Optional[float]]] = None
    frames_captured: int = 0
    frames_posted: int = 0
    #: Segments whose transcriber ran but produced no text (timeout, non-zero exit). The episode
    #: is still posted carrying `transcriptError`; the RUN is "partial", never "ok". Until
    #: 2026-10-07 a run whose every transcript failed reported ok and the worker stayed READY.
    episodes_transcribe_failed: int = 0


@dataclass
class CapturePhase:
    """Phase 1 of a wake: bounded audio (and frames) on disk, nothing transcribed or posted yet.

    Capture and transcribe/post are separate phases so the office keeps being listened to while
    whisper works: one three-minute transcription used to be three minutes of deafness. `result`
    is set when the phase ended with nothing to process (blocked, failed, no speech).
    """
    trigger: Trigger
    started_at: float
    capture_seconds: float
    segments: list[Any]
    frames: list[dict[str, Any]]
    result: Optional[CaptureResult] = None


@dataclass
class OfficeWakeConfig:
    bridge_url: str
    office_serial: str
    event_names: frozenset[str]
    capture_mode: bool
    capture_enabled: bool
    policy_acknowledged: bool
    source_url: str
    input_format: str
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
    status_path: str = ""
    retention_max_mb: float = 256.0
    min_free_mb: float = 512.0
    capture_host: str = ""
    audio_fallback_enabled: bool = False
    audio_probe_seconds: float = 5.0
    audio_probe_interval_seconds: float = 15.0
    audio_activity_mean_db: float = -50.0
    audio_activity_max_db: float = -34.0
    audio_fallback_cooldown_seconds: float = 180.0
    # 2026-10-02 · office "watch": still frames ride along with each episode (officeframes.py).
    # Operator decision: ON (recording signs are posted); OFFICE_VISUAL_ENABLED=0 turns it off.
    visual_enabled: bool = False
    visual_interval_seconds: float = 30.0
    visual_max_frames: int = 6
    # Captured wakes allowed to wait for transcription (phase 2). Full -> the OLDEST is dropped
    # with a ledger receipt and a counted failure; OFFICE_TRANSCRIBE_BACKLOG_MAX.
    transcribe_backlog_max: int = 6
    # Where `model` came from: env (OFFICE_WHISPER_MODEL), override-file, override-ignored, none.
    model_source: str = "env"
    # Directory holding whisper-model.override: the status file's directory, never the audio
    # out_dir (the supervisor's disk floor prunes every file older than 6 h in there). Empty
    # means out_dir, which is only right when out_dir is not the audio directory (tests).
    model_override_dir: str = ""

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
            blockers.append("office audio source is not configured")
        if not self.schedule:
            blockers.append("OFFICE_ACTIVE_SCHEDULE_JSON is empty")
        if not self.status_path:
            blockers.append("OFFICE_CONVERSATION_STATUS_PATH is not configured")
        if not (Path(self.transcriber).exists() or shutil.which(self.transcriber)):
            blockers.append(f"transcriber is not runnable: {self.transcriber}")
        if self.model and not Path(self.model).exists():
            blockers.append(f"STT model does not exist: {self.model}")
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


def _iso_utc(at: float) -> str:
    return datetime.fromtimestamp(float(at), tz=timezone.utc).isoformat()


class RuntimeReceipt:
    """Atomic current-state receipt consumed by the Eufy heartbeat producer.

    This is deliberately a FILE, not another cloud writer. The Eufy agent remains the only
    producer for camera_runtime.office, so a conversation worker restart can never race or
    overwrite camera/media/control facets with a second producerInstanceId.

    The writer never raises. On Windows, `os.replace` onto a file a reader currently holds open
    (the Eufy agent reads this one every heartbeat) fails with PermissionError for the
    milliseconds the read takes. Until 2026-10-07 that exception escaped, the status task died
    with it, the heartbeat went stale, and the supervisor restarted a healthy worker every ten
    minutes for it.
    """

    REPLACE_ATTEMPTS = 8

    def __init__(
        self,
        config: OfficeWakeConfig,
        *,
        clock: Callable[[], float] = time.time,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.config = config
        self.clock = clock
        self.sleep = sleep
        self.path = Path(config.status_path) if config.status_path else None
        self._failure_day = ""
        self.write_failures = 0
        self.last_write_error: Optional[str] = None
        self.state: dict[str, Any] = {
            "conversationWorkerOk": True,
            "conversationWorkerState": "STARTING",
            "conversationAudioSource": config.source_name,
            "conversationCaptureHost": config.capture_host or os.environ.get("COMPUTERNAME", ""),
            "conversationSttEngine": os.path.basename(config.transcriber) or config.transcriber,
            "conversationWhisperModel": os.path.basename(config.model) if config.model else None,
            "conversationWhisperModelSource": config.model_source,
            "conversationQueueDepth": 0,
            "conversationFailuresToday": 0,
            "conversationLastError": None,
        }
        self.update()

    def _local_day(self, now: float) -> str:
        return datetime.fromtimestamp(now, tz=ZoneInfo(self.config.timezone_name)).date().isoformat()

    def _replace_with_retry(self, tmp: Path) -> None:
        delay = 0.02
        for attempt in range(self.REPLACE_ATTEMPTS):
            try:
                os.replace(tmp, self.path)
                return
            except PermissionError:
                if attempt == self.REPLACE_ATTEMPTS - 1:
                    raise
                self.sleep(delay)
                delay = min(0.25, delay * 2)

    def update(self, **fields: Any) -> None:
        now = float(self.clock())
        day = self._local_day(now)
        if day != self._failure_day:
            self._failure_day = day
            self.state["conversationFailuresToday"] = 0
        self.state.update(fields)
        self.state["conversationWorkerHeartbeatAt"] = _iso_utc(now)
        if self.path is None:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_name(self.path.name + ".tmp")
            tmp.write_text(json.dumps(self.state, sort_keys=True), encoding="utf-8")
            self._replace_with_retry(tmp)
        except OSError as exc:
            # The heartbeat writer must never take the worker down with it. The in-memory state
            # stays current and the next write that lands carries the failure count.
            self.write_failures += 1
            self.last_write_error = f"{type(exc).__name__}: {exc}"[:200]
            self.state["conversationStatusWriteFailures"] = self.write_failures

    def failure(self, message: str, *, state: str = "DEGRADED") -> None:
        failures = int(self.state.get("conversationFailuresToday") or 0) + 1
        self.update(
            conversationWorkerState=state,
            conversationFailuresToday=failures,
            conversationLastError=str(message)[:500],
        )


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


def trigger_enabled(config: OfficeWakeConfig, event_name: str) -> bool:
    return event_name in config.event_names or (
        event_name == "audioActivity" and config.audio_fallback_enabled
    )


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
    if not trigger_enabled(config, trigger.event):
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
    max_bytes: Optional[int] = None,
    min_free_bytes: Optional[int] = None,
    protect_newer_than_seconds: float = 600.0,
    now: Optional[float] = None,
) -> int:
    """Bound local raw artifacts by age, hard quota, and disk floor.

    Files newer than `protect_newer_than_seconds` are never quota-pruned so a retention pass
    cannot unlink the WAV an active capture/transcriber is still using.
    """
    root = Path(out_dir)
    if not root.exists():
        return 0
    current = float(now if now is not None else time.time())
    removed = 0

    if retention_hours > 0:
        cutoff = current - retention_hours * 3600.0
        for pattern in ("*.wav", "*.wav.json"):
            for path in root.glob(pattern):
                try:
                    if path.stat().st_mtime < cutoff:
                        path.unlink()
                        removed += 1
                except OSError:
                    continue

    files: list[tuple[float, int, Path]] = []
    total = 0
    for pattern in ("*.wav", "*.wav.json"):
        for path in root.glob(pattern):
            try:
                stat = path.stat()
            except OSError:
                continue
            size = int(stat.st_size)
            total += size
            if current - float(stat.st_mtime) >= protect_newer_than_seconds:
                files.append((float(stat.st_mtime), size, path))
    files.sort(key=lambda item: item[0])

    def pressure() -> bool:
        quota_bad = max_bytes is not None and max_bytes > 0 and total > max_bytes
        try:
            free = shutil.disk_usage(root).free
        except OSError:
            free = None
        disk_bad = min_free_bytes is not None and min_free_bytes > 0 and free is not None and free < min_free_bytes
        return quota_bad or disk_bad

    while files and pressure():
        _mtime, size, path = files.pop(0)
        try:
            path.unlink()
        except OSError:
            continue
        total = max(0, total - size)
        removed += 1
    return removed


def capture_phase(
    config: OfficeWakeConfig,
    trigger: Trigger,
    *,
    capture_fn: Optional[Callable[..., list[Any]]] = None,
    clock: Callable[[], float] = time.time,
    frame_sampler: Optional[Any] = None,
    people_counter: Optional[Any] = None,
) -> CapturePhase:
    """Phase 1: bounded audio capture plus the frames sampled beside it. Nothing leaves the box."""
    from . import officeaudio, officeframes

    capture_fn = capture_fn or officeaudio.capture_window
    started_at = float(clock())

    def ended(status: str, reason: str, capture_seconds: float = 0.0) -> CapturePhase:
        return CapturePhase(
            trigger=trigger,
            started_at=started_at,
            capture_seconds=capture_seconds,
            segments=[],
            frames=[],
            result=CaptureResult(status, reason, _trigger_payload(trigger)),
        )

    kwargs: dict[str, Any] = {}
    if config.silence_db is not None:
        kwargs["silence_db"] = config.silence_db

    capture_seconds = float(config.seconds)
    if config.capture_mode:
        remaining = active_window_remaining_seconds(
            config.schedule,
            at=started_at,
            timezone_name=config.timezone_name,
        )
        if remaining <= 0:
            return ended("capture_blocked", "outside configured active hours at capture start")
        capture_seconds = min(capture_seconds, remaining)

    # The sampler runs BESIDE the audio capture and never blocks it: a dead camera feed costs the
    # episode its frames, not its audio.
    if frame_sampler is None and config.visual_enabled and config.bridge_url and config.office_serial:
        frame_sampler = officeframes.FrameSampler(
            officeframes.snapshot_url(config.bridge_url, config.office_serial),
            interval_s=config.visual_interval_seconds,
            max_frames=config.visual_max_frames,
        )
    if frame_sampler is not None:
        try:
            frame_sampler.start()
        except Exception:  # noqa: BLE001
            frame_sampler = None

    try:
        segments = capture_fn(
            config.source_url,
            config.out_dir,
            capture_seconds,
            source=config.source_name,
            input_format=config.input_format,
            **kwargs,
        )
    except Exception as exc:  # noqa: BLE001
        if frame_sampler is not None:
            frame_sampler.stop(final_grab=False)
        return ended("capture_failed", f"{type(exc).__name__}: {exc}"[:500], capture_seconds)
    frames: list[dict[str, Any]] = []
    if frame_sampler is not None:
        try:
            frames = frame_sampler.stop()
        except Exception:  # noqa: BLE001
            frames = []

    if not segments:
        return ended("no_segments", "bounded capture returned no speech segments", capture_seconds)

    # On-box person count, once per sampled frame (not per post). null = not measured.
    if frames:
        officeframes.annotate_people(frames, people_counter)

    return CapturePhase(
        trigger=trigger,
        started_at=started_at,
        capture_seconds=capture_seconds,
        segments=list(segments),
        frames=frames,
    )


def process_phase(
    config: OfficeWakeConfig,
    phase: CapturePhase,
    *,
    transcribe_fn: Optional[Callable[..., Any]] = None,
    post_fn: Optional[Callable[..., dict[str, Any]]] = None,
) -> CaptureResult:
    """Phase 2: transcribe each captured segment locally and post the evidence payload."""
    from . import officeframes, officepost

    if phase.result is not None:
        return phase.result
    transcribe_fn = transcribe_fn or officepost.transcribe
    post_fn = post_fn or officepost.post_episode
    trigger = phase.trigger
    segments = phase.segments
    frames = phase.frames

    prepared = 0
    transcribed = 0
    transcribe_failed = 0
    posted = 0
    failed = 0
    facts_stored = 0
    summaries_stored = 0
    frames_posted = 0
    stt_latencies: list[int] = []
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

        if transcript.error is None:
            transcribed += 1
        else:
            # The evidence payload still goes out (duration, volume, frames, the error itself);
            # the run must not call itself ok over a transcriber that produced nothing.
            transcribe_failed += 1
            errors.append(f"transcribe: {transcript.error}"[:300])
        if transcript.latency_ms is not None:
            stt_latencies.append(int(transcript.latency_ms))
        payload = officepost.build_payload(
            segment,
            transcript,
            camera_serial=config.office_serial,
            capture_host=config.capture_host,
            trigger_type=trigger.event,
            triggered_at=trigger.received_at,
        )
        seg_frames = officeframes.frames_for_segment(
            frames,
            float(getattr(segment, "started_at", 0.0) or 0.0),
            float(getattr(segment, "duration_s", 0.0) or 0.0),
        )
        if seg_frames:
            payload["frames"] = seg_frames
        prepared += 1
        total = float(payload.get("totalSeconds") or 0.0)
        covered = float(payload.get("coveredSeconds") or 0.0)
        coverages.append(round(covered / total, 3) if total > 0 else None)
        if config.dry_run:
            continue

        try:
            # An episode with frames waits on a server-side vision call as well as fact
            # extraction; the default 30s would read a stored episode as a failed post.
            if seg_frames:
                result = post_fn(payload, endpoint=config.endpoint, timeout=120.0)
            else:
                result = post_fn(payload, endpoint=config.endpoint)
        except Exception as exc:  # noqa: BLE001
            failed += 1
            errors.append(f"post: {type(exc).__name__}: {exc}"[:300])
            continue

        if result.get("posted"):
            posted += 1
            frames_posted += len(seg_frames)
            reply = result.get("reply") if isinstance(result.get("reply"), dict) else {}
            facts_stored += int(reply.get("factsStored") or 0)
            summaries_stored += 1 if reply.get("summaryStored") else 0
        else:
            failed += 1
            errors.append(str(result.get("error") or "post failed")[:300])

    problems = failed + transcribe_failed
    status = "ok" if problems == 0 else ("partial" if prepared > failed else "failed")
    reason = "capture/transcribe/post complete" if not errors else " | ".join(errors)[:500]
    return CaptureResult(
        status,
        reason,
        _trigger_payload(trigger),
        segments_found=len(segments),
        episodes_prepared=prepared,
        episodes_transcribed=transcribed,
        episodes_posted=posted,
        episodes_failed=failed,
        facts_stored=facts_stored,
        summaries_stored=summaries_stored,
        stt_latency_ms=max(stt_latencies) if stt_latencies else None,
        coverages=coverages,
        frames_captured=len(frames),
        frames_posted=frames_posted,
        episodes_transcribe_failed=transcribe_failed,
    )


def run_capture_once(
    config: OfficeWakeConfig,
    trigger: Trigger,
    *,
    capture_fn: Optional[Callable[..., list[Any]]] = None,
    transcribe_fn: Optional[Callable[..., Any]] = None,
    post_fn: Optional[Callable[..., dict[str, Any]]] = None,
    clock: Callable[[], float] = time.time,
    frame_sampler: Optional[Any] = None,
    people_counter: Optional[Any] = None,
) -> CaptureResult:
    """Capture, transcribe and post in ONE call: commissioning runs, --dry-run, injected runners.

    The daemon runs the two phases on separate workers; this keeps the single-call contract.
    """
    phase = capture_phase(
        config,
        trigger,
        capture_fn=capture_fn,
        clock=clock,
        frame_sampler=frame_sampler,
        people_counter=people_counter,
    )
    return process_phase(config, phase, transcribe_fn=transcribe_fn, post_fn=post_fn)


def schedule_active_seconds(
    schedule: dict[int, tuple[ActiveWindow, ...]],
    start: float,
    end: float,
    timezone_name: str,
) -> float:
    """Seconds of [start, end) inside the active schedule, sampled once per minute."""
    if end <= start or not schedule:
        return 0.0
    total = 0.0
    at = float(start)
    while at < end:
        step = min(60.0, float(end) - at)
        if schedule_allows(schedule, at=at, timezone_name=timezone_name):
            total += step
        at += step
    return round(total, 3)


class OfficeWakeDaemon:
    """One Eufy event listener, one capture worker, one transcribe/post worker.

    Bursts coalesce to one pending wake. Capture (phase 1) hands off to a bounded transcribe
    backlog (phase 2) so the next wake is captured while whisper is still working on the last.
    """

    WINDOW_SECONDS = 3600.0
    #: Under five eligible minutes the hour cannot be judged: a worker that just started, or a
    #: shop that just opened, has not failed. Coverage is then None, never 0.
    MIN_ELIGIBLE_SECONDS = 300.0

    def __init__(
        self,
        config: OfficeWakeConfig,
        *,
        ledger: ReceiptLedger,
        clock: Callable[[], float] = time.time,
        runner: Optional[Callable[[OfficeWakeConfig, Trigger], CaptureResult]] = None,
        runtime: Optional[RuntimeReceipt] = None,
        capture_phase_fn: Optional[Callable[..., CapturePhase]] = None,
        process_phase_fn: Optional[Callable[[OfficeWakeConfig, CapturePhase], CaptureResult]] = None,
    ) -> None:
        self.config = config
        self.ledger = ledger
        self.clock = clock
        # `runner` is the legacy single-call path (capture+transcribe+post in one thread); when it
        # is injected the two-phase workers are bypassed. Production leaves it None.
        self.runner = runner
        self.capture_phase_fn = capture_phase_fn or capture_phase
        self.process_phase_fn = process_phase_fn or process_phase
        self.queue: asyncio.Queue[Trigger] = asyncio.Queue(maxsize=1)
        self.transcribe_queue: asyncio.Queue[CapturePhase] = asyncio.Queue(
            maxsize=max(1, int(config.transcribe_backlog_max))
        )
        self.processing_phase: Optional[CapturePhase] = None
        self.last_capture_started_at: Optional[float] = None
        self.last_audio_fallback_finished_at: Optional[float] = None
        self.runtime = runtime or RuntimeReceipt(config, clock=clock)
        self.runtime_state = "STARTING"
        self.bridge_connected = False
        # Listening ledger behind the *Last60m status fields.
        self.started_at = float(clock())
        self.current_capture_started_at: Optional[float] = None
        self._trigger_times: deque[float] = deque()
        self._capture_windows: deque[tuple[float, float, bool]] = deque()
        # Operator decoder switch without an elevated shell: see resolve_whisper_model.
        self.model_override_watch = WhisperModelOverrideWatch(config.model_override_dir or config.out_dir)

    # ---- listening counters ---------------------------------------------------------------------

    def transcribe_backlog(self) -> int:
        return self.transcribe_queue.qsize() + (1 if self.processing_phase is not None else 0)

    def record_trigger(self, at: float) -> None:
        self._trigger_times.append(float(at))

    def record_capture_window(self, started_at: float, ended_at: float, *, ok: bool) -> None:
        self._capture_windows.append((float(started_at), float(ended_at), bool(ok)))

    def _prune(self, now: float) -> None:
        horizon = now - self.WINDOW_SECONDS
        while self._trigger_times and self._trigger_times[0] < horizon:
            self._trigger_times.popleft()
        while self._capture_windows and self._capture_windows[0][1] < horizon:
            self._capture_windows.popleft()

    def window_counters(self, now: Optional[float] = None) -> dict[str, Any]:
        """What the last hour of listening looked like, as status fields.

        Coverage is capture seconds over the seconds the schedule made this worker eligible to
        listen (and that it existed for). "I am alive and heard nothing" and "I am deaf" used to
        be the same READY.
        """
        current = float(self.clock() if now is None else now)
        self._prune(current)
        horizon = current - self.WINDOW_SECONDS
        windows = [(s, e, ok) for (s, e, ok) in self._capture_windows if e >= horizon]
        if self.current_capture_started_at is not None:
            windows.append((self.current_capture_started_at, current, True))
        capture_seconds = 0.0
        for started, ended, _ok in windows:
            capture_seconds += max(0.0, min(ended, current) - max(started, horizon))
        failures = sum(1 for _s, _e, ok in windows if not ok)
        eligible = schedule_active_seconds(
            self.config.schedule,
            max(horizon, self.started_at),
            current,
            self.config.timezone_name,
        )
        coverage: Optional[float] = None
        if eligible >= self.MIN_ELIGIBLE_SECONDS:
            coverage = round(min(1.0, capture_seconds / eligible), 3)
        return {
            "conversationWakeTriggersLast60m": sum(1 for at in self._trigger_times if at >= horizon),
            "conversationCapturesLast60m": len(windows),
            "conversationCaptureFailuresLast60m": failures,
            "conversationCaptureSecondsLast60m": round(capture_seconds, 1),
            "conversationListeningCoverage60m": coverage,
            "conversationTranscribeBacklog": self.transcribe_backlog(),
        }

    # ---- wake intake --------------------------------------------------------------------------

    async def offer(self, event: dict[str, Any]) -> WakeDecision:
        now = self.clock()
        decision = decide_event(self.config, event, at=now)
        self.ledger.note("wake_decision", asdict(decision))
        trigger = trigger_from_event(event, at=now)
        if trigger is None:
            return decision
        if (
            trigger.device_sn == self.config.office_serial
            and trigger_enabled(self.config, trigger.event)
            and event_is_positive(event)
        ):
            self.record_trigger(now)
            self.runtime.update(
                lastConversationEventAt=_iso_utc(now),
                conversationLastTrigger=trigger.event,
                conversationQueueDepth=self.queue.qsize(),
            )
        if decision.action != "capture":
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
        self.runtime.update(conversationQueueDepth=self.queue.qsize())
        return decision

    # ---- phase 1: capture -----------------------------------------------------------------------

    def _idle_state(self, at: float) -> str:
        return (
            "READY"
            if schedule_allows(self.config.schedule, at=at, timezone_name=self.config.timezone_name)
            else "OFF_HOURS"
        )

    def _apply_result(self, result: CaptureResult, finished_at: float) -> None:
        """Fold a finished (transcribed + posted, or failed) wake into the status receipt."""
        measured_coverages = [
            float(value) for value in (result.coverages or []) if value is not None
        ]
        common: dict[str, Any] = {"conversationQueueDepth": self.queue.qsize()}
        common.update(self.window_counters(finished_at))
        if measured_coverages:
            common["lastConversationCoverage"] = round(min(measured_coverages), 4)
        if self.config.visual_enabled:
            # Visible to the Eufy agent's heartbeat: a camera that stops yielding frames shows
            # up as 0 here instead of disappearing silently.
            common["lastConversationFramesCaptured"] = result.frames_captured
            common["lastConversationFramesPosted"] = result.frames_posted
        if result.episodes_transcribed > 0:
            common["lastConversationSttAt"] = _iso_utc(finished_at)
        if result.episodes_posted > 0:
            common["lastConversationPostAt"] = _iso_utc(finished_at)
        if result.summaries_stored > 0:
            common["lastConversationSummaryAt"] = _iso_utc(finished_at)

        if result.status in FAILED_STATUSES:
            self.runtime_state = "DEGRADED"
            self.runtime.failure(result.reason, state=self.runtime_state)
            self.runtime.update(**common)
        else:
            # A transcription finishing in the background must not pull a live capture out of
            # CAPTURING; anything else (READY, DEGRADED, OFF_HOURS) is cleared by a clean result.
            if self.runtime_state != "CAPTURING":
                self.runtime_state = self._idle_state(finished_at)
            self.runtime.update(
                conversationWorkerState=self.runtime_state,
                conversationLastError=None,
                **common,
            )

    def _enqueue_phase(self, phase: CapturePhase) -> None:
        """Hand a captured wake to the transcribe worker; a full backlog drops the OLDEST."""
        if self.transcribe_queue.full():
            try:
                dropped = self.transcribe_queue.get_nowait()
                self.transcribe_queue.task_done()
            except asyncio.QueueEmpty:
                dropped = None
            if dropped is not None:
                self.ledger.note(
                    "transcribe_backlog_dropped",
                    {
                        "dropped": {
                            "trigger": _trigger_payload(dropped.trigger),
                            "segments": len(dropped.segments),
                            "capturedAt": _iso_utc(dropped.started_at),
                        },
                        "backlogMax": self.transcribe_queue.maxsize,
                    },
                )
                self.runtime_state = "DEGRADED"
                self.runtime.failure(
                    f"transcribe backlog full ({self.transcribe_queue.maxsize}); dropped the "
                    f"oldest capture from {_iso_utc(dropped.started_at)}",
                    state=self.runtime_state,
                )
        self.transcribe_queue.put_nowait(phase)
        self.runtime.update(conversationTranscribeBacklog=self.transcribe_backlog())

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
                    self.runtime_state = (
                        "OFF_HOURS" if "outside configured active hours" in decision.reason else "READY"
                    )
                    self.runtime.update(
                        conversationWorkerState=self.runtime_state,
                        conversationQueueDepth=self.queue.qsize(),
                    )
                    continue
                if (
                    self.last_capture_started_at is not None
                    and now - self.last_capture_started_at < self.config.cooldown_seconds
                ):
                    self.ledger.note(
                        "capture_skipped",
                        {**asdict(decision), "reason": "within capture cooldown at worker start"},
                    )
                    self.runtime.update(conversationQueueDepth=self.queue.qsize())
                    continue

                self.last_capture_started_at = now
                self.current_capture_started_at = now
                self.runtime_state = "CAPTURING"
                self.runtime.update(
                    conversationWorkerState=self.runtime_state,
                    lastConversationCaptureAt=_iso_utc(now),
                    conversationQueueDepth=self.queue.qsize(),
                    **self.window_counters(now),
                )
                self.ledger.note("capture_started", {"trigger": _trigger_payload(trigger)})

                if self.runner is not None:
                    # Legacy single-call path: everything in one thread, result applied here.
                    try:
                        result = await asyncio.to_thread(self.runner, self.config, trigger)
                    except Exception as exc:  # noqa: BLE001
                        result = CaptureResult(
                            "runner_failed",
                            f"{type(exc).__name__}: {exc}"[:500],
                            _trigger_payload(trigger),
                            episodes_failed=1,
                        )
                    finished_at = self.clock()
                    self.current_capture_started_at = None
                    if trigger.event == "audioActivity":
                        self.last_audio_fallback_finished_at = finished_at
                    if result.status != "capture_blocked":
                        self.record_capture_window(now, finished_at, ok=result.status not in FAILED_STATUSES)
                    self.ledger.note("capture_finished", asdict(result))
                    self._apply_result(result, finished_at)
                    continue

                try:
                    phase = await asyncio.to_thread(
                        self.capture_phase_fn, self.config, trigger, clock=self.clock
                    )
                except Exception as exc:  # noqa: BLE001
                    phase = CapturePhase(
                        trigger=trigger,
                        started_at=now,
                        capture_seconds=0.0,
                        segments=[],
                        frames=[],
                        result=CaptureResult(
                            "runner_failed",
                            f"{type(exc).__name__}: {exc}"[:500],
                            _trigger_payload(trigger),
                            episodes_failed=1,
                        ),
                    )
                finished_at = self.clock()
                self.current_capture_started_at = None
                if trigger.event == "audioActivity":
                    self.last_audio_fallback_finished_at = finished_at

                if phase.result is not None:
                    # Nothing to transcribe: blocked, failed, or no speech. Settle it now.
                    if phase.result.status != "capture_blocked":
                        self.record_capture_window(
                            now, finished_at, ok=phase.result.status not in FAILED_STATUSES
                        )
                    self.ledger.note("capture_finished", asdict(phase.result))
                    self._apply_result(phase.result, finished_at)
                    continue

                self.record_capture_window(now, finished_at, ok=True)
                self.ledger.note(
                    "capture_captured",
                    {
                        "trigger": _trigger_payload(trigger),
                        "segments": len(phase.segments),
                        "frames": len(phase.frames),
                        "captureSeconds": round(phase.capture_seconds, 1),
                    },
                )
                self._enqueue_phase(phase)
                # Listening again while phase 2 runs. DEGRADED clears only on a clean result.
                if self.runtime_state != "DEGRADED":
                    self.runtime_state = self._idle_state(finished_at)
                self.runtime.update(
                    conversationWorkerState=self.runtime_state,
                    conversationQueueDepth=self.queue.qsize(),
                    **self.window_counters(finished_at),
                )
            finally:
                self.queue.task_done()

    # ---- phase 2: transcribe + post ---------------------------------------------------------------

    async def transcribe_worker(self) -> None:
        """Consume captured wakes oldest first, off the capture path."""
        while True:
            phase = await self.transcribe_queue.get()
            self.processing_phase = phase
            try:
                try:
                    result = await asyncio.to_thread(self.process_phase_fn, self.config, phase)
                except Exception as exc:  # noqa: BLE001
                    result = CaptureResult(
                        "runner_failed",
                        f"{type(exc).__name__}: {exc}"[:500],
                        _trigger_payload(phase.trigger),
                        episodes_failed=1,
                    )
                self.ledger.note("capture_finished", asdict(result))
                self._apply_result(result, self.clock())
            finally:
                self.processing_phase = None
                self.runtime.update(conversationTranscribeBacklog=self.transcribe_backlog())
                self.transcribe_queue.task_done()


def audio_activity_detected(
    mean_db: Optional[float],
    max_db: Optional[float],
    *,
    mean_threshold_db: float,
    max_threshold_db: float,
) -> bool:
    return (
        mean_db is not None
        and max_db is not None
        and float(mean_db) >= float(mean_threshold_db)
        and float(max_db) >= float(max_threshold_db)
    )


def audio_fallback_in_cooldown(
    last_finished_at: Optional[float],
    *,
    now: float,
    cooldown_seconds: float,
) -> bool:
    return (
        last_finished_at is not None
        and float(now) - float(last_finished_at) < max(0.0, float(cooldown_seconds))
    )


async def audio_fallback_worker(
    daemon: OfficeWakeDaemon,
    *,
    probe_fn: Optional[Callable[..., tuple[Optional[float], Optional[float]]]] = None,
) -> None:
    """Wake capture from brief local audio-energy probes when Eufy semantic pushes are absent."""
    if not daemon.config.audio_fallback_enabled:
        return
    from . import officeaudio

    probe_fn = probe_fn or officeaudio.probe_level
    interval = max(2.0, float(daemon.config.audio_probe_interval_seconds))
    while True:
        now = daemon.clock()
        eligible = (
            daemon.config.capture_mode
            and daemon.config.capture_enabled
            and daemon.config.policy_acknowledged
            and schedule_allows(
                daemon.config.schedule,
                at=now,
                timezone_name=daemon.config.timezone_name,
            )
        )
        if not eligible:
            daemon.runtime.update(conversationFallbackState="IDLE")
            await asyncio.sleep(interval)
            continue

        if daemon.runtime_state == "CAPTURING" or not daemon.queue.empty():
            await asyncio.sleep(interval)
            continue

        if audio_fallback_in_cooldown(
            daemon.last_audio_fallback_finished_at,
            now=now,
            cooldown_seconds=daemon.config.audio_fallback_cooldown_seconds,
        ):
            daemon.runtime.update(conversationFallbackState="COOLDOWN")
            await asyncio.sleep(interval)
            continue

        if (
            daemon.last_capture_started_at is not None
            and now - daemon.last_capture_started_at < daemon.config.cooldown_seconds
        ):
            await asyncio.sleep(interval)
            continue

        try:
            mean_db, max_db = await asyncio.to_thread(
                probe_fn,
                daemon.config.source_url,
                daemon.config.audio_probe_seconds,
                binary=os.environ.get("FFMPEG_BIN") or None,
                input_format=daemon.config.input_format,
            )
        except Exception as exc:  # noqa: BLE001
            detail = f"{type(exc).__name__}: {exc}"[:500]
            daemon.ledger.note("audio_fallback_error", {"error": detail})
            daemon.runtime.update(
                conversationFallbackOk=False,
                conversationFallbackState="DEGRADED",
                conversationFallbackLastError=detail,
                conversationFallbackLastProbeAt=_iso_utc(now),
            )
            await asyncio.sleep(interval)
            continue

        active = audio_activity_detected(
            mean_db,
            max_db,
            mean_threshold_db=daemon.config.audio_activity_mean_db,
            max_threshold_db=daemon.config.audio_activity_max_db,
        )
        daemon.runtime.update(
            conversationFallbackOk=True,
            conversationFallbackState="ACTIVE" if active else "QUIET",
            conversationFallbackLastError=None,
            conversationFallbackLastProbeAt=_iso_utc(now),
            conversationFallbackMeanDb=mean_db,
            conversationFallbackMaxDb=max_db,
        )
        if active:
            daemon.ledger.note(
                "audio_fallback_wake",
                {
                    "meanDb": mean_db,
                    "maxDb": max_db,
                    "meanThresholdDb": daemon.config.audio_activity_mean_db,
                    "maxThresholdDb": daemon.config.audio_activity_max_db,
                },
            )
            await daemon.offer(
                {
                    "event": "audioActivity",
                    "deviceSn": daemon.config.office_serial,
                    "detected": True,
                }
            )
        await asyncio.sleep(interval)


async def retention_worker(
    config: OfficeWakeConfig,
    ledger: ReceiptLedger,
    runtime: Optional[RuntimeReceipt] = None,
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
                max_bytes=int(config.retention_max_mb * 1024 * 1024),
                min_free_bytes=int(config.min_free_mb * 1024 * 1024),
            )
            if removed:
                ledger.note("retention_prune", {"filesRemoved": removed})
        except Exception as exc:  # noqa: BLE001
            detail = f"{type(exc).__name__}: {exc}"[:500]
            ledger.note("retention_error", {"error": detail})
            if runtime is not None:
                runtime.failure("retention: " + detail)
        await asyncio.sleep(interval)


async def runtime_status_worker(
    daemon: OfficeWakeDaemon,
    *,
    interval_seconds: float = 30.0,
) -> None:
    """Keep a fresh local worker heartbeat even when the shop is quiet.

    One bad tick must not end the heartbeat for the life of the process: a stale heartbeat is
    exactly what the supervisor reads as a dead worker, and it restarts a live one for it.
    """
    interval = max(0.05, float(interval_seconds))
    last_error: Optional[str] = None
    while True:
        try:
            now = daemon.clock()
            if daemon.runtime_state not in {"CAPTURING", "DEGRADED", "BRIDGE_RETRY"}:
                daemon.runtime_state = (
                    "READY"
                    if schedule_allows(
                        daemon.config.schedule,
                        at=now,
                        timezone_name=daemon.config.timezone_name,
                    )
                    else "OFF_HOURS"
                )
            daemon.runtime.update(
                conversationWorkerOk=True,
                conversationWorkerState=daemon.runtime_state,
                conversationQueueDepth=daemon.queue.qsize(),
                **daemon.window_counters(now),
            )
            last_error = None
            # The decoder override file changed: leave cleanly between captures so the supervisor
            # starts the task again with the new model. SystemExit is not an Exception, so the
            # guard below does not swallow it.
            watch = getattr(daemon, "model_override_watch", None)
            if (
                watch is not None
                and watch.changed()
                and daemon.runtime_state != "CAPTURING"
                and daemon.transcribe_backlog() == 0
            ):
                daemon.ledger.note(
                    "whisper_model_override_changed",
                    {"from": watch.initial, "to": read_whisper_model_override(watch.out_dir)},
                )
                daemon.runtime.update(conversationWorkerOk=True, conversationWorkerState="RESTARTING")
                raise SystemExit(0)
        except Exception as exc:  # noqa: BLE001
            detail = f"{type(exc).__name__}: {exc}"[:500]
            if detail != last_error:
                daemon.ledger.note("status_worker_error", {"error": detail})
                last_error = detail
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
    transcribe_task = asyncio.create_task(daemon.transcribe_worker())
    retention_task = asyncio.create_task(
        retention_worker(daemon.config, daemon.ledger, daemon.runtime)
    )
    status_task = asyncio.create_task(runtime_status_worker(daemon))
    fallback_task = asyncio.create_task(audio_fallback_worker(daemon))
    background = (worker_task, transcribe_task, retention_task, status_task, fallback_task)
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
                    daemon.bridge_connected = True
                    daemon.runtime_state = (
                        "READY"
                        if schedule_allows(
                            daemon.config.schedule,
                            at=daemon.clock(),
                            timezone_name=daemon.config.timezone_name,
                        )
                        else "OFF_HOURS"
                    )
                    daemon.runtime.update(
                        conversationWorkerOk=True,
                        conversationWorkerState=daemon.runtime_state,
                        conversationLastError=None,
                    )
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
                            await daemon.transcribe_queue.join()
                            return
            except Exception as exc:  # noqa: BLE001
                detail = f"{type(exc).__name__}: {exc}"[:500]
                daemon.bridge_connected = False
                daemon.runtime_state = "BRIDGE_RETRY"
                daemon.runtime.update(
                    conversationWorkerOk=True,
                    conversationWorkerState=daemon.runtime_state,
                    conversationLastError=detail,
                    conversationQueueDepth=daemon.queue.qsize(),
                )
                daemon.ledger.note(
                    "bridge_disconnected",
                    {"error": detail, "retrySeconds": delay},
                )
                await asyncio.sleep(delay)
                delay = min(60.0, delay * 2)
    finally:
        # A background task that asked the process to exit (the status worker, on a decoder
        # override change) ends with SystemExit; re-awaiting it here re-raises that. Keep the
        # RESTARTING receipt it wrote instead of overwriting it with STOPPED, and let the exit
        # continue once every other task is cancelled.
        exit_request: Optional[SystemExit] = None
        for task in background:
            task.cancel()
        for task in background:
            try:
                await task
            except asyncio.CancelledError:
                pass
            except SystemExit as exc:
                exit_request = exc
        if exit_request is not None:
            raise exit_request
        daemon.runtime.update(
            conversationWorkerOk=False,
            conversationWorkerState="STOPPED",
            conversationQueueDepth=daemon.queue.qsize(),
            conversationTranscribeBacklog=daemon.transcribe_backlog(),
        )


WHISPER_MODEL_OVERRIDE_FILE = "whisper-model.override"


def whisper_override_dir(status_path: str, out_dir: str) -> str:
    """Where whisper-model.override lives: beside the status file (install-office-capture.ps1
    puts both the status JSON and the ledger in `...\\StateNour\\OfficeIntelligence`), never in
    the audio out_dir (`...\\OfficeIntelligence\\audio`), where the supervisor's disk floor removes
    every file older than 6 h. Without a status path the out_dir is all there is."""
    status = str(status_path or "").strip()
    if status:
        return str(Path(status).parent)
    return str(out_dir)


def read_whisper_model_override(out_dir: str) -> Optional[str]:
    """First non-empty, non-comment line of `<dir>/whisper-model.override`, or None.

    The decoder lived only in the MACHINE environment (install-office-capture.ps1 writes
    OFFICE_WHISPER_MODEL there), so changing it needed an elevated shell on the shop PC; the
    2026-10-03 switch to large-v3-turbo was done that way. This file is operator-writable, the
    SYSTEM worker reads it at startup, and the worker exits on a change so the supervisor restarts
    it with the new decoder (WhisperModelOverrideWatch). No elevation, no task edit.
    """
    path = Path(out_dir) / WHISPER_MODEL_OVERRIDE_FILE
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None
    for line in text.splitlines():
        value = line.strip()
        if value and not value.startswith("#"):
            return value
    return None


def resolve_whisper_model(cli_model: Optional[str], out_dir: str) -> tuple[Optional[str], str]:
    """Return (model path, source). The override file wins when it names an existing file; a bare
    name such as `small.en-q5_1` is looked up as `ggml-<name>.bin` beside the configured model.
    An override that resolves to nothing is reported as `override-ignored` and the environment's
    model stays in force: a typo must never silence the office lane."""
    override = read_whisper_model_override(out_dir)
    if override:
        candidate = Path(override)
        if candidate.is_file():
            return str(candidate), "override-file"
        if cli_model:
            sibling = Path(cli_model).parent / f"ggml-{override}.bin"
            if sibling.is_file():
                return str(sibling), "override-file"
        return cli_model, "override-ignored"
    return cli_model, ("env" if cli_model else "none")


class WhisperModelOverrideWatch:
    """Remembers the override file's content at startup; `changed()` is True once it differs.

    Checked from the status worker between captures; a change ends the process cleanly and the
    supervisor's "task not Running -> start" rule brings it back reading the new file."""

    def __init__(self, out_dir: str) -> None:
        self.out_dir = out_dir
        self.initial = read_whisper_model_override(out_dir)

    def changed(self) -> bool:
        return read_whisper_model_override(self.out_dir) != self.initial


def _env_true(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def config_from_args(args: argparse.Namespace) -> OfficeWakeConfig:
    ZoneInfo(str(args.timezone))
    event_names = frozenset(
        item.strip()
        for item in str(args.events or "").split(",")
        if item.strip()
    ) or DEFAULT_EVENTS
    model_override_dir = whisper_override_dir(str(args.status or ""), str(args.out_dir))
    model, model_source = resolve_whisper_model(args.model, model_override_dir)
    return OfficeWakeConfig(
        bridge_url=str(args.bridge_url or "").strip(),
        office_serial=str(args.office_serial or "").strip(),
        event_names=event_names,
        capture_mode=bool(args.capture),
        capture_enabled=_env_true("OFFICE_INTERACTION_CAPTURE_ENABLED"),
        policy_acknowledged=_env_true("OFFICE_AUDIO_POLICY_ACK"),
        source_url=str(args.source_url or "").strip(),
        input_format=str(args.input_format or "auto").strip(),
        out_dir=str(args.out_dir),
        source_name=str(args.source),
        seconds=max(10.0, float(args.seconds)),
        silence_db=args.silence_db,
        transcriber=str(args.transcriber),
        model=model,
        model_source=model_source,
        model_override_dir=model_override_dir,
        endpoint=str(args.endpoint),
        dry_run=bool(args.dry_run),
        timezone_name=str(args.timezone),
        schedule=parse_schedule(str(args.schedule_json or "")),
        cooldown_seconds=max(0.0, float(args.cooldown_seconds)),
        retention_hours=max(0.0, float(args.retention_hours)),
        ingest_key_present=bool(os.environ.get("CAMERA_INGEST_KEY", "").strip()),
        status_path=str(args.status or "").strip(),
        retention_max_mb=max(1.0, float(args.retention_max_mb)),
        min_free_mb=max(0.0, float(args.min_free_mb)),
        capture_host=str(args.capture_host or os.environ.get("COMPUTERNAME", "")).strip(),
        audio_fallback_enabled=bool(args.audio_fallback),
        audio_probe_seconds=max(0.5, float(args.audio_probe_seconds)),
        audio_probe_interval_seconds=max(2.0, float(args.audio_probe_interval_seconds)),
        audio_activity_mean_db=float(args.audio_activity_mean_db),
        audio_activity_max_db=float(args.audio_activity_max_db),
        audio_fallback_cooldown_seconds=max(0.0, float(args.audio_fallback_cooldown_seconds)),
        visual_enabled=bool(args.visual),
        visual_interval_seconds=max(5.0, float(args.visual_interval_seconds)),
        visual_max_frames=max(1, min(12, int(args.visual_max_frames))),
        transcribe_backlog_max=max(1, int(args.transcribe_backlog_max)),
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
    parser.add_argument(
        "--source-url",
        default=os.environ.get("OFFICE_AUDIO_SOURCE") or os.environ.get("OFFICE_MEDIA_URL", ""),
    )
    parser.add_argument(
        "--input-format",
        choices=("auto", "rtsp", "dshow", "generic"),
        default=os.environ.get("OFFICE_AUDIO_INPUT_FORMAT", "auto"),
    )
    parser.add_argument("--out-dir", default=os.environ.get("OFFICE_INTERACTION_DIR", "data/office"))
    parser.add_argument("--ledger", default=os.environ.get("OFFICE_WAKE_LEDGER", ""))
    parser.add_argument("--status", default=os.environ.get("OFFICE_CONVERSATION_STATUS_PATH", ""))
    parser.add_argument("--source", default=os.environ.get("OFFICE_AUDIO_SOURCE_NAME", "eufy-office"))
    parser.add_argument("--capture-host", default=os.environ.get("COMPUTERNAME", ""))
    parser.add_argument("--seconds", type=float, default=float(os.environ.get("OFFICE_CAPTURE_SECONDS", "120")))
    parser.add_argument("--silence-db", type=float, default=None)
    parser.add_argument("--transcriber", default=os.environ.get("OFFICE_TRANSCRIBER", "whisper-cli"))
    parser.add_argument("--model", default=os.environ.get("OFFICE_WHISPER_MODEL") or None)
    parser.add_argument("--endpoint", default="https://nickstire.org/api/conversation-episodes")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--timezone", default="America/New_York")
    parser.add_argument(
        "--schedule-json",
        default=os.environ.get("OFFICE_ACTIVE_SCHEDULE_JSON", ""),
    )
    parser.add_argument("--cooldown-seconds", type=float, default=float(os.environ.get("OFFICE_CAPTURE_COOLDOWN_SECONDS", "30")))
    parser.add_argument(
        "--audio-fallback",
        action="store_true",
        default=_env_true("OFFICE_AUDIO_FALLBACK_ENABLED"),
        help="wake from brief local audio-energy probes when semantic camera pushes are absent",
    )
    parser.add_argument("--audio-probe-seconds", type=float, default=float(os.environ.get("OFFICE_AUDIO_PROBE_SECONDS", "5")))
    parser.add_argument("--audio-probe-interval-seconds", type=float, default=float(os.environ.get("OFFICE_AUDIO_PROBE_INTERVAL_SECONDS", "15")))
    parser.add_argument("--audio-activity-mean-db", type=float, default=float(os.environ.get("OFFICE_AUDIO_ACTIVITY_MEAN_DB", "-50")))
    parser.add_argument("--audio-activity-max-db", type=float, default=float(os.environ.get("OFFICE_AUDIO_ACTIVITY_MAX_DB", "-34")))
    parser.add_argument("--audio-fallback-cooldown-seconds", type=float, default=float(os.environ.get("OFFICE_AUDIO_FALLBACK_COOLDOWN_SECONDS", "180")))
    parser.add_argument(
        "--visual",
        action=argparse.BooleanOptionalAction,
        # Default ON (operator decision 2026-10-02: recording signs posted). OFFICE_VISUAL_ENABLED=0 opts out.
        default=os.environ.get("OFFICE_VISUAL_ENABLED", "1").strip().lower() not in {"0", "false", "no", "off"},
        help="attach still frames from the Eufy bridge to each episode (server describes them)",
    )
    parser.add_argument("--visual-interval-seconds", type=float, default=float(os.environ.get("OFFICE_VISUAL_INTERVAL_SECONDS", "30")))
    parser.add_argument("--visual-max-frames", type=int, default=int(os.environ.get("OFFICE_VISUAL_MAX_FRAMES", "6")))
    parser.add_argument("--transcribe-backlog-max", type=int, default=int(os.environ.get("OFFICE_TRANSCRIBE_BACKLOG_MAX", "6")), help="captured wakes kept waiting for transcription before the oldest is dropped")
    parser.add_argument("--retention-hours", type=float, default=float(os.environ.get("OFFICE_RAW_AUDIO_RETENTION_HOURS", "6")))
    parser.add_argument("--retention-max-mb", type=float, default=float(os.environ.get("OFFICE_RAW_AUDIO_MAX_MB", "256")))
    parser.add_argument("--min-free-mb", type=float, default=float(os.environ.get("OFFICE_MIN_FREE_MB", "768")))
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
            "whisperModel": os.path.basename(config.model) if config.model else None,
            "whisperModelSource": config.model_source,
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
