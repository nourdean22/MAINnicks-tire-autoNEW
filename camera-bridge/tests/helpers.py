"""Shared builders for the unit tests (stdlib only, no clock, no network)."""
from __future__ import annotations

import os
import sys
from typing import Dict, List, Optional, Sequence

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from visitd.frigate_events import FrigateEvent, LprUpdate, parse_event, parse_tracked_object_update  # noqa: E402
from visitd.state_machine import CameraSpec, Emission, TopologyLink, VisitPolicy, VisitTracker  # noqa: E402

FIXTURES = os.path.join(ROOT, "tests", "fixtures")
T0 = 1757347331.12
BOX = (400, 300, 700, 520)


def fixture(name: str) -> str:
    """Absolute path of a JSONL fixture."""
    return os.path.join(FIXTURES, name)


def cameras() -> Dict[str, CameraSpec]:
    """Two cameras matching config.example.yaml, plus a bay zone on `bay`."""
    return {
        "lot": CameraSpec("lot", frozenset({"front_lot", "entrance_lane"}), frozenset()),
        "sign": CameraSpec("sign", frozenset({"bay_entrance"}), frozenset()),
        "bay": CameraSpec("bay", frozenset(), frozenset({"bay_1"})),
    }


def policy(**overrides: object) -> VisitPolicy:
    """Default policy with the sign->lot topology link."""
    base = dict(topology=(TopologyLink("sign", "lot", 1.0, 90.0),))
    base.update(overrides)
    return VisitPolicy(**base)  # type: ignore[arg-type]


class Ids:
    """Deterministic visit ids: V1, V2, ..."""

    def __init__(self) -> None:
        self.n = 0

    def __call__(self) -> str:
        self.n += 1
        return f"V{self.n}"


def tracker(**overrides: object) -> VisitTracker:
    """Tracker with deterministic ids."""
    return VisitTracker(policy(**overrides), cameras(), id_factory=Ids())


def ev(
    kind: str,
    oid: str,
    at: float,
    zones: Sequence[str] = (),
    camera: str = "lot",
    start: Optional[float] = None,
    box: Sequence[int] = BOX,
    stationary: bool = False,
    end: Optional[float] = None,
    plate: Optional[str] = None,
    plate_score: Optional[float] = None,
    sub_label: Optional[str] = None,
    label: str = "car",
    score: float = 0.85,
) -> FrigateEvent:
    """Build a parsed frigate/events message."""
    after = {
        "id": oid, "camera": camera, "label": label, "score": score, "top_score": max(score, 0.9),
        "frame_time": at, "start_time": start if start is not None else at, "end_time": end, "box": list(box),
        "area": (box[2] - box[0]) * (box[3] - box[1]), "stationary": stationary, "motionless_count": 50 if stationary else 0,
        "current_zones": list(zones), "entered_zones": list(zones),
        "recognized_license_plate": plate, "recognized_license_plate_score": plate_score, "sub_label": sub_label,
    }
    return parse_event({"type": kind, "before": {}, "after": after})


def lpr(oid: str, plate: str, score: float, at: float, camera: str = "lot") -> LprUpdate:
    """Build a parsed lpr update."""
    parsed = parse_tracked_object_update({"type": "lpr", "id": oid, "plate": plate, "score": score, "camera": camera, "timestamp": at})
    assert parsed is not None
    return parsed


def states(emissions: Sequence[Emission]) -> List[str]:
    """State names in order."""
    return [e.state for e in emissions]


def ticks(t: VisitTracker, start: float, stop: float, step: float = 5.0) -> List[Emission]:
    """Tick from start (exclusive) to stop (inclusive) in `step` seconds."""
    out: List[Emission] = []
    now = start + step
    while now <= stop + 1e-9:
        out.extend(t.tick(now))
        now += step
    return out
