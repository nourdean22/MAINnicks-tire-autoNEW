"""Transcribe captured office segments and POST them to the shop.

`officeaudio.py` deliberately stops at bounded audio segments -- it does not transcribe. This
module is the other half: it takes those segments, runs a LOCAL whisper-family transcriber on
each, and posts the result to `POST /api/conversation-episodes` on nickstire.org.

WHY LOCAL TRANSCRIPTION. The office camera is on the shop LAN and nothing outside it can reach
192.168.0.167. Uploading raw audio to the shop server was rejected: the route stores a POINTER
(`audioRef`), never audio, so the recording stays on the shop PC where it was made.

THE MEASUREMENT THAT SHAPES THIS FILE. A 90-second office sample transcribed on the shop PC on
2026-09-22 produced text for 37.4s of 90s. The 50s that came back empty carried NORMAL
conversational energy (-16.7 to -31.2 dB against -21 to -36 dB for the windows that DID
transcribe), so loudness predicts nothing here, and the 44% that returned was semantically
incoherent. The server refuses to extract facts below 65% coverage -- which only works if the
coverage number this module computes is HONEST. Hence `covered_seconds()` below, and its test.

TWO FAILURES THIS MODULE REFUSES TO BLUR:
  * A transcriber that CRASHED posts `transcriptError`, never a silent empty list. An empty list
    with no error means the room was genuinely quiet, and the server stores those differently.
  * Coverage is the UNION of transcript spans, not their sum. Whisper emits overlapping segments
    routinely; summing them can exceed the clip length and would wave a gappy transcript straight
    through the gate that exists to catch it.
"""
from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass
from typing import List, Optional, Sequence

#: Default endpoint. The shop server owns the table; this module only feeds it.
DEFAULT_ENDPOINT = "https://nickstire.org/api/conversation-episodes"

#: Env var holding the shared ingest secret. Same one the visit producer uses, and the same one
#: the route checks -- a mismatch here is a 401, never a silent drop.
KEY_ENV = "CAMERA_INGEST_KEY"


class TranscriberMissing(RuntimeError):
    """The transcriber binary is absent. Named so the caller reports it instead of posting silence."""


@dataclass
class Transcript:
    """What a transcriber returned for ONE segment, plus whether it ran at all."""
    segments: List[dict]
    engine: Optional[str] = None
    latency_ms: Optional[int] = None
    #: Populated ONLY when transcription could not run or produce output. An empty `segments`
    #: list with `error is None` is a real finding: the clip had no speech in it.
    error: Optional[str] = None
    model: Optional[str] = None


def covered_seconds(segments: Sequence[dict], total: Optional[float] = None) -> float:
    """Seconds of audio that produced text, counting OVERLAPS ONCE.

    Whisper-family models routinely emit segments that overlap by a fraction of a second, and
    occasionally a hallucinated segment running past the end of the clip. Summing durations
    would inflate coverage above the real figure -- and coverage is the only signal that caught
    the incoherent-transcript failure, so inflating it defeats the gate.

    `total` clamps the result to the clip length when it is known.
    """
    spans = []
    for s in segments:
        try:
            a, b = float(s.get("start", 0.0)), float(s.get("end", 0.0))
        except (TypeError, ValueError):
            continue
        if b > a:
            spans.append((a, b))
    if not spans:
        return 0.0
    spans.sort()
    merged = [list(spans[0])]
    for a, b in spans[1:]:
        if a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    covered = sum(b - a for a, b in merged)
    if total is not None and total > 0:
        covered = min(covered, total)
    return round(covered, 2)


