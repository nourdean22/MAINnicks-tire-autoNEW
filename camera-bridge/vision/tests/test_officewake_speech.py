"""The office mic wakes on SPEECH, not bangs (2026-10-21), and no false BRIDGE_RETRY on the shop PC.

Owner, 2026-10-21: loud banging inside or outside the shop starts recordings. The energy wake
(mean >= -50 dBFS AND peak >= -34 dBFS) cannot tell an impact wrench from a customer, so with
OFFICE_WAKE_GATE=speech a probe that passes the energy pre-gate is transcribed by the same whisper
the captures use, and only words wake a capture. Default "energy" must stay today's behaviour.

A probe whisper could NOT transcribe is not silence (empty-vs-error): it falls back to the
energy decision and is counted, never read as "no speech".
"""
from __future__ import annotations

import asyncio
import subprocess
import sys
import types
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from vision.officepost import Transcript
from vision.officewake import (
    OfficeWakeConfig,
    OfficeWakeDaemon,
    audio_fallback_worker,
    build_parser,
    config_from_args,
    is_speech_text,
    parse_schedule,
)

OFFICE = "T8410P5225154105"
MONDAY_10AM = datetime(2026, 9, 28, 10, 0, tzinfo=ZoneInfo("America/New_York")).timestamp()
LOUD = (-40.0, -20.0)    # passes the energy pre-gate (-50 mean, -34 peak)
QUIET = (-70.0, -60.0)   # fails it


class MemoryLedger:
    def __init__(self):
        self.rows = []

    def note(self, kind, payload):
        self.rows.append((kind, payload))

    def kinds(self, kind):
        return [p for k, p in self.rows if k == kind]


def _cfg(tmp_path: Path, **over) -> OfficeWakeConfig:
    base = dict(
        bridge_url="ws://127.0.0.1:3000/ws",
        office_serial=OFFICE,
        event_names=frozenset({"motion", "personDetected"}),
        capture_mode=True,
        capture_enabled=True,
        policy_acknowledged=True,
        source_url="rtsp://verified-media-source",
        input_format="rtsp",
        out_dir=str(tmp_path / "audio"),
        source_name="eufy-office",
        seconds=30.0,
        silence_db=None,
        transcriber=sys.executable,
        model=None,
        endpoint="https://nickstire.org/api/conversation-episodes",
        dry_run=True,
        timezone_name="America/New_York",
        schedule=parse_schedule('{"mon":"08:00-18:00"}'),
        cooldown_seconds=0.0,
        retention_hours=24.0,
        ingest_key_present=False,
        status_path=str(tmp_path / "status.json"),
        audio_fallback_enabled=True,
    )
    base.update(over)
    return OfficeWakeConfig(**base)


class FakeProbe:
    """Records every probe call; writes the probe wav when asked for one, like ffmpeg would."""

    def __init__(self, levels=LOUD):
        self.levels = levels
        self.calls = []

    def __call__(self, *args, **kwargs):
        self.calls.append(kwargs)
        wav = kwargs.get("wav_path")
        if wav:
            Path(wav).parent.mkdir(parents=True, exist_ok=True)
            Path(wav).write_bytes(b"RIFF-fake-probe")
        return self.levels


class FakeWhisper:
    """Stands in for officepost.transcribe; writes the side json whisper-cli leaves behind."""

    def __init__(self, result):
        self.result = result
        self.calls = []

    def __call__(self, path, **kwargs):
        self.calls.append((path, kwargs))
        Path(path + ".json").write_text("{}", encoding="utf-8")
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def _run_worker(daemon, probe, whisper=None, *, until):
    async def scenario():
        kwargs = {"probe_fn": probe}
        if whisper is not None:
            kwargs["speech_fn"] = whisper
        task = asyncio.create_task(audio_fallback_worker(daemon, **kwargs))
        try:
            for _ in range(200):
                if until():
                    break
                await asyncio.sleep(0.01)
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    asyncio.run(scenario())


def _speech(text):
    return Transcript([{"index": 0, "start": 0.0, "end": 2.0, "text": text}], engine="whisper-cli")


# ---- (a) control: energy mode is today's behaviour --------------------------------------------


