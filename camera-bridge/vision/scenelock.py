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


def _hanning(shape) -> Optional[np.ndarray]:
    """A 2-D Hanning window matching `shape`, or None when OpenCV is unavailable.

    Phase correlation on an unwindowed image correlates the RECTANGULAR BORDER as strongly
    as the content, which pins the answer at zero shift and would make the gate report
    "home" for any image at all.
    """
    try:
        import cv2

        return cv2.createHanningWindow((int(shape[1]), int(shape[0])), cv2.CV_32F)
    except Exception:  # noqa: BLE001
        return None


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
    #: REPORTED ONLY -- it no longer decides `pose_ok`. Kept because it is already a
    #: heartbeat column (`poseDelta`) and changing what a wire field MEANS is worse than
    #: leaving a superseded number beside a better one.
    pose_delta: Optional[float] = None
    #: How far the current view has MOVED from the reference, in source pixels, by phase
    #: correlation. This is what decides `pose_ok`. None when there is no reference.
    pose_shift_px: Optional[float] = None
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
        pose_max_shift_px: float = 6.0,
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
        #: How far the view may move from the reference before the pose is refused, in
        #: SOURCE pixels. MEASURED, not chosen: across 107 real hard-case episodes spanning
        #: three hours -- over which the weather went from hard sun to overcast, every
        #: parked car turned over and the bay doors opened -- the registration reading never
        #: exceeded 1.68px. Synthetic pans of the same footage are recovered accurately from
        #: 3px up (3->3.64, 8->7.98, 20->19.95, 80->79.92). 6.0 is ~3.6x the worst observed
        #: noise and still refuses anything from 8px, which is a third of the 23px-deep band
        #: the lot's drivable region actually occupies.
        self.pose_max_shift_px = pose_max_shift_px
        #: Hanning window and reference width, built once with the reference. Rebuilding the
        #: window per frame costs more than the correlation it feeds.
        self._win = None
        self._ref_scale = 1.0
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
        self._install_reference(gray_small(image), float(image.shape[1]))

    def _install_reference(self, g: np.ndarray, source_width: float) -> None:
        """Adopt `g` as the home pose. THE ONLY place `_ref` is assigned.

        It exists because there are TWO ways to become the reference -- an explicit
        `set_reference()` and the auto-adopt of the first settled frame -- and the second one
        used to assign `self._ref` directly. That left the Hanning window unbuilt, so
        `_shift_px` returned None and `pose_ok` fell back to True FOREVER on any producer
        that had no calibrated reference to pin. That is exactly the inert pose gate this
        module was fixed for on 2026-09-09, arriving again by a different door, and the
        existing guard test caught it.
        """
        self._ref = g
        # The window is built ONCE, here. `cv2.createHanningWindow` costs more than the
        # correlation it feeds, so building it per frame would make the gate the most
        # expensive thing in the loop instead of one of the cheapest (0.39 ms measured).
        self._win = _hanning(g.shape)
        # Registration runs on the DOWNSAMPLED image; the reading is reported in SOURCE
        # pixels, which is the unit thresholds, logs and operators all think in.
        self._ref_scale = (source_width / float(g.shape[1])) if g.shape[1] else 1.0

    def _shift_px(self, g: np.ndarray) -> Optional[float]:
        """How far `g` has moved from the reference, in source pixels.

        WHY REGISTRATION AND NOT A PIXEL DIFFERENCE. The old gate asked "what fraction of
        pixels differ from the reference by more than 25 grey levels?" and refused the pose
        past 30%. On an outdoor lot that measure is dominated by everything EXCEPT the thing
        it is trying to detect: over one real afternoon the sun went behind cloud, shadows
        swept the building facade, every parked car turned over and the bay doors opened,
        and the reading climbed from 0.00 to 0.45 and stayed there -- while the camera had
        not moved at all (registration: 0.63px). `may_create_visits` is
        `(not moving) and pose_ok`, so the guard against minting visits from a moved camera
        instead stopped ANY visit being minted, for hours, with the view perfectly fine.

        Phase correlation separates the two exactly. Measured on that same footage:
        the unchanged view reads 0.63px while real pans of 3-80px are recovered to within
        0.4px; a DIFFERENT lens reads 90px (shop-ptz) and 245px (shop-right), and pure noise
        reads 173px -- so this refuses a foreign scene on its own and needs no second gate
        bolted on to cover it.

        None when there is nothing to compare against, never 0.0: "no reference" and "has
        not moved" are different claims and only one of them is evidence.
        """
        if self._ref is None or self._win is None or self._ref.shape != g.shape:
            return None
        try:
            import cv2

            (dx, dy), _response = cv2.phaseCorrelate(self._ref * self._win, g * self._win)
        except Exception:  # noqa: BLE001 - the pose gate must never take the lot down
            return None
        return float((dx * dx + dy * dy) ** 0.5) * self._ref_scale

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
            self._install_reference(g, float(image.shape[1]))
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
            # THE VERDICT IS THE REGISTRATION, not the pixel difference.
            #
            # It used to be `changed <= pose_max_changed_frac` -- the fraction of pixels
            # differing from the reference by more than `pixel_delta`. That reasoning was
            # "a lot full of moving cars leaves most of the frame in place, a pan does
            # not", and the first half of it is false on this lot over any real span of
            # time. Measured across one afternoon: the reading went 0.00 -> 0.45 and stayed
            # above the 0.30 refusal for hours, because the weather turned, shadows swept
            # the building, every parked car was replaced and the bay doors opened. The
            # camera had not moved -- registration read 0.63px. Since `may_create_visits`
            # is `(not moving) and pose_ok`, the guard against a MOVED camera minting bad
            # visits instead stopped every visit being minted at all, silently, while the
            # view was perfect.
            #
            # `changed` is still computed and `pose_delta` still reported: they are useful
            # context and `poseDelta` is already a heartbeat column. They just no longer
            # DECIDE. See `_shift_px` for the measurements behind the replacement.
            changed = float((diff > self.pixel_delta).mean())
            # REGISTRATION VETOES THE REFUSAL. It does not replace the measure.
            #
            # The pixel-difference test stands exactly as it was whenever it is SATISFIED,
            # so every case this gate already got right is untouched. What is new is the
            # second opinion when it wants to REFUSE: if the view has not actually moved,
            # a high changed-fraction is the lot doing its job, not the camera leaving home.
            #
            # Only asking on refusal is also why this is free. `phaseCorrelate` is 0.39 ms
            # on the downsampled frame, and it runs on the minority of frames that would
            # otherwise be suppressed rather than on all of them.
            shift = None
            if changed > self.pose_max_changed_frac:
                shift = self._shift_px(g)
            # `shift is None` -- no OpenCV, a shape mismatch, a scene with no static
            # structure to register against -- leaves the ORIGINAL verdict standing. The
            # veto can only ever forgive, never accuse, so a producer that cannot register
            # behaves exactly as it did before this change.
            pose_ok = (changed <= self.pose_max_changed_frac
                       or (shift is not None and shift <= self.pose_max_shift_px))
            return SceneState(moving=False, change_frac=change_frac, cell_frac=cell_frac,
                              pose_ok=pose_ok, pose_delta=delta, pose_shift_px=shift,
                              reference_set=True)

        # No reference: the pose is UNKNOWN rather than verified. Kept permissive so an
        # uncalibrated run still tracks, but callers can see `reference_set=False`.
        return SceneState(moving=False, change_frac=change_frac, cell_frac=cell_frac,
                          pose_ok=True, reference_set=False)
