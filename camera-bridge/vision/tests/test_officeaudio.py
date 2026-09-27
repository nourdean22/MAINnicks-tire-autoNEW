"""officeaudio tests.

The failure this module must not have is a capture that reports success while producing
nothing usable. So the tests assert the DISTINCTIONS -- silence vs unmeasurable, no segments
vs not-run, empty container vs real audio -- rather than that functions return values.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from vision.officeaudio import (  # noqa: E402
    AudioSegment, FfmpegMissing, _input_args, _speech_spans, capture_window, measure_level,
)


class _Ran:
    """Stands in for subprocess.run, returning canned ffmpeg stderr."""

    def __init__(self, stderr: str = "", rc: int = 0):
        self.stderr, self.returncode, self.stdout = stderr, rc, ""


# ------------------------------------------------------------------ span inversion

def test_silence_between_two_talkers_splits_into_two_spans(monkeypatch):
    """silencedetect reports the QUIET parts; the speech is what is left between them."""
    out = ("[silencedetect] silence_start: 10.0\n"
           "[silencedetect] silence_end: 25.0 | silence_duration: 15.0\n")
    monkeypatch.setattr("vision.officeaudio.subprocess.run",
                        lambda *a, **k: _Ran(stderr=out))
    spans = _speech_spans("ffmpeg", "x.wav", -35.0, 3.0, 60.0)
    assert spans == [(0.0, 10.0), (25.0, 60.0)]


def test_no_silence_detected_means_the_whole_window_is_speech(monkeypatch):
    """Not an error and not empty: a busy counter with no 3s gap is one long interaction.

    Returning [] here would discard a genuinely busy period -- the exact case the shop cares
    most about -- and it would look identical to a quiet morning.
    """
    monkeypatch.setattr("vision.officeaudio.subprocess.run",
                        lambda *a, **k: _Ran(stderr="[silencedetect] nothing here\n"))
    assert _speech_spans("ffmpeg", "x.wav", -35.0, 3.0, 90.0) == [(0.0, 90.0)]


def test_a_window_that_is_entirely_silent_yields_no_speech_spans(monkeypatch):
    out = ("[silencedetect] silence_start: 0.0\n"
           "[silencedetect] silence_end: 60.0 | silence_duration: 60.0\n")
    monkeypatch.setattr("vision.officeaudio.subprocess.run",
                        lambda *a, **k: _Ran(stderr=out))
    assert _speech_spans("ffmpeg", "x.wav", -35.0, 3.0, 60.0) == []


# ------------------------------------------------------------------ level measurement

def test_level_is_parsed_from_ffmpeg_output(monkeypatch):
    out = ("[Parsed_volumedetect_0] mean_volume: -31.4 dB\n"
           "[Parsed_volumedetect_0] max_volume: -6.2 dB\n")
    monkeypatch.setattr("vision.officeaudio.subprocess.run",
                        lambda *a, **k: _Ran(stderr=out))
    monkeypatch.setattr("vision.officeaudio._ffmpeg", lambda b=None: "ffmpeg")
    assert measure_level("clip.wav") == (-31.4, -6.2)


def test_an_unmeASURABLE_file_returns_None_NOT_zero(monkeypatch):
    """None and 0.0 dB are opposite claims.

    0.0 dBFS is FULL SCALE -- the loudest possible signal. Returning it for a file ffmpeg
    could not read would assert a deafening recording where there was actually no
    measurement, and every downstream reader would believe it.
    """
    def boom(*a, **k):
        raise OSError("ffmpeg exploded")
    monkeypatch.setattr("vision.officeaudio.subprocess.run", boom)
    monkeypatch.setattr("vision.officeaudio._ffmpeg", lambda b=None: "ffmpeg")
    assert measure_level("clip.wav") == (None, None)


def test_a_segment_records_WHETHER_it_was_measured(monkeypatch):
    """`measured` exists so "quiet room" and "measurement failed" stay distinguishable."""
    unmeasured = AudioSegment(episode_id="e", source="s", path="p",
                              started_at=0.0, duration_s=10.0)
    assert unmeasured.measured is False
    assert unmeasured.to_dict()["meanVolumeDb"] is None


# ------------------------------------------------------------------ capture guards

def test_an_empty_wav_container_is_a_FAILURE_not_a_silent_capture(monkeypatch, tmp_path):
    """A 44-byte wav is a valid file with no audio, and rc=0 makes it look like success.

    This is the shape that would quietly produce hours of "successful" empty captures.
    """
    monkeypatch.setattr("vision.officeaudio._ffmpeg", lambda b=None: "ffmpeg")

    def fake_run(cmd, *a, **k):
        # emulate ffmpeg writing a header-only wav and exiting cleanly
        target = cmd[cmd.index("-y") + 1]
        Path(target).write_bytes(b"RIFF" + b"\0" * 40)
        return _Ran(rc=0)

    monkeypatch.setattr("vision.officeaudio.subprocess.run", fake_run)
    with pytest.raises(RuntimeError, match="no audio"):
        capture_window("rtsp://x/live0", str(tmp_path), 5.0)


def test_a_missing_ffmpeg_raises_a_NAMED_error_not_a_bare_oserror(monkeypatch):
    """The caller must be able to report "install ffmpeg" rather than a stack trace.

    ffmpeg was genuinely absent on the shop PC on 2026-09-22, so this path is real.
    """
    def boom(*a, **k):
        raise FileNotFoundError("no ffmpeg")
    monkeypatch.setattr("vision.officeaudio.subprocess.run", boom)
    with pytest.raises(FfmpegMissing, match="FFMPEG_BIN"):
        from vision.officeaudio import _ffmpeg
        _ffmpeg(None)


def test_short_bursts_are_discarded_as_noise(monkeypatch, tmp_path):
    """A door slam is not an interaction. Two seconds of anything is noise with a timestamp."""
    monkeypatch.setattr("vision.officeaudio._ffmpeg", lambda b=None: "ffmpeg")
    monkeypatch.setattr("vision.officeaudio._speech_spans",
                        lambda *a, **k: [(0.0, 2.0), (10.0, 40.0)])
    monkeypatch.setattr("vision.officeaudio.measure_level", lambda *a, **k: (-30.0, -5.0))

    def fake_run(cmd, *a, **k):
        target = cmd[cmd.index("-y") + 1]
        Path(target).write_bytes(b"RIFF" + b"\0" * 5000)
        return _Ran(rc=0)

    monkeypatch.setattr("vision.officeaudio.subprocess.run", fake_run)
    segs = capture_window("rtsp://x/live0", str(tmp_path), 60.0)
    assert len(segs) == 1, "the 2-second burst should have been discarded"
    assert segs[0].duration_s == 30.0


# ------------------------------------------------------------------ calibration

class _Cal:
    """Feeds calibrate() a scripted sequence of measured levels."""

    def __init__(self, levels):
        self.levels = list(levels)

    def measure(self, *a, **k):
        return (self.levels.pop(0), -3.0) if self.levels else (None, None)


def _stub_capture(monkeypatch, levels, tmp_path):
    monkeypatch.setattr("vision.officeaudio._ffmpeg", lambda b=None: "ffmpeg")
    monkeypatch.setattr("vision.officeaudio.subprocess.run", lambda *a, **k: _Ran(rc=0))
    monkeypatch.setattr("vision.officeaudio.os.remove", lambda p: None)
    monkeypatch.setattr("vision.officeaudio.measure_level", _Cal(levels).measure)


def test_calibration_proposes_a_threshold_between_the_floor_and_speech(monkeypatch, tmp_path):
    """A real room: quiet stretches near -55, talking near -25."""
    from vision.officeaudio import calibrate
    levels = [-55, -54, -53, -52, -30, -28, -27, -26, -25, -24, -52, -51]
    _stub_capture(monkeypatch, levels, tmp_path)
    cal = calibrate("rtsp://x/live0", str(tmp_path), samples=len(levels))
    assert cal.refused is None
    # Above the room floor, well below speech -- a missed conversation is a worse failure
    # than an over-long segment, so it sits low in the range rather than in the middle.
    assert cal.floor_db < cal.suggested_silence_db < cal.loud_db


def test_calibration_REFUSES_when_nothing_distinguishable_happened(monkeypatch, tmp_path):
    """An empty office gives a narrow spread, and a threshold from it would be fiction.

    This is the failure that matters: a calibration run during a quiet hour would otherwise
    produce a confident-looking number derived entirely from room tone, and every later
    capture would split on nothing.
    """
    from vision.officeaudio import calibrate
    levels = [-48, -47.5, -48.2, -47.8, -48.1, -47.9, -48.3, -47.6]
    _stub_capture(monkeypatch, levels, tmp_path)
    cal = calibrate("rtsp://x/live0", str(tmp_path), samples=len(levels))
    assert cal.suggested_silence_db is None
    assert "nothing distinguishable" in (cal.refused or "")


def test_calibration_REFUSES_on_too_few_usable_readings(monkeypatch, tmp_path):
    """Most samples failed to measure. Averaging the survivors would hide that."""
    from vision.officeaudio import calibrate
    _stub_capture(monkeypatch, [-50, None, None, None, -30, None], tmp_path)
    cal = calibrate("rtsp://x/live0", str(tmp_path), samples=6)
    assert cal.suggested_silence_db is None
    assert "usable readings" in (cal.refused or "")


def test_a_refusal_carries_its_REASON_not_just_a_null(monkeypatch, tmp_path):
    """`suggested is None` alone cannot tell an empty office from a broken mic."""
    from vision.officeaudio import calibrate
    _stub_capture(monkeypatch, [-50, None, None], tmp_path)
    cal = calibrate("rtsp://x/live0", str(tmp_path), samples=3)
    assert cal.refused and len(cal.refused) > 20
    assert cal.to_dict()["refused"] == cal.refused


# ------------------------------------------------------------------ source selection

def test_rtsp_source_keeps_tcp_transport():
    assert _input_args("rtsp://camera/live0", "auto") == [
        "-rtsp_transport", "tcp", "-i", "rtsp://camera/live0"
    ]


def test_dshow_source_does_not_inherit_rtsp_flags():
    assert _input_args("USB Counter Mic", "dshow") == [
        "-f", "dshow", "-i", "audio=USB Counter Mic"
    ]
    assert "-rtsp_transport" not in _input_args("USB Counter Mic", "dshow")


def test_explicit_dshow_audio_spec_is_not_double_prefixed():
    assert _input_args("audio=USB Counter Mic", "dshow") == [
        "-f", "dshow", "-i", "audio=USB Counter Mic"
    ]


def test_unknown_input_format_fails_loudly():
    with pytest.raises(ValueError, match="unsupported input_format"):
        _input_args("x", "magic")


def test_capture_window_threads_dshow_input_args_to_ffmpeg(monkeypatch, tmp_path):
    monkeypatch.setattr("vision.officeaudio._ffmpeg", lambda b=None: "ffmpeg")
    monkeypatch.setattr("vision.officeaudio._wav_duration", lambda _path: 5.0)
    monkeypatch.setattr("vision.officeaudio._speech_spans", lambda *a, **k: [])

    seen = {}

    def fake_run(cmd, *a, **k):
        if "-y" in cmd:
            seen["cmd"] = cmd
            target = cmd[cmd.index("-y") + 1]
            Path(target).write_bytes(b"RIFF" + b"\0" * 5000)
        return _Ran(rc=0)

    monkeypatch.setattr("vision.officeaudio.subprocess.run", fake_run)
    capture_window("USB Counter Mic", str(tmp_path), 5.0, input_format="dshow")
    cmd = seen["cmd"]
    assert cmd[cmd.index("-f") + 1] == "dshow"
    assert cmd[cmd.index("-i") + 1] == "audio=USB Counter Mic"
    assert "-rtsp_transport" not in cmd


def test_finite_generic_input_uses_actual_wav_duration_not_requested_ceiling(monkeypatch, tmp_path):
    monkeypatch.setattr("vision.officeaudio._ffmpeg", lambda b=None: "ffmpeg")
    monkeypatch.setattr("vision.officeaudio._wav_duration", lambda _path: 10.0)

    seen = {}

    def fake_spans(_ff, _raw, _silence_db, _gap, duration):
        seen["duration"] = duration
        return []

    def fake_run(cmd, *a, **k):
        if "-y" in cmd:
            target = cmd[cmd.index("-y") + 1]
            Path(target).write_bytes(b"RIFF" + b"0" * 5000)
        return _Ran(rc=0)

    monkeypatch.setattr("vision.officeaudio._speech_spans", fake_spans)
    monkeypatch.setattr("vision.officeaudio.subprocess.run", fake_run)

    capture_window("short-input.wav", str(tmp_path), 300.0, input_format="generic")
    assert seen["duration"] == 10.0
