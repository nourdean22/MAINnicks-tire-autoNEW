"""officepost tests.

The failure this module must not have is posting a CONFIDENT number derived from a broken run:
a coverage figure inflated by overlapping segments, or an empty transcript from a dead
transcriber presented as a quiet room. Both would pass the server's gate and produce fluent,
wrong summaries -- so both are asserted here.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from vision.officepost import (  # noqa: E402
    TranscriberMissing, Transcript, build_payload, covered_seconds, post_episode, transcribe,
)


class _Seg:
    """Stands in for officeaudio.AudioSegment."""

    def __init__(self, measured=True, mean=-25.0, dur=90.0):
        self.episode_id, self.source, self.path = "ep-1", "eufy-office", "C:/a/ep-1.wav"
        self.started_at, self.duration_s = 1_700_000_000.0, dur
        self.mean_volume_db, self.max_volume_db, self.measured = mean, -3.0, measured


class _Proc:
    def __init__(self, rc=0, stdout="", stderr=""):
        self.returncode, self.stdout, self.stderr = rc, stdout, stderr


# ------------------------------------------------------------------ coverage arithmetic

def test_overlapping_segments_are_counted_ONCE():
    """Whisper emits overlapping spans routinely; SUMMING them inflates coverage.

    This is the arithmetic that decides whether the server's 65% gate fires. Summing these
    three would give 60s of a 90s clip (67%, gate OFF); the union is 40s (44%, gate ON) -- and
    44% is exactly the measured failure the gate exists to catch.
    """
    segs = [
        {"start": 0, "end": 20, "text": "a"},
        {"start": 15, "end": 35, "text": "b"},
        {"start": 30, "end": 40, "text": "c"},
    ]
    assert covered_seconds(segs, total=90) == 40.0


def test_a_segment_running_past_the_clip_cannot_exceed_it():
    """A hallucinated tail must not buy coverage the recording does not have."""
    assert covered_seconds([{"start": 0, "end": 500, "text": "x"}], total=90) == 90.0


def test_disjoint_segments_add_up_normally():
    # Positive control. Without it, a function that always returned 0 passes both tests above.
    assert covered_seconds([{"start": 0, "end": 10, "text": "a"},
                            {"start": 50, "end": 60, "text": "b"}], total=90) == 20.0


def test_no_segments_is_zero_coverage_not_a_crash():
    assert covered_seconds([], total=90) == 0.0


def test_a_malformed_span_is_skipped_rather_than_counted_as_zero_length():
    assert covered_seconds([{"start": "x", "end": "y", "text": "a"},
                            {"start": 0, "end": 5, "text": "b"}], total=90) == 5.0


# ------------------------------------------------------------------ transcriber honesty

def test_a_MISSING_transcriber_raises_rather_than_returning_empty(monkeypatch):
    """The caller must be able to report "install whisper" instead of posting silence."""
    def boom(*a, **k):
        raise FileNotFoundError("nope")
    monkeypatch.setattr("vision.officepost.subprocess.run", boom)
    with pytest.raises(TranscriberMissing, match="--transcriber"):
        transcribe("x.wav")


def test_a_NONZERO_exit_sets_error_and_returns_no_segments(monkeypatch):
    monkeypatch.setattr("vision.officepost.subprocess.run",
                        lambda *a, **k: _Proc(rc=2, stderr="cuda exploded"))
    tr = transcribe("x.wav")
    assert tr.segments == []
    assert tr.error and "exited 2" in tr.error


def test_a_CLEAN_exit_that_wrote_nothing_is_an_ERROR_not_a_quiet_room(monkeypatch, tmp_path):
    """The shape that would quietly record hours of "nobody spoke".

    A working transcriber emits a json envelope even for silence. Exiting 0 with no output
    means the run broke, and storing that as SKIPPED asserts the counter was empty.
    """
    monkeypatch.setattr("vision.officepost.subprocess.run", lambda *a, **k: _Proc(rc=0, stdout=""))
    tr = transcribe(str(tmp_path / "x.wav"))
    assert tr.segments == []
    assert tr.error is not None


def test_a_real_transcript_parses_from_stdout(monkeypatch, tmp_path):
    # Positive control for the parser: without it, every test above passes on a function that
    # can never succeed.
    payload = {"segments": [{"start": 0.0, "end": 4.0, "text": " front right tire "},
                            {"start": 4.0, "end": 9.0, "text": "we can patch that"}]}
    monkeypatch.setattr("vision.officepost.subprocess.run",
                        lambda *a, **k: _Proc(rc=0, stdout=json.dumps(payload)))
    tr = transcribe(str(tmp_path / "x.wav"))
    assert tr.error is None
    assert [s["text"] for s in tr.segments] == ["front right tire", "we can patch that"]
    assert tr.segments[0]["index"] == 0


def test_whisper_cli_millisecond_offsets_are_read_as_seconds(monkeypatch, tmp_path):
    """whisper-cli reports {"offsets": {"from": ms}}; reading those as seconds would put a
    90-second clip's spans 1000x out and hand the server a nonsense coverage figure."""
    payload = {"transcription": [{"offsets": {"from": 1500, "to": 4000}, "text": "hello"}]}
    monkeypatch.setattr("vision.officepost.subprocess.run",
                        lambda *a, **k: _Proc(rc=0, stdout=json.dumps(payload)))
    tr = transcribe(str(tmp_path / "x.wav"))
    assert tr.segments[0]["start"] == 1.5 and tr.segments[0]["end"] == 4.0


# ------------------------------------------------------------------ payload contract

def test_the_payload_ALWAYS_carries_both_coverage_numbers():
    """The route requires them, and the server's gate turns OFF if either is missing."""
    p = build_payload(_Seg(), Transcript([{"index": 0, "start": 0, "end": 37.4, "text": "x"}]))
    assert p["coveredSeconds"] == 37.4 and p["totalSeconds"] == 90.0


def test_an_UNMEASURED_level_is_posted_as_None_never_zero():
    """0.0 dBFS is FULL SCALE. Posting it for an unmeasured clip asserts a deafening room."""
    assert build_payload(_Seg(measured=False), Transcript([]))["meanVolumeDb"] is None


def test_a_transcriber_error_RIDES_ALONG_so_the_server_can_store_FAILED():
    # Without this field the server sees an empty segment list and stores SKIPPED.
    p = build_payload(_Seg(), Transcript([], error="transcriber exited 2"))
    assert p["transcriptError"] == "transcriber exited 2"
    assert p["segments"] == []


def test_a_genuinely_quiet_clip_carries_NO_error():
    """Empty-with-no-error is a real finding and must stay distinguishable from a crash."""
    p = build_payload(_Seg(), Transcript([], error=None))
    assert p["transcriptError"] is None and p["coveredSeconds"] == 0.0


# ------------------------------------------------------------------ posting

def test_posting_without_the_key_FAILS_LOUD_rather_than_401ing_silently(monkeypatch):
    monkeypatch.delenv("CAMERA_INGEST_KEY", raising=False)
    r = post_episode({"episodeId": "e"})
    assert r["posted"] is False and "CAMERA_INGEST_KEY" in r["error"]
