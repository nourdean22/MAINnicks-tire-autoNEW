"""The pose gate was refusing the pose because the LOT was busy, not because the camera moved.

WHAT HAPPENED, measured from 107 real hard-case episodes recorded on 2026-09-10.

`pose_ok` was `changed <= 0.30`, where `changed` is the fraction of pixels differing from the
reference by more than 25 grey levels. Its stated reasoning was "a lot full of moving cars
leaves most of the frame in place, a pan does not" -- and the first half of that is false on
this lot over any real span of time. Across one afternoon the reading climbed from 0.00 to
0.45 and stayed above the refusal for HOURS, because:

  * the weather turned from hard sun to overcast, so shadows swept the whole building facade,
  * every parked car was replaced by a different one, and
  * the bay doors opened.

Every one of those is the shop working normally, and together they consume the entire 30%
budget. `may_create_visits` is `(not moving) and pose_ok`, so the guard that exists to stop a
MOVED camera minting visits against stale polygons instead stopped ANY visit being minted --
silently, with the view perfectly fine. The clip that led here is a textbook shot of the
forecourt labelled POSE_OFF_HOME.

THE MEASUREMENT THAT SEPARATES THE TWO. Phase correlation reads how far the view MOVED,
which is the question the gate is actually asking:

    same camera, 3h apart, weather + every car changed   0.63 px   (44% of pixels differ)
    real pans of the same footage, 3 -> 80 px            recovered to within 0.4 px
    a DIFFERENT lens (shop-ptz / shop-right)             90 px / 245 px
    pure noise, not a scene at all                       173 px
    worst reading over all 107 real episodes             1.68 px

REGISTRATION VETOES A REFUSAL; IT DOES NOT REPLACE THE MEASURE. Whenever the pixel test is
satisfied the verdict is exactly what it always was, so every case this gate already got
right is untouched. The veto can only ever forgive, never accuse -- which also means a
producer that cannot register (no OpenCV, a shape mismatch, a scene with no static structure)
behaves precisely as it did before.

WHAT THIS DELIBERATELY DOES NOT FIX, so nobody reads more into it than is there: a pan small
enough to leave `changed` under 0.30 is still not detected, because nothing asks. That was
already true and is unchanged -- measured, a 100px pan of the synthetic fixture moves only
19% of its pixels. Closing it means making registration primary, which needs field data from
a producer running this build; the reading is recorded on every refusal so that data will
exist.
"""
from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from vision.scenelock import SceneLock, gray_small                    # noqa: E402


