"""Honesty and survival of the office conversation worker (officewake.py).

What went wrong on NicksMax before these existed (2026-10-03 .. 10-07):
  * the heartbeat writer did `os.replace` with no retry; on Windows a reader holding the file
    (the Eufy agent reads it every heartbeat) makes that a PermissionError, the status task
    died with it, the heartbeat went stale and the supervisor restarted a worker that was
    otherwise fine, every 10 minutes;
  * a whisper timeout left `Transcript.error` set, the episode was still posted, and the run
    reported "ok" -- READY on every dashboard while no words were being transcribed;
  * capture, transcribe and post ran serially in one thread, so a 3-minute transcription was
    3 minutes the office was not being listened to, invisibly;
  * the status file had no way to say "I am alive but I heard nothing" vs "I am deaf".
"""
from __future__ import annotations

import asyncio
import os
import sys
import threading
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from vision.officepost import Transcript
from vision.officewake import (
    CapturePhase,
    CaptureResult,
    OfficeWakeConfig,
    OfficeWakeDaemon,
    RuntimeReceipt,
    Trigger,
    parse_schedule,
    run_capture_once,
    runtime_status_worker,
    schedule_active_seconds,
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
        status_path="",
    )
    base.update(overrides)
    return OfficeWakeConfig(**base)


def _live_cfg(tmp_path: Path, **over):
    base = dict(
        capture_mode=True,
        capture_enabled=True,
        policy_acknowledged=True,
        source_url="rtsp://verified-media-source",
        dry_run=False,
        ingest_key_present=True,
        out_dir=str(tmp_path),
        status_path=str(tmp_path / "status.json"),
        cooldown_seconds=0.0,
    )
    base.update(over)
    return config(**base)


def _segment(tmp_path: Path, name: str, started_at: float, duration_s: float = 10.0):
    seg = SimpleNamespace(
        episode_id=name, source="eufy-office", path=str(tmp_path / f"{name}.wav"),
        started_at=started_at, duration_s=duration_s, mean_volume_db=-24.0, measured=True,
    )
    Path(seg.path).write_bytes(b"x")
    return seg


# ---- heartbeat writer -------------------------------------------------------------------------


def test_status_writer_retries_through_a_reader_holding_the_file(tmp_path, monkeypatch):
    real_replace = os.replace
    attempts = {"n": 0}

    def flaky_replace(src, dst):
        attempts["n"] += 1
        if attempts["n"] <= 3:
            raise PermissionError(5, "Access is denied")
        return real_replace(src, dst)

    monkeypatch.setattr("vision.officewake.os.replace", flaky_replace)
    naps: list[float] = []
    runtime = RuntimeReceipt(_live_cfg(tmp_path), clock=lambda: MONDAY_10AM, sleep=naps.append)
    attempts["n"] = 0
    naps.clear()

    runtime.update(conversationWorkerState="READY")

    written = Path(runtime.path).read_text(encoding="utf-8")
    assert '"conversationWorkerState": "READY"' in written
    assert attempts["n"] == 4
    assert len(naps) == 3 and all(n > 0 for n in naps)
    assert runtime.write_failures == 0
    assert "conversationStatusWriteFailures" not in runtime.state


def test_status_writer_never_raises_when_the_replace_keeps_failing(tmp_path, monkeypatch):
    def always_denied(src, dst):
        raise PermissionError(32, "The process cannot access the file")

    runtime = RuntimeReceipt(_live_cfg(tmp_path), clock=lambda: MONDAY_10AM, sleep=lambda _s: None)
    monkeypatch.setattr("vision.officewake.os.replace", always_denied)

    runtime.update(conversationWorkerState="CAPTURING")  # must not raise
    runtime.update(conversationWorkerState="READY")

    assert runtime.write_failures == 2
    assert runtime.state["conversationStatusWriteFailures"] == 2
    assert "PermissionError" in runtime.last_write_error
    # the in-memory state kept moving even though the file could not
    assert runtime.state["conversationWorkerState"] == "READY"


def test_runtime_status_worker_outlives_an_exploding_update(tmp_path):
    async def scenario():
        ledger = MemoryLedger()
        daemon = OfficeWakeDaemon(_live_cfg(tmp_path), ledger=ledger, clock=lambda: MONDAY_10AM)
        calls = {"n": 0}
        real_update = daemon.runtime.update

        def exploding_update(**fields):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("disk fell over")
            return real_update(**fields)

        daemon.runtime.update = exploding_update  # type: ignore[method-assign]
        task = asyncio.create_task(runtime_status_worker(daemon, interval_seconds=0.01))
        try:
            for _ in range(100):
                if calls["n"] >= 3:
                    break
                await asyncio.sleep(0.01)
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        assert calls["n"] >= 3, "the heartbeat loop died with its first exception"
        assert any(kind == "status_worker_error" for kind, _ in ledger.rows)

    asyncio.run(scenario())


