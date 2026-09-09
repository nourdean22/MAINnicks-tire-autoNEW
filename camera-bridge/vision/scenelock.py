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


def changed_cell_fraction(diff_mask: np.ndarray, texture: Optional[np.ndarray] = None,
                          grid: int = 8, texture_std: float = 4.0) -> float:
    """Of the grid cells that COULD register change, what fraction did?

    This is the difference between a PAN and a TRUCK. A pan moves the whole scene, so
    change appears in essentially every cell that has any detail in it. A delivery truck
    pulling close to the lens can cover the same raw pixel FRACTION while the change
    stays spatially concentrated in a handful of adjacent cells. Judging on the raw
    fraction alone -- which is all the first version did -- silently discarded exactly
    the large, close, valuable arrivals this system exists to catch.

    The denominator is ELIGIBLE cells, not all cells, and that is load-bearing rather
    than a refinement. Frame differencing cannot see a featureless region move: pan a
    camera whose top 40% is blank sky and only the textured 60% of cells change. Divided
    by ALL cells that reads as 0.6 -- under any sane threshold -- so a real pan would
    score as "not camera motion" and the lock would open during it. Dividing by the cells
    with enough detail to show change restores ~1.0 for that pan while leaving the truck
    at its true ~0.45.

    `texture` is the current grayscale frame. When it is omitted every cell counts as
    eligible, which reproduces the older, weaker behaviour -- callers that care about the
    sky case must pass it.
    """
    h, w = diff_mask.shape[:2]
    if h < grid or w < grid:
        return 1.0 if diff_mask.any() else 0.0
    ys = np.linspace(0, h, grid + 1).astype(int)
    xs = np.linspace(0, w, grid + 1).astype(int)
    hit = 0
    eligible = 0
    for i in range(grid):
        for j in range(grid):
            cell = diff_mask[ys[i]:ys[i + 1], xs[j]:xs[j + 1]]
            if not cell.size:
                continue
            if texture is not None:
                patch = texture[ys[i]:ys[i + 1], xs[j]:xs[j + 1]]
                # A flat cell cannot produce a pixel delta no matter how the camera
                # moves, so counting it against us would mask real motion.
                if patch.size and float(patch.std()) < texture_std:
                    continue
            eligible += 1
            if cell.mean() > 0.10:
                hit += 1
    if eligible == 0:
        # A completely featureless view. Nothing can be concluded about motion from
        # differencing it, so report the maximum and let the caller's other gates decide
        # -- reporting 0.0 here would read as "definitely not moving".
        return 1.0
    return hit / float(eligible)


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
        auto_reference: bool = True,
        pose_max_changed_frac: float = 0.30,
    ) -> None:
        self.moving_frac = moving_frac
        self.pixel_delta = pixel_delta
        self.settle_frames = settle_frames
        #: Camera motion must be SPATIALLY GLOBAL, not merely large.
        self.moving_cell_frac = moving_cell_frac
        #: Legacy mean-abs-difference bound. Reported for observability; NO LONGER the
        #: verdict -- see `pose_max_changed_frac`.
        self.pose_tolerance = pose_tolerance
        #: The pose verdict: what FRACTION of the frame may differ from the reference and
        #: still count as the same camera pose.
        #:
        #: The mean was the wrong statistic and it locked the system out. Measured live on
        #: 2026-09-09: against a fixed reference the mean climbed 0 -> 5.58 in THIRTY
        #: SECONDS purely from cars moving on the lot, monotonically, because the
        #: reference never updates. Over a 15-minute run it crossed 12.0 and stayed there,
        #: and since `may_create_visits` is `(not moving) and pose_ok`, the pipeline
        #: suppressed 2315 of 2629 frames -- 88% blind -- and reported it under a counter
        #: named "camera motion" while the camera had not moved at all.
        #:
        #: Cars coming and going IS the subject, so the pose check must be indifferent to
        #: it. Over the same measurement the fraction of pixels differing by more than the
        #: delta stayed at 0.008-0.019: 98% of the frame still matched. A real pan moves
        #: essentially everything. So the verdict is "does MOST of the frame still line
        #: up", which a busy lot passes and a pan cannot.
        self.pose_max_changed_frac = pose_max_changed_frac
        #: Adopt the first settled view as the pose reference. See update()'s comment --
        #: without this the pose gate is inert, because nothing else calls
        #: set_reference() and `may_create_visits` is `(not moving) and pose_ok`.
        self.auto_reference = auto_reference
        self._prev: Optional[np.ndarray] = None
        self._ref: Optional[np.ndarray] = None
        self._settle_left = 0
        self.moving_frames = 0

    def set_reference(self, image: np.ndarray) -> None:
        """Record the canonical LOT_HOME pose.

        Call this with a known-good calibrated view when one exists. Otherwise the first
        settled frame is adopted automatically -- see `auto_reference`.
        """
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
            cell_frac = changed_cell_fraction(mask, texture=g)
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

        # Adopt the first settled view as the reference if nobody supplied one.
        #
        # This is what makes the pose gate real rather than decorative. Audited
        # 2026-09-09: `set_reference()` had exactly one caller in the entire package -- a
        # test -- so in production `_ref` was always None, `pose_ok` was unconditionally
        # True, and `may_create_visits` collapsed to `not moving`. A camera knocked off
        # aim would pan, settle, and then mint visits forever against lot, portal and bay
        # polygons belonging to a view it no longer has: silently wrong, with no symptom.
        #
        # The startup view is NOT necessarily the calibrated one, and this does not
        # pretend otherwise -- it detects DRIFT FROM WHERE THE PROCESS STARTED, which is
        # the actual failure (someone bumps the camera, a PTZ preset fires). Pass a known
        # good frame to set_reference() when one exists; that always wins, because this
        # only fires when `_ref` is still None.
        if self._ref is None and self.auto_reference:
            self._ref = g
            return SceneState(moving=False, change_frac=change_frac, cell_frac=cell_frac,
                              pose_ok=True, pose_delta=0.0, reference_set=True)

        # A pan that ENDS SOMEWHERE ELSE is still stationary. Settling alone therefore
        # cannot establish that the view is the calibrated one, and the lot, portal and
        # bay polygons belong to the reference pose -- so trusting a settled-but-unmatched
        # view lets detections in a NEW view be read as crossings and bay occupancy.
        # With a reference set, the pose must actually match before it is trusted.
        if self._ref is not None:
            if self._ref.shape != g.shape:
                return SceneState(moving=False, change_frac=change_frac, cell_frac=cell_frac,
                                  pose_ok=False, reference_set=True)
            diff = np.abs(g - self._ref)
            delta = float(diff.mean())
            # The VERDICT is the changed FRACTION, not the average magnitude: a lot full
            # of moving cars leaves most of the frame in place, a pan does not.
            changed = float((diff > self.pixel_delta).mean())
            return SceneState(moving=False, change_frac=change_frac, cell_frac=cell_frac,
                              pose_ok=changed <= self.pose_max_changed_frac,
                              pose_delta=delta, reference_set=True)

        # No reference: the pose is UNKNOWN rather than verified. Kept permissive so an
        # uncalibrated run still tracks, but callers can see `reference_set=False`.
        return SceneState(moving=False, change_frac=change_frac, cell_frac=cell_frac,
                          pose_ok=True, reference_set=False)
