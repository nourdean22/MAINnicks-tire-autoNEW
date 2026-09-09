"""
PlateLab: choose good frames, read several of them, and vote -- never trust one OCR.

Pipeline: score candidate crops (plate size, detector score, sharpness, motion blur,
glare/saturation, skew, occlusion, frame-edge proximity) -> OCR only the good ones ->
character-position consensus across frames -> format plausibility -> a verdict.

Verdicts are deliberately coarse and include an explicit UNREADABLE and AMBIGUOUS,
because "a wrong plate confidently reported" is the single most dangerous output in
this whole system: it attaches the wrong customer to a car.

Not used, on purpose: generative super-resolution or any generative OCR. A
hallucinated character is indistinguishable from a read one. Multi-frame stacking is
allowed only if the characters stay traceable to real frames.

The OCR backend is pluggable (`ocr_fn`). fast-alpr 0.4.0 (MIT, ONNX/OpenVINO extras)
is the intended local backend; Intel's `vehicle-license-plate-detection-barrier-0106`
may act as a second PROPOSAL generator, but its front-facing, Chinese-domain training
means its scores are not transferable to an Ohio parking lot.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Callable, Optional, Sequence

import numpy as np

from .fingerprint import normalize_plate

NONE = "NONE"
UNREADABLE = "UNREADABLE"
CANDIDATE = "CANDIDATE"
CONFIRMED = "CONFIRMED"
AMBIGUOUS = "AMBIGUOUS"

# Characters that OCR confuses; used to detect "different string, same plate".
CONFUSABLE = {"0": "O", "O": "0", "1": "I", "I": "1", "5": "S", "S": "5",
              "8": "B", "B": "8", "2": "Z", "Z": "2"}


def canonical(text: str) -> str:
    """Collapse confusable characters so O0/I1/S5 variants compare equal."""
    norm = normalize_plate(text)
    table = {"O": "0", "I": "1", "S": "5", "B": "8", "Z": "2"}
    return "".join(table.get(c, c) for c in norm)


def sharpness(gray: np.ndarray) -> float:
    """Variance of a discrete Laplacian. Higher is sharper. Pure numpy."""
    if gray.ndim == 3:
        gray = gray[:, :, :3].mean(axis=2)
    g = gray.astype(np.float32)
    if g.shape[0] < 3 or g.shape[1] < 3:
        return 0.0
    lap = (-4.0 * g[1:-1, 1:-1] + g[:-2, 1:-1] + g[2:, 1:-1]
           + g[1:-1, :-2] + g[1:-1, 2:])
    return float(lap.var())


def glare_ratio(gray: np.ndarray, ceiling: int = 250) -> float:
    if gray.ndim == 3:
        gray = gray[:, :, :3].mean(axis=2)
    return float(np.count_nonzero(gray >= ceiling)) / float(gray.size or 1)


@dataclass
class PlateCandidate:
    text: str
    confidence: float
    ts: float
    quality: float = 0.0


@dataclass
class PlateQuality:
    score: float
    width_px: float
    sharpness: float
    glare: float
    near_edge: bool
    reasons: list[str] = field(default_factory=list)

    @property
    def usable(self) -> bool:
        return self.score >= 0.5


def score_crop(crop: np.ndarray, frame_w: int, box_x1: float, box_x2: float,
               min_width_px: float = 60.0) -> PlateQuality:
    """Reject junk BEFORE spending OCR on it. min_width_px is deliberately a knob:
    Intel's barrier model documents ~96px minimum plate width, which an angled lot
    camera will rarely hit."""
    reasons: list[str] = []
    width = float(crop.shape[1]) if crop.size else 0.0
    sharp = sharpness(crop) if crop.size else 0.0
    glare = glare_ratio(crop) if crop.size else 1.0
    near_edge = box_x1 <= 4 or box_x2 >= (frame_w - 4)

    score = 1.0
    if width < min_width_px:
        score -= 0.5
        reasons.append(f"plate width {width:.0f}px < {min_width_px:.0f}px")
    if sharp < 40.0:
        score -= 0.3
        reasons.append(f"low sharpness {sharp:.0f} (motion blur)")
    if glare > 0.15:
        score -= 0.3
        reasons.append(f"glare {glare:.2f}")
    if near_edge:
        score -= 0.2
        reasons.append("touching frame edge (likely cropped)")
    return PlateQuality(max(0.0, score), width, sharp, glare, near_edge, reasons)


class PlateLab:
    def __init__(
        self,
        ocr_fn: Optional[Callable[[np.ndarray], tuple[str, float]]] = None,
        min_reads: int = 3,
        confirm_agreement: float = 0.6,
        confirm_confidence: float = 0.80,
    ) -> None:
        self.ocr_fn = ocr_fn
        self.min_reads = min_reads
        self.confirm_agreement = confirm_agreement
        self.confirm_confidence = confirm_confidence
        self.candidates: list[PlateCandidate] = []

    @property
    def available(self) -> bool:
        return self.ocr_fn is not None

    def observe(self, crop: np.ndarray, ts: float, quality: PlateQuality) -> Optional[PlateCandidate]:
        """OCR one crop if it is worth reading. Returns the candidate, or None."""
        if not self.available or not quality.usable:
            return None
        text, conf = self.ocr_fn(crop)
        norm = normalize_plate(text)
        if not norm:
            return None
        cand = PlateCandidate(text=norm, confidence=float(conf), ts=ts, quality=quality.score)
        self.candidates.append(cand)
        return cand

    def add_candidate(self, text: str, confidence: float, ts: float, quality: float = 1.0) -> None:
        """Inject a read from an external backend (fast-alpr, an OMZ proposal, a test)."""
        norm = normalize_plate(text)
        if norm:
            self.candidates.append(PlateCandidate(norm, float(confidence), ts, quality))

    def consensus(self) -> dict:
        """Character-position voting over every retained read. Keeps all candidates."""
        if not self.available and not self.candidates:
            return {"verdict": NONE, "text": None, "confidence": 0.0,
                    "reads": 0, "reason": "no OCR backend and no candidates"}
        if not self.candidates:
            return {"verdict": NONE, "text": None, "confidence": 0.0,
                    "reads": 0, "reason": "no readable plate crops"}

        reads = len(self.candidates)
        # Group by confusable-collapsed form so O0/I1 variants count as agreement.
        groups: Counter[str] = Counter(canonical(c.text) for c in self.candidates)
        top_key, top_n = groups.most_common(1)[0]
        agreement = top_n / reads
        members = [c for c in self.candidates if canonical(c.text) == top_key]
        # Report the exact string most often seen within the winning group.
        text = Counter(m.text for m in members).most_common(1)[0][0]
        weighted = sum(m.confidence * max(0.1, m.quality) for m in members)
        denom = sum(max(0.1, m.quality) for m in members) or 1.0
        confidence = weighted / denom

        second = groups.most_common(2)[1][1] if len(groups) > 1 else 0
        if reads < self.min_reads:
            verdict, reason = CANDIDATE, f"only {reads} read(s) < {self.min_reads}"
        elif second and (top_n - second) <= 0:
            verdict, reason = AMBIGUOUS, "two readings tied"
        elif agreement >= self.confirm_agreement and confidence >= self.confirm_confidence:
            verdict, reason = CONFIRMED, f"{top_n}/{reads} agree at {confidence:.2f}"
        elif agreement >= self.confirm_agreement:
            verdict, reason = CANDIDATE, f"agreement ok, confidence {confidence:.2f} low"
        else:
            verdict, reason = AMBIGUOUS, f"agreement {agreement:.2f} below threshold"

        return {
            "verdict": verdict,
            "text": text,
            "canonical": top_key,
            "confidence": round(confidence, 3),
            "agreement": round(agreement, 3),
            "reads": reads,
            "distinct": len(groups),
            "reason": reason,
            "candidates": [
                {"text": c.text, "confidence": c.confidence, "ts": c.ts} for c in self.candidates
            ],
        }


def lookup_class(query: str, known_plates: Sequence[str]) -> dict:
    """Classify a customer-DB plate lookup: EXACT | CONFUSABLE_UNIQUE | AMBIGUOUS | NONE.

    A fuzzy variant must never be returned as though it were exact. Only EXACT (or an
    operator-approved high-confidence match) may bind an identity; CONFUSABLE_UNIQUE is
    advisory and needs staff confirmation.
    """
    q = normalize_plate(query)
    if not q:
        return {"class": NONE, "matches": []}
    exact = [p for p in known_plates if normalize_plate(p) == q]
    if exact:
        return {"class": "EXACT", "matches": exact}
    qc = canonical(q)
    near = [p for p in known_plates if canonical(p) == qc]
    if len(near) == 1:
        return {"class": "CONFUSABLE_UNIQUE", "matches": near}
    if len(near) > 1:
        return {"class": "AMBIGUOUS", "matches": near}
    return {"class": NONE, "matches": []}
