"""Shadow-only reasoning for service performed OUTSIDE a calibrated bay.

This module is intentionally incapable of mutating VisitTracker, BayLatch, or the shop
projection. It consumes auxiliary observations and returns an assessment. That architectural
one-way door matters more than the score: open-vocabulary vision and video MLLMs are useful
research witnesses, not yet measured authorities on this lot.

Two different questions stay separate:

1. NO_BAY_ACTIVITY_REVIEW
   An arrived vehicle has remained stationary outside every calibrated bay long enough to be
   worth saving as a training/review clip. This is AMBIGUITY, not evidence of service.

2. OUTSIDE_SERVICE_CANDIDATE
   Independent auxiliary cues persist around that same vehicle: a nearby person AND at least
   one mechanical/service cue over multiple observations. This is still shadow evidence and
   never becomes a visit state here.

evidence_support is a deterministic support score for sorting review work. It is NOT a
probability and MUST NOT be rendered as calibrated confidence.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Iterable, Optional, Sequence, Tuple

Box = Tuple[float, float, float, float]

PERSON_LABELS = frozenset({"person", "technician", "mechanic"})
MECHANICAL_LABELS = frozenset({
    "floor_jack",
    "jack",
    "tire",
    "wheel",
    "wheel_removed",
    "impact_wrench",
    "impact_gun",
    "hand_tool",
    "tool",
    "hood_open",
    "crouched_at_wheel",
    "mechanic_at_wheel",
})


def normalize_label(label: str) -> str:
    return "_".join(str(label).strip().lower().replace("-", " ").split())


@dataclass(frozen=True)
class ServiceCue:
    """One auxiliary observation from an open-set detector or video reasoner."""

    label: str
    score: float
    box: Optional[Box] = None
    source: str = "unknown"

    @property
    def normalized_label(self) -> str:
        return normalize_label(self.label)


@dataclass(frozen=True)
class OutsideServiceAssessment:
    track_id: int
    at: float
    state: str
    evidence_support: float
    stationary_seconds: float
    person_near: bool
    mechanical_cues: tuple[str, ...]
    observation_hits: int
    evidence_span_seconds: float
    reasons: tuple[str, ...]
    newly_candidate: bool = False


@dataclass
class _TrackEvidence:
    first_at: Optional[float] = None
    last_at: Optional[float] = None
    hits: int = 0
    candidate_emitted: bool = False


@dataclass
class OutsideServiceShadow:
    """Temporal shadow scorer. It has no import or callback into canonical visit state."""

    min_stationary_seconds: float = 20.0
    min_cue_score: float = 0.30
    min_observation_hits: int = 3
    min_evidence_span_seconds: float = 6.0
    evidence_reset_seconds: float = 20.0
    proximity_margin_ratio: float = 0.35
    _tracks: dict[int, _TrackEvidence] = field(default_factory=dict, init=False)

    def observe(
        self,
        *,
        track_id: int,
        vehicle_box: Box,
        stationary_seconds: float,
        in_bay: bool,
        cues: Sequence[ServiceCue],
        at: float,
    ) -> OutsideServiceAssessment:
        """Evaluate one observation without changing any canonical state."""
        stationary = max(0.0, float(stationary_seconds))
        relevant = [c for c in cues if float(c.score) >= self.min_cue_score]
        person_near = any(
            c.normalized_label in PERSON_LABELS
            and c.box is not None
            and _near(c.box, vehicle_box, self.proximity_margin_ratio)
            for c in relevant
        )
        mechanical = sorted({
            c.normalized_label
            for c in relevant
            if c.normalized_label in MECHANICAL_LABELS
            and c.box is not None
            and _near(c.box, vehicle_box, self.proximity_margin_ratio)
        })

        track = self._tracks.setdefault(track_id, _TrackEvidence())
        eligible_geometry = (not in_bay) and stationary >= self.min_stationary_seconds
        joint = eligible_geometry and person_near and bool(mechanical)

        if not eligible_geometry:
            self._tracks[track_id] = _TrackEvidence()
            track = self._tracks[track_id]
        elif joint:
            if (
                track.last_at is None
                or at < track.last_at
                or at - track.last_at > self.evidence_reset_seconds
            ):
                track.first_at = at
                track.hits = 1
                track.candidate_emitted = False
            else:
                if track.first_at is None:
                    track.first_at = at
                track.hits += 1
            track.last_at = at
        elif track.last_at is not None and at - track.last_at > self.evidence_reset_seconds:
            self._tracks[track_id] = _TrackEvidence()
            track = self._tracks[track_id]

        span = (
            max(0.0, float(track.last_at - track.first_at))
            if track.first_at is not None and track.last_at is not None
            else 0.0
        )
        candidate = (
            eligible_geometry
            and person_near
            and bool(mechanical)
            and track.hits >= self.min_observation_hits
            and span >= self.min_evidence_span_seconds
        )
        newly = candidate and not track.candidate_emitted
        if candidate:
            track.candidate_emitted = True

        # Sorting support, NOT calibrated confidence/probability.
        persistence_fraction = min(
            1.0,
            min(
                track.hits / max(1, self.min_observation_hits),
                span / max(0.001, self.min_evidence_span_seconds),
            ),
        )
        support = (
            (0.20 if eligible_geometry else 0.0)
            + (0.25 if person_near else 0.0)
            + (0.30 if mechanical else 0.0)
            + 0.25 * persistence_fraction
        )
        support = round(min(1.0, max(0.0, support)), 3)

        reasons = []
        if in_bay:
            reasons.append("vehicle currently intersects a calibrated bay")
        elif stationary < self.min_stationary_seconds:
            reasons.append(
                f"stationary {stationary:.1f}s < {self.min_stationary_seconds:.1f}s floor"
            )
        else:
            reasons.append(f"stationary outside bay for {stationary:.1f}s")
        reasons.append("person near vehicle" if person_near else "no nearby person cue")
        reasons.append(
            "mechanical cues: " + ", ".join(mechanical)
            if mechanical else "no nearby mechanical cue"
        )
        if track.hits:
            reasons.append(f"joint evidence {track.hits} hit(s) across {span:.1f}s")
        reasons.append("SHADOW ONLY: never mutates visit/service state")

        state = "OUTSIDE_SERVICE_CANDIDATE" if candidate else "NO_BAY_ACTIVITY_REVIEW"
        return OutsideServiceAssessment(
            track_id=track_id,
            at=float(at),
            state=state,
            evidence_support=support,
            stationary_seconds=stationary,
            person_near=person_near,
            mechanical_cues=tuple(mechanical),
            observation_hits=track.hits,
            evidence_span_seconds=round(span, 3),
            reasons=tuple(reasons),
            newly_candidate=newly,
        )

    def forget(self, track_id: int) -> None:
        self._tracks.pop(track_id, None)

    def retain_only(self, track_ids: Iterable[int]) -> None:
        keep = {int(t) for t in track_ids}
        for track_id in list(self._tracks):
            if track_id not in keep:
                self._tracks.pop(track_id, None)


@dataclass
class ServiceEvidenceStats:
    considered: int = 0
    candidates_written: int = 0
    dropped_write_error: int = 0
    rotated: int = 0
    last_error: Optional[str] = None

    @property
    def healthy(self) -> bool:
        return self.dropped_write_error == 0


@dataclass
class ServiceEvidenceLedger:
    """Append-only metadata ledger for shadow service candidates."""

    path: str
    max_bytes: int = 32 * 1024 * 1024
    stats: ServiceEvidenceStats = field(default_factory=ServiceEvidenceStats)

    def note(
        self,
        assessment: OutsideServiceAssessment,
        *,
        camera: str,
        cues: Sequence[ServiceCue],
        context: Optional[dict] = None,
    ) -> bool:
        self.stats.considered += 1
        if not assessment.newly_candidate:
            return False
        row = {
            "at": round(float(assessment.at), 3),
            "camera": str(camera),
            "trackId": int(assessment.track_id),
            "state": assessment.state,
            "evidenceSupport": assessment.evidence_support,
            "supportIsCalibratedProbability": False,
            "stationarySeconds": round(assessment.stationary_seconds, 3),
            "personNear": assessment.person_near,
            "mechanicalCues": list(assessment.mechanical_cues),
            "observationHits": assessment.observation_hits,
            "evidenceSpanSeconds": assessment.evidence_span_seconds,
            "reasons": list(assessment.reasons),
            "cues": [
                {
                    "label": c.normalized_label,
                    "score": round(float(c.score), 4),
                    "box": list(c.box) if c.box is not None else None,
                    "source": c.source,
                }
                for c in cues
            ],
            "context": _plain(context or {}),
            "authority": "shadow_only",
        }
        try:
            self._rotate_if_needed()
            parent = os.path.dirname(self.path)
            if parent:
                os.makedirs(parent, exist_ok=True)
            with open(self.path, "a", encoding="utf-8", newline="\n") as fh:
                fh.write(json.dumps(row, sort_keys=True) + "\n")
        except Exception as exc:
            self.stats.dropped_write_error += 1
            self.stats.last_error = f"{type(exc).__name__}: {exc}"
            return False
        self.stats.candidates_written += 1
        return True

    def _rotate_if_needed(self) -> None:
        if not os.path.exists(self.path) or os.path.getsize(self.path) < self.max_bytes:
            return
        backup = self.path + ".1"
        if os.path.exists(backup):
            os.remove(backup)
        os.replace(self.path, backup)
        self.stats.rotated += 1


def _near(cue: Box, vehicle: Box, margin_ratio: float) -> bool:
    """Cue center inside a vehicle box expanded by its own dimensions."""
    vx1, vy1, vx2, vy2 = map(float, vehicle)
    cx1, cy1, cx2, cy2 = map(float, cue)
    if vx2 <= vx1 or vy2 <= vy1 or cx2 <= cx1 or cy2 <= cy1:
        return False
    width = vx2 - vx1
    height = vy2 - vy1
    margin_x = width * max(0.0, margin_ratio)
    margin_y = height * max(0.0, margin_ratio)
    center_x = (cx1 + cx2) / 2.0
    center_y = (cy1 + cy2) / 2.0
    return (
        vx1 - margin_x <= center_x <= vx2 + margin_x
        and vy1 - margin_y <= center_y <= vy2 + margin_y
    )


def _plain(value):
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_plain(v) for v in value]
    return repr(value)
