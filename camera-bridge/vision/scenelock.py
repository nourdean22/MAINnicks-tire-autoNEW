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


def changed_cell_fraction(diff_mask: np.ndarray, grid: int = 8) -> float:
    """Fraction of grid cells containing meaningful change.

    This is the difference between a PAN and a TRUCK. A pan moves the whole scene, so
    change appears in essentially every cell. A delivery truck pulling close to the lens
    can cover the same raw pixel FRACTION while the change stays spatially concentrated
    in a handful of adjacent cells. Judging on the raw fraction alone -- which is all the
    first version did -- silently discarded exactly the large, close, valuable arrivals
    this system exists to catch.
    """
    h, w = diff_mask.shape[:2]
    if h < grid or w < grid:
        return 1.0 if diff_mask.any() else 0.0
    ys = np.linspace(0, h, grid + 1).astype(int)
    xs = np.linspace(0, w, grid + 1).astype(int)
    hit = 0
    for i in range(grid):
        for j in range(grid):
            cell = diff_mask[ys[i]:ys[i + 1], xs[j]:xs[j + 1]]
            if cell.size and cell.mean() > 0.10:
                hit += 1
    return hit / float(grid * grid)


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
    #: Fraction of grid cells that changed. Near 1.0 for a pan; low for one big object.
    cell_frac: float
    pose_ok: bool
    inlier_ratio: Optional[float] = None
    #: Mean absolute difference from the trusted reference pose, or None when no
    #: reference has been set (in which case the pose is simply unknown, not matched).
    pose_delta: Optional[float] = None
    reference_set: bool = False

    @property
    def may_create_visits(self) -> bool:
        return (not self.moving) and self.pose_ok


class SceneLock:
    def __init__(
        self,
        moving_frac: float = 0.33,
        pixel_delta: float = 25.0,
        settle_frames: int = 2,
        pose_tolerance: float = 12.0,
        moving_cell_frac: float = 0.70,
    ) -> None:
        self.moving_frac = moving_frac
        self.pixel_delta = pixel_delta
        self.settle_frames = settle_frames
        #: Camera motion must be SPATIALLY GLOBAL, not merely large.
        self.moving_cell_frac = moving_cell_frac
        #: Max mean-abs-difference from the reference still counted as the same pose.
        self.pose_tolerance = pose_tolerance
        self._prev: Optional[np.ndarray] = None
        self._ref: Optional[np.ndarray] = None
        self._settle_left = 0
        self.moving_frames = 0

    def set_reference(self, image: np.ndarray) -> None:
        """Record the canonical LOT_HOME pose. Reserved for homography scoring."""
        self._ref = gray_small(image)

    def update(self, image: Optional[np.ndarray]) -> SceneState:
        if image is None:
            return SceneState(moving=False, change_frac=0.0, cell_frac=0.0, pose_ok=True)
        g = gray_small(image)
        change_frac = 0.0
        cell_frac = 0.0
        if self._prev is not None and self._prev.shape == g.shape:
            mask = np.abs(g - self._prev) > self.pixel_delta
            change_frac = float(np.count_nonzero(mask)) / float(g.size)
            cell_frac = changed_cell_fraction(mask)
        self._prev = g

        # BOTH conditions. Large-and-concentrated is an object; large-and-everywhere is
        # the camera. Requiring only the first drops close vehicles as "camera motion".
        if change_frac > self.moving_frac and cell_frac >= self.moving_cell_frac:
            self.moving_frames += 1
            # After motion stops, hold the lock closed for a few frames so the first
            # post-pan frame (full of "new" foreground) cannot mint arrivals either.
            self._settle_left = self.settle_frames
            return SceneState(moving=True, change_frac=change_frac, cell_frac=cell_frac,
                              pose_ok=False)

        if self._settle_left > 0:
            self._settle_left -= 1
            return SceneState(moving=False, change_frac=change_frac, cell_frac=cell_frac,
                              pose_ok=False, reference_set=self._ref is not None)

        # A pan that ENDS SOMEWHERE ELSE is still stationary. Settling alone therefore
        # cannot establish that the view is the calibrated one, and the lot, portal and
        # bay polygons belong to the reference pose -- so trusting a settled-but-unmatched
        # view lets detections in a NEW view be read as crossings and bay occupancy.
        # With a reference set, the pose must actually match before it is trusted.
        if self._ref is not None:
            if self._ref.shape != g.shape:
                return SceneState(moving=False, change_frac=change_frac, cell_frac=cell_frac,
                                  pose_ok=False, reference_set=True)
            delta = float(np.abs(g - self._ref).mean())
            return SceneState(moving=False, change_frac=change_frac, cell_frac=cell_frac,
                              pose_ok=delta <= self.pose_tolerance,
                              pose_delta=delta, reference_set=True)

        # No reference: the pose is UNKNOWN rather than verified. Kept permissive so an
        # uncalibrated run still tracks, but callers can see `reference_set=False`.
        return SceneState(moving=False, change_frac=change_frac, cell_frac=cell_frac,
                          pose_ok=True, reference_set=False)
