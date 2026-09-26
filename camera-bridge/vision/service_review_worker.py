"""Offline shadow analysis for NO_BAY_ACTIVITY_REVIEW hard-case clips.

This module is deliberately OUT of the live frame loop. It consumes clips already saved by
HardCaseRecorder, asks an auxiliary open-vocabulary detector for person/mechanical cues, and
feeds those observations into OutsideServiceShadow. The only durable output is shadow-only
review evidence; it cannot mutate visits, bays, or shop state.

The first concrete analyzer uses Hugging Face Transformers + Grounding DINO Tiny. Heavy model
dependencies are imported lazily so the camera runtime and its tests do not acquire a GPU/ML
dependency just because this file exists.
"""
from __future__ import annotations

import argparse
import json
import os
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Optional, Protocol, Sequence

import numpy as np

from .service_shadow import OutsideServiceShadow, ServiceCue, ServiceEvidenceLedger


SERVICE_REVIEW_SCHEMA = "v1"
MODEL_ID = "IDEA-Research/grounding-dino-tiny"
# Pin the model repository revision used for the initial shadow lane. Model upgrades should
# create a new measurement cohort rather than silently changing what an old score meant.
MODEL_REVISION = "a2bb814dd30d776dcf7e30523b00659f4f141c71"

PROMPTS = (
    "person",
    "mechanic",
    "technician",
    "floor jack",
    "car jack",
    "tire",
    "wheel",
    "impact wrench",
    "impact gun",
    "hand tool",
    "open hood",
    "person crouched by wheel",
)

_LABEL_ALIASES = {
    "person": "person",
    "mechanic": "mechanic",
    "technician": "technician",
    "floor jack": "floor_jack",
    "car jack": "floor_jack",
    "jack": "jack",
    "tire": "tire",
    "wheel": "wheel",
    "impact wrench": "impact_wrench",
    "impact gun": "impact_gun",
    "hand tool": "hand_tool",
    "tool": "tool",
    "open hood": "hood_open",
    "hood open": "hood_open",
    "person crouched by wheel": "crouched_at_wheel",
    "mechanic at wheel": "mechanic_at_wheel",
}


@dataclass(frozen=True)
class ReviewFrame:
    at: float
    source: str | np.ndarray
    source_kind: str
    label: str
    track: Optional[dict]


class CueAnalyzer(Protocol):
    name: str

    def detect(self, image: str | np.ndarray) -> Sequence[ServiceCue]:
        ...


