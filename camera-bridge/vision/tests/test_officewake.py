from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from vision.officepost import Transcript
from vision.officewake import (
    WHISPER_MODEL_OVERRIDE_FILE,
    OfficeWakeConfig,
    OfficeWakeDaemon,
    Trigger,
    WhisperModelOverrideWatch,
    active_window_remaining_seconds,
    audio_activity_detected,
    audio_fallback_in_cooldown,
    audio_fallback_worker,
    decide_event,
    parse_schedule,
    prune_audio,
    read_whisper_model_override,
    resolve_whisper_model,
    retention_worker,
    run_capture_once,
    runtime_status_worker,
    schedule_allows,
    whisper_override_dir,
)


OFFICE = "T8410P5225154105"
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
        input_format="auto",
        out_dir="data/office",
        source_name="eufy-office",
        seconds=30.0,
        silence_db=None,
        transcriber=sys.executable,
        model=None,
        endpoint="https://nickstire.org/api/conversation-episodes",
        dry_run=True,
        timezone_name="America/New_York",
        schedule=parse_schedule('{"mon":"08:00-18:00"}'),
        cooldown_seconds=30.0,
        retention_hours=24.0,
        ingest_key_present=False,
        status_path=str(Path(tempfile.gettempdir()) / f"officewake-test-{os.getpid()}.json"),
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
    assert "audio source" in decision.reason

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





def test_audio_activity_threshold_requires_sustained_mean_and_peak():
    assert audio_activity_detected(
        -45.0, -30.0, mean_threshold_db=-50.0, max_threshold_db=-34.0
    )
    assert not audio_activity_detected(
        -60.0, -20.0, mean_threshold_db=-50.0, max_threshold_db=-34.0
    )
    assert not audio_activity_detected(
        -40.0, -38.0, mean_threshold_db=-50.0, max_threshold_db=-34.0
    )
    assert not audio_activity_detected(
        None, -20.0, mean_threshold_db=-50.0, max_threshold_db=-34.0
    )


def test_audio_fallback_cooldown_is_independent_and_bounded():
    assert not audio_fallback_in_cooldown(None, now=100.0, cooldown_seconds=60.0)
    assert audio_fallback_in_cooldown(50.0, now=100.0, cooldown_seconds=60.0)
    assert not audio_fallback_in_cooldown(40.0, now=100.0, cooldown_seconds=60.0)
    assert not audio_fallback_in_cooldown(100.0, now=100.0, cooldown_seconds=0.0)


def test_audio_activity_wake_requires_explicit_fallback_enablement():
    blocked = config(
        capture_mode=True,
        capture_enabled=True,
        policy_acknowledged=True,
        source_url="http://127.0.0.1:3000/record/office",
        audio_fallback_enabled=False,
    )
    decision = decide_event(
        blocked,
        {"event": "audioActivity", "deviceSn": OFFICE, "detected": True},
        at=MONDAY_10AM,
    )
    assert decision.action == "drop"
    assert decision.reason == "event not enabled"

    allowed = config(
        capture_mode=True,
        capture_enabled=True,
        policy_acknowledged=True,
        source_url="http://127.0.0.1:3000/record/office",
        audio_fallback_enabled=True,
    )
    decision = decide_event(
        allowed,
        {"event": "audioActivity", "deviceSn": OFFICE, "detected": True},
        at=MONDAY_10AM,
    )
    assert decision.action == "capture"



def test_audio_fallback_worker_skips_probe_while_capturing():
    async def scenario():
        calls = []
        cfg = config(
            capture_mode=True,
            capture_enabled=True,
            policy_acknowledged=True,
            source_url="rtsp://verified-media-source",
            audio_fallback_enabled=True,
        )
        daemon = OfficeWakeDaemon(cfg, ledger=MemoryLedger(), clock=lambda: MONDAY_10AM)
        daemon.runtime_state = "CAPTURING"

        def probe(*args, **kwargs):
            calls.append((args, kwargs))
            return (-40.0, -20.0)

        task = asyncio.create_task(audio_fallback_worker(daemon, probe_fn=probe))
        try:
            await asyncio.sleep(0.05)
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        assert calls == []

    asyncio.run(scenario())


