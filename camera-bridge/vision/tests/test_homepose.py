from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest

from vision.homepose import HomePoseError, verify_home_pose, write_receipt
from vision.scenelock import SceneLock


def _scene() -> np.ndarray:
    """Static textured shop-like geometry without random per-pixel noise."""
    import cv2

    image = np.zeros((360, 640, 3), dtype=np.uint8)
    image[:] = (55, 65, 75)
    cv2.rectangle(image, (25, 30), (615, 330), (95, 105, 115), 3)
    cv2.rectangle(image, (80, 90), (245, 270), (175, 120, 60), -1)
    cv2.rectangle(image, (360, 75), (550, 260), (70, 150, 190), -1)
    for x in range(35, 620, 45):
        cv2.line(image, (x, 20), (x, 340), (130, 135, 140), 1)
    for y in range(35, 340, 35):
        cv2.line(image, (20, y), (620, y), (105, 110, 120), 1)
    cv2.circle(image, (315, 180), 42, (230, 220, 90), -1)
    return image


def _shift(image: np.ndarray, dx: float, dy: float = 0.0) -> np.ndarray:
    import cv2

    matrix = np.float32([[1, 0, dx], [0, 1, dy]])
    return cv2.warpAffine(
        image,
        matrix,
        (image.shape[1], image.shape[0]),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REFLECT,
    )


def test_exact_reference_is_home_with_measured_registration():
    ref = _scene()
    receipt = verify_home_pose(ref, ref.copy(), serial="OFFICE")
    assert receipt.isHome is True
    assert receipt.poseShiftPx is not None
    assert receipt.poseShiftPx <= 0.1


def test_small_measured_shift_inside_tolerance_is_home():
    ref = _scene()
    receipt = verify_home_pose(ref, _shift(ref, 3.0), serial="OFFICE")
    assert receipt.isHome is True
    assert receipt.poseShiftPx is not None
    assert receipt.poseShiftPx < 6.0


def test_shift_past_measured_tolerance_is_not_home():
    ref = _scene()
    receipt = verify_home_pose(ref, _shift(ref, 14.0), serial="OFFICE")
    assert receipt.isHome is False
    assert receipt.poseShiftPx is not None
    assert receipt.poseShiftPx > 6.0


def test_foreground_change_does_not_fake_camera_motion():
    import cv2

    ref = _scene()
    current = ref.copy()
    # A large vehicle/person-like foreground change while the underlying view stays fixed.
    cv2.rectangle(current, (255, 210), (410, 335), (15, 15, 15), -1)
    receipt = verify_home_pose(ref, current, serial="OFFICE")
    assert receipt.isHome is True
    assert receipt.changedFraction < receipt.maxChangedFraction


def test_unrelated_scene_is_refused_as_untrustworthy_registration():
    ref = _scene()
    current = np.full_like(ref, 240)
    with pytest.raises(HomePoseError, match="confidence too low"):
        verify_home_pose(ref, current, serial="OFFICE")


def test_missing_registration_is_unknown_not_home():
    ref = _scene()
    with patch.object(SceneLock, "_registration", return_value=(None, None)):
        with pytest.raises(HomePoseError, match="registration unavailable"):
            verify_home_pose(ref, ref.copy(), serial="OFFICE")


def test_shape_mismatch_is_refused():
    ref = _scene()
    with pytest.raises(HomePoseError, match="shape mismatch"):
        verify_home_pose(ref, ref[:300], serial="OFFICE")


def test_receipt_write_is_atomic_and_round_trips(tmp_path: Path):
    ref = _scene()
    at = datetime(2026, 9, 27, 10, 0, tzinfo=timezone.utc)
    receipt = verify_home_pose(ref, ref.copy(), serial="OFFICE", verified_at=at)
    target = tmp_path / "home-pose.json"

    result = write_receipt(target, receipt)

    assert result == target
    payload = json.loads(target.read_text(encoding="utf-8"))
    assert payload["serial"] == "OFFICE"
    assert payload["isHome"] is True
    assert payload["verifiedAt"] == "2026-09-27T10:00:00+00:00"
    assert list(tmp_path.glob("*.tmp")) == []
