"""
DetectorCouncil: a cascade, not a single favourite model.

    frame -> MotionGate (cheap trigger only)
          -> primary vehicle detector (tiny, always-on)
          -> adjudicator (heavier, only for ambiguous / entry-critical frames)
          -> fused observation

The hard invariant, enforced here and asserted by a test:

    **MOTION ALONE CAN NEVER CONFIRM A CUSTOMER ARRIVAL.**

MOG2 responds to foreground change -- shadows, the V380 pane refresh, the OSD clock,
trees, and re-detected parked cars. It is retained as an inexpensive compute trigger
and a diagnostic signal, and its detections are marked `can_confirm=False`. If every
neural detector is unavailable, the council still reports occupancy/motion, but
`can_confirm_arrival` is False and the pipeline refuses to create visits.

Licensing: Intel Open Model Zoo IR models and OpenVINO are Apache-2.0. AGPL
Ultralytics/BoxMOT stay rejected. D-FINE pretrained weights are NOT vendored -- the
distributed-weights licence (Objects365-derived) was still unresolved as of
2026-08-19.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional, Sequence

import numpy as np

from .frame import Detection


class DetectorUnavailable(RuntimeError):
    """Raised when a detector's runtime or weights are not present on this machine."""


class Detector:
    name: str = "detector"
    can_confirm: bool = False

    def detect(self, image: np.ndarray) -> list[Detection]:  # pragma: no cover - interface
        raise NotImplementedError


class StubDetector(Detector):
    """Scripted detector for offline tests and replay of recorded detections."""

    def __init__(self, script: Sequence[Sequence[Detection]], name: str = "stub",
                 can_confirm: bool = True) -> None:
        self.name = name
        self.can_confirm = can_confirm
        self._script = list(script)
        self._i = 0

    def detect(self, image: Optional[np.ndarray]) -> list[Detection]:
        if self._i < len(self._script):
            out = list(self._script[self._i])
        else:
            out = []
        self._i += 1
        return [Detection(d.box, d.score, d.label, self.name) for d in out]


