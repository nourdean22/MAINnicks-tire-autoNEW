from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from vision.officepost import Transcript
from vision.officewake import (
    OfficeWakeConfig,
    OfficeWakeDaemon,
    Trigger,
    active_window_remaining_seconds,
    decide_event,
    parse_schedule,
    prune_audio,
    retention_worker,
    run_capture_once,
    schedule_allows,
)


OFFICE = "T8410P522517180B"
MONDAY_10AM = datetime(2026, 9, 28, 10, 0, tzinfo=ZoneInfo("America/New_York")).timestamp()


class MemoryLedger:
    def __init__(self):
        self.rows = []

    def note(self, kind, payload):
        self.rows.append((kind, payload))


def config(**overrides):
    base = dict(
        bridge_url="ws://127.0.0.1:3000/ws",
        office_serial=OFFICE,
        event_names=frozenset({"motion", "personDetected"}),
        capture_mode=False,
        capture_enabled=False,
        policy_acknowledged=False,
        source_url="",
        out_dir="data/office",
        source_name="eufy-office",
        seconds=30.0,
        silence_db=None,
        transcriber="whisper-cli",
        model=None,
        endpoint="https://nickstire.org/api/conversation-episodes",
        dry_run=True,
        timezone_name="America/New_York",
        schedule=parse_schedule('{"mon":"08:00-18:00"}'),
        cooldown_seconds=30.0,
        retention_hours=24.0,
        ingest_key_present=False,
    )
    base.update(overrides)
    return OfficeWakeConfig(**base)


def test_schedule_is_explicit_and_local_time_bounded():
    schedule = parse_schedule('{"mon":["08:00-12:00","13:00-18:00"],"sun":"closed"}')
    assert schedule_allows(schedule, at=MONDAY_10AM, timezone_name="America/New_York")

    noon = datetime(2026, 9, 28, 12, 30, tzinfo=ZoneInfo("America/New_York")).timestamp()
    assert not schedule_allows(schedule, at=noon, timezone_name="America/New_York")


def test_active_window_reports_exact_remaining_seconds():
    schedule = parse_schedule('{"mon":"08:00-18:00"}')
    at = datetime(2026, 9, 28, 17, 59, 30, tzinfo=ZoneInfo("America/New_York")).timestamp()

    assert active_window_remaining_seconds(
        schedule,
        at=at,
        timezone_name="America/New_York",
    ) == 30.0


def test_event_only_commissioning_observes_semantic_event_without_capture():
    decision = decide_event(
        config(),
        {"event": "personDetected", "deviceSn": OFFICE, "detected": True},
        at=MONDAY_10AM,
    )
    assert decision.action == "event_only"
    assert decision.reason == "semantic event observed"


def test_clear_transition_and_wrong_camera_are_not_wakes():
    cleared = decide_event(
        config(),
        {"event": "motion", "deviceSn": OFFICE, "detected": False},
        at=MONDAY_10AM,
    )
    assert cleared.action == "drop"
    assert "clear" in cleared.reason

    other = decide_event(
        config(),
        {"event": "motion", "deviceSn": "HOME"},
        at=MONDAY_10AM,
    )
    assert other.action == "drop"
    assert other.reason == "different camera"


def test_capture_path_fails_closed_until_policy_media_and_enablement_exist():
    blocked = config(capture_mode=True)
    decision = decide_event(
        blocked,
        {"event": "motion", "deviceSn": OFFICE},
        at=MONDAY_10AM,
    )
    assert decision.action == "drop"
    assert "OFFICE_INTERACTION_CAPTURE_ENABLED" in decision.reason
    assert "OFFICE_AUDIO_POLICY_ACK" in decision.reason
    assert "OFFICE_MEDIA_URL" in decision.reason

    allowed = config(
        capture_mode=True,
        capture_enabled=True,
        policy_acknowledged=True,
        source_url="rtsp://verified-media-source",
        dry_run=True,
    )
    decision = decide_event(
        allowed,
        {"event": "motion", "deviceSn": OFFICE},
        at=MONDAY_10AM,
    )
    assert decision.action == "capture"