def test_energy_gate_is_the_default_and_never_runs_whisper_on_a_probe(tmp_path):
    ledger = MemoryLedger()
    daemon = OfficeWakeDaemon(_cfg(tmp_path), ledger=ledger, clock=lambda: MONDAY_10AM)
    probe, whisper = FakeProbe(LOUD), FakeWhisper(_speech("hello there"))
    assert daemon.config.wake_gate == "energy"

    _run_worker(daemon, probe, whisper, until=lambda: ledger.kinds("audio_fallback_wake"))

    assert ledger.kinds("audio_fallback_wake"), "a loud probe must still wake in energy mode"
    assert daemon.queue.qsize() == 1
    assert whisper.calls == []
    assert "wav_path" not in probe.calls[0]  # the probe command is unchanged: nothing written
    assert ledger.kinds("speech_probe") == []
    assert "conversationSpeechGate" not in daemon.runtime.state


# ---- (b) a bang passes the energy pre-gate but has no words: no wake --------------------------


@pytest.mark.parametrize("bang", [
    Transcript([], engine="whisper-cli"),
    _speech("(banging)"),
    _speech("[BLANK_AUDIO]"),
])
def test_speech_gate_does_not_wake_on_a_bang(tmp_path, bang):
    ledger = MemoryLedger()
    daemon = OfficeWakeDaemon(_cfg(tmp_path, wake_gate="speech"), ledger=ledger, clock=lambda: MONDAY_10AM)
    probe, whisper = FakeProbe(LOUD), FakeWhisper(bang)

    _run_worker(daemon, probe, whisper, until=lambda: ledger.kinds("speech_probe"))

    rows = ledger.kinds("speech_probe")
    assert rows and rows[0]["decision"] == "no_speech"
    assert rows[0]["words"] == 0
    assert "latencyMs" in rows[0]
    assert ledger.kinds("audio_fallback_wake") == []
    assert daemon.queue.qsize() == 0
    assert daemon.window_counters(MONDAY_10AM)["conversationWakeTriggersLast60m"] == 0
    assert daemon.runtime.state["conversationFallbackState"] == "NOISE"
    assert daemon.runtime.state["conversationSpeechGate"]["rejected"] == 1
    # The probe audio and whisper's side json are gone: probe audio is never retained.
    assert list(Path(daemon.config.out_dir).glob("*")) == []


# ---- (c) words wake ---------------------------------------------------------------------------


def test_speech_gate_wakes_on_words(tmp_path):
    ledger = MemoryLedger()
    daemon = OfficeWakeDaemon(_cfg(tmp_path, wake_gate="speech", whisper_threads=2),
                              ledger=ledger, clock=lambda: MONDAY_10AM)
    probe, whisper = FakeProbe(LOUD), FakeWhisper(_speech("can you check the tires"))

    _run_worker(daemon, probe, whisper, until=lambda: ledger.kinds("audio_fallback_wake"))

    rows = ledger.kinds("speech_probe")
    assert rows[0]["decision"] == "speech" and rows[0]["words"] == 5
    assert "text" not in rows[0]  # transcript text never reaches the ledger
    assert daemon.queue.qsize() == 1
    assert daemon.window_counters(MONDAY_10AM)["conversationWakeTriggersLast60m"] == 1
    # Same whisper, same threads, short timeout, on the probe the energy gate measured.
    path, kwargs = whisper.calls[0]
    assert path == probe.calls[0]["wav_path"]
    assert kwargs["threads"] == 2 and kwargs["timeout_s"] <= 30
    assert daemon.runtime.state["conversationSpeechGate"]["wakes"] == 1


# ---- the pre-gate stays: a quiet room never costs a whisper run --------------------------------


def test_speech_gate_keeps_the_energy_pre_gate(tmp_path):
    ledger = MemoryLedger()
    daemon = OfficeWakeDaemon(_cfg(tmp_path, wake_gate="speech"), ledger=ledger, clock=lambda: MONDAY_10AM)
    probe, whisper = FakeProbe(QUIET), FakeWhisper(_speech("hello there"))

    _run_worker(daemon, probe, whisper, until=lambda: len(probe.calls) >= 1
                and daemon.runtime.state.get("conversationFallbackState") == "QUIET")

    assert whisper.calls == []
    assert ledger.kinds("speech_probe") == []
    assert daemon.queue.qsize() == 0