def test_audio_fallback_worker_respects_post_capture_cooldown():
    async def scenario():
        calls = []
        cfg = config(
            capture_mode=True,
            capture_enabled=True,
            policy_acknowledged=True,
            source_url="rtsp://verified-media-source",
            audio_fallback_enabled=True,
            audio_fallback_cooldown_seconds=180.0,
        )
        daemon = OfficeWakeDaemon(cfg, ledger=MemoryLedger(), clock=lambda: MONDAY_10AM)
        daemon.runtime_state = "READY"
        daemon.last_audio_fallback_finished_at = MONDAY_10AM - 30.0

        def probe(*args, **kwargs):
            calls.append((args, kwargs))
            return (-40.0, -20.0)

        task = asyncio.create_task(audio_fallback_worker(daemon, probe_fn=probe))
        try:
            for _ in range(20):
                if daemon.runtime.state.get("conversationFallbackState") == "COOLDOWN":
                    break
                await asyncio.sleep(0.01)
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        assert calls == []
        assert daemon.runtime.state.get("conversationFallbackState") == "COOLDOWN"

    asyncio.run(scenario())


def test_audio_fallback_worker_marks_probe_error_degraded():
    async def scenario():
        ledger = MemoryLedger()
        cfg = config(
            capture_mode=True,
            capture_enabled=True,
            policy_acknowledged=True,
            source_url="rtsp://verified-media-source",
            audio_fallback_enabled=True,
        )
        daemon = OfficeWakeDaemon(cfg, ledger=ledger, clock=lambda: MONDAY_10AM)
        daemon.runtime_state = "READY"

        def probe(*args, **kwargs):
            raise RuntimeError("probe exploded")

        task = asyncio.create_task(audio_fallback_worker(daemon, probe_fn=probe))
        try:
            for _ in range(20):
                if daemon.runtime.state.get("conversationFallbackState") == "DEGRADED":
                    break
                await asyncio.sleep(0.01)
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        assert daemon.runtime.state.get("conversationFallbackState") == "DEGRADED"
        assert daemon.runtime.state.get("conversationFallbackOk") is False
        assert "probe exploded" in str(
            daemon.runtime.state.get("conversationFallbackLastError")
        )
        assert any(kind == "audio_fallback_error" for kind, _ in ledger.rows)

    asyncio.run(scenario())


def test_event_wake_passes_local_mic_input_format_to_capture(tmp_path):
    seen = {}

    def fake_capture(source_url, out_dir, seconds, **kwargs):
        seen["source_url"] = source_url
        seen["input_format"] = kwargs.get("input_format")
        return []

    cfg = config(
        capture_mode=True,
        capture_enabled=True,
        policy_acknowledged=True,
        source_url="USB Counter Mic",
        input_format="dshow",
        out_dir=str(tmp_path),
    )
    result = run_capture_once(
        cfg,
        Trigger(MONDAY_10AM, "personDetected", OFFICE),
        capture_fn=fake_capture,
        clock=lambda: MONDAY_10AM,
    )

    assert result.status == "no_segments"
    assert seen == {"source_url": "USB Counter Mic", "input_format": "dshow"}


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
        clock=lambda: MONDAY_10AM,
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
                pruned = any(kind == "retention_prune" for kind, _ in ledger.rows)
                if not old_wav.exists() and pruned:
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


def test_retention_hard_quota_prunes_oldest_but_protects_fresh(tmp_path):
    now = 20_000.0
    old_a = tmp_path / "old-a.wav"
    old_b = tmp_path / "old-b.wav.json"
    fresh = tmp_path / "fresh.wav"
    for path in (old_a, old_b, fresh):
        path.write_bytes(b"x" * 700)
    os.utime(old_a, (now - 5000, now - 5000))
    os.utime(old_b, (now - 4000, now - 4000))
    os.utime(fresh, (now - 30, now - 30))

    removed = prune_audio(
        tmp_path,
        retention_hours=24.0,
        max_bytes=1000,
        protect_newer_than_seconds=600.0,
        now=now,
    )

    assert removed == 2
    assert not old_a.exists()
    assert not old_b.exists()
    assert fresh.exists()


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