def test_capture_posts_existing_evidence_payload_without_raw_audio_upload(tmp_path):
    segment = SimpleNamespace(
        episode_id="eufy-office-test",
        source="eufy-office",
        path=str(tmp_path / "segment.wav"),
        started_at=MONDAY_10AM,
        duration_s=10.0,
        mean_volume_db=-24.0,
        measured=True,
    )
    Path(segment.path).write_bytes(b"not-real-audio")
    transcript = Transcript(
        segments=[
            {"index": 0, "start": 0.0, "end": 4.0, "text": "Need two tires."},
            {"index": 1, "start": 4.0, "end": 8.0, "text": "Okay."},
        ],
        engine="fake",
        latency_ms=12,
    )
    posted = []

    def fake_capture(*args, **kwargs):
        return [segment]

    def fake_transcribe(*args, **kwargs):
        return transcript

    def fake_post(payload, endpoint):
        posted.append((payload, endpoint))
        return {"posted": True, "status": 200}

    cfg = config(
        capture_mode=True,
        capture_enabled=True,
        policy_acknowledged=True,
        source_url="rtsp://verified-media-source",
        dry_run=False,
        ingest_key_present=True,
        out_dir=str(tmp_path),
    )
    result = run_capture_once(
        cfg,
        Trigger(MONDAY_10AM, "personDetected", OFFICE),
        capture_fn=fake_capture,
        transcribe_fn=fake_transcribe,
        post_fn=fake_post,
    )

    assert result.status == "ok"
    assert result.segments_found == 1
    assert result.episodes_prepared == 1
    assert result.episodes_posted == 1
    assert result.coverages == [0.8]
    assert posted[0][0]["audioRef"] == segment.path
    assert "audio" not in posted[0][0]


def test_capture_is_trimmed_at_active_window_boundary(tmp_path):
    at = datetime(2026, 9, 28, 17, 59, 30, tzinfo=ZoneInfo("America/New_York")).timestamp()
    durations = []

    def fake_capture(source_url, out_dir, seconds, **kwargs):
        durations.append(seconds)
        return []

    cfg = config(
        capture_mode=True,
        capture_enabled=True,
        policy_acknowledged=True,
        source_url="rtsp://verified-media-source",
        seconds=120.0,
        out_dir=str(tmp_path),
    )
    result = run_capture_once(
        cfg,
        Trigger(at, "motion", OFFICE),
        capture_fn=fake_capture,
        clock=lambda: at,
    )

    assert result.status == "no_segments"
    assert durations == [30.0]


def test_post_exception_becomes_failed_episode_instead_of_escaping(tmp_path):
    segment = SimpleNamespace(
        episode_id="eufy-office-test",
        source="eufy-office",
        path=str(tmp_path / "segment.wav"),
        started_at=MONDAY_10AM,
        duration_s=10.0,
        mean_volume_db=-24.0,
        measured=True,
    )
    Path(segment.path).write_bytes(b"not-real-audio")
    transcript = Transcript(
        segments=[{"index": 0, "start": 0.0, "end": 8.0, "text": "Need two tires."}],
        engine="fake",
        latency_ms=12,
    )

    cfg = config(
        capture_mode=True,
        capture_enabled=True,
        policy_acknowledged=True,
        source_url="rtsp://verified-media-source",
        dry_run=False,
        ingest_key_present=True,
        out_dir=str(tmp_path),
    )
    result = run_capture_once(
        cfg,
        Trigger(MONDAY_10AM, "personDetected", OFFICE),
        capture_fn=lambda *args, **kwargs: [segment],
        transcribe_fn=lambda *args, **kwargs: transcript,
        post_fn=lambda *args, **kwargs: (_ for _ in ()).throw(ValueError("bad endpoint")),
        clock=lambda: MONDAY_10AM,
    )

    assert result.status == "failed"
    assert result.episodes_failed == 1
    assert "ValueError" in result.reason


