"""Bench whisper models on recorded office clips: does a stronger model fit the shop PC?

    python -m vision.officebench --clips <audio dir> --model <ggml-base.en.bin> --model <ggml-small.en.bin>
        [--transcriber whisper-cli.exe] [--threads 2] [--max-clips 10]

Runs the production transcriber (officepost.transcribe, same flags, "-mc 0" included) over the
oldest --max-clips *.wav files in --clips with each model, and prints one JSON line per clip and
one summary line per model: seconds of audio, STT ms, real-time factor (STT seconds / audio
seconds; under 1.0 is faster than real time) and word count.

It never posts and never changes the clips folder: each clip is copied to a temporary directory
first, because whisper-cli writes `<clip>.json` beside the file it reads, and the clips folder is
the live capture directory. The copy and its json are removed after each run.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import wave
from typing import Any, Callable, List, Optional

from . import officepost

_WORD = re.compile(r"\w+(?:['\u2019]\w+)*")


def _audio_seconds(path: str) -> Optional[float]:
    try:
        with wave.open(path, "rb") as handle:
            rate, frames = handle.getframerate(), handle.getnframes()
    except (OSError, wave.Error, EOFError):
        return None
    return round(frames / float(rate), 3) if rate > 0 else None


def _clips(folder: str, max_clips: int) -> List[str]:
    paths = [os.path.join(folder, name) for name in os.listdir(folder) if name.lower().endswith(".wav")]
    paths.sort(key=lambda p: (os.path.getmtime(p), os.path.basename(p)))  # oldest first
    return paths[: max(0, int(max_clips))]


def _emit(row: dict[str, Any], out) -> None:
    out.write(json.dumps(row, sort_keys=True) + "\n")
    out.flush()


def run_bench(
    clips_dir: str,
    models: List[str],
    *,
    transcriber: str = "whisper-cli",
    threads: Optional[int] = None,
    max_clips: int = 10,
    transcribe_fn: Optional[Callable[..., Any]] = None,
    out=None,
) -> int:
    """Bench every model over the same clips. Returns the number of clips benched."""
    out = out or sys.stdout
    transcribe_fn = transcribe_fn or officepost.transcribe
    clips = _clips(clips_dir, max_clips)
    kwargs: dict[str, Any] = {"binary": transcriber}
    if threads:
        kwargs["threads"] = int(threads)
    with tempfile.TemporaryDirectory(prefix="officebench-") as scratch:
        for model in models:
            total_audio = total_ms = words_total = failures = done = 0
            for clip in clips:
                name = os.path.basename(clip)
                seconds = _audio_seconds(clip)
                copy = os.path.join(scratch, name)
                shutil.copy2(clip, copy)
                try:
                    transcript = transcribe_fn(copy, model=model, **kwargs)
                    error = transcript.error
                except Exception as exc:  # noqa: BLE001
                    transcript, error = None, f"{type(exc).__name__}: {exc}"[:300]
                finally:
                    for leftover in (copy, copy + ".json"):
                        try:
                            os.remove(leftover)
                        except OSError:
                            pass
                ms = transcript.latency_ms if transcript is not None else None
                words = None
                if error is None and transcript is not None:
                    words = sum(len(_WORD.findall(str(seg.get("text") or ""))) for seg in transcript.segments)
                rtf = round(ms / 1000.0 / seconds, 3) if (ms is not None and seconds) else None
                _emit({"kind": "clip", "model": os.path.basename(model), "clip": name,
                       "audioSeconds": seconds, "sttMs": ms, "rtf": rtf, "words": words, "error": error}, out)
                # A failed run is a failure, never a fast clip with zero words.
                if error is not None or rtf is None:
                    failures += 1
                    continue
                done += 1
                total_audio += seconds
                total_ms += ms
                words_total += words
            _emit({"kind": "summary", "model": os.path.basename(model), "clips": done,
                   "failures": failures, "audioSeconds": round(total_audio, 3), "sttMs": total_ms,
                   "rtf": round(total_ms / 1000.0 / total_audio, 3) if total_audio else None,
                   "words": words_total, "threads": kwargs.get("threads")}, out)
    return len(clips)


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="bench whisper models on recorded office clips")
    ap.add_argument("--clips", required=True, help="folder of .wav clips (read only)")
    ap.add_argument("--model", action="append", required=True, help="ggml model path; repeat per model")
    ap.add_argument("--transcriber", default=os.environ.get("OFFICE_TRANSCRIBER", "whisper-cli"))
    ap.add_argument("--threads", type=int, default=None)
    ap.add_argument("--max-clips", type=int, default=10)
    args = ap.parse_args(argv)
    # A missing transcriber shows up as an error on every clip row, not as a crash.
    benched = run_bench(args.clips, args.model, transcriber=args.transcriber,
                        threads=args.threads, max_clips=args.max_clips)
    # Zero clips measured nothing; that is not a result.
    return 0 if benched else 4


if __name__ == "__main__":
    raise SystemExit(main())