def transcribe(path: str, binary: str = "whisper-cli", model: Optional[str] = None,
               timeout_s: float = 600.0) -> Transcript:
    """Run the local transcriber over one wav and return its timed segments.

    The contract is the one thing that matters: a transcriber that did not run returns a
    Transcript with `error` SET and no segments -- never an empty success.
    """
    import time

    # "-mc 0": no text context carried between decode windows. With context on, the small
    # models feed their own last line back in and loop on noise -- measured 2026-10-03, one
    # short question emitted four times across a 19s office clip. The server also refuses a
    # looped transcript (conversationFacts.isTranscriberLoop); this stops it at the source.
    cmd = [binary, "-f", path, "--output-json", "--no-prints", "-mc", "0"]
    if model:
        cmd[1:1] = ["-m", model]
    engine_name = os.path.basename(binary) or binary
    model_name = os.path.basename(model) if model else None
    started = time.time()
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_s)
    except FileNotFoundError as exc:
        raise TranscriberMissing(
            f"transcriber {binary!r} not found; set --transcriber to its path"
        ) from exc
    except subprocess.TimeoutExpired:
        return Transcript([], engine=engine_name, model=model_name, latency_ms=int((time.time() - started) * 1000),
                          error=f"transcriber timed out after {timeout_s:.0f}s")
    latency = int((time.time() - started) * 1000)

    if proc.returncode != 0:
        return Transcript([], engine=engine_name, model=model_name, latency_ms=latency,
                          error=f"transcriber exited {proc.returncode}: {(proc.stderr or '')[:300]}")

    # whisper-cli writes <path>.json beside the wav; fall back to stdout for other builds.
    raw = None
    side = path + ".json"
    if os.path.exists(side):
        try:
            raw = json.load(open(side, encoding="utf-8"))
        except (OSError, ValueError) as exc:
            return Transcript([], engine=engine_name, model=model_name, latency_ms=latency,
                              error=f"transcript json unreadable: {exc}"[:300])
    elif proc.stdout.strip():
        try:
            raw = json.loads(proc.stdout)
        except ValueError as exc:
            return Transcript([], engine=engine_name, model=model_name, latency_ms=latency,
                              error=f"transcriber stdout was not json: {exc}"[:300])
    if raw is None:
        # Exited clean and wrote nothing. That is a BROKEN run, not a quiet room: a working
        # transcriber emits a json envelope with an empty segment list for silence.
        return Transcript([], engine=engine_name, model=model_name, latency_ms=latency,
                          error="transcriber produced no output file and no stdout")

    out: List[dict] = []
    for i, seg in enumerate(_iter_segments(raw)):
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        out.append({"index": i, "start": _secs(seg, "start"), "end": _secs(seg, "end"), "text": text})
    return Transcript(out, engine=engine_name, model=model_name, latency_ms=latency, error=None)


def _iter_segments(raw) -> List[dict]:
    """Both shapes seen in the wild: {"transcription": [...]} and {"segments": [...]}."""
    if isinstance(raw, dict):
        for key in ("transcription", "segments"):
            val = raw.get(key)
            if isinstance(val, list):
                return val
    return raw if isinstance(raw, list) else []


def _secs(seg: dict, which: str) -> float:
    """Seconds, from either a float field or whisper-cli's {"offsets": {"from": ms}}."""
    if which in seg:
        try:
            return round(float(seg[which]), 3)
        except (TypeError, ValueError):
            pass
    offs = seg.get("offsets") or {}
    key = "from" if which == "start" else "to"
    try:
        return round(float(offs.get(key, 0)) / 1000.0, 3)
    except (TypeError, ValueError):
        return 0.0


