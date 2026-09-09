"""A single captured (or synthetic) frame, plus a lightweight detection record."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

import numpy as np

Box = tuple[float, float, float, float]  # x1, y1, x2, y2 in pixels


@dataclass
class Frame:
    """`image` may be None for pure-geometry tests that feed detections directly."""

    seq: int
    ts: float
    source: str
    image: Optional[np.ndarray] = None
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def size(self) -> tuple[int, int]:
        if self.image is None:
            return (int(self.meta.get("w", 0)), int(self.meta.get("h", 0)))
        h, w = self.image.shape[:2]
        return (w, h)


@dataclass
class Detection:
    """`ground_point` is bottom-center: where the vehicle touches the ground plane.

    Every geometry decision (zones, entry crossing, queue order) uses the ground point,
    never the box center -- a box center drifts with vehicle height and camera pitch.
    """

    box: Box
    score: float
    label: str = "vehicle"
    source: str = "unknown"  # which detector produced it

    @property
    def ground_point(self) -> tuple[float, float]:
        x1, _y1, x2, y2 = self.box
        return ((x1 + x2) / 2.0, y2)

    @property
    def center(self) -> tuple[float, float]:
        x1, y1, x2, y2 = self.box
        return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)

    @property
    def area(self) -> float:
        x1, y1, x2, y2 = self.box
        return max(0.0, x2 - x1) * max(0.0, y2 - y1)


def iou(a: Box, b: Box) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter
    return inter / union if union > 0 else 0.0
