"""Regenerate the JSONL replay fixtures (python tests/fixtures/make_fixtures.py).

Payloads mirror Frigate 0.17.2 `frigate/events` and `frigate/tracked_object_update`
messages field-for-field. T0 = 2026-09-08T16:02:11.12Z, the plan's example.
"""
from __future__ import annotations

import json
import os
from typing import Dict, List, Optional, Sequence

T0 = 1757347331.12
HERE = os.path.dirname(os.path.abspath(__file__))


def obj(
    oid: str,
    camera: str,
    start: float,
    frame: float,
    zones: Sequence[str],
    box: Sequence[int],
    score: float = 0.82,
    top: float = 0.9,
    stationary: bool = False,
    motionless: int = 0,
    end: Optional[float] = None,
    plate: Optional[str] = None,
    plate_score: Optional[float] = None,
    sub_label: Optional[str] = None,
    entered: Optional[Sequence[str]] = None,
) -> Dict[str, object]:
    """One before/after block."""
    x1, y1, x2, y2 = box
    return {
        "id": oid,
        "camera": camera,
        "frame_time": round(frame, 3),
        "snapshot": None,
        "label": "car",
        "sub_label": sub_label,
        "top_score": top,
        "false_positive": False,
        "start_time": round(start, 3),
        "end_time": None if end is None else round(end, 3),
        "score": score,
        "box": [x1, y1, x2, y2],
        "area": (x2 - x1) * (y2 - y1),
        "ratio": round((x2 - x1) / max(1, y2 - y1), 3),
        "region": [max(0, x1 - 100), max(0, y1 - 100), x2 + 100, y2 + 100],
        "active": not stationary,
        "stationary": stationary,
        "motionless_count": motionless,
        "position_changes": 1,
        "current_zones": list(zones),
        "entered_zones": list(entered if entered is not None else zones),
        "has_clip": True,
        "has_snapshot": True,
        "attributes": {},
        "current_attributes": [],
        "recognized_license_plate": plate,
        "recognized_license_plate_score": plate_score,
    }


def event(kind: str, before: Optional[Dict[str, object]], after: Dict[str, object]) -> Dict[str, object]:
    """frigate/events record."""
    return {"topic": "frigate/events", "payload": {"type": kind, "before": before or {}, "after": after}}


def lpr(oid: str, camera: str, plate: str, score: float, at: float) -> Dict[str, object]:
    """frigate/tracked_object_update lpr record."""
    return {"topic": "frigate/tracked_object_update", "payload": {"type": "lpr", "id": oid, "plate": plate, "score": score, "camera": camera, "timestamp": round(at, 3)}}


def arrival_and_leave() -> List[Dict[str, object]]:
    """One car: enters front_lot, parks (stationary), plate read, leaves after ~5 min."""
    oid = "1757347331.12-abc123"
    b = (400, 300, 700, 520)
    a0 = obj(oid, "lot", T0, T0, [], b, score=0.72, top=0.72)
    a1 = obj(oid, "lot", T0, T0 + 0.6, ["front_lot"], b, score=0.8, top=0.8)
    a2 = obj(oid, "lot", T0, T0 + 8.0, ["front_lot"], b, score=0.87, top=0.9)
    a3 = obj(oid, "lot", T0, T0 + 12.0, ["front_lot"], b, score=0.87, top=0.9, stationary=True, motionless=50)
    a4 = obj(oid, "lot", T0, T0 + 40.0, ["front_lot"], b, score=0.87, top=0.9, stationary=True, motionless=190, plate="ABC1234", plate_score=0.93)
    a5 = obj(oid, "lot", T0, T0 + 300.0, ["front_lot"], (420, 305, 715, 525), score=0.85, top=0.9, stationary=False, motionless=0, plate="ABC1234", plate_score=0.93)
    a6 = obj(oid, "lot", T0, T0 + 306.0, [], (900, 350, 1180, 560), score=0.8, top=0.9, plate="ABC1234", plate_score=0.93, entered=["front_lot"])
    a7 = obj(oid, "lot", T0, T0 + 309.0, [], (1100, 380, 1280, 580), score=0.8, top=0.9, end=T0 + 309.0, plate="ABC1234", plate_score=0.93, entered=["front_lot"])
    return [
        event("new", None, a0), event("update", a0, a1), event("update", a1, a2), event("update", a2, a3),
        event("update", a3, a4), lpr(oid, "lot", "ABC1234", 0.95, T0 + 41.0), event("update", a4, a5),
        event("update", a5, a6), event("end", a6, a7),
    ]