def post_episode(payload: dict, endpoint: str = DEFAULT_ENDPOINT, key: Optional[str] = None,
                 timeout: float = 30.0) -> dict:
    """POST one episode. Returns the server's reply, or a dict carrying the transport error."""
    import urllib.error
    import urllib.request

    key = key or os.environ.get(KEY_ENV, "")
    if not key:
        # Fail LOUD. Posting without the header is a guaranteed 401, and a loop that swallowed
        # it would look like a working producer whose episodes simply never appear.
        return {"error": f"{KEY_ENV} is not set; the route will 401", "posted": False}

    req = urllib.request.Request(endpoint, data=json.dumps(payload).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("x-sync-key", key)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", "replace")
            return {"posted": True, "status": resp.status, "reply": _maybe_json(body)}
    except urllib.error.HTTPError as exc:
        return {"posted": False, "status": exc.code,
                "error": exc.read().decode("utf-8", "replace")[:300]}
    except (urllib.error.URLError, OSError) as exc:
        return {"posted": False, "error": str(exc)[:300]}


def _maybe_json(body: str):
    try:
        return json.loads(body)
    except ValueError:
        return body[:300]


def build_payload(
    seg,
    transcript: Transcript,
    *,
    camera_serial: Optional[str] = None,
    capture_host: Optional[str] = None,
    trigger_type: Optional[str] = None,
    triggered_at: Optional[float] = None,
) -> dict:
    """Assemble what the route requires, with coverage computed over the UNION of spans.

    `seg` is an officeaudio.AudioSegment. `totalSeconds` is the clip length and
    `coveredSeconds` the part that produced text; the route REQUIRES both, because without
    them the server's coverage gate silently turns off.
    """
    total = round(float(seg.duration_s), 2)
    return {
        "episodeId": seg.episode_id,
        "source": seg.source,
        "cameraSerial": camera_serial,
        "captureHost": capture_host,
        "triggerType": trigger_type,
        "triggeredAt": triggered_at,
        "startedAt": seg.started_at,
        "durationSeconds": total,
        "audioRef": seg.path,
        # None, not 0.0, when the level could not be measured -- 0.0 dBFS is FULL SCALE.
        "meanVolumeDb": seg.mean_volume_db if seg.measured else None,
        "segments": transcript.segments,
        "sttEngine": transcript.engine,
        "sttModel": transcript.model,
        "sttLatencyMs": transcript.latency_ms,
        "transcriptError": transcript.error,
        "coveredSeconds": covered_seconds(transcript.segments, total),
        "totalSeconds": total,
    }


def main(argv: List[str]) -> int:
    import argparse

    from officeaudio import FfmpegMissing, capture_window

    ap = argparse.ArgumentParser(description="capture -> transcribe -> post one office window")
    ap.add_argument("--source-url", required=True)
    ap.add_argument("--input-format", choices=("auto", "rtsp", "dshow", "generic"), default="auto")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--seconds", type=float, default=300.0)
    ap.add_argument("--source", default="eufy-office")
    ap.add_argument("--silence-db", type=float, default=None)
    ap.add_argument("--transcriber", default="whisper-cli")
    ap.add_argument("--model", default=None)
    ap.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    ap.add_argument("--dry-run", action="store_true",
                    help="transcribe and print the payloads WITHOUT posting")
    args = ap.parse_args(argv)

    kw = {}
    if args.silence_db is not None:
        kw["silence_db"] = args.silence_db
    try:
        segs = capture_window(
            args.source_url,
            args.out_dir,
            args.seconds,
            source=args.source,
            input_format=args.input_format,
            **kw,
        )
    except FfmpegMissing as exc:
        print(json.dumps({"error": "ffmpeg_missing", "detail": str(exc)}))
        return 3
    except Exception as exc:                                     # noqa: BLE001
        print(json.dumps({"error": "capture_failed", "detail": str(exc)[:500]}))
        return 2

    results = []
    for seg in segs:
        try:
            tr = transcribe(seg.path, binary=args.transcriber, model=args.model)
        except TranscriberMissing as exc:
            print(json.dumps({"error": "transcriber_missing", "detail": str(exc)}))
            return 6
        payload = build_payload(seg, tr)
        results.append(payload if args.dry_run else
                       {**post_episode(payload, endpoint=args.endpoint),
                        "episodeId": payload["episodeId"],
                        "coverage": round(payload["coveredSeconds"] / payload["totalSeconds"], 3)
                        if payload["totalSeconds"] else None})
    print(json.dumps({"episodes": results}, indent=2))

    # ZERO SEGMENTS IS NOT SUCCESS -- same rule officeaudio's main follows. A quiet office and a
    # mis-tuned silence threshold produce the same empty list.
    if not segs:
        return 4
    # A post that failed must not exit 0 either; a cron wrapper reads this.
    if not args.dry_run and any(not r.get("posted") for r in results):
        return 7
    return 0


if __name__ == "__main__":
    raise SystemExit(main(__import__("sys").argv[1:]))
