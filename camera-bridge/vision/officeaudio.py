"""Office audio capture: turn a continuous stream into discrete INTERACTIONS.

WHAT THIS IS FOR. The office Eufy camera at 192.168.0.167 was measured 2026-09-22 to carry a
real audio track -- `aac`, 16 kHz, mono, alongside 1080p15 video. That makes capturing counter
conversations possible. This turns that stream into bounded episodes a transcriber can chew.

WHY NOT ONE LONG RECORDING. A ten-hour file is unusable in every direction: it cannot be
transcribed in one call, it cannot be reviewed, its retention cannot be reasoned about, and it
buries four real conversations in eight hours of compressor noise. An INTERACTION is the unit
anyone actually wants -- "what was said at the counter between 14:13 and 14:18" -- so the
capture produces those and nothing else.

SOURCE-AGNOSTIC ON PURPOSE. `source_url` may be the camera's RTSP stream or a local capture
device. The camera's mic is a single element in a housing across a room, and whether it is
intelligible at the counter is an OPEN QUESTION that only a real recording settles. If the
answer is no, the fix is a dedicated counter microphone -- a different `source_url` and
`source` label, and nothing else here changes.

THE MEASUREMENT THAT MUST TRAVEL WITH EVERY CLIP. `mean_volume_db` is recorded per segment,
because a bad transcript has two very different causes -- a mic too far from the speaker, or a
model that failed -- and they call for opposite fixes. Without the level, every bad transcript
looks like the same problem. This is the same empty-vs-error discipline the camera lanes use:
a failed read must never render as a confident result.

WHAT THIS DELIBERATELY DOES NOT DO. It does not transcribe, summarise, identify speakers, or
decide who was talking. It produces bounded audio segments with their measured level, and
stops. `transcribeAudio()` in apps/statenour/lib/ai/stt.ts already owns transcription and is
production-proven; duplicating it here would create a second lane to keep in step.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import time
import uuid
from dataclasses import dataclass, field
from typing import List, Optional

#: Silence below this (dBFS) is treated as "nobody is talking". -35 is deliberately
#: permissive: a distant mic in a room with HVAC sits well above a studio noise floor, and a
#: gate tuned for a close mic would discard every real conversation as silence.
DEFAULT_SILENCE_DB = -35.0

#: How long the room must stay quiet before an interaction is considered OVER. Shorter than
#: this and a normal pause mid-sentence splits one conversation into three episodes; much
#: longer and two separate customers merge into one. Two seconds is a pause; ten is a gap.
DEFAULT_SILENCE_GAP_S = 3.0

#: Hard ceiling per segment. A conversation that genuinely runs longer is split rather than
#: dropped -- an unbounded segment is how a capture service quietly fills a disk.
DEFAULT_MAX_SEGMENT_S = 600.0

#: Segments shorter than this are discarded as door slams, phone rings, coughs. A one-second
#: "interaction" is noise with a timestamp.
MIN_SEGMENT_S = 4.0


@dataclass
class AudioSegment:
    """One bounded interaction, plus the measurements that explain its quality."""
    episode_id: str
    source: str
    path: str
    started_at: float
    duration_s: float
    mean_volume_db: Optional[float] = None
    max_volume_db: Optional[float] = None
    #: Reported, never inferred: a segment whose level could not be measured is NOT the same
    #: as a silent one, and a downstream reader must be able to tell them apart.
    measured: bool = False

    def to_dict(self) -> dict:
        return {
            "episodeId": self.episode_id,
            "source": self.source,
            "audioRef": self.path,
            "startedAt": self.started_at,
            "durationSeconds": round(self.duration_s, 2),
            "meanVolumeDb": self.mean_volume_db,
            "maxVolumeDb": self.max_volume_db,
            "measured": self.measured,
        }


class FfmpegMissing(RuntimeError):
    """ffmpeg is not on this machine. Named so a caller can report it instead of guessing."""


def _ffmpeg(binary: Optional[str] = None) -> str:
    """Resolve ffmpeg, preferring an explicit path over PATH.

    Raises rather than returning a bare "ffmpeg" that will fail later with a confusing
    FileNotFoundError deep inside a subprocess call. On the shop PC winget installs it to a
    long versioned path that is on PATH only in shells started AFTER the install.
    """
    cand = binary or os.environ.get("FFMPEG_BIN") or "ffmpeg"
    try:
        subprocess.run([cand, "-version"], capture_output=True, timeout=15, check=True)
        return cand
    except (OSError, subprocess.SubprocessError) as exc:
        raise FfmpegMissing(
            f"ffmpeg not runnable as {cand!r}. Install it (winget install Gyan.FFmpeg) or "
            f"set FFMPEG_BIN to its full path."
        ) from exc


_VOL_RE = re.compile(r"(mean|max)_volume:\s*(-?\d+(?:\.\d+)?) dB")


def measure_level(path: str, binary: Optional[str] = None) -> tuple[Optional[float], Optional[float]]:
    """(mean_dB, max_dB) for a file, or (None, None) if it could not be measured.

    NONE IS NOT ZERO. A file ffmpeg refused to read and a file of pure digital silence are
    different findings; returning 0.0 for the first would claim a measurement that never
    happened, and every caller downstream would believe it.
    """
    try:
        out = subprocess.run(
            [_ffmpeg(binary), "-hide_banner", "-i", path, "-af", "volumedetect",
             "-f", "null", os.devnull],
            capture_output=True, text=True, timeout=120,
        ).stderr or ""
    except (OSError, subprocess.SubprocessError, FfmpegMissing):
        return (None, None)
    found = {k: float(v) for k, v in _VOL_RE.findall(out)}
    return (found.get("mean"), found.get("max"))


def capture_window(
    source_url: str,
    out_dir: str,
    seconds: float,
    source: str = "eufy-office",
    binary: Optional[str] = None,
    silence_db: float = DEFAULT_SILENCE_DB,
    silence_gap_s: float = DEFAULT_SILENCE_GAP_S,
    min_segment_s: float = MIN_SEGMENT_S,
) -> List[AudioSegment]:
    """Record `seconds` of audio, split it on silence, return the speech segments.

    Records first and splits after, rather than streaming a detector live. The reason is
    recoverable failure: if segmentation is wrong -- and the silence threshold is a guess
    until real room noise is measured -- the raw window is still on disk and can be re-split
    with different settings. A live detector that mis-gates has thrown the audio away.
    """
    os.makedirs(out_dir, exist_ok=True)
    ff = _ffmpeg(binary)
    stamp = int(time.time())
    raw = os.path.join(out_dir, f"raw-{stamp}.wav")

    # 16 kHz mono PCM: matches what the camera already provides, and what whisper-family
    # models expect. Resampling a 16 kHz source upward would invent detail it does not have.
    proc = subprocess.run(
        [ff, "-hide_banner", "-rtsp_transport", "tcp", "-i", source_url,
         "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
         "-t", str(float(seconds)), "-y", raw],
        capture_output=True, text=True, timeout=float(seconds) + 120,
    )
    if proc.returncode != 0 or not os.path.exists(raw) or os.path.getsize(raw) < 1024:
        # A 44-byte wav is a valid container with no audio in it, and it looks like success
        # to anything that only checks the exit code.
        raise RuntimeError(
            f"capture produced no audio (rc={proc.returncode}): "
            f"{(proc.stderr or '').strip()[-400:]}"
        )

    spans = _speech_spans(ff, raw, silence_db, silence_gap_s, float(seconds))
    segments: List[AudioSegment] = []
    for start, end in spans:
        dur = end - start
        if dur < min_segment_s:
            continue                      # door slam, phone ring, cough
        eid = f"{source}-{stamp}-{uuid.uuid4().hex[:8]}"
        clip = os.path.join(out_dir, f"{eid}.wav")
        cut = subprocess.run(
            [ff, "-hide_banner", "-i", raw, "-ss", f"{start:.2f}", "-t", f"{dur:.2f}",
             "-acodec", "pcm_s16le", "-y", clip],
            capture_output=True, text=True, timeout=180,
        )
        if cut.returncode != 0 or not os.path.exists(clip):
            continue
        mean_db, max_db = measure_level(clip, binary)
        segments.append(AudioSegment(
            episode_id=eid, source=source, path=clip,
            started_at=stamp + start, duration_s=dur,
            mean_volume_db=mean_db, max_volume_db=max_db,
            measured=mean_db is not None,
        ))
    return segments


def _speech_spans(ff: str, path: str, silence_db: float, gap_s: float,
                  total_s: float) -> List[tuple]:
    """Invert ffmpeg's silencedetect output into (start, end) spans of NON-silence.

    silencedetect reports the QUIET parts; everything between them is someone talking. The
    inversion is done here rather than trusted from a second tool so there is one definition
    of "an interaction" in this file.
    """
    out = subprocess.run(
        [ff, "-hide_banner", "-i", path,
         "-af", f"silencedetect=noise={silence_db}dB:d={gap_s}", "-f", "null", os.devnull],
        capture_output=True, text=True, timeout=300,
    ).stderr or ""

    starts = [float(m) for m in re.findall(r"silence_start:\s*(-?\d+(?:\.\d+)?)", out)]
    ends = [float(m) for m in re.findall(r"silence_end:\s*(-?\d+(?:\.\d+)?)", out)]

    # No silence detected at all means the WHOLE window is speech (or the threshold is wrong
    # for this room -- which the recorded level will reveal, rather than being swallowed).
    if not starts:
        return [(0.0, total_s)]

    spans: List[tuple] = []
    cursor = 0.0
    for i, s in enumerate(starts):
        if s > cursor:
            spans.append((cursor, s))
        cursor = ends[i] if i < len(ends) else total_s
    if cursor < total_s:
        spans.append((cursor, total_s))
    return [(a, b) for a, b in spans if b > a]


def main(argv: List[str]) -> int:
    import argparse
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source-url", required=True, help="RTSP URL or capture device")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--seconds", type=float, default=300.0)
    ap.add_argument("--source", default="eufy-office")
    ap.add_argument("--ffmpeg", default=None)
    ap.add_argument("--silence-db", type=float, default=DEFAULT_SILENCE_DB)
    ap.add_argument("--silence-gap", type=float, default=DEFAULT_SILENCE_GAP_S)
    args = ap.parse_args(argv)

    try:
        segs = capture_window(
            args.source_url, args.out_dir, args.seconds, source=args.source,
            binary=args.ffmpeg, silence_db=args.silence_db, silence_gap_s=args.silence_gap,
        )
    except FfmpegMissing as exc:
        print(json.dumps({"error": "ffmpeg_missing", "detail": str(exc)}))
        return 3
    except Exception as exc:                                    # noqa: BLE001
        print(json.dumps({"error": "capture_failed", "detail": str(exc)[:500]}))
        return 2

    print(json.dumps({"segments": [s.to_dict() for s in segs]}, indent=2))
    # ZERO SEGMENTS IS NOT SUCCESS. A quiet office and a broken silence threshold produce the
    # same empty list, so the exit code has to distinguish "ran and found nothing" from
    # "ran and found interactions" -- otherwise a mis-tuned gate reads as a calm morning.
    return 0 if segs else 4


if __name__ == "__main__":
    raise SystemExit(main(__import__("sys").argv[1:]))
