"""officebench: does a stronger whisper model fit the shop PC? (2026-10-21)

It runs the real officepost.transcribe() over recorded office clips with each model and prints
seconds of audio, STT ms, real-time factor and word count. It must never post, never delete, and
never write beside the clips: whisper-cli drops `<clip>.json` next to whatever it reads, and the
clips folder is the live capture directory.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
import wave
from pathlib import Path

from vision.officebench import main, run_bench


def _wav(path: Path, seconds: float, mtime: float) -> None:
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(16000)
        handle.writeframes(b"\x00\x00" * int(16000 * seconds))
    os.utime(path, (mtime, mtime))


def _snapshot(folder: Path):
    return sorted((p.name, p.stat().st_size, p.stat().st_mtime) for p in folder.iterdir())


def _fake_whisper(seen):
    """Behaves like whisper-cli: writes <wav>.json beside the file it was given."""

    def run(cmd, *a, **k):
        seen.append(list(cmd))
        wav = cmd[cmd.index("-f") + 1]
        model = cmd[cmd.index("-m") + 1]
        words = "front right tire" if "small" in model else "front tire"
        Path(wav + ".json").write_text(json.dumps(
            {"transcription": [{"offsets": {"from": 0, "to": 2000}, "text": words}]}), encoding="utf-8")
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    return run


def test_bench_prints_rtf_per_clip_and_model_and_touches_nothing(tmp_path, monkeypatch, capsys):
    clips = tmp_path / "audio"
    clips.mkdir()
    now = time.time()
    _wav(clips / "new.wav", 4.0, now - 10)
    _wav(clips / "old.wav", 2.0, now - 300)
    _wav(clips / "mid.wav", 3.0, now - 100)
    (clips / "notes.txt").write_text("not audio", encoding="utf-8")
    before = _snapshot(clips)
    seen = []
    monkeypatch.setattr("vision.officepost.subprocess.run", _fake_whisper(seen))

    rc = main(["--clips", str(clips), "--model", "ggml-base.en.bin", "--model", "ggml-small.en.bin",
               "--transcriber", "whisper-cli", "--threads", "2", "--max-clips", "2"])

    out = capsys.readouterr().out
    assert rc == 0
    assert _snapshot(clips) == before, "the clips folder must not change"
    # Oldest first, capped at --max-clips, every model over the same clips.
    run_clips = [Path(c[c.index("-f") + 1]).name for c in seen]
    assert run_clips == ["old.wav", "mid.wav", "old.wav", "mid.wav"]
    assert all(not Path(c[c.index("-f") + 1]).is_relative_to(clips) for c in seen)
    assert all(c[c.index("-t") + 1] == "2" for c in seen)
    assert all("-mc" in c for c in seen)  # the production command, not a bench-only one
    lines = [json.loads(line) for line in out.splitlines() if line.strip()]
    per_clip = [row for row in lines if row["kind"] == "clip"]
    summary = {row["model"]: row for row in lines if row["kind"] == "summary"}
    assert len(per_clip) == 4
    first = per_clip[0]
    assert first["clip"] == "old.wav" and first["audioSeconds"] == 2.0
    assert first["words"] == 2 and first["error"] is None
    assert first["sttMs"] >= 0 and first["rtf"] == round(first["sttMs"] / 1000.0 / 2.0, 3)
    assert set(summary) == {"ggml-base.en.bin", "ggml-small.en.bin"}
    assert summary["ggml-small.en.bin"]["clips"] == 2
    assert summary["ggml-small.en.bin"]["words"] == 6
    assert summary["ggml-small.en.bin"]["failures"] == 0
    assert summary["ggml-small.en.bin"]["audioSeconds"] == 5.0
    assert "rtf" in summary["ggml-base.en.bin"]


def test_a_failed_transcription_is_a_failure_not_zero_words(tmp_path, capsys):
    clips = tmp_path / "audio"
    clips.mkdir()
    _wav(clips / "a.wav", 2.0, time.time() - 60)

    def broken(path, **kwargs):
        from vision.officepost import Transcript
        return Transcript([], engine="whisper-cli", latency_ms=5, error="transcriber exited 3")

    run_bench(str(clips), ["m.bin"], transcriber="whisper-cli", transcribe_fn=broken)
    rows = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.strip()]
    clip = next(r for r in rows if r["kind"] == "clip")
    summary = next(r for r in rows if r["kind"] == "summary")
    assert clip["error"] == "transcriber exited 3" and clip["words"] is None
    assert summary["failures"] == 1 and summary["rtf"] is None


def test_no_clips_is_a_nonzero_exit(tmp_path, capsys):
    (tmp_path / "audio").mkdir()
    assert main(["--clips", str(tmp_path / "audio"), "--model", "m.bin"]) != 0