class FakeSampler:
    def __init__(self, frames):
        self._frames = frames
        self.started = False
        self.stopped_with_final = None

    def start(self):
        self.started = True
        return self

    def stop(self, *, final_grab=True):
        self.stopped_with_final = final_grab
        return list(self._frames)


def _live_cfg(tmp_path):
    return config(
        capture_mode=True,
        capture_enabled=True,
        policy_acknowledged=True,
        source_url="rtsp://verified-media-source",
        dry_run=False,
        ingest_key_present=True,
        out_dir=str(tmp_path),
    )


def _segment(tmp_path, name, started_at, duration_s):
    seg = SimpleNamespace(
        episode_id=name, source="eufy-office", path=str(tmp_path / f"{name}.wav"),
        started_at=started_at, duration_s=duration_s, mean_volume_db=-24.0, measured=True,
    )
    Path(seg.path).write_bytes(b"x")
    return seg


def test_capture_attaches_each_segments_own_frames(tmp_path):
    seg_a = _segment(tmp_path, "a", MONDAY_10AM, 20.0)
    seg_b = _segment(tmp_path, "b", MONDAY_10AM + 90, 20.0)
    frames = [
        {"at": MONDAY_10AM + 5, "mime": "image/jpeg", "base64": "A"},
        {"at": MONDAY_10AM + 95, "mime": "image/jpeg", "base64": "B"},
    ]
    sampler = FakeSampler(frames)
    posted = []
    result = run_capture_once(
        _live_cfg(tmp_path),
        Trigger(MONDAY_10AM, "personDetected", OFFICE),
        capture_fn=lambda *a, **k: [seg_a, seg_b],
        transcribe_fn=lambda *a, **k: Transcript(segments=[{"index": 0, "start": 0.0, "end": 4.0, "text": "hi"}], engine="fake"),
        post_fn=lambda payload, endpoint, **k: posted.append((payload, k)) or {"posted": True, "status": 200},
        clock=lambda: MONDAY_10AM,
        frame_sampler=sampler,
    )
    assert sampler.started and sampler.stopped_with_final is True
    assert [f["base64"] for f in posted[0][0]["frames"]] == ["A"]
    assert [f["base64"] for f in posted[1][0]["frames"]] == ["B"]
    # an episode carrying frames waits for the server's vision call
    assert posted[0][1] == {"timeout": 120.0}
    assert result.frames_captured == 2
    assert result.frames_posted == 2


def test_capture_without_frames_posts_the_unchanged_payload(tmp_path):
    seg = _segment(tmp_path, "a", MONDAY_10AM, 20.0)
    posted = []
    run_capture_once(
        _live_cfg(tmp_path),
        Trigger(MONDAY_10AM, "personDetected", OFFICE),
        capture_fn=lambda *a, **k: [seg],
        transcribe_fn=lambda *a, **k: Transcript(segments=[], engine="fake"),
        post_fn=lambda payload, endpoint: posted.append(payload) or {"posted": True, "status": 200},
        clock=lambda: MONDAY_10AM,
        frame_sampler=FakeSampler([]),
    )
    assert "frames" not in posted[0]


def test_capture_failure_stops_the_sampler_without_a_closing_grab(tmp_path):
    sampler = FakeSampler([])

    def boom(*a, **k):
        raise RuntimeError("ffmpeg died")

    result = run_capture_once(
        _live_cfg(tmp_path),
        Trigger(MONDAY_10AM, "personDetected", OFFICE),
        capture_fn=boom,
        clock=lambda: MONDAY_10AM,
        frame_sampler=sampler,
    )
    assert result.status == "capture_failed"
    assert sampler.stopped_with_final is False


# ---- whisper decoder override: an operator-writable file beats the Machine environment --------
# The decoder path lived only in the SYSTEM task's Machine env (install-office-capture.ps1), so
# changing it needed an elevated shell on the shop PC. `<out_dir>/whisper-model.override` is read at
# startup, and a change between captures ends the worker cleanly so the supervisor restarts it.


def _override(tmp_path, text):
    (tmp_path / WHISPER_MODEL_OVERRIDE_FILE).write_text(text, encoding="utf-8")


def _models(tmp_path):
    models = tmp_path / "WhisperCpp"
    models.mkdir(exist_ok=True)
    env_model = models / "ggml-large-v3-turbo-q5_0.bin"
    env_model.write_bytes(b"x")
    return env_model