# ---- honest results ---------------------------------------------------------------------------


def test_transcript_error_is_partial_not_ok(tmp_path):
    seg = _segment(tmp_path, "a", MONDAY_10AM)
    posted = []
    result = run_capture_once(
        _live_cfg(tmp_path),
        Trigger(MONDAY_10AM, "personDetected", OFFICE),
        capture_fn=lambda *a, **k: [seg],
        transcribe_fn=lambda *a, **k: Transcript(segments=[], engine="whisper-cli", error="timeout after 600s"),
        post_fn=lambda payload, endpoint, **k: posted.append(payload) or {"posted": True, "status": 200},
        clock=lambda: MONDAY_10AM,
    )
    assert posted and posted[0]["transcriptError"] == "timeout after 600s"  # evidence still lands
    assert result.status == "partial"
    assert result.episodes_posted == 1
    assert result.episodes_transcribed == 0
    assert result.episodes_transcribe_failed == 1
    assert "transcribe: timeout after 600s" in result.reason


def test_a_clean_run_is_still_ok(tmp_path):
    seg = _segment(tmp_path, "a", MONDAY_10AM)
    result = run_capture_once(
        _live_cfg(tmp_path),
        Trigger(MONDAY_10AM, "personDetected", OFFICE),
        capture_fn=lambda *a, **k: [seg],
        transcribe_fn=lambda *a, **k: Transcript(segments=[{"index": 0, "start": 0.0, "end": 8.0, "text": "hi"}], engine="fake"),
        post_fn=lambda payload, endpoint, **k: {"posted": True, "status": 200},
        clock=lambda: MONDAY_10AM,
    )
    assert result.status == "ok"
    assert result.episodes_transcribe_failed == 0


# ---- two-phase worker: capture never waits for transcription -----------------------------------


class _Gate:
    """A process phase the test releases by hand."""

    def __init__(self):
        self.release = threading.Event()
        self.entered = 0

    def __call__(self, cfg, phase):
        self.entered += 1
        self.release.wait(timeout=10)
        return CaptureResult(
            "ok", "processed", asdict(phase.trigger), segments_found=len(phase.segments),
            episodes_prepared=len(phase.segments), episodes_transcribed=len(phase.segments),
            episodes_posted=len(phase.segments),
        )


def _capture_phase_factory(tmp_path):
    counter = {"n": 0}

    def fake_capture_phase(cfg, trigger, *, clock=None, **_kw):
        counter["n"] += 1
        seg = _segment(tmp_path, f"cap{counter['n']}", trigger.received_at)
        return CapturePhase(
            trigger=trigger, started_at=trigger.received_at, capture_seconds=cfg.seconds,
            segments=[seg], frames=[],
        )

    return fake_capture_phase, counter


def test_second_capture_runs_while_the_first_is_still_transcribing(tmp_path):
    async def scenario():
        ledger = MemoryLedger()
        gate = _Gate()
        fake_capture_phase, captured = _capture_phase_factory(tmp_path)
        daemon = OfficeWakeDaemon(
            _live_cfg(tmp_path), ledger=ledger, clock=lambda: MONDAY_10AM,
            capture_phase_fn=fake_capture_phase, process_phase_fn=gate,
        )
        worker = asyncio.create_task(daemon.worker())
        transcriber = asyncio.create_task(daemon.transcribe_worker())
        try:
            await daemon.offer({"event": "motion", "deviceSn": OFFICE})
            await daemon.queue.join()
            await daemon.offer({"event": "personDetected", "deviceSn": OFFICE})
            await daemon.queue.join()
            # Both captures happened; nothing has been transcribed yet.
            assert captured["n"] == 2
            assert gate.entered == 1
            assert daemon.runtime_state == "READY"
            assert daemon.transcribe_backlog() == 2
            assert daemon.runtime.state["conversationTranscribeBacklog"] == 2
            gate.release.set()
            await daemon.transcribe_queue.join()
        finally:
            for task in (worker, transcriber):
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        finished = [p for k, p in ledger.rows if k == "capture_finished"]
        assert len(finished) == 2 and all(p["status"] == "ok" for p in finished)
        assert daemon.transcribe_backlog() == 0
        assert daemon.runtime.state["conversationTranscribeBacklog"] == 0

    asyncio.run(scenario())