def test_worker_survives_runner_exception_and_processes_next_wake():
    async def scenario():
        ledger = MemoryLedger()
        calls = []

        def flaky_runner(cfg, trigger):
            calls.append(trigger.event)
            if len(calls) == 1:
                raise RuntimeError("first run exploded")
            from vision.officewake import CaptureResult
            return CaptureResult("ok", "recovered", {
                "receivedAt": trigger.received_at,
                "event": trigger.event,
                "deviceSn": trigger.device_sn,
            })

        cfg = config(
            capture_mode=True,
            capture_enabled=True,
            policy_acknowledged=True,
            source_url="rtsp://verified-media-source",
            cooldown_seconds=0.0,
        )
        daemon = OfficeWakeDaemon(
            cfg,
            ledger=ledger,
            clock=lambda: MONDAY_10AM,
            runner=flaky_runner,
        )
        task = asyncio.create_task(daemon.worker())
        try:
            await daemon.offer({"event": "motion", "deviceSn": OFFICE})
            await daemon.queue.join()
            await daemon.offer({"event": "personDetected", "deviceSn": OFFICE})
            await daemon.queue.join()
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        assert calls == ["motion", "personDetected"]
        finished = [payload for kind, payload in ledger.rows if kind == "capture_finished"]
        assert finished[0]["status"] == "runner_failed"
        assert finished[1]["status"] == "ok"

    asyncio.run(scenario())


def test_event_burst_coalesces_to_one_pending_capture():
    async def scenario():
        ledger = MemoryLedger()
        cfg = config(
            capture_mode=True,
            capture_enabled=True,
            policy_acknowledged=True,
            source_url="rtsp://verified-media-source",
        )
        daemon = OfficeWakeDaemon(cfg, ledger=ledger, clock=lambda: MONDAY_10AM)

        first = await daemon.offer({"event": "motion", "deviceSn": OFFICE})
        second = await daemon.offer({"event": "personDetected", "deviceSn": OFFICE})

        assert first.action == "capture"
        assert second.action == "capture"
        assert daemon.queue.qsize() == 1
        kept = daemon.queue.get_nowait()
        daemon.queue.task_done()
        assert kept.event == "personDetected"
        assert any(kind == "wake_coalesced" for kind, _ in ledger.rows)

    asyncio.run(scenario())


def test_retention_worker_prunes_without_any_capture(tmp_path):
    async def scenario():
        old_wav = tmp_path / "old.wav"
        old_wav.write_text("x", encoding="utf-8")
        old = time.time() - 7200
        os.utime(old_wav, (old, old))

        ledger = MemoryLedger()
        cfg = config(out_dir=str(tmp_path), retention_hours=1.0)
        task = asyncio.create_task(
            retention_worker(cfg, ledger, interval_seconds=0.01)
        )
        try:
            for _ in range(50):
                if not old_wav.exists():
                    break
                await asyncio.sleep(0.01)
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        assert not old_wav.exists()
        assert any(kind == "retention_prune" for kind, _ in ledger.rows)

    asyncio.run(scenario())


def test_retention_prunes_only_expired_audio_artifacts(tmp_path):
    old_wav = tmp_path / "old.wav"
    old_json = tmp_path / "old.wav.json"
    fresh = tmp_path / "fresh.wav"
    keep = tmp_path / "notes.json"
    for path in (old_wav, old_json, fresh, keep):
        path.write_text("x", encoding="utf-8")

    now = 10_000.0
    os.utime(old_wav, (now - 10_000, now - 10_000))
    os.utime(old_json, (now - 10_000, now - 10_000))
    os.utime(fresh, (now - 60, now - 60))
    os.utime(keep, (now - 10_000, now - 10_000))

    removed = prune_audio(tmp_path, retention_hours=1.0, now=now)

    assert removed == 2
    assert not old_wav.exists()
    assert not old_json.exists()
    assert fresh.exists()
    assert keep.exists()
