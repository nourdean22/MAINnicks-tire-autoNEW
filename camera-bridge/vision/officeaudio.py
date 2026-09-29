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
import wave
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


def probe_level(
    source_url: str,
    seconds: float,
    *,
    binary: Optional[str] = None,
    input_format: str = "auto",
) -> tuple[Optional[float], Optional[float]]:
    """Measure a short live source without writing or retaining probe audio."""
    ff = _ffmpeg(binary)
    proc = subprocess.run(
        [
            ff,
            "-hide_banner",
            *_input_args(source_url, input_format),
            "-vn",
            "-t",
            str(max(0.5, float(seconds))),
            "-af",
            "volumedetect",
            "-f",
            "null",
            os.devnull,
        ],
        capture_output=True,
        text=True,
        timeout=max(30.0, float(seconds) + 30.0),
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"audio probe failed (rc={proc.returncode}): {(proc.stderr or '')[-300:]}"
        )
    found = {k: float(v) for k, v in _VOL_RE.findall(proc.stderr or "")}
    return (found.get("mean"), found.get("max"))


def _wav_duration(path: str) -> float:
    """Return the duration actually written to a PCM WAV.

    A finite file can end before the requested capture window. Coverage must use what
    ffmpeg really captured, never the requested ceiling, or good transcripts look gappy.
    """
    try:
        with wave.open(path, "rb") as handle:
            rate = handle.getframerate()
            frames = handle.getnframes()
    except (OSError, wave.Error) as exc:
        raise RuntimeError(f"captured WAV is unreadable: {path}") from exc
    if rate <= 0 or frames <= 0:
        raise RuntimeError(f"captured WAV has no measurable duration: {path}")
    return frames / float(rate)


def _input_args(source_url: str, input_format: str = "auto") -> List[str]:
    """Build ffmpeg input arguments without pretending every source is RTSP.

    `auto` preserves the legacy behavior for rtsp:// URLs and otherwise lets ffmpeg
    auto-detect files/URLs. Windows DirectShow capture is explicit because device names
    are not URLs and must be opened with `-f dshow`.
    """
    kind = (input_format or "auto").strip().lower()
    if kind == "auto":
        kind = "rtsp" if source_url.lower().startswith(("rtsp://", "rtsps://")) else "generic"
    if kind == "rtsp":
        return ["-rtsp_transport", "tcp", "-i", source_url]
    if kind == "dshow":
        spec = source_url if source_url.lower().startswith("audio=") else f"audio={source_url}"
        return ["-f", "dshow", "-i", spec]
    if kind == "generic":
        return ["-i", source_url]
    raise ValueError(f"unsupported input_format {input_format!r}; expected auto, rtsp, dshow, or generic")