def _scene(seed: int = 20260910, h: int = 360, w: int = 640) -> np.ndarray:
    """A view with real two-dimensional structure, like a camera pointed at a building.

    COARSE BLOCKS, not per-pixel noise. `gray_small` decimates with `img[::4, ::4]`, and
    per-pixel noise is the highest frequency there is -- it does not survive the stride, it
    aliases into fresh noise, and two frames of it register at zero shift however far the
    scene moved. That cost an hour to find; the block size is the fix.
    """
    rng = np.random.default_rng(seed)
    coarse = rng.integers(30, 220, size=(h // 16 + 2, w // 16 + 2), dtype=np.int16)
    flat = np.repeat(np.repeat(coarse, 16, axis=0), 16, axis=1)[:h, :w]
    return np.repeat(flat[:, :, None], 3, axis=2).astype(np.uint8)


def _busy_afternoon(scene: np.ndarray, seed: int = 7) -> np.ndarray:
    """The same view, hours later: the cars turned over and the light changed.

    The bottom 45% is replaced outright -- that is the lot, and every vehicle on it is a
    different vehicle. The whole frame is then brightened, which is the weather. The building
    across the top is untouched, exactly as a fixed camera would see it.
    """
    rng = np.random.default_rng(seed)
    out = scene.astype(np.int16).copy()
    lot_top = int(scene.shape[0] * 0.55)
    coarse = rng.integers(30, 220, size=((scene.shape[0] - lot_top) // 16 + 2,
                                         scene.shape[1] // 16 + 2), dtype=np.int16)
    lot = np.repeat(np.repeat(coarse, 16, axis=0), 16, axis=1)[:scene.shape[0] - lot_top,
                                                               :scene.shape[1]]
    out[lot_top:] = lot[:, :, None]
    return np.clip(out + 18, 0, 255).astype(np.uint8)


def _changed_fraction(a: np.ndarray, b: np.ndarray, lock: SceneLock) -> float:
    return float((np.abs(gray_small(a) - gray_small(b)) > lock.pixel_delta).mean())


def _settle(lock: SceneLock, image: np.ndarray, n: int = 4):
    for _ in range(n):
        state = lock.update(image)
    return state


class TestABusyLotIsNotAMovedCamera:

    def test_the_regression_this_fixes(self):
        """THE WHOLE POINT. Content changes past the refusal, the view has not moved, and
        the pose must stay trusted -- because visits depend on it."""
        home = _scene()
        busy = _busy_afternoon(home)
        lock = SceneLock()
        lock.set_reference(home)

        changed = _changed_fraction(busy, home, lock)
        assert changed > lock.pose_max_changed_frac, (
            f"the control: this fixture must actually trip the old measure, and it changed "
            f"only {changed:.3f}")

        state = _settle(lock, busy)
        assert state.pose_shift_px is not None, "the veto must have been consulted"
        assert state.pose_shift_px <= lock.pose_max_shift_px
        assert state.pose_ok is True, (
            "the lot got busy and the weather turned; the camera did not move")
        assert state.may_create_visits is True, (
            "this is the outage: hours of arrivals suppressed with the view perfectly fine")

    def test_a_REAL_pan_is_still_refused(self):
        """The guard the veto must not weaken. Registration only forgives when the view
        genuinely has not moved."""
        home = _scene()
        away = np.roll(np.roll(home, 60, axis=1), 25, axis=0)
        lock = SceneLock()
        lock.set_reference(home)

        state = _settle(lock, away, n=9)
        assert state.moving is False, "the camera really has stopped"
        assert state.pose_shift_px is not None and state.pose_shift_px > lock.pose_max_shift_px
        assert state.pose_ok is False
        assert state.may_create_visits is False

    def test_a_pan_UNDER_a_busy_lot_is_still_refused(self):
        """The case that would be easiest to get wrong: both things at once. A camera that
        moved AND a lot that turned over must still be refused -- forgiving here would hand
        a moved camera visit authority whenever the shop happened to be busy."""
        home = _scene()
        moved_and_busy = np.roll(np.roll(_busy_afternoon(home), 60, axis=1), 25, axis=0)
        lock = SceneLock()
        lock.set_reference(home)

        state = _settle(lock, moved_and_busy, n=9)
        assert state.pose_ok is False
        assert state.may_create_visits is False


class TestTheVetoOnlyEverForgives:

    def test_registration_is_not_consulted_when_the_pose_already_passes(self):
        """Cost and blast radius. The correlation runs on the minority of frames that would
        otherwise be SUPPRESSED, never on the quiet majority, and a satisfied pixel test is
        decided exactly as it always was."""
        home = _scene()
        lock = SceneLock()
        lock.set_reference(home)
        state = _settle(lock, home)
        assert state.pose_ok is True
        assert state.pose_shift_px is None, (
            "nothing was refused, so nothing needed a second opinion")

    def test_when_registration_is_UNAVAILABLE_the_original_verdict_stands(self):
        """A box without OpenCV, or a reference of another shape, must behave exactly as it
        did before this change -- refused. Forgiving on a failed measurement would be the
        same outage arriving through a different door."""
        home = _scene()
        busy = _busy_afternoon(home)
        lock = SceneLock()
        lock.set_reference(home)
        lock._win = None                      # registration cannot run

        state = _settle(lock, busy)
        assert state.pose_shift_px is None
        assert state.pose_ok is False, "an unmeasurable pose is not a forgiven one"


class TestTheReferenceIsInstalledTheSameWayBothTimes:

    def test_an_AUTO_ADOPTED_reference_can_still_register(self):
        """The defect this file's own change introduced, caught by an existing guard test.

        There are two ways to become the reference -- an explicit `set_reference()` and the
        auto-adopt of the first settled frame -- and the second used to assign `_ref`
        directly, leaving the Hanning window unbuilt. Registration then returned None
        forever, which under a veto means every refusal stands, and under any design that
        made registration primary would mean `pose_ok` was unconditionally True: the inert
        pose gate this module was repaired for in the first place.
        """
        home = _scene()
        lock = SceneLock()                    # no explicit reference: auto-adopt
        lock.update(home)
        assert lock._ref is not None, "the control: a reference really was adopted"

        busy = _busy_afternoon(home)
        state = _settle(lock, busy)
        assert state.pose_shift_px is not None, (
            "the auto-adopted reference must be registerable, or the veto is dead on every "
            "producer that has no calibrated pose to pin")
        assert state.pose_ok is True
