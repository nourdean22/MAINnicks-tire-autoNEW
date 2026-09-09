"""
EvidencePacket: every meaningful transition must be reconstructable, visually and
logically, without guessing.

An operator asking "why did the system say this car arrived?" gets: the before /
crossing / after frames, the camera pose, the track id, the detector scores and which
detector was allowed to confirm, the zone geometry and the exact rule that fired, the
plate candidates, the fingerprint's supports AND contradictions, and an explicit list
of which values were ESTIMATED rather than observed.

Frames are written as JPEG next to a JSONL journal, and every packet references its
frames by filename so the journal stays small and greppable.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Optional

import numpy as np


@dataclass
class EvidencePacket:
    event: str                       # e.g. CONFIRMED_ARRIVAL, PREEXISTING, BAY_ENTER
    ts: float
    camera: str
    track_id: Optional[int] = None
    visit_id: Optional[str] = None
    rule: str = ""                   # the exact transition rule that fired
    reasons: list[str] = field(default_factory=list)
    estimated: list[str] = field(default_factory=list)
    detector_scores: dict[str, Any] = field(default_factory=dict)
    pose: dict[str, Any] = field(default_factory=dict)
    zones: list[str] = field(default_factory=list)
    box: Optional[tuple[float, float, float, float]] = None
    plate: dict[str, Any] = field(default_factory=dict)
    fingerprint: dict[str, Any] = field(default_factory=dict)
    frames: dict[str, str] = field(default_factory=dict)   # role -> filename

    def to_dict(self) -> dict:
        return {
            "event": self.event,
            "ts": round(self.ts, 3),
            "camera": self.camera,
            "trackId": self.track_id,
            "visitId": self.visit_id,
            "rule": self.rule,
            "reasons": list(self.reasons),
            "estimated": list(self.estimated),
            "detectorScores": self.detector_scores,
            "pose": self.pose,
            "zones": list(self.zones),
            "box": list(self.box) if self.box else None,
            "plate": self.plate,
            "fingerprint": self.fingerprint,
            "frames": dict(self.frames),
        }


class EvidenceStore:
    """Writes packets to `<dir>/evidence.jsonl` and frames to `<dir>/frames/`.

    `enabled=False` makes every call a no-op so tests and headless replays don't
    litter the disk, without the pipeline needing to branch.
    """

    def __init__(self, directory: Optional[str] = None, enabled: bool = True,
                 jpeg_quality: int = 70) -> None:
        self.enabled = enabled and directory is not None
        self.directory = directory
        self.jpeg_quality = jpeg_quality
        self.packets: list[EvidencePacket] = []
        if self.enabled:
            os.makedirs(os.path.join(self.directory, "frames"), exist_ok=True)
            self._journal = os.path.join(self.directory, "evidence.jsonl")

    def save_frame(self, image: Optional[np.ndarray], name: str) -> str:
        if not self.enabled or image is None:
            return ""
        try:
            import cv2
        except Exception:
            return ""
        path = os.path.join(self.directory, "frames", f"{name}.jpg")
        cv2.imwrite(path, image, [int(cv2.IMWRITE_JPEG_QUALITY), self.jpeg_quality])
        return os.path.basename(path)

    def write(self, packet: EvidencePacket) -> EvidencePacket:
        self.packets.append(packet)
        if self.enabled:
            with open(self._journal, "a", encoding="ascii") as fh:
                fh.write(json.dumps(packet.to_dict(), default=str) + "\n")
        return packet

    def find(self, event: str) -> list[EvidencePacket]:
        return [p for p in self.packets if p.event == event]