# ---- (d) whisper failed on the probe: energy decision stands, counted --------------------------


@pytest.mark.parametrize("broken", [
    Transcript([], engine="whisper-cli", error="transcriber exited 3: bad flag"),
    RuntimeError("whisper exploded"),
])
def test_speech_probe_error_falls_back_to_energy_and_is_counted(tmp_path, broken):
    ledger = MemoryLedger()
    daemon = OfficeWakeDaemon(_cfg(tmp_path, wake_gate="speech"), ledger=ledger, clock=lambda: MONDAY_10AM)
    probe, whisper = FakeProbe(LOUD), FakeWhisper(broken)

    _run_worker(daemon, probe, whisper, until=lambda: ledger.kinds("audio_fallback_wake"))

    rows = ledger.kinds("speech_probe")
    assert rows[0]["decision"] == "error" and rows[0]["error"]
    assert ledger.kinds("audio_fallback_wake"), "a failed speech check is not silence"
    assert daemon.queue.qsize() == 1
    assert daemon.runtime.state["conversationSpeechGate"]["errors"] == 1
    assert list(Path(daemon.config.out_dir).glob("*")) == []


# ---- (e) a transcription backlog skips the speech check (no CPU pile-up) -----------------------


def test_speech_check_is_skipped_while_a_capture_is_transcribing(tmp_path):
    ledger = MemoryLedger()
    daemon = OfficeWakeDaemon(_cfg(tmp_path, wake_gate="speech"), ledger=ledger, clock=lambda: MONDAY_10AM)
    daemon.processing_phase = object()  # one capture in phase 2
    assert daemon.transcribe_backlog() == 1
    probe, whisper = FakeProbe(LOUD), FakeWhisper(_speech("hello there"))

    _run_worker(daemon, probe, whisper, until=lambda: ledger.kinds("audio_fallback_wake"))

    assert whisper.calls == []
    assert "wav_path" not in probe.calls[0]
    rows = ledger.kinds("speech_probe")
    assert rows[0]["decision"] == "skipped_backlog"
    assert daemon.queue.qsize() == 1
    assert daemon.runtime.state["conversationSpeechGate"]["skippedBacklog"] == 1


# ---- the non-speech list ----------------------------------------------------------------------


@pytest.mark.parametrize("text", [
    "", "   ", "[BLANK_AUDIO]", "[MUSIC]", "(banging)", "(wind blowing)", "[ Silence ]",
    "*clank*", "you", "You.", "Thank you.", "thanks for watching!", "...", "a", "♪ ♪",
    "(engine revving) [BLANK_AUDIO]",
])
def test_non_speech_tokens_are_not_speech(text):
    assert is_speech_text(text) is False


@pytest.mark.parametrize("text", [
    "can you check the tires", "Hi", "how much for an oil change?", "(laughs) yeah that works",
    "you can pull it in", "OK",
])
def test_words_are_speech(text):
    assert is_speech_text(text) is True


# ---- config -----------------------------------------------------------------------------------


def test_wake_gate_env_reaches_the_config_and_rejects_a_typo(monkeypatch):
    monkeypatch.delenv("OFFICE_WAKE_GATE", raising=False)
    assert config_from_args(build_parser().parse_args([])).wake_gate == "energy"
    monkeypatch.setenv("OFFICE_WAKE_GATE", "speech")
    assert config_from_args(build_parser().parse_args([])).wake_gate == "speech"
    monkeypatch.setenv("OFFICE_WAKE_GATE", "speach")
    with pytest.raises(ValueError, match="OFFICE_WAKE_GATE"):
        config_from_args(build_parser().parse_args([]))


# ---- the probe can keep its audio for the speech check ------------------------------------------