class GroundingDinoAnalyzer:
    """Grounding-DINO adapter kept intentionally optional and shadow-only."""

    def __init__(
        self,
        *,
        model_id: str = MODEL_ID,
        revision: str = MODEL_REVISION,
        threshold: float = 0.30,
        text_threshold: float = 0.25,
        device: Optional[str] = None,
    ) -> None:
        try:
            import torch
            from PIL import Image
            from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor
        except ImportError as exc:
            raise RuntimeError(
                "service review needs optional ML deps; install torch for this machine plus "
                "transformers>=4.57 and Pillow in a separate review-worker environment"
            ) from exc

        self._torch = torch
        self._Image = Image
        self.model_id = model_id
        self.revision = revision
        self.threshold = float(threshold)
        self.text_threshold = float(text_threshold)
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.name = (
            f"grounding-dino-service-{SERVICE_REVIEW_SCHEMA}:{model_id}@{revision}"
            f":box={self.threshold:.3f}:text={self.text_threshold:.3f}"
        )

        self.processor = AutoProcessor.from_pretrained(model_id, revision=revision)
        self.model = AutoModelForZeroShotObjectDetection.from_pretrained(
            model_id,
            revision=revision,
            # Fail closed onto the non-pickle artifact. The pinned repository revision
            # contains model.safetensors; do not silently fall back to pytorch_model.bin.
            use_safetensors=True,
        ).to(self.device)
        self.model.eval()

    @staticmethod
    def _canonical_label(raw: object) -> Optional[str]:
        text = str(raw).strip().lower().replace("_", " ").replace("-", " ")
        text = " ".join(text.split())
        if text in _LABEL_ALIASES:
            return _LABEL_ALIASES[text]
        # Grounding outputs can include the article/prompt wording around a useful noun.
        for phrase in sorted(_LABEL_ALIASES, key=len, reverse=True):
            if phrase in text:
                return _LABEL_ALIASES[phrase]
        return None

    def detect(self, image_source: str | np.ndarray) -> Sequence[ServiceCue]:
        if isinstance(image_source, str):
            image = self._Image.open(image_source).convert("RGB")
        else:
            frame = np.asarray(image_source)
            if frame.ndim != 3 or frame.shape[2] < 3:
                raise ValueError("episode frame is not a 3-channel image")
            # vision.episode.read_frames returns OpenCV BGR. Grounding-DINO consumes RGB.
            rgb = np.ascontiguousarray(frame[:, :, :3][:, :, ::-1])
            image = self._Image.fromarray(rgb).convert("RGB")
        labels = [list(PROMPTS)]
        inputs = self.processor(images=image, text=labels, return_tensors="pt")
        moved = {}
        for key, value in inputs.items():
            moved[key] = value.to(self.device) if hasattr(value, "to") else value

        with self._torch.inference_mode():
            outputs = self.model(**moved)

        kwargs = {
            "threshold": self.threshold,
            "text_threshold": self.text_threshold,
            "target_sizes": [(image.height, image.width)],
        }
        try:
            result = self.processor.post_process_grounded_object_detection(
                outputs,
                moved.get("input_ids"),
                text_labels=labels,
                **kwargs,
            )[0]
        except TypeError:
            # Transformers has carried both signatures; support the pinned model across
            # currently-supported 4.x builds without turning a library signature into data.
            result = self.processor.post_process_grounded_object_detection(
                outputs,
                moved.get("input_ids"),
                **kwargs,
            )[0]

        raw_labels = result.get("text_labels")
        if raw_labels is None:
            raw_labels = result.get("labels", [])
        cues: list[ServiceCue] = []
        for raw_label, raw_score, raw_box in zip(
            raw_labels, result.get("scores", []), result.get("boxes", [])
        ):
            # Older processors may return numeric prompt indices instead of text.
            if hasattr(raw_label, "item"):
                raw_label = raw_label.item()
            if isinstance(raw_label, int) and 0 <= raw_label < len(PROMPTS):
                raw_label = PROMPTS[raw_label]
            label = self._canonical_label(raw_label)
            if label is None:
                continue
            score = float(raw_score.item() if hasattr(raw_score, "item") else raw_score)
            box_values = raw_box.tolist() if hasattr(raw_box, "tolist") else list(raw_box)
            if len(box_values) != 4:
                continue
            cues.append(
                ServiceCue(
                    label=label,
                    score=score,
                    box=tuple(float(v) for v in box_values),
                    source=self.name,
                )
            )
        return cues


@dataclass
class ReviewResult:
    case_dir: str
    status: str
    reason: str
    state: Optional[str] = None
    frames_analyzed: int = 0
    candidate_written: bool = False
    evidence_support: Optional[float] = None
    analyzer: Optional[str] = None


def _write_result(case_dir: Path, result: ReviewResult, *, extra: Optional[dict] = None) -> None:
    payload = {
        **asdict(result),
        "authority": "shadow_only",
        "supportIsCalibratedProbability": False,
        "processedAt": time.time(),
    }
    if extra:
        payload.update(extra)
    tmp = case_dir / "service-review.json.tmp"
    final = case_dir / "service-review.json"
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(tmp, final)


