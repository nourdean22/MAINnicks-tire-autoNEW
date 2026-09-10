"""Vehicle appearance: an embedder, and a BANK of views per track rather than one vector.

WHY A BANK AND NOT A VECTOR. A car that vanishes behind another for eighteen seconds and
reappears is the case this exists for. Comparing the reappearance against one arbitrary
stored frame asks "does the rear three-quarter view at dusk look like the front-left view in
daylight?", which is a question about viewpoints, not about vehicles -- and it answers wrong
in both directions. Comparing it against the best of several stored views asks the question
that was actually meant.

WHY THIS IS EVIDENCE AND NEVER IDENTITY. Vehicle ReID benchmarks reward memorising make,
model and body type, and published work through 2026 keeps finding that state-of-the-art
methods degrade on unseen vehicle types and viewpoint changes. Two silver sedans of the same
model are, to an embedding, close to indistinguishable -- and at a tire shop that is a
Tuesday, not a corner case. So `similarity()` returns a number for `fingerprint.compare()` to
weigh alongside plate, colour, type and trajectory, and the contradiction rules there keep
their veto. Nothing here may promote a similarity into a match on its own.

The asymmetry that governs every threshold: a FALSE MERGE writes two customers' visits into
one and is not recoverable from the data. A temporary SPLIT is visible, annoying, and gets
fixed by the next observation. When in doubt, split.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Optional, Sequence, Tuple

import numpy as np

from .detector import DetectorUnavailable

#: Cosine similarity at or above which two views are ALREADY represented by each other, so
#: the newer one adds nothing to a bank. Deliberately high: a bank of near-duplicates spans
#: one moment, and spanning moments is the entire reason it exists.
REDUNDANT_ABOVE = 0.97
#: The smallest crop worth embedding, in pixels per side. Below this there is not enough
#: vehicle in the image for an embedding to describe anything but noise and JPEG artefacts.
MIN_CROP_PX = 24


def _l2(vec: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vec))
    return vec if norm == 0.0 else vec / norm


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    """Cosine similarity, clamped to [-1, 1] against floating-point drift."""
    va, vb = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    na, nb = float(np.linalg.norm(va)), float(np.linalg.norm(vb))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return float(max(-1.0, min(1.0, float(np.dot(va, vb)) / (na * nb))))


def crop_quality(crop: Optional[np.ndarray]) -> float:
    """How much a crop is worth embedding, in [0, 1]. Bigger and sharper is better.

    Sharpness is the variance of a Laplacian -- the standard cheap focus measure. It matters
    here for a specific reason: a motion-blurred crop of a car mid-turn produces a perfectly
    confident embedding of a smear, and a bank that accepted it would compare every later
    view against that smear.
    """
    if crop is None or crop.size == 0:
        return 0.0
    height, width = crop.shape[:2]
    if height < MIN_CROP_PX or width < MIN_CROP_PX:
        return 0.0
    import cv2

    grey = crop if crop.ndim == 2 else cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    sharp = float(cv2.Laplacian(grey, cv2.CV_64F).var())
    # 300 is a plain normalising constant, not a threshold: it maps "clearly in focus" to
    # roughly 1.0 so size and sharpness contribute on comparable scales.
    sharpness = min(1.0, sharp / 300.0)
    size = min(1.0, (height * width) / float(160 * 160))
    return round(math.sqrt(max(size, 1e-6)) * (0.35 + 0.65 * sharpness), 4)


class ReidEmbedder:
    """OpenVINO wrapper for a vehicle re-identification model.

    Written against Intel's `vehicle-reid-0001` -- MIT licensed, 512-dimensional, native to
    the runtime already in this process -- but it reads the shape from the IR rather than
    hard-coding it, so a better model is a path change and not a rewrite.

    Every failure raises `DetectorUnavailable`, matching the contract the rest of the vision
    layer is written against, INCLUDING the model load itself. That last part is deliberate:
    the detector next door had the same gap and a truncated download crashed the producer at
    startup instead of degrading.
    """

    def __init__(self, model_xml: str, device: str = "CPU", name: Optional[str] = None) -> None:
        try:
            import openvino as ov
        except Exception as exc:  # noqa: BLE001
            raise DetectorUnavailable(f"openvino not installed: {exc!r}") from exc
        import os

        if not os.path.exists(model_xml):
            raise DetectorUnavailable(f"reid IR not found: {model_xml}")
        self.model_xml = model_xml
        self.name = name or f"reid:{os.path.basename(model_xml).replace('.xml', '')}"
        core = ov.Core()
        if device not in core.available_devices and device != "AUTO":
            raise DetectorUnavailable(
                f"device {device} not available; have {core.available_devices}")
        try:
            self._compiled = core.compile_model(core.read_model(model_xml), device)
        except Exception as exc:  # noqa: BLE001
            raise DetectorUnavailable(
                f"reid IR at {model_xml} could not be loaded on {device}: "
                f"{type(exc).__name__}. A truncated or corrupt download reads exactly like "
                "this."
            ) from exc
        self._input = self._compiled.input(0)
        shape = self._input.shape
        self.in_h, self.in_w = int(shape[2]), int(shape[3])
        self.dim: Optional[int] = None

    def embed(self, crop: np.ndarray) -> Optional[np.ndarray]:
        """One L2-normalised embedding, or None when the crop is not worth embedding.

        None rather than a zero vector, and the difference is not cosmetic: a zero vector has
        cosine similarity 0 with everything, which reads downstream as "definitely a different
        car" -- a confident answer derived from having no data at all.
        """
        if crop is None or crop.size == 0:
            return None
        height, width = crop.shape[:2]
        if height < MIN_CROP_PX or width < MIN_CROP_PX:
            return None
        import cv2

        resized = cv2.resize(crop, (self.in_w, self.in_h), interpolation=cv2.INTER_LINEAR)
        blob = resized.transpose(2, 0, 1)[None].astype(np.float32)
        out = self._compiled([blob])
        vec = np.asarray(list(out.values())[0]).reshape(-1).astype(np.float32)
        if vec.size == 0 or not np.isfinite(vec).all():
            return None
        self.dim = int(vec.size)
        return _l2(vec)


@dataclass(frozen=True)
class View:
    """One stored appearance of one track."""

    embedding: np.ndarray
    quality: float
    at: float
    box: Optional[Tuple[int, int, int, int]] = None


@dataclass
class AppearanceBank:
    """Up to `capacity` DIVERSE views of one vehicle, plus the evidence to compare against.

    Selection is by diversity, not recency, and that is the whole design. Keeping the last N
    embeddings of a car sitting still gives N copies of one viewpoint, which is exactly the
    bank that fails when the car reappears facing the other way. When the bank is full, the
    incoming view replaces whichever stored view is MOST redundant -- the one whose nearest
    neighbour is closest -- so the set that survives spans as much appearance as it can.

    Quality breaks ties, because a sharp large crop of a viewpoint is worth more than a
    blurred small one of the same viewpoint, and a smear embeds just as confidently.
    """

    capacity: int = 5
    views: List[View] = field(default_factory=list)
    considered: int = 0
    rejected_redundant: int = 0
    rejected_quality: int = 0

    def add(self, embedding: Optional[np.ndarray], quality: float, at: float,
            box: Optional[Tuple[int, int, int, int]] = None) -> bool:
        """Offer a view. Returns whether it was kept."""
        self.considered += 1
        if embedding is None or quality <= 0.0:
            self.rejected_quality += 1
            return False
        candidate = View(embedding=_l2(np.asarray(embedding, dtype=np.float32)),
                         quality=float(quality), at=float(at), box=box)

        nearest = max((cosine(candidate.embedding, v.embedding) for v in self.views),
                      default=-1.0)
        if nearest >= REDUNDANT_ABOVE:
            # Already represented. Keep the better crop of the two, because the bank should
            # hold the best view of each appearance rather than the first one that arrived.
            twin = max(self.views, key=lambda v: cosine(candidate.embedding, v.embedding))
            if candidate.quality > twin.quality:
                self.views[self.views.index(twin)] = candidate
            self.rejected_redundant += 1
            return False

        if len(self.views) < self.capacity:
            self.views.append(candidate)
            return True

        # FULL: break the TIGHTEST PAIR in the bank, which may include the candidate.
        #
        # An earlier version scored redundancy among RESIDENTS ONLY and evicted the worst of
        # those. That loses diversity in a case that is not exotic: if the candidate is a near
        # twin of a high-quality resident A, while B and C are mutually distinct, the
        # resident-only score picks B or C -- so the bank ends up holding A AND its near twin
        # and drops an unrelated viewpoint. The bank got tighter, which is the opposite of
        # what it is for.
        #
        # The question is "which two views are most alike", full stop. The candidate is one of
        # the views. Whichever pair is closest, the lower-quality half of that pair goes.
        def nearest_to(index: int) -> float:
            return max((cosine(self.views[index].embedding, o.embedding)
                        for j, o in enumerate(self.views) if j != index), default=-1.0)

        resident_pairs = [(nearest_to(i), i) for i in range(len(self.views))]
        tightest_resident, worst_resident = max(resident_pairs, key=lambda p: p[0])

        if nearest >= tightest_resident:
            # The candidate is the tighter half of the tightest pair: it duplicates `twin`.
            # Keep whichever of the two is the better crop.
            twin_index = max(range(len(self.views)),
                             key=lambda i: cosine(candidate.embedding, self.views[i].embedding))
            if candidate.quality <= self.views[twin_index].quality:
                self.rejected_redundant += 1
                return False
            self.views[twin_index] = candidate
            return True

        # A resident pair is tighter than anything involving the candidate, so the candidate
        # genuinely widens the bank: drop the lower-quality half of that pair.
        pair_partner = max((i for i in range(len(self.views)) if i != worst_resident),
                           key=lambda i: cosine(self.views[worst_resident].embedding,
                                                self.views[i].embedding))
        drop = (worst_resident if self.views[worst_resident].quality
                <= self.views[pair_partner].quality else pair_partner)
        self.views[drop] = candidate
        return True

    def similarity(self, embedding: Optional[np.ndarray]) -> Optional[float]:
        """Best cosine against any stored view, or None when there is nothing to compare.

        None, never 0.0. An empty bank means "no evidence"; 0.0 means "measured, and they
        look nothing alike". Collapsing the two is how a system with no data starts reporting
        confident disagreement.
        """
        if embedding is None or not self.views:
            return None
        return max(cosine(embedding, v.embedding) for v in self.views)

    def best(self) -> Optional[View]:
        return max(self.views, key=lambda v: v.quality) if self.views else None

    def describe(self) -> str:
        return (f"views={len(self.views)}/{self.capacity} considered={self.considered} "
                f"redundant={self.rejected_redundant} low_quality={self.rejected_quality}"
                + (f" best_quality={self.best().quality:.2f}" if self.views else ""))
