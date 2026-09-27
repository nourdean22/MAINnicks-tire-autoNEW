"""Trusted-reference PTZ home-pose verification.

This is intentionally a ONE-SHOT verifier, not an always-on detector. The office PTZ camera
may roam for interactions, but "home" becomes a factual claim only when a fresh image is
registered against an operator-approved reference view.

Truth rules:
- a motor acknowledgement is irrelevant here;
- a ptzNotify only proves the motor/P2P path moved;
- home requires visual registration to the trusted reference AFTER that receipt;
- inability to register is UNKNOWN/failure, never an inferred match;
- the JSON receipt is atomic so the StateNour heartbeat never reads a half-written proof.
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np

from .scenelock import SceneLock, gray_small

VERIFIER_VERSION = "office-home-pose-v2"


@dataclass(frozen=True)
class HomePoseReceipt:
    serial: str
    evidenceAt: str
    verifiedAt: str
    isHome: bool
    verifierVersion: str
    referenceSha256: str
    currentSha256: str
    poseShiftPx: float
    correlationResponse: float
    changedFraction: float
    maxShiftPx: float
    minCorrelationResponse: float
    maxChangedFraction: float


class HomePoseError(RuntimeError):
    """The verifier could not produce a trustworthy visual verdict."""


def _image_sha256(image: np.ndarray) -> str:
    contiguous = np.ascontiguousarray(image)
    return hashlib.sha256(contiguous.tobytes()).hexdigest()


def verify_home_pose(
    reference: np.ndarray,
    current: np.ndarray,
    *,
    serial: str,
    max_shift_px: float = 6.0,
    min_correlation_response: float = 0.20,
    max_changed_fraction: float = 0.65,
    evidence_at: Optional[datetime] = None,
    verified_at: Optional[datetime] = None,
) -> HomePoseReceipt:
    """Compare one current frame to a trusted home reference.

    SceneLock's measured phase-correlation registration is reused rather than copied.
    For THIS stronger "absolute home" claim, registration must actually be available;
    the normal SceneLock fixed-camera path may permissively fall back to changed-pixel
    fraction when OpenCV registration is unavailable, but a PTZ-home promotion may not.
    """
    if reference is None or current is None:
        raise HomePoseError("reference and current frames are required")
    if reference.ndim not in (2, 3) or current.ndim not in (2, 3):
        raise HomePoseError("reference/current must be image arrays")
    if reference.shape[:2] != current.shape[:2]:
        raise HomePoseError(
            f"frame shape mismatch: reference={reference.shape[:2]} current={current.shape[:2]}"
        )
    serial = str(serial or "").strip()
    if not serial:
        raise HomePoseError("camera serial is required")
    if max_shift_px <= 0:
        raise HomePoseError("max_shift_px must be positive")
    if not (0.0 < min_correlation_response <= 1.0):
        raise HomePoseError("min_correlation_response must be in (0, 1]")
    if not (0.0 <= max_changed_fraction <= 1.0):
        raise HomePoseError("max_changed_fraction must be between 0 and 1")

    evidence = evidence_at or datetime.now(timezone.utc)
    if evidence.tzinfo is None:
        evidence = evidence.replace(tzinfo=timezone.utc)

    lock = SceneLock(
        auto_reference=False,
        settle_frames=0,
        pose_max_shift_px=float(max_shift_px),
    )
    lock.set_reference(reference)

    ref_small = gray_small(reference)
    cur_small = gray_small(current)
    if ref_small.shape != cur_small.shape:
        raise HomePoseError("downscaled reference/current shapes differ")

    diff = np.abs(cur_small - ref_small)
    changed = float((diff > lock.pixel_delta).mean())

    # Absolute home needs BOTH displacement and confidence. phaseCorrelate returns a
    # displacement even for unrelated frames, so finite/near-zero shift alone is not proof.
    shift, response = lock._registration(cur_small)  # noqa: SLF001 - shared measured primitive
    if (
        shift is None
        or response is None
        or not np.isfinite(shift)
        or not np.isfinite(response)
    ):
        raise HomePoseError(
            "visual registration unavailable; refusing to infer PTZ home from pixel similarity"
        )
    if response < float(min_correlation_response):
        raise HomePoseError(
            f"visual registration confidence too low ({response:.4f} < "
            f"{min_correlation_response:.4f})"
        )

    is_home = bool(
        shift <= float(max_shift_px)
        and changed <= float(max_changed_fraction)
    )
    verified = verified_at or datetime.now(timezone.utc)
    if verified.tzinfo is None:
        verified = verified.replace(tzinfo=timezone.utc)

    return HomePoseReceipt(
        serial=serial,
        evidenceAt=evidence.astimezone(timezone.utc).isoformat(),
        verifiedAt=verified.astimezone(timezone.utc).isoformat(),
        isHome=is_home,
        verifierVersion=VERIFIER_VERSION,
        referenceSha256=_image_sha256(reference),
        currentSha256=_image_sha256(current),
        poseShiftPx=round(float(shift), 4),
        correlationResponse=round(float(response), 6),
        changedFraction=round(changed, 6),
        maxShiftPx=float(max_shift_px),
        minCorrelationResponse=float(min_correlation_response),
        maxChangedFraction=float(max_changed_fraction),
    )


def write_receipt(path: str | Path, receipt: HomePoseReceipt) -> Path:
    """Atomically replace the current home-pose receipt."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(asdict(receipt), sort_keys=True, indent=2) + "\n"

    fd, temp_name = tempfile.mkstemp(
        prefix=f".{target.name}.",
        suffix=".tmp",
        dir=str(target.parent),
        text=True,
    )
    temp = Path(temp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, target)
    except Exception:
        try:
            temp.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    return target