def test_probe_level_writes_nothing_unless_asked(monkeypatch, tmp_path):
    from vision import officeaudio

    seen = []

    def run(cmd, *a, **k):
        seen.append(list(cmd))
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="mean_volume: -40.0 dB\nmax_volume: -20.0 dB\n")

    monkeypatch.setattr("vision.officeaudio.subprocess.run", run)
    assert officeaudio.probe_level("rtsp://cam/live0", 5, binary="ffmpeg", input_format="rtsp") == (-40.0, -20.0)
    wav = str(tmp_path / "probe" / "speechprobe-1.wav")
    assert officeaudio.probe_level("rtsp://cam/live0", 5, binary="ffmpeg", input_format="rtsp",
                                   wav_path=wav) == (-40.0, -20.0)
    plain, kept = seen[1], seen[3]  # [0] and [2] are the `ffmpeg -version` checks
    assert plain == ["ffmpeg", "-hide_banner", "-rtsp_transport", "tcp", "-i", "rtsp://cam/live0",
                     "-vn", "-t", "5.0", "-af", "volumedetect", "-f", "null", __import__("os").devnull]
    assert kept[:11] == plain[:11]
    assert kept[11:] == ["-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", "-y", wav]
    assert Path(wav).parent.is_dir()


# ---- (g) no bridge configured: no BRIDGE_RETRY; a configured bridge that fails: BRIDGE_RETRY ----


def _fake_websockets(monkeypatch):
    attempts = []

    def connect(url, **kwargs):
        attempts.append(url)
        raise ConnectionRefusedError(1225, "The remote computer refused the network connection")

    monkeypatch.setitem(sys.modules, "websockets", types.SimpleNamespace(connect=connect))
    return attempts


def _listen(monkeypatch, daemon, *, until):
    import vision.officewake as ow

    async def idle(*a, **k):  # no ffmpeg probes from the test
        return None

    monkeypatch.setattr(ow, "audio_fallback_worker", idle)
    monkeypatch.setattr(ow.asyncio, "sleep", _fast_sleep)
    states = []
    real_update = daemon.runtime.update

    def update(**fields):
        if "conversationWorkerState" in fields:
            states.append(fields["conversationWorkerState"])
        real_update(**fields)

    daemon.runtime.update = update

    async def scenario():
        task = asyncio.create_task(ow.listen_forever(daemon))
        try:
            for _ in range(300):
                if until(states):
                    break
                await _REAL_SLEEP(0.005)
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    asyncio.run(scenario())
    return states


_REAL_SLEEP = asyncio.sleep


async def _fast_sleep(seconds, *a, **k):
    await _REAL_SLEEP(min(float(seconds), 0.005))


def test_no_bridge_configured_never_reports_bridge_retry(tmp_path, monkeypatch):
    attempts = _fake_websockets(monkeypatch)
    ledger = MemoryLedger()
    daemon = OfficeWakeDaemon(_cfg(tmp_path, bridge_url=""), ledger=ledger, clock=lambda: MONDAY_10AM)

    states = _listen(monkeypatch, daemon, until=lambda s: s.count("READY") >= 3)

    assert attempts == []
    assert "BRIDGE_RETRY" not in states
    assert "READY" in states
    assert ledger.kinds("bridge_disconnected") == []
    assert ledger.kinds("bridge_not_configured")


def test_a_configured_bridge_that_fails_still_reports_bridge_retry(tmp_path, monkeypatch):
    attempts = _fake_websockets(monkeypatch)
    ledger = MemoryLedger()
    daemon = OfficeWakeDaemon(_cfg(tmp_path), ledger=ledger, clock=lambda: MONDAY_10AM)

    states = _listen(monkeypatch, daemon, until=lambda s: "BRIDGE_RETRY" in s and len(attempts) >= 2)

    assert attempts and attempts[0] == "ws://127.0.0.1:3000/ws"
    assert "BRIDGE_RETRY" in states
    assert ledger.kinds("bridge_disconnected")


def test_no_bridge_is_allowed_only_when_the_audio_fallback_can_wake(tmp_path):
    shop_pc = _cfg(tmp_path, bridge_url="")
    assert shop_pc.startup_blockers() == []
    no_wake_source = _cfg(tmp_path, bridge_url="", audio_fallback_enabled=False)
    assert "EUFY bridge URL is not configured" in no_wake_source.startup_blockers()
    events_only = _cfg(tmp_path, bridge_url="", capture_mode=False)
    assert "EUFY bridge URL is not configured" in events_only.startup_blockers()


# ---- noise flags reach the consumers: captures, the speech probe, the status receipt ------------

NOISE = ("--suppress-nst", "--no-speech-thold", "0.6")