def test_transcribe_backlog_drops_the_oldest_with_a_receipt(tmp_path):
    async def scenario():
        ledger = MemoryLedger()
        gate = _Gate()
        fake_capture_phase, _captured = _capture_phase_factory(tmp_path)
        daemon = OfficeWakeDaemon(
            _live_cfg(tmp_path, transcribe_backlog_max=1), ledger=ledger, clock=lambda: MONDAY_10AM,
            capture_phase_fn=fake_capture_phase, process_phase_fn=gate,
        )
        worker = asyncio.create_task(daemon.worker())
        transcriber = asyncio.create_task(daemon.transcribe_worker())
        try:
            for event in ("motion", "personDetected", "motion"):
                await daemon.offer({"event": event, "deviceSn": OFFICE})
                await daemon.queue.join()
            dropped = [p for k, p in ledger.rows if k == "transcribe_backlog_dropped"]
            assert len(dropped) == 1
            assert dropped[0]["dropped"]["segments"] == 1
            assert daemon.runtime.state["conversationFailuresToday"] == 1
            assert daemon.runtime_state == "DEGRADED"
            assert "backlog" in daemon.runtime.state["conversationLastError"]
            gate.release.set()
            await daemon.transcribe_queue.join()
        finally:
            for task in (worker, transcriber):
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        finished = [p for k, p in ledger.rows if k == "capture_finished"]
        assert len(finished) == 2  # one processed before the gate, the kept one after

    asyncio.run(scenario())


def test_transcript_error_marks_the_worker_degraded_end_to_end(tmp_path):
    async def scenario():
        ledger = MemoryLedger()
        seg = _segment(tmp_path, "a", MONDAY_10AM)

        def capture_phase_fn(cfg, trigger, *, clock=None, **_kw):
            return CapturePhase(trigger=trigger, started_at=MONDAY_10AM, capture_seconds=30.0, segments=[seg], frames=[])

        def process_phase_fn(cfg, phase):
            from vision.officewake import process_phase
            return process_phase(
                cfg, phase,
                transcribe_fn=lambda *a, **k: Transcript(segments=[], engine="whisper-cli", error="exit 3"),
                post_fn=lambda payload, endpoint, **k: {"posted": True, "status": 200},
            )

        daemon = OfficeWakeDaemon(
            _live_cfg(tmp_path), ledger=ledger, clock=lambda: MONDAY_10AM,
            capture_phase_fn=capture_phase_fn, process_phase_fn=process_phase_fn,
        )
        worker = asyncio.create_task(daemon.worker())
        transcriber = asyncio.create_task(daemon.transcribe_worker())
        try:
            await daemon.offer({"event": "motion", "deviceSn": OFFICE})
            await daemon.queue.join()
            await daemon.transcribe_queue.join()
        finally:
            for task in (worker, transcriber):
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        assert daemon.runtime_state == "DEGRADED"
        assert daemon.runtime.state["conversationFailuresToday"] == 1
        assert "transcribe: exit 3" in daemon.runtime.state["conversationLastError"]

    asyncio.run(scenario())


def test_legacy_runner_injection_still_runs_single_phase(tmp_path):
    async def scenario():
        ledger = MemoryLedger()
        calls = []

        def runner(cfg, trigger):
            calls.append(trigger.event)
            return CaptureResult("ok", "single phase", asdict(trigger))

        daemon = OfficeWakeDaemon(_live_cfg(tmp_path), ledger=ledger, clock=lambda: MONDAY_10AM, runner=runner)
        worker = asyncio.create_task(daemon.worker())
        try:
            await daemon.offer({"event": "motion", "deviceSn": OFFICE})
            await daemon.queue.join()
        finally:
            worker.cancel()
            try:
                await worker
            except asyncio.CancelledError:
                pass
        assert calls == ["motion"]
        assert daemon.transcribe_backlog() == 0

    asyncio.run(scenario())


# ---- listening counters -----------------------------------------------------------------------


def test_schedule_active_seconds_counts_only_open_hours():
    schedule = parse_schedule('{"mon":"08:00-18:00"}')
    eight = datetime(2026, 9, 28, 8, 0, tzinfo=ZoneInfo("America/New_York")).timestamp()
    assert schedule_active_seconds(schedule, eight - 1800, eight + 1800, "America/New_York") == 1800.0
    assert schedule_active_seconds(schedule, eight - 7200, eight - 3600, "America/New_York") == 0.0
    assert schedule_active_seconds(schedule, MONDAY_10AM - 3600, MONDAY_10AM, "America/New_York") == 3600.0