def _load_case(case_dir: Path) -> tuple[dict, list[ReviewFrame]]:
    case_path = case_dir / "case.json"
    if not case_path.is_file():
        raise ValueError("missing case.json")
    meta = json.loads(case_path.read_text(encoding="utf-8"))
    if meta.get("reason") != "NO_BAY_ACTIVITY_REVIEW":
        raise ValueError("not a NO_BAY_ACTIVITY_REVIEW case")

    context = meta.get("context") or {}
    box = context.get("vehicleBox")
    if not isinstance(box, list) or len(box) != 4:
        raise ValueError("case lacks vehicleBox provenance")
    try:
        [float(v) for v in box]
        int(context["trackId"])
        float(context["stationarySeconds"])
        trigger_at = float(meta["at"])
        expected_frames = int(meta["frames"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("case lacks valid track/timing provenance") from exc

    raw_timestamps = meta.get("frameTimestamps")
    if not isinstance(raw_timestamps, list) or len(raw_timestamps) != expected_frames:
        raise ValueError("case lacks exact frameTimestamps provenance")
    try:
        timestamps = [float(ts) for ts in raw_timestamps]
    except (TypeError, ValueError) as exc:
        raise ValueError("case contains invalid frame timestamp") from exc
    if timestamps != sorted(timestamps):
        raise ValueError("case frameTimestamps are not monotonic")

    raw_observations = meta.get("serviceTrackObservations")
    if not isinstance(raw_observations, list) or len(raw_observations) != len(timestamps):
        raise ValueError("case lacks per-frame canonical serviceTrackObservations provenance")
    target_id = int(context["trackId"])
    track_rows: list[Optional[dict]] = []
    for index, (expected, row) in enumerate(zip(timestamps, raw_observations)):
        if not isinstance(row, dict):
            raise ValueError(f"invalid serviceTrackObservations row {index}")
        try:
            observed_at = float(row["at"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"invalid serviceTrackObservations timestamp at row {index}") from exc
        if abs(observed_at - expected) > 0.001:
            raise ValueError(f"service track timestamp mismatch at row {index}")
        track = row.get("track")
        if track is None:
            track_rows.append(None)
            continue
        if not isinstance(track, dict):
            raise ValueError(f"invalid service track snapshot at row {index}")
        try:
            if int(track["trackId"]) != target_id:
                raise ValueError(f"service track id mismatch at row {index}")
            box_values = [float(v) for v in track["box"]]
            if len(box_values) != 4:
                raise ValueError
            stationary = float(track["stationarySeconds"])
            misses = int(track["misses"])
            zones = track["zones"]
            evidence = str(track["evidence"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"invalid service track snapshot at row {index}") from exc
        if not isinstance(zones, list):
            raise ValueError(f"invalid service track zones at row {index}")
        track_rows.append({
            "trackId": target_id,
            "box": box_values,
            "stationarySeconds": max(0.0, stationary),
            "misses": misses,
            "zones": [str(z) for z in zones],
            "evidence": evidence,
        })

    jpgs = sorted(case_dir.glob("*.jpg"))
    frames: list[ReviewFrame] = []
    if jpgs:
        if len(jpgs) != len(timestamps):
            raise ValueError("JPEG count does not match exact frameTimestamps provenance")
        frames = [
            ReviewFrame(ts, str(path), "jpeg", path.name, track)
            for ts, path, track in zip(timestamps, jpgs, track_rows)
        ]
    else:
        # HardCaseRecorder's intended steady-state "replace" mode deletes numbered JPEGs
        # only after a complete MCAP episode re-reads with the full image count. Read that
        # verified replacement directly instead of making the sidecar depend on a legacy
        # duplicate copy of the pixels.
        episode_path = case_dir / "episode.mcap"
        if not episode_path.is_file():
            raise ValueError("case has neither numbered JPEGs nor episode.mcap")
        from .episode import read_frames, verify

        seen = verify(str(episode_path))
        if not seen or not seen.get("complete"):
            raise ValueError("episode.mcap is unreadable or incomplete")
        if int((seen.get("topics") or {}).get("/camera/image", 0)) != len(timestamps):
            raise ValueError("episode image count does not match exact frameTimestamps provenance")
        decoded = list(read_frames(str(episode_path)) or [])
        if len(decoded) != len(timestamps):
            raise ValueError("episode frames could not be decoded completely")
        for index, (expected, row) in enumerate(zip(timestamps, decoded)):
            actual, image, _frame_meta = row
            # Both clocks were written from the same source timestamp. A material mismatch
            # is corruption/skew, not permission to pair an image with a different instant.
            if abs(float(actual) - expected) > 0.001:
                raise ValueError(
                    f"episode timestamp mismatch at frame {index}: "
                    f"case={expected:.6f} episode={float(actual):.6f}"
                )
            frames.append(
                ReviewFrame(expected, image, "mcap", f"episode:{index:04d}", track_rows[index])
            )

    timed = [frame for frame in frames if frame.at >= trigger_at]
    if not timed:
        raise ValueError("case has no post-trigger frames")
    return meta, timed

def _sample_frames(
    timed: Sequence[ReviewFrame], *, every_seconds: float
) -> list[ReviewFrame]:
    if every_seconds <= 0:
        return list(timed)
    out: list[ReviewFrame] = []
    next_at: Optional[float] = None
    for frame in timed:
        if next_at is None or frame.at >= next_at:
            out.append(frame)
            next_at = frame.at + every_seconds
    if timed and out and out[-1].at != timed[-1].at:
        # Include resolution evidence at the end even when it falls just before the next
        # cadence tick. This is still bounded: at most one extra inference per case.
        out.append(timed[-1])
    return out

def analyze_case(
    case_dir: str | Path,
    *,
    analyzer: CueAnalyzer,
    ledger: ServiceEvidenceLedger,
    every_seconds: float = 3.0,
    scorer: Optional[OutsideServiceShadow] = None,
) -> ReviewResult:
    directory = Path(case_dir)
    try:
        meta, timed = _load_case(directory)
    except Exception as exc:  # noqa: BLE001 - one bad corpus row must not stop the batch
        result = ReviewResult(
            str(directory), "skipped", str(exc), analyzer=getattr(analyzer, "name", "unknown")
        )
        _write_result(directory, result)
        return result

    context = meta["context"]
    track_id = int(context["trackId"])
    vehicle_box = tuple(float(v) for v in context["vehicleBox"])
    base_stationary = float(context["stationarySeconds"])
    trigger_at = float(meta["at"])
    camera = str(context.get("camera") or "unknown")
    scorer = scorer or OutsideServiceShadow()
    sampled = _sample_frames(timed, every_seconds=every_seconds)

    last = None
    written = False
    analyzed = 0
    try:
        bay_names = {str(name) for name in (context.get("bayNames") or [])}
        for frame in sampled:
            track = frame.track
            if track is None:
                # Missing target observation breaks the temporal evidence run. The trigger
                # box is used only as a required shape argument to RESET the scorer; it does
                # not support proximity or a candidate.
                last = scorer.observe(
                    track_id=track_id,
                    vehicle_box=vehicle_box,
                    stationary_seconds=0.0,
                    in_bay=True,
                    cues=[],
                    at=frame.at,
                )
                continue

            current_box = tuple(float(v) for v in track["box"])
            stationary = float(track["stationarySeconds"])
            zones = {str(z) for z in track["zones"]}
            in_bay = bool(zones & bay_names)
            canonical_eligible = (
                track["evidence"] == "arrival"
                and int(track["misses"]) == 0
                and not in_bay
                and stationary >= scorer.min_stationary_seconds
            )
            if not canonical_eligible:
                # Reset before spending inference. A moved/unseen/bay vehicle must not carry
                # person/tool hits from an earlier outside stationary interval.
                last = scorer.observe(
                    track_id=track_id,
                    vehicle_box=current_box,
                    stationary_seconds=stationary,
                    in_bay=(in_bay or track["evidence"] != "arrival" or int(track["misses"]) != 0),
                    cues=[],
                    at=frame.at,
                )
                continue

            cues = list(analyzer.detect(frame.source))
            analyzed += 1
            assessment = scorer.observe(
                track_id=track_id,
                vehicle_box=current_box,
                stationary_seconds=stationary,
                in_bay=False,
                cues=cues,
                at=frame.at,
            )
            last = assessment
            if ledger.note(
                assessment,
                camera=camera,
                cues=cues,
                context={
                    "caseDir": directory.name,
                    "trackId": track_id,
                    "triggerAt": trigger_at,
                    "timingSource": "exact_case_json",
                    "trackSource": "per_frame_canonical_snapshot",
                    "frameSource": frame.source_kind,
                },
            ):
                written = True
    except Exception as exc:  # noqa: BLE001 - corpus work is retryable and non-authoritative
        result = ReviewResult(
            str(directory),
            "error",
            f"{type(exc).__name__}: {exc}",
            state=getattr(last, "state", None),
            frames_analyzed=analyzed,
            candidate_written=written,
            analyzer=getattr(analyzer, "name", "unknown"),
        )
        _write_result(directory, result, extra={"timingSource": "exact_case_json"})
        return result

    result = ReviewResult(
        str(directory),
        "ok",
        "shadow review complete",
        state=getattr(last, "state", "NO_BAY_ACTIVITY_REVIEW"),
        frames_analyzed=analyzed,
        candidate_written=written,
        evidence_support=getattr(last, "evidence_support", None),
        analyzer=getattr(analyzer, "name", "unknown"),
    )
    _write_result(
        directory,
        result,
        extra={
            "timingSource": "exact_case_json",
            "trackId": track_id,
            "vehicleBox": list(vehicle_box),
            "camera": camera,
            "frameSource": sampled[0].source_kind,
            "trackSource": "per_frame_canonical_snapshot",
        },
    )
    return result


@dataclass
class BatchStats:
    cases_seen: int = 0
    cases_processed: int = 0
    cases_skipped_existing: int = 0
    cases_invalid: int = 0
    cases_error: int = 0
    candidates_written: int = 0


def scan_cases(
    cases_dir: str | Path,
    *,
    analyzer: CueAnalyzer,
    ledger: ServiceEvidenceLedger,
    every_seconds: float = 3.0,
    force: bool = False,
) -> BatchStats:
    root = Path(cases_dir)
    stats = BatchStats()
    for case_path in sorted(root.glob("*/case.json")):
        directory = case_path.parent
        try:
            meta = json.loads(case_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if meta.get("reason") != "NO_BAY_ACTIVITY_REVIEW":
            continue
        stats.cases_seen += 1
        receipt = directory / "service-review.json"
        if receipt.is_file() and not force:
            try:
                prior = json.loads(receipt.read_text(encoding="utf-8"))
                if (
                    prior.get("status") == "ok"
                    and prior.get("analyzer") == getattr(analyzer, "name", None)
                ):
                    stats.cases_skipped_existing += 1
                    continue
            except Exception:
                pass
        result = analyze_case(
            directory, analyzer=analyzer, ledger=ledger, every_seconds=every_seconds
        )
        if result.status == "ok":
            stats.cases_processed += 1
            stats.candidates_written += int(result.candidate_written)
        elif result.status == "skipped":
            stats.cases_invalid += 1
        else:
            stats.cases_error += 1
    return stats


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Analyze saved no-bay hard cases into shadow-only service evidence."
    )
    parser.add_argument("--cases-dir", required=True)
    parser.add_argument("--ledger", default=None)
    parser.add_argument("--model", default=MODEL_ID)
    parser.add_argument("--revision", default=MODEL_REVISION)
    parser.add_argument("--device", default=None)
    parser.add_argument("--threshold", type=float, default=0.30)
    parser.add_argument("--text-threshold", type=float, default=0.25)
    parser.add_argument("--every-seconds", type=float, default=3.0)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args(argv)

    ledger_path = args.ledger or str(Path(args.cases_dir) / "service-evidence.jsonl")
    analyzer = GroundingDinoAnalyzer(
        model_id=args.model,
        revision=args.revision,
        threshold=args.threshold,
        text_threshold=args.text_threshold,
        device=args.device,
    )
    ledger = ServiceEvidenceLedger(ledger_path)
    stats = scan_cases(
        args.cases_dir,
        analyzer=analyzer,
        ledger=ledger,
        every_seconds=args.every_seconds,
        force=args.force,
    )
    print(json.dumps(asdict(stats), sort_keys=True))
    return 1 if stats.cases_error else 0


if __name__ == "__main__":
    raise SystemExit(main())
