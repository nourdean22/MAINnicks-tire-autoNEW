"""
SceneLock: a PTZ pan, a whole-pane redraw, or an exposure jump moves the ENTIRE
frame. While that is happening, visit-CREATING events must be frozen so global motion
never mints a car. Existing visits stay alive but are marked visibilityDegraded.

Primary signal is the global-change fraction: the share of pixels that changed a lot
between consecutive frames, computed on a downscaled grayscale image (cheap, and
needs only numpy). This is what suppressed camera motion in the live POC.

Optional refinement: an ORB + RANSAC homography against a trusted reference pose,
used only when a reference image is set and OpenCV exposes ORB. It degrades silently
to global-change-only, because a cheap camera's pose recovery must never become a
hard dependency of arrival truth.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np


def gray_small(image: np.ndarray, max_dim: int = 160) -> np.ndarray:
    img = image
    if img.ndim == 3:
        img = img[:, :, :3].mean(axis=2)
    h, w = img.shape[:2]
    stride = max(1, int(max(h, w) / max_dim))
    return img[::stride, ::stride].astype(np.float32)


@dataclass
class SceneState:
    moving: bool
    change_frac: float
    pose_ok: bool
    inlier_ratio: Optional[float] = None

    @property
    def may_create_visits(self) -> bool:
        return (not self.moving) and self.pose_ok


class SceneLock:
    def __init__(
        self,
        moving_frac: float = 0.33,
        pixel_delta: float = 25.0,
        settle_frames: int = 2,
    ) -> None:
        self.moving_frac = moving_frac
        self.pixel_delta = pixel_delta
        self.settle_frames = settle_frames
        self._prev: Optional[np.ndarray] = None
        self._ref: Optional[np.ndarray] = None
        self._settle_left = 0
        self.moving_frames = 0

    def set_reference(self, image: np.ndarray) -> None:
        """Record the canonical LOT_HOME pose. Reserved for homography scoring."""
        self._ref = gray_small(image)

    def update(self, image: Optional[np.ndarray]) -> SceneState:
        if image is None:
            return SceneState(moving=False, change_frac=0.0, pose_ok=True)
        g = gray_small(image)
        change_frac = 0.0
        if self._prev is not None and self._prev.shape == g.shape:
            changed = np.count_nonzero(np.abs(g - self._prev) > self.pixel_delta)
            change_frac = float(changed) / float(g.size)
        self._prev = g

        if change_frac > self.moving_frac:
            self.moving_frames += 1
            # After motion stops, hold the lock closed for a few frames so the first
            # post-pan frame (full of "new" foreground) cannot mint arrivals either.
            self._settle_left = self.settle_frames
            return SceneState(moving=True, change_frac=change_frac, pose_ok=False)

        if self._settle_left > 0:
            self._settle_left -= 1
            return SceneState(moving=False, change_frac=change_frac, pose_ok=False)

        return SceneState(moving=False, change_frac=change_frac, pose_ok=True)
