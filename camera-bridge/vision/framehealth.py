"""
FrameHealth: a frozen or duplicated V380 pane must not masquerade as a live feed.

Pure functions of the frame stream -- no camera required, no cv2 required. Uses an
8x8 difference hash so a frozen pane (identical consecutive frames) or a short loop
of cached frames is detectable, plus FPS and frame age from timestamps.

Why this matters: the desktop-capture lane reads whatever the V380 app last painted.
If the app stalls, the last good frame keeps being captured forever and every
downstream component happily reports a stable, parked, healthy lot.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Optional

import numpy as np


def dhash(image: Optional[np.ndarray], size: int = 8) -> int:
    """64-bit difference hash; nearest-neighbour resize via numpy indexing."""
    if image is None:
        return 0
    img = image
    if img.ndim == 3:
        img = img[:, :, :3].mean(axis=2)
    h, w = img.shape[:2]
    if h < 2 or w < 2:
        return 0
    ys = np.linspace(0, h - 1, size).astype(int)
    xs = np.linspace(0, w - 1, size + 1).astype(int)
    small = img[np.ix_(ys, xs)]
    diff = small[:, 1:] > small[:, :-1]
    bits = 0
    for bit in diff.flatten():
        bits = (bits << 1) | int(bit)
    return bits


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


@dataclass
class HealthState:
    fps: float
    age: float          # seconds since the last frame, measured at `now`
    dup_ratio: float    # fraction of recent frames duplicating their predecessor
    frozen: bool        # a run of near-identical frames long enough to distrust
    ok: bool


class FrameHealth:
    def __init__(
        self,
        window: int = 20,
        dup_hamming: int = 4,
        freeze_run: int = 8,
        min_fps: float = 0.5,
        max_age: float = 5.0,
    ) -> None:
        self.window = window
        self.dup_hamming = dup_hamming
        self.freeze_run = freeze_run
        self.min_fps = min_fps
        self.max_age = max_age
        self._ts: deque[float] = deque(maxlen=window)
        self._dups: deque[bool] = deque(maxlen=window)
        self._prev_hash: Optional[int] = None
        self._freeze_streak = 0
        self.last_ts: Optional[float] = None

    def update(self, ts: float, image: Optional[np.ndarray]) -> None:
        self._ts.append(ts)
        self.last_ts = ts
        h = dhash(image) if image is not None else None
        if h is not None and self._prev_hash is not None:
            dup = hamming(h, self._prev_hash) <= self.dup_hamming
            self._dups.append(dup)
            self._freeze_streak = self._freeze_streak + 1 if dup else 0
        else:
            self._dups.append(False)
            self._freeze_streak = 0
        if h is not None:
            self._prev_hash = h

    def state(self, now: float) -> HealthState:
        ts = list(self._ts)
        if len(ts) >= 2 and (ts[-1] - ts[0]) > 0:
            fps = (len(ts) - 1) / (ts[-1] - ts[0])
        else:
            fps = 0.0
        age = (now - self.last_ts) if self.last_ts is not None else float("inf")
        dup_ratio = (sum(self._dups) / len(self._dups)) if self._dups else 0.0
        frozen = self._freeze_streak >= self.freeze_run
        # FPS is only judged once the window has filled, so a healthy cold start is not
        # reported as unhealthy.
        fps_ok = fps >= self.min_fps or len(ts) < self.window
        ok = (not frozen) and age <= self.max_age and fps_ok
        return HealthState(fps=fps, age=age, dup_ratio=dup_ratio, frozen=frozen, ok=ok)