def capture_window(
    source_url: str,
    out_dir: str,
    seconds: float,
    source: str = "eufy-office",
    binary: Optional[str] = None,
    silence_db: float = DEFAULT_SILENCE_DB,
    silence_gap_s: float = DEFAULT_SILENCE_GAP_S,
    min_segment_s: float = MIN_SEGMENT_S,
    input_format: str = "auto",
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
        [ff, "-hide_banner", *_input_args(source_url, input_format),
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

    captured_seconds = _wav_duration(raw)
    spans = _speech_spans(ff, raw, silence_db, silence_gap_s, captured_seconds)
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


@dataclass
class Calibration:
    """What the room actually sounds like, and what threshold follows from it."""
    samples: int
    levels_db: List[float] = field(default_factory=list)
    floor_db: Optional[float] = None
    loud_db: Optional[float] = None
    suggested_silence_db: Optional[float] = None
    #: Populated when the measurement CANNOT support a suggestion. A refusal with a stated
    #: reason beats a plausible number nobody can defend.
    refused: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "samples": self.samples,
            "levelsDb": [round(x, 1) for x in self.levels_db],
            "floorDb": self.floor_db,
            "loudDb": self.loud_db,
            "suggestedSilenceDb": self.suggested_silence_db,
            "refused": self.refused,
        }


def calibrate(
    source_url: str,
    out_dir: str,
    samples: int = 12,
    seconds_each: float = 10.0,
    spacing_s: float = 0.0,
    binary: Optional[str] = None,
    input_format: str = "auto",
) -> Calibration:
    """Measure the room over time, then propose a silence threshold from what was heard.

    WHY THIS EXISTS. `DEFAULT_SILENCE_DB` is a GUESS. A threshold tuned for a quiet office
    discards every conversation in a noisy one; tuned for a noisy shop it splits nothing and
    every window becomes one giant "interaction". Guessing it is how a capture service
    silently records either nothing or everything -- and both look like it is working.

    The office camera also runs AGC, which means the floor MOVES: it lifts during quiet
    stretches and ducks after transients. A single ten-second reading would capture one
    arbitrary point on that curve, so this takes many spaced samples and reads the
    DISTRIBUTION instead.

    IT REFUSES RATHER THAN GUESSING when the samples cannot support a suggestion -- too few
    usable readings, or a spread so narrow that quiet and loud are indistinguishable (which
    means nothing actually happened while it listened, and the "floor" is just the room).
    """
    ff = _ffmpeg(binary)
    os.makedirs(out_dir, exist_ok=True)
    levels: List[float] = []

    for i in range(max(1, int(samples))):
        probe = os.path.join(out_dir, f"calib-{i}.wav")
        try:
            subprocess.run(
                [ff, "-hide_banner", *_input_args(source_url, input_format),
                 "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
                 "-t", str(float(seconds_each)), "-y", probe],
                capture_output=True, text=True, timeout=float(seconds_each) + 90,
            )
            mean_db, _ = measure_level(probe, binary)
            if mean_db is not None:
                levels.append(mean_db)
        except (OSError, subprocess.SubprocessError):
            # One failed sample is not a failed calibration; a run of them will show up as
            # too few usable readings below, which is reported rather than averaged over.
            pass
        finally:
            try:
                os.remove(probe)
            except OSError:
                pass
        if spacing_s > 0 and i + 1 < samples:
            time.sleep(spacing_s)

    cal = Calibration(samples=len(levels), levels_db=sorted(levels))

    if len(levels) < 4:
        cal.refused = (f"only {len(levels)} usable readings; need at least 4 before a "
                       f"threshold means anything")
        return cal

    ordered = sorted(levels)
    # Percentiles, not mean: the mean of a bimodal room (silence and speech) lands in a gap
    # where neither state actually sits, and a threshold placed there splits on nothing.
    floor = ordered[len(ordered) // 10]                    # ~10th percentile: the quiet room
    loud = ordered[(len(ordered) * 9) // 10]               # ~90th: someone talking
    cal.floor_db, cal.loud_db = round(floor, 1), round(loud, 1)

    if (loud - floor) < 6.0:
        # Quiet and loud are within 6 dB of each other, so the recording never heard a
        # difference. Either nobody spoke, or AGC flattened the range. Either way a
        # threshold derived from this would be fiction.
        cal.refused = (f"spread is only {loud - floor:.1f} dB (floor {floor:.1f}, loud "
                       f"{loud:.1f}) -- nothing distinguishable happened while listening; "
                       f"re-run during real counter activity")
        return cal

    # Sit above the floor but well below speech. A third of the way up the measured range
    # keeps room tone out while leaving quiet talkers in -- and a MISSED conversation is a
    # worse failure here than an over-long segment, which merely costs transcription time.
    cal.suggested_silence_db = round(floor + (loud - floor) / 3.0, 1)
    return cal


def main(argv: List[str]) -> int:
    import argparse
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source-url", required=True, help="audio source spec: RTSP URL, dshow device name, file, or URL")
    ap.add_argument("--input-format", choices=("auto", "rtsp", "dshow", "generic"), default="auto")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--seconds", type=float, default=300.0)
    ap.add_argument("--source", default="eufy-office")
    ap.add_argument("--ffmpeg", default=None)
    ap.add_argument("--silence-db", type=float, default=DEFAULT_SILENCE_DB)
    ap.add_argument("--silence-gap", type=float, default=DEFAULT_SILENCE_GAP_S)
    ap.add_argument("--calibrate", action="store_true",
                    help="measure the room and PROPOSE a silence threshold instead of capturing")
    ap.add_argument("--calib-samples", type=int, default=12)
    ap.add_argument("--calib-seconds", type=float, default=10.0)
    ap.add_argument("--calib-spacing", type=float, default=0.0,
                    help="seconds between samples; spread them across real activity")
    args = ap.parse_args(argv)

    if args.calibrate:
        try:
            cal = calibrate(args.source_url, args.out_dir, samples=args.calib_samples,
                            seconds_each=args.calib_seconds, spacing_s=args.calib_spacing,
                            binary=args.ffmpeg, input_format=args.input_format)
        except FfmpegMissing as exc:
            print(json.dumps({"error": "ffmpeg_missing", "detail": str(exc)}))
            return 3
        print(json.dumps(cal.to_dict(), indent=2))
        # A REFUSED calibration must not exit 0. "I could not tell" and "here is your
        # threshold" are opposite outcomes, and a caller scripting this would otherwise
        # write a fiction into its config.
        return 0 if cal.suggested_silence_db is not None else 5

    try:
        segs = capture_window(
            args.source_url, args.out_dir, args.seconds, source=args.source,
            binary=args.ffmpeg, silence_db=args.silence_db, silence_gap_s=args.silence_gap,
            input_format=args.input_format,
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