def test_noise_flags_reach_every_transcription_and_only_when_set(tmp_path):
    from types import SimpleNamespace

    from vision.officewake import Trigger, run_capture_once

    seg = SimpleNamespace(episode_id="a", source="eufy-office", path=str(tmp_path / "a.wav"),
                          started_at=MONDAY_10AM, duration_s=10.0, mean_volume_db=-24.0, measured=True)
    calls = []
    for args in (NOISE, ()):
        run_capture_once(
            _cfg(tmp_path, whisper_noise_args=args),
            Trigger(MONDAY_10AM, "audioActivity", OFFICE),
            capture_fn=lambda *a, **k: [seg],
            transcribe_fn=lambda *a, **k: calls.append(k) or Transcript(segments=[], engine="fake"),
            post_fn=lambda payload, endpoint, **k: {"posted": True},
            clock=lambda: MONDAY_10AM,
        )
    assert calls[0]["extra_args"] == NOISE
    assert "extra_args" not in calls[1]  # unset keeps the old call shape for any custom transcriber


def test_the_speech_probe_uses_the_same_noise_flags(tmp_path):
    ledger = MemoryLedger()
    daemon = OfficeWakeDaemon(_cfg(tmp_path, wake_gate="speech", whisper_noise_args=NOISE),
                              ledger=ledger, clock=lambda: MONDAY_10AM)
    probe, whisper = FakeProbe(LOUD), FakeWhisper(_speech("front left tire"))
    _run_worker(daemon, probe, whisper, until=lambda: ledger.kinds("speech_probe"))
    assert whisper.calls[0][1]["extra_args"] == NOISE


def test_status_receipt_engine_names_the_effective_flags(tmp_path):
    plain = OfficeWakeDaemon(_cfg(tmp_path), ledger=MemoryLedger(), clock=lambda: MONDAY_10AM)
    assert plain.runtime.state["conversationSttEngine"] == Path(sys.executable).name
    noisy = OfficeWakeDaemon(_cfg(tmp_path, whisper_noise_args=NOISE), ledger=MemoryLedger(),
                             clock=lambda: MONDAY_10AM)
    engine = noisy.runtime.state["conversationSttEngine"]
    assert engine == f"{Path(sys.executable).name} --suppress-nst --no-speech-thold 0.6"
    long = OfficeWakeDaemon(_cfg(tmp_path, transcriber="w" * 200, whisper_noise_args=NOISE),
                            ledger=MemoryLedger(), clock=lambda: MONDAY_10AM)
    assert len(long.runtime.state["conversationSttEngine"]) <= 128


def test_main_probes_the_binary_once_and_hands_the_flags_to_the_daemon(monkeypatch, tmp_path):
    import vision.officewake as ow

    help_calls = []

    def run(cmd, *a, **k):
        help_calls.append(cmd)
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="  -sns, --suppress-nst  [false] x\n")

    monkeypatch.setattr("vision.officepost.subprocess.run", run)
    seen = {}

    async def fake_listen(daemon, **k):
        seen["daemon"] = daemon

    monkeypatch.setattr(ow, "listen_forever", fake_listen)
    for name in ("OFFICE_CONVERSATION_STATUS_PATH", "OFFICE_WAKE_LEDGER", "OFFICE_WAKE_GATE"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("EUFY_BRIDGE_URL", "ws://127.0.0.1:3000/ws")
    monkeypatch.setenv("OFFICE_TRANSCRIBER", "whisper-cli")
    monkeypatch.setenv("OFFICE_INTERACTION_DIR", str(tmp_path))

    monkeypatch.setenv("OFFICE_WHISPER_NOISE_ARGS", "auto")
    assert ow.main([]) == 0
    assert help_calls == [["whisper-cli", "--help"]]
    assert seen["daemon"].config.whisper_noise_args == ("--suppress-nst",)
    assert seen["daemon"].runtime.state["conversationSttEngine"] == "whisper-cli --suppress-nst"

    help_calls.clear()
    monkeypatch.delenv("OFFICE_WHISPER_NOISE_ARGS")
    assert ow.main([]) == 0
    assert help_calls == []  # default: no probe, no flags, today's command
    assert seen["daemon"].config.whisper_noise_args == ()
    assert seen["daemon"].runtime.state["conversationSttEngine"] == "whisper-cli"

    monkeypatch.setenv("OFFICE_WHISPER_NOISE_ARGS", "loud")
    assert ow.main([]) == 2  # a typo is invalid_config, never a silent default
