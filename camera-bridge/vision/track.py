"""
TrackGraph: a ByteTrack-style two-stage associator.

ByteTrack's key idea is that low-confidence detections are usually occluded real
objects, not noise. Stage 1 matches high-score detections to active tracks; stage 2
offers the LEFTOVER low-score detections to the tracks that stayed unmatched, which is
what recovers a car passing behind another car. New tracks are born only from
high-score detections, so noise never mints an identity.

Association is deliberately geometric and temporal, not appearance-based. Deep ReID is
supporting evidence for hard cross-camera stitching (see fingerprint.py), never the
ordinary same-camera association mechanism -- an appearance model that decides identity
will happily merge two customers' cars of the same colour.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Optional, Sequence

from .frame import Box, Detection, iou


@dataclass
class Track:
    track_id: int
    box: Box
    score: float
    born_ts: float
    last_seen: float
    still_since: float
    source: str = "unknown"
    hits: int = 1
    misses: int = 0
    evidence: str = "candidate"          # preexisting | candidate | arrival
    entry_reason: str = ""
    degraded: bool = False               # camera moved while this track was alive
    confirmable: bool = False            # produced by a detector allowed to confirm
    path: deque[tuple[float, float]] = field(default_factory=lambda: deque(maxlen=240))
    zones: list[str] = field(default_factory=list)

    @property
    def ground_point(self) -> tuple[float, float]:
        x1, _y1, x2, y2 = self.box
        return ((x1 + x2) / 2.0, y2)

    def stationary_for(self, now: float) -> float:
        return max(0.0, now - self.still_since)


class TrackGraph:
    def __init__(
        self,
        high_score: float = 0.55,
        match_iou: float = 0.25,
        low_match_iou: float = 0.15,
        max_misses: int = 12,
        move_epsilon: float = 14.0,
    ) -> None:
        self.high_score = high_score
        self.match_iou = match_iou
        self.low_match_iou = low_match_iou
        self.max_misses = max_misses
        self.move_epsilon = move_epsilon
        self.tracks: dict[int, Track] = {}
        self._next_id = 1

    def _match(self, tracks: list[Track], dets: list[Detection], thresh: float
               ) -> tuple[list[tuple[Track, Detection]], list[Track], list[Detection]]:
        pairs: list[tuple[float, Track, Detection]] = []
        for t in tracks:
            for d in dets:
                score = iou(t.box, d.box)
                if score >= thresh:
                    pairs.append((score, t, d))
        pairs.sort(key=lambda p: p[0], reverse=True)
        used_t: set[int] = set()
        used_d: set[int] = set()
        matched: list[tuple[Track, Detection]] = []
        for score, t, d in pairs:
            if id(t) in used_t or id(d) in used_d:
                continue
            used_t.add(id(t))
            used_d.add(id(d))
            matched.append((t, d))
        rem_t = [t for t in tracks if id(t) not in used_t]
        rem_d = [d for d in dets if id(d) not in used_d]
        return matched, rem_t, rem_d

    def update(self, detections: Sequence[Detection], now: float,
               confirmable: bool = True) -> tuple[list[Track], list[Track]]:
        """Advance one frame. Returns (born, died)."""
        dets = list(detections)
        high = [d for d in dets if d.score >= self.high_score]
        low = [d for d in dets if d.score < self.high_score]
        active = list(self.tracks.values())

        matched, rem_tracks, rem_high = self._match(active, high, self.match_iou)
        matched2, rem_tracks2, _rem_low = self._match(rem_tracks, low, self.low_match_iou)

        for t, d in matched + matched2:
            prev = t.ground_point
            t.box = d.box
            t.score = d.score
            t.source = d.source
            t.last_seen = now
            t.hits += 1
            t.misses = 0
            # NOT `or`: latching this True meant a track seen once by a real detector
            # kept arrival authority through a detector outage, while its path -- the
            # input to EntryPortal -- accrued points from whatever ran instead.
            t.confirmable = confirmable
            new_pt = t.ground_point
            if ((new_pt[0] - prev[0]) ** 2 + (new_pt[1] - prev[1]) ** 2) ** 0.5 > self.move_epsilon:
                t.still_since = now
            t.path.append(new_pt)

        died: list[Track] = []
        for t in rem_tracks2:
            t.misses += 1
            if t.misses > self.max_misses:
                died.append(t)
        for t in died:
            self.tracks.pop(t.track_id, None)

        born: list[Track] = []
        for d in rem_high:
            t = Track(
                track_id=self._next_id, box=d.box, score=d.score, born_ts=now,
                last_seen=now, still_since=now, source=d.source, confirmable=confirmable,
            )
            t.path.append(t.ground_point)
            self._next_id += 1
            self.tracks[t.track_id] = t
            born.append(t)

        return born, died

    def mark_degraded(self) -> None:
        """Mark every track as observed through a degraded interval.

        Also DISCARDS the ground-point history of tracks that are not yet arrivals. A
        candidate that survives a freeze, an unverified stretch or a PTZ pan would
        otherwise keep its pre-blackout samples, and combining outside samples from
        BEFORE the blind interval with inside samples from AFTER it reads as a portal
        crossing that nobody observed. An arrival keeps its path: its crossing already
        happened and is already evidenced.
        """
        for t in self.tracks.values():
            t.degraded = True
            if t.evidence != "arrival":
                t.path.clear()
                t.path.append(t.ground_point)

    def get(self, track_id: int) -> Optional[Track]:
        return self.tracks.get(track_id)