class Mog2MotionDetector(Detector):
    """Background subtraction. A COMPUTE TRIGGER and diagnostic -- never a confirmation."""

    name = "mog2"
    can_confirm = False

    def __init__(self, min_area_frac: float = 0.006, history: int = 500,
                 var_threshold: float = 40.0) -> None:
        try:
            import cv2  # noqa: WPS433 - optional dependency
        except Exception as exc:  # pragma: no cover - environment dependent
            raise DetectorUnavailable(f"opencv not available: {exc!r}") from exc
        self._cv2 = cv2
        self.min_area_frac = min_area_frac
        self._mog = cv2.createBackgroundSubtractorMOG2(
            history=history, varThreshold=var_threshold, detectShadows=True
        )

    def detect(self, image: Optional[np.ndarray]) -> list[Detection]:
        # A capture gap hands None down the pipeline (FailureInjector.camera_restart does
        # exactly this). Crashing on it would take out the whole loop on a blackout.
        if image is None:
            return []
        cv2 = self._cv2
        h, w = image.shape[:2]
        frame_area = float(h * w)
        blurred = cv2.GaussianBlur(image, (5, 5), 0)
        fg = self._mog.apply(blurred)
        _, fg = cv2.threshold(fg, 200, 255, cv2.THRESH_BINARY)
        fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        fg = cv2.dilate(fg, np.ones((9, 9), np.uint8), 2)
        contours, _ = cv2.findContours(fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        out: list[Detection] = []
        for c in contours:
            if cv2.contourArea(c) < frame_area * self.min_area_frac:
                continue
            x, y, bw, bh = cv2.boundingRect(c)
            if bh < 24 or not (0.6 <= bw / float(bh) <= 4.5):
                continue
            out.append(Detection((float(x), float(y), float(x + bw), float(y + bh)),
                                 score=0.5, label="motion", source=self.name))
        return out

    def has_motion(self, image: np.ndarray) -> bool:
        return bool(self.detect(image))


class OpenVinoVehicleDetector(Detector):
    """Intel OpenVINO IR vehicle detector (e.g. vehicle-detection-0200, 256x256 SSD).

    Parses the standard SSD detection output [1, 1, N, 7]:
    [image_id, label, confidence, x_min, y_min, x_max, y_max] in normalised coords.

    `device` is passed through verbatim so CPU / GPU / NPU can each be benchmarked --
    AUTO does NOT select the NPU on its own.
    """

    can_confirm = True

    def __init__(self, model_xml: str, device: str = "CPU", conf: float = 0.5,
                 name: Optional[str] = None) -> None:
        try:
            import openvino as ov  # noqa: WPS433 - optional dependency
        except Exception as exc:
            raise DetectorUnavailable(f"openvino not installed: {exc!r}") from exc
        import os

        if not os.path.exists(model_xml):
            raise DetectorUnavailable(f"model IR not found: {model_xml}")
        self._ov = ov
        self.device = device
        self.conf = conf
        self.model_xml = model_xml
        self.name = name or f"openvino:{os.path.basename(model_xml).replace('.xml', '')}"
        core = ov.Core()
        if device not in core.available_devices and device != "AUTO":
            raise DetectorUnavailable(
                f"device {device} not available; have {core.available_devices}"
            )
        # THE LOAD ITSELF, guarded. Everything above this raises `DetectorUnavailable` -- the
        # contract every caller is written against -- and then the actual read was left bare.
        # OpenVINO raises a plain RuntimeError for an IR it cannot parse, so a TRUNCATED OR
        # CORRUPT model file crashed the producer at startup instead of degrading to the
        # documented motion-only path. That is not hypothetical: `fetch_models.py` pins a size
        # and a sha256 precisely because a half-finished download is a thing that happens, and
        # the crash lands before any of that verification could have reported it.
        try:
            model = core.read_model(model_xml)
            self._compiled = core.compile_model(model, device)
        except DetectorUnavailable:
            raise
        except Exception as exc:  # noqa: BLE001 - any load failure is unavailability, not a crash
            raise DetectorUnavailable(
                f"model IR at {model_xml} could not be loaded on {device}: {type(exc).__name__}. "
                "A truncated or corrupt download reads exactly like this -- re-run "
                "`python vision/fetch_models.py --verify-only` to check its size and sha256."
            ) from exc
        self._input = self._compiled.input(0)
        shape = self._input.shape
        # NCHW
        self.in_h, self.in_w = int(shape[2]), int(shape[3])
        self.last_latency_ms: float = 0.0

    def detect(self, image: Optional[np.ndarray]) -> list[Detection]:
        import cv2

        if image is None:
            return []
        h, w = image.shape[:2]
        bgr = image[:, :, :3] if image.ndim == 3 else cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
        resized = cv2.resize(bgr, (self.in_w, self.in_h))
        blob = np.ascontiguousarray(resized.transpose(2, 0, 1)[None].astype(np.float32))
        t0 = time.perf_counter()
        result = self._compiled([blob])
        self.last_latency_ms = (time.perf_counter() - t0) * 1000.0
        raw = list(result.values())[0]
        arr = np.asarray(raw).reshape(-1, 7)
        out: list[Detection] = []
        for row in arr:
            conf = float(row[2])
            if conf < self.conf:
                continue
            x1, y1, x2, y2 = (float(row[3]) * w, float(row[4]) * h,
                              float(row[5]) * w, float(row[6]) * h)
            if x2 <= x1 or y2 <= y1:
                continue
            out.append(Detection(
                (max(0.0, x1), max(0.0, y1), min(float(w), x2), min(float(h), y2)),
                score=conf, label="vehicle", source=self.name,
            ))
        return out


@dataclass
class CouncilResult:
    detections: list[Detection] = field(default_factory=list)
    can_confirm_arrival: bool = False
    motion_only: bool = False
    escalated: bool = False
    skipped_no_motion: bool = False
    latency_ms: float = 0.0
    reason: str = ""
    by_detector: dict[str, int] = field(default_factory=dict)


class DetectorCouncil:
    """Motion gate -> primary vehicle detector -> optional adjudicator.

    `degrade_to_motion=True` keeps returning motion observations when every neural
    detector is unavailable, but the result's `can_confirm_arrival` stays False so no
    caller can accidentally promote motion to a customer visit.
    """

    def __init__(
        self,
        primary: Optional[Detector] = None,
        motion_gate: Optional[Detector] = None,
        adjudicator: Optional[Detector] = None,
        low_conf: float = 0.35,
        high_conf: float = 0.70,
        degrade_to_motion: bool = True,
    ) -> None:
        self.primary = primary
        self.motion_gate = motion_gate
        self.adjudicator = adjudicator
        self.low_conf = low_conf
        self.high_conf = high_conf
        self.degrade_to_motion = degrade_to_motion

    def run(self, image: Optional[np.ndarray], entry_critical: bool = False) -> CouncilResult:
        t0 = time.perf_counter()
        res = CouncilResult()
        if image is None:
            # No pixels is not an empty scene. Report it, confirm nothing.
            res.can_confirm_arrival = False
            res.reason = "no image: capture gap"
            res.latency_ms = (time.perf_counter() - t0) * 1000.0
            return res

        motion_dets: list[Detection] = []
        if self.motion_gate is not None:
            motion_dets = self.motion_gate.detect(image)
            res.by_detector[self.motion_gate.name] = len(motion_dets)

        # `can_confirm` is the enforcement mechanism for this file's hard invariant, so
        # it has to be READ, not merely declared. It was declared on every detector and
        # never consulted here, which left invariant 4 resting on the convention that
        # MOG2 is wired as `motion_gate` rather than `primary`. Wire a can_confirm=False
        # detector as `primary` and the council used to hand back arrival authority.
        primary_can_confirm = bool(self.primary is not None and self.primary.can_confirm)

        if self.primary is None or not primary_can_confirm:
            # Either no detector at all, or only one that is not allowed to confirm.
            # Report occupancy honestly; confirm nothing.
            fallback = motion_dets
            if self.primary is not None:
                fallback = self.primary.detect(image) or motion_dets
            res.detections = fallback if self.degrade_to_motion else []
            res.motion_only = True
            res.can_confirm_arrival = False
            res.reason = (
                "no vehicle detector available: motion/occupancy uncertain only"
                if self.primary is None
                else f"detector {self.primary.name!r} is not permitted to confirm arrivals: "
                     "motion/occupancy uncertain only"
            )
            res.latency_ms = (time.perf_counter() - t0) * 1000.0
            return res

        # The motion gate saves compute, but it must not be able to hide a vehicle on an
        # entry-critical frame, so escalate regardless when the caller flags one.
        if self.motion_gate is not None and not motion_dets and not entry_critical:
            res.skipped_no_motion = True
            res.can_confirm_arrival = primary_can_confirm
            res.reason = "no motion: heavy detector skipped"
            res.latency_ms = (time.perf_counter() - t0) * 1000.0
            return res

        dets = self.primary.detect(image)
        res.by_detector[self.primary.name] = len(dets)
        confident = [d for d in dets if d.score >= self.high_conf]
        ambiguous = [d for d in dets if self.low_conf <= d.score < self.high_conf]

        if self.adjudicator is not None and (ambiguous or entry_critical):
            adj = self.adjudicator.detect(image)
            res.by_detector[self.adjudicator.name] = len(adj)
            res.escalated = True
            dets = self._fuse(confident, ambiguous, adj)

        res.detections = [d for d in dets if d.score >= self.low_conf]
        res.can_confirm_arrival = primary_can_confirm
        res.reason = "vehicle detector ran"
        res.latency_ms = (time.perf_counter() - t0) * 1000.0
        return res

    @staticmethod
    def _fuse(confident: list[Detection], ambiguous: list[Detection],
              adjudicated: list[Detection]) -> list[Detection]:
        """Keep confident primaries; promote an ambiguous box the adjudicator agrees with."""
        from .frame import iou

        out = list(confident)
        for a in ambiguous:
            best = max((iou(a.box, b.box) for b in adjudicated), default=0.0)
            if best >= 0.5:
                out.append(Detection(a.box, min(0.99, a.score + 0.25), a.label,
                                     f"{a.source}+adjudicated"))
        for b in adjudicated:
            if max((iou(b.box, o.box) for o in out), default=0.0) < 0.5:
                out.append(b)
        return out