def test_no_override_file_keeps_the_environment_decoder(tmp_path):
    env_model = _models(tmp_path)
    assert read_whisper_model_override(str(tmp_path)) is None
    assert resolve_whisper_model(str(env_model), str(tmp_path)) == (str(env_model), "env")
    assert resolve_whisper_model(None, str(tmp_path)) == (None, "none")


def test_override_reads_the_first_uncommented_line_only(tmp_path):
    _override(tmp_path, "# office decoder, operator-writable\n\n  small.en-q5_1  \nbase.en-q5_1\n")
    assert read_whisper_model_override(str(tmp_path)) == "small.en-q5_1"
    _override(tmp_path, "# only comments\n\n")
    assert read_whisper_model_override(str(tmp_path)) is None


def test_override_bare_name_resolves_beside_the_environment_decoder(tmp_path):
    env_model = _models(tmp_path)
    small = env_model.parent / "ggml-small.en-q5_1.bin"
    small.write_bytes(b"x")
    _override(tmp_path, "small.en-q5_1\n")
    assert resolve_whisper_model(str(env_model), str(tmp_path)) == (str(small), "override-file")


def test_override_explicit_path_wins_over_the_environment_decoder(tmp_path):
    env_model = _models(tmp_path)
    explicit = tmp_path / "elsewhere" / "ggml-base.en-q5_1.bin"
    explicit.parent.mkdir()
    explicit.write_bytes(b"x")
    _override(tmp_path, f"{explicit}\n")
    assert resolve_whisper_model(str(env_model), str(tmp_path)) == (str(explicit), "override-file")


def test_override_naming_a_missing_model_is_ignored_and_says_so(tmp_path):
    # A typo must never silence the office lane: the environment decoder stays in force and the
    # status receipt says the override was ignored, instead of the worker failing every capture.
    env_model = _models(tmp_path)
    _override(tmp_path, "smal.en-q5_1\n")
    assert resolve_whisper_model(str(env_model), str(tmp_path)) == (str(env_model), "override-ignored")
    # Positive control for the same input: once the file exists the same line resolves.
    (env_model.parent / "ggml-smal.en-q5_1.bin").write_bytes(b"x")
    assert resolve_whisper_model(str(env_model), str(tmp_path))[1] == "override-file"


def test_status_receipt_names_the_decoder_and_where_it_came_from(tmp_path):
    cfg = config(
        model="C:/Users/nourd/AppData/Local/StateNour/WhisperCpp/ggml-small.en-q5_1.bin",
        model_source="override-file",
        status_path=str(tmp_path / "status.json"),
    )
    OfficeWakeDaemon(cfg, ledger=MemoryLedger(), clock=lambda: MONDAY_10AM)
    written = json.loads((tmp_path / "status.json").read_text(encoding="utf-8"))
    assert written["conversationWhisperModel"] == "ggml-small.en-q5_1.bin"
    assert written["conversationWhisperModelSource"] == "override-file"

    bare = config(model=None, status_path=str(tmp_path / "bare.json"))
    OfficeWakeDaemon(bare, ledger=MemoryLedger(), clock=lambda: MONDAY_10AM)
    written = json.loads((tmp_path / "bare.json").read_text(encoding="utf-8"))
    assert written["conversationWhisperModel"] is None
    assert written["conversationWhisperModelSource"] == "env"


def test_override_watch_sees_a_change_in_content_not_in_bytes(tmp_path):
    _override(tmp_path, "small.en-q5_1\n")
    watch = WhisperModelOverrideWatch(str(tmp_path))
    assert watch.initial == "small.en-q5_1"
    assert watch.changed() is False
    _override(tmp_path, "# same decoder, new comment\nsmall.en-q5_1\n")
    assert watch.changed() is False
    _override(tmp_path, "base.en-q5_1\n")
    assert watch.changed() is True


def test_override_watch_counts_a_file_appearing_or_vanishing_as_a_change(tmp_path):
    watch = WhisperModelOverrideWatch(str(tmp_path))
    assert watch.initial is None
    _override(tmp_path, "small.en-q5_1\n")
    assert watch.changed() is True

    present = WhisperModelOverrideWatch(str(tmp_path))
    (tmp_path / WHISPER_MODEL_OVERRIDE_FILE).unlink()
    assert present.changed() is True


