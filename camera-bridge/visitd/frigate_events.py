"""Normalize Frigate 0.17 MQTT payloads into plain, validated dataclasses.

Two topics are understood:
  frigate/events                -> FrigateEvent  {type: new|update|end, before, after}
  frigate/tracked_object_update -> LprUpdate     {type: "lpr", id, plate, score, camera, timestamp}

Everything else returns None from parse_message(). Missing optional fields get
safe defaults; a payload without an object id or camera is rejected with
ValueError so a malformed message can never reach the state machine.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Mapping, Optional, Tuple, Union

VEHICLE_LABELS = frozenset({"car", "truck", "motorcycle", "bus"})
EVENT_TYPES = frozenset({"new", "update", "end"})

Box = Tuple[int, int, int, int]


@dataclass(frozen=True)
class ObjectSnapshot:
    """One `before`/`after` block of a frigate/events message."""

    id: str
    camera: str
    label: str
    score: float
    top_score: float
    frame_time: float
    start_time: float
    end_time: Optional[float]
    box: Optional[Box]
    area: int
    stationary: bool
    motionless_count: int
    current_zones: Tuple[str, ...]
    entered_zones: Tuple[str, ...]
    recognized_license_plate: Optional[str]
    recognized_license_plate_score: Optional[float]
    sub_label: Optional[str]


@dataclass(frozen=True)
class FrigateEvent:
    """A normalized frigate/events message."""

    type: str
    before: Optional[ObjectSnapshot]
    after: ObjectSnapshot

    @property
    def time(self) -> float:
        """Frame time the message describes (end_time for `end` when present)."""
        if self.type == "end" and self.after.end_time is not None:
            return self.after.end_time
        return self.after.frame_time


@dataclass(frozen=True)
class LprUpdate:
    """A normalized frigate/tracked_object_update message of type `lpr`."""

    id: str
    plate: str
    score: float
    camera: Optional[str]
    timestamp: Optional[float]


def _float(value: Any, default: float = 0.0) -> float:
    """Coerce a JSON number to float, tolerating None and strings."""
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _opt_float(value: Any) -> Optional[float]:
    """Coerce to float or None."""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _str_tuple(value: Any) -> Tuple[str, ...]:
    """Coerce a JSON list of strings to a tuple, dropping non-strings."""
    if not isinstance(value, (list, tuple)):
        return ()
    return tuple(v for v in value if isinstance(v, str))


def _box(value: Any) -> Optional[Box]:
    """Coerce a 4-number list to an int box tuple, else None."""
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return None
    try:
        return (int(value[0]), int(value[1]), int(value[2]), int(value[3]))
    except (TypeError, ValueError):
        return None


def _sub_label(value: Any) -> Optional[str]:
    """Frigate emits sub_label as a string or a [name, score] pair; return the name."""
    if isinstance(value, str):
        return value or None
    if isinstance(value, (list, tuple)) and value and isinstance(value[0], str):
        return value[0] or None
    return None


def parse_snapshot(raw: Mapping[str, Any]) -> ObjectSnapshot:
    """Parse one before/after object block; raises ValueError without id or camera."""
    obj_id = raw.get("id")
    camera = raw.get("camera")
    if not isinstance(obj_id, str) or not obj_id:
        raise ValueError("object snapshot without id")
    if not isinstance(camera, str) or not camera:
        raise ValueError("object snapshot without camera")
    frame_time = _float(raw.get("frame_time"), default=_float(raw.get("start_time")))
    start_time = _float(raw.get("start_time"), default=frame_time)
    plate = raw.get("recognized_license_plate")
    return ObjectSnapshot(
        id=obj_id,
        camera=camera,
        label=str(raw.get("label") or "unknown"),
        score=_float(raw.get("score")),
        top_score=_float(raw.get("top_score"), default=_float(raw.get("score"))),
        frame_time=frame_time,
        start_time=start_time,
        end_time=_opt_float(raw.get("end_time")),
        box=_box(raw.get("box")),
        area=int(_float(raw.get("area"))),
        stationary=bool(raw.get("stationary", False)),
        motionless_count=int(_float(raw.get("motionless_count"))),
        current_zones=_str_tuple(raw.get("current_zones")),
        entered_zones=_str_tuple(raw.get("entered_zones")),
        recognized_license_plate=plate if isinstance(plate, str) and plate else None,
        recognized_license_plate_score=_opt_float(raw.get("recognized_license_plate_score")),
        sub_label=_sub_label(raw.get("sub_label")),
    )


def parse_event(payload: Mapping[str, Any]) -> FrigateEvent:
    """Parse a frigate/events payload; raises ValueError when malformed."""
    if not isinstance(payload, Mapping):
        raise ValueError("event payload is not an object")
    ev_type = payload.get("type")
    if ev_type not in EVENT_TYPES:
        raise ValueError(f"unknown event type: {ev_type!r}")
    after_raw = payload.get("after")
    if not isinstance(after_raw, Mapping):
        raise ValueError("event without after block")
    before_raw = payload.get("before")
    before = None
    if isinstance(before_raw, Mapping) and before_raw.get("id"):
        try:
            before = parse_snapshot(before_raw)
        except ValueError:
            before = None
    return FrigateEvent(type=str(ev_type), before=before, after=parse_snapshot(after_raw))


def parse_tracked_object_update(payload: Mapping[str, Any]) -> Optional[LprUpdate]:
    """Parse a frigate/tracked_object_update payload; None unless it is an lpr update."""
    if not isinstance(payload, Mapping) or payload.get("type") != "lpr":
        return None
    obj_id = payload.get("id")
    plate = payload.get("plate")
    if not isinstance(obj_id, str) or not obj_id or not isinstance(plate, str) or not plate:
        raise ValueError("lpr update without id or plate")
    camera = payload.get("camera")
    return LprUpdate(
        id=obj_id,
        plate=plate,
        score=_float(payload.get("score")),
        camera=camera if isinstance(camera, str) and camera else None,
        timestamp=_opt_float(payload.get("timestamp")),
    )


def parse_message(
    topic: str, payload: Union[bytes, str, Mapping[str, Any]], topic_prefix: str = "frigate"
) -> Optional[Union[FrigateEvent, LprUpdate]]:
    """Route a raw MQTT message by topic; returns None for topics visitd ignores."""
    is_event = topic == f"{topic_prefix}/events"
    is_update = topic == f"{topic_prefix}/tracked_object_update"
    if not (is_event or is_update):
        return None
    if isinstance(payload, (bytes, bytearray)):
        payload = payload.decode("utf-8", errors="replace")
    if isinstance(payload, str):
        payload = json.loads(payload)
    return parse_event(payload) if is_event else parse_tracked_object_update(payload)
