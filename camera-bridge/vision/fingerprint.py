"""
VehicleFingerprint + PrivacyToken.

The fingerprint answers "does this look consistent with the same vehicle?" -- never
"this definitely is customer X". It exposes its evidence AND its contradictions
instead of collapsing them into one magic similarity score, because falsely MERGING
two customers is much worse than temporarily SPLITTING one.

Hard stop: two high-confidence plate reads that disagree is a contradiction, and no
amount of colour/ReID/trajectory agreement may override it.

PrivacyToken uses a KEYED HMAC, not a plain hash. A licence plate has small enough
entropy that a plain SHA of every possible plate can be enumerated in seconds, so a
plain hash is not a pseudonym. The HMAC lets repeat visits be counted after the raw
plate text is scrubbed, without keeping an easily-reversible value.
"""
from __future__ import annotations

import hmac
import os
import re
from dataclasses import dataclass, field
from hashlib import sha256
from typing import Optional, Sequence

_PLATE_CLEAN = re.compile(r"[^A-Z0-9]")


def normalize_plate(text: str) -> str:
    return _PLATE_CLEAN.sub("", (text or "").upper())


class PrivacyToken:
    """Keyed pseudonym for a plate. Raises if no key is configured -- an unkeyed
    'pseudonym' is a false promise, so it must fail loudly rather than degrade."""

    ENV_KEY = "VISION_PLATE_HMAC_KEY"

    def __init__(self, key: Optional[bytes] = None) -> None:
        raw = key if key is not None else os.environ.get(self.ENV_KEY, "").encode()
        if not raw:
            raise ValueError(
                f"{self.ENV_KEY} is unset: refusing to emit an unkeyed plate pseudonym"
            )
        self._key = raw

    def token(self, plate_text: str, length: int = 16) -> str:
        norm = normalize_plate(plate_text)
        if not norm:
            return ""
        return hmac.new(self._key, norm.encode(), sha256).hexdigest()[:length]


@dataclass
class VehicleFingerprint:
    """Weighted evidence about one observed vehicle. Every field is optional."""

    plate_exact: Optional[str] = None            # CONFIRMED read
    plate_candidates: list[str] = field(default_factory=list)
    plate_confidence: float = 0.0
    reid_embedding: Optional[Sequence[float]] = None   # e.g. vehicle-reid-0001, 512 floats
    color: Optional[str] = None
    vehicle_type: Optional[str] = None
    color_confidence: float = 0.0
    first_seen: Optional[float] = None
    last_seen: Optional[float] = None
    camera: Optional[str] = None

    def privacy_token(self, tokenizer: PrivacyToken) -> str:
        return tokenizer.token(self.plate_exact) if self.plate_exact else ""


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    num = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    return num / (na * nb)


@dataclass
class MatchEvidence:
    verdict: str                       # SAME | LIKELY_SAME | UNKNOWN | CONTRADICTED
    contradictions: list[str] = field(default_factory=list)
    supports: list[str] = field(default_factory=list)
    score: float = 0.0

    def to_dict(self) -> dict:
        return {
            "verdict": self.verdict,
            "supports": list(self.supports),
            "contradictions": list(self.contradictions),
            "score": round(self.score, 3),
        }


def compare(a: VehicleFingerprint, b: VehicleFingerprint,
            plate_high_conf: float = 0.85, reid_same: float = 0.80) -> MatchEvidence:
    ev = MatchEvidence(verdict="UNKNOWN")

    # 1. Contradiction check FIRST -- it can only ever veto, never be outvoted.
    if (a.plate_exact and b.plate_exact
            and a.plate_confidence >= plate_high_conf
            and b.plate_confidence >= plate_high_conf
            and normalize_plate(a.plate_exact) != normalize_plate(b.plate_exact)):
        ev.verdict = "CONTRADICTED"
        ev.contradictions.append(
            f"two high-confidence plates disagree: {normalize_plate(a.plate_exact)} "
            f"vs {normalize_plate(b.plate_exact)}"
        )
        return ev

    if a.plate_exact and b.plate_exact and \
            normalize_plate(a.plate_exact) == normalize_plate(b.plate_exact):
        ev.supports.append("exact plate match")
        ev.score += 1.0
        ev.verdict = "SAME"
        return ev

    if a.reid_embedding and b.reid_embedding:
        sim = _cosine(a.reid_embedding, b.reid_embedding)
        if sim >= reid_same:
            ev.supports.append(f"reid cosine {sim:.2f}")
            ev.score += 0.5
        else:
            ev.contradictions.append(f"reid cosine {sim:.2f} below {reid_same}")

    if a.color and b.color:
        if a.color == b.color:
            ev.supports.append(f"colour {a.color}")
            ev.score += 0.15
        else:
            ev.contradictions.append(f"colour {a.color} vs {b.color}")
    if a.vehicle_type and b.vehicle_type:
        if a.vehicle_type == b.vehicle_type:
            ev.supports.append(f"type {a.vehicle_type}")
            ev.score += 0.1
        else:
            ev.contradictions.append(f"type {a.vehicle_type} vs {b.vehicle_type}")

    if ev.contradictions and ev.score < 0.5:
        ev.verdict = "UNKNOWN"
    elif ev.score >= 0.6:
        ev.verdict = "LIKELY_SAME"
    else:
        ev.verdict = "UNKNOWN"
    return ev