def test_window_counters_measure_listening_against_eligible_time(tmp_path):
    daemon = OfficeWakeDaemon(_live_cfg(tmp_path), ledger=MemoryLedger(), clock=lambda: MONDAY_10AM)
    daemon.started_at = MONDAY_10AM - 7200
    daemon.record_trigger(MONDAY_10AM - 3000)
    daemon.record_trigger(MONDAY_10AM - 1500)
    daemon.record_trigger(MONDAY_10AM - 7000)  # outside the window
    daemon.record_capture_window(MONDAY_10AM - 3000, MONDAY_10AM - 2880, ok=True)   # 120 s
    daemon.record_capture_window(MONDAY_10AM - 1500, MONDAY_10AM - 1020, ok=False)  # 480 s, failed
    daemon.record_capture_window(MONDAY_10AM - 7000, MONDAY_10AM - 6880, ok=True)   # outside

    counters = daemon.window_counters(MONDAY_10AM)

    assert counters["conversationWakeTriggersLast60m"] == 2
    assert counters["conversationCapturesLast60m"] == 2
    assert counters["conversationCaptureFailuresLast60m"] == 1
    assert counters["conversationCaptureSecondsLast60m"] == 600.0
    assert counters["conversationListeningCoverage60m"] == round(600.0 / 3600.0, 3)
    assert counters["conversationTranscribeBacklog"] == 0


def test_window_counters_clip_a_capture_straddling_the_window_edge(tmp_path):
    daemon = OfficeWakeDaemon(_live_cfg(tmp_path), ledger=MemoryLedger(), clock=lambda: MONDAY_10AM)
    daemon.started_at = MONDAY_10AM - 7200
    daemon.record_capture_window(MONDAY_10AM - 3660, MONDAY_10AM - 3540, ok=True)  # 60 s inside
    counters = daemon.window_counters(MONDAY_10AM)
    assert counters["conversationCapturesLast60m"] == 1
    assert counters["conversationCaptureSecondsLast60m"] == 60.0


def test_coverage_is_unknown_not_zero_when_the_worker_is_young_or_closed(tmp_path):
    daemon = OfficeWakeDaemon(_live_cfg(tmp_path), ledger=MemoryLedger(), clock=lambda: MONDAY_10AM)
    daemon.started_at = MONDAY_10AM - 120  # two minutes old: not enough to judge
    young = daemon.window_counters(MONDAY_10AM)
    assert young["conversationListeningCoverage60m"] is None
    assert young["conversationCaptureSecondsLast60m"] == 0.0

    midnight = datetime(2026, 9, 28, 0, 30, tzinfo=ZoneInfo("America/New_York")).timestamp()
    daemon.started_at = midnight - 7200
    closed = daemon.window_counters(midnight)
    assert closed["conversationListeningCoverage60m"] is None


def test_coverage_denominator_excludes_off_hours(tmp_path):
    half_past_eight = datetime(2026, 9, 28, 8, 30, tzinfo=ZoneInfo("America/New_York")).timestamp()
    daemon = OfficeWakeDaemon(_live_cfg(tmp_path), ledger=MemoryLedger(), clock=lambda: half_past_eight)
    daemon.started_at = half_past_eight - 7200
    daemon.record_capture_window(half_past_eight - 1200, half_past_eight - 300, ok=True)  # 900 s
    counters = daemon.window_counters(half_past_eight)
    assert counters["conversationListeningCoverage60m"] == 0.5  # 900 of the 1800 open seconds


def test_an_in_progress_capture_counts_toward_listening(tmp_path):
    daemon = OfficeWakeDaemon(_live_cfg(tmp_path), ledger=MemoryLedger(), clock=lambda: MONDAY_10AM)
    daemon.started_at = MONDAY_10AM - 7200
    daemon.current_capture_started_at = MONDAY_10AM - 90
    counters = daemon.window_counters(MONDAY_10AM)
    assert counters["conversationCaptureSecondsLast60m"] == 90.0
    assert counters["conversationCapturesLast60m"] == 1


def test_worker_records_triggers_and_capture_windows_for_the_counters(tmp_path):
    async def scenario():
        now = {"t": MONDAY_10AM}
        ledger = MemoryLedger()
        fake_capture_phase, _c = _capture_phase_factory(tmp_path)
        daemon = OfficeWakeDaemon(
            _live_cfg(tmp_path), ledger=ledger, clock=lambda: now["t"],
            capture_phase_fn=fake_capture_phase,
            process_phase_fn=lambda cfg, phase: CaptureResult("ok", "done", asdict(phase.trigger), episodes_prepared=1, episodes_posted=1),
        )
        daemon.started_at = MONDAY_10AM - 7200
        worker = asyncio.create_task(daemon.worker())
        transcriber = asyncio.create_task(daemon.transcribe_worker())
        try:
            await daemon.offer({"event": "motion", "deviceSn": OFFICE})
            await daemon.queue.join()
            await daemon.transcribe_queue.join()
        finally:
            for task in (worker, transcriber):
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        state = daemon.runtime.state
        assert state["conversationWakeTriggersLast60m"] == 1
        assert state["conversationCapturesLast60m"] == 1
        assert state["conversationCaptureFailuresLast60m"] == 0
        assert state["conversationTranscribeBacklog"] == 0
        assert "conversationListeningCoverage60m" in state

    asyncio.run(scenario())