def test_status_worker_exits_cleanly_on_override_change_but_never_mid_capture(tmp_path):
    ledger = MemoryLedger()
    cfg = config(
        out_dir=str(tmp_path),
        status_path=str(tmp_path / "status.json"),
        model="C:/models/ggml-large-v3-turbo-q5_0.bin",
    )
    daemon = OfficeWakeDaemon(cfg, ledger=ledger, clock=lambda: MONDAY_10AM)

    async def scenario():
        daemon.runtime_state = "CAPTURING"
        task = asyncio.create_task(runtime_status_worker(daemon, interval_seconds=0.01))
        await asyncio.sleep(0.05)
        _override(tmp_path, "small.en-q5_1\n")
        await asyncio.sleep(0.05)
        # Mid-capture the worker keeps heartbeating; the change waits for the capture to end.
        assert not task.done()
        assert daemon.runtime.state["conversationWorkerState"] == "CAPTURING"
        daemon.runtime_state = "READY"
        # SystemExit propagates through here; a worker that keeps running is a failure, not a hang.
        await asyncio.wait_for(task, timeout=2.0)

    with pytest.raises(SystemExit) as exit_info:
        asyncio.run(scenario())
    assert exit_info.value.code == 0
    notes = [payload for kind, payload in ledger.rows if kind == "whisper_model_override_changed"]
    assert notes == [{"from": None, "to": "small.en-q5_1"}]
    # The receipt on disk says RESTARTING, so the supervisor's "task not Running -> start" rule
    # brings the worker back and nothing reads the gap as a crash.
    written = json.loads((tmp_path / "status.json").read_text(encoding="utf-8"))
    assert written["conversationWorkerState"] == "RESTARTING"
    assert written["conversationWorkerOk"] is True


def test_status_worker_waits_for_the_transcribe_backlog_before_exiting(tmp_path):
    ledger = MemoryLedger()
    cfg = config(out_dir=str(tmp_path), status_path=str(tmp_path / "status.json"))
    daemon = OfficeWakeDaemon(cfg, ledger=ledger, clock=lambda: MONDAY_10AM)
    daemon.processing_phase = "transcribing"  # one capture still being decoded

    async def scenario():
        daemon.runtime_state = "READY"
        task = asyncio.create_task(runtime_status_worker(daemon, interval_seconds=0.01))
        _override(tmp_path, "small.en-q5_1\n")
        await asyncio.sleep(0.05)
        assert not task.done()
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(scenario())
    assert not [kind for kind, _ in ledger.rows if kind == "whisper_model_override_changed"]


def test_override_lives_beside_the_status_file_never_in_the_pruned_audio_dir():
    # install-office-capture.ps1: out_dir = ...\OfficeIntelligence\audio, status = ...\OfficeIntelligence\
    # office-conversation-status.json. The supervisor's disk floor deletes every file older than
    # 6 h in audio\, so an override written there would vanish on the first low-disk tick.
    status = "C:/Users/nourd/AppData/Local/StateNour/OfficeIntelligence/office-conversation-status.json"
    audio = "C:/Users/nourd/AppData/Local/StateNour/OfficeIntelligence/audio"
    assert whisper_override_dir(status, audio) == str(Path(status).parent)
    assert whisper_override_dir("", audio) == audio
    assert whisper_override_dir("   ", audio) == audio


def test_daemon_watches_the_override_dir_not_the_audio_dir(tmp_path):
    audio = tmp_path / "audio"
    audio.mkdir()
    cfg = config(out_dir=str(audio), model_override_dir=str(tmp_path), status_path=str(tmp_path / "status.json"))
    daemon = OfficeWakeDaemon(cfg, ledger=MemoryLedger(), clock=lambda: MONDAY_10AM)
    assert daemon.model_override_watch.out_dir == str(tmp_path)
    _override(audio, "small.en-q5_1\n")
    assert daemon.model_override_watch.changed() is False
    _override(tmp_path, "small.en-q5_1\n")
    assert daemon.model_override_watch.changed() is True