def pass_through() -> List[Dict[str, object]]:
    """One car drives through front_lot in 4 s and leaves the frame."""
    oid = "1757347400.5-pt0001"
    s = T0 + 69.38
    a0 = obj(oid, "lot", s, s, [], (0, 320, 180, 480), score=0.7, top=0.7)
    a1 = obj(oid, "lot", s, s + 0.6, ["front_lot"], (120, 320, 330, 490), score=0.78, top=0.8)
    a2 = obj(oid, "lot", s, s + 4.0, [], (900, 330, 1130, 500), score=0.8, top=0.82, entered=["front_lot"])
    a3 = obj(oid, "lot", s, s + 7.0, [], (1150, 330, 1280, 500), score=0.8, top=0.82, end=s + 7.0, entered=["front_lot"])
    return [event("new", None, a0), event("update", a0, a1), event("update", a1, a2), event("end", a2, a3)]


def split_track() -> List[Dict[str, object]]:
    """One parked car whose Frigate track ends inside the zone (occlusion) and restarts 3 s later."""
    a_id = "1757347500.0-trackA"
    b_id = "1757347533.0-trackB"
    s = T0 + 168.88
    b = (400, 300, 700, 520)
    a0 = obj(a_id, "lot", s, s, [], b, score=0.75, top=0.75)
    a1 = obj(a_id, "lot", s, s + 0.6, ["front_lot"], b, score=0.8, top=0.85)
    a2 = obj(a_id, "lot", s, s + 12.0, ["front_lot"], b, score=0.86, top=0.9, stationary=True, motionless=50)
    a3 = obj(a_id, "lot", s, s + 30.0, ["front_lot"], b, score=0.86, top=0.9, stationary=True, motionless=140, end=s + 30.0)
    s2 = s + 33.0
    b0 = obj(b_id, "lot", s2, s2, [], (405, 302, 702, 522), score=0.74, top=0.74)
    b1 = obj(b_id, "lot", s2, s2 + 0.6, ["front_lot"], (405, 302, 702, 522), score=0.8, top=0.86)
    b2 = obj(b_id, "lot", s2, s2 + 20.0, ["front_lot"], (405, 302, 702, 522), score=0.86, top=0.9, stationary=True, motionless=90)
    b3 = obj(b_id, "lot", s2, s + 120.0, [], (950, 340, 1200, 560), score=0.82, top=0.9, entered=["front_lot"])
    b4 = obj(b_id, "lot", s2, s + 123.0, [], (1120, 360, 1280, 580), score=0.82, top=0.9, end=s + 123.0, entered=["front_lot"])
    return [
        event("new", None, a0), event("update", a0, a1), event("update", a1, a2), event("end", a2, a3),
        event("new", None, b0), event("update", b0, b1), event("update", b1, b2), event("update", b2, b3), event("end", b3, b4),
    ]


def write(name: str, records: List[Dict[str, object]]) -> None:
    """Write one JSONL fixture."""
    path = os.path.join(HERE, name)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(f"# generated by make_fixtures.py - {name}\n")
        for rec in records:
            fh.write(json.dumps(rec, separators=(",", ":")) + "\n")
    print(f"wrote {path} ({len(records)} records)")


if __name__ == "__main__":
    write("arrival_and_leave.jsonl", arrival_and_leave())
    write("pass_through.jsonl", pass_through())
    write("split_track.jsonl", split_track())
