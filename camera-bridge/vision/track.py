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
from .stitch import DEFAULT_MAX_SPEED_PX_S


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
    #: Wall-clock seconds this track existed through while the tracker could not observe
    #: the lot at all. Subtracted from stillness -- see `stationary_for`.
    blind_seconds: float = 0.0
    #: The miss tolerance actually applied when this track was retired, or None while it is
    #: alive. The tracker REPORTING its own decision, rather than a reader re-deriving it
    #: from `stationary_for` and `parked_after` and hoping neither has moved since. Read by
    #: the death ledger, which needs "was this vehicle being treated as settling or as
    #: parked?" to be a recorded fact rather than an inference.
    retired_allowed: Optional[int] = None
    path: deque[tuple[float, float]] = field(default_factory=lambda: deque(maxlen=240))
    zones: list[str] = field(default_factory=list)
    #: Arrival-zone hysteresis bookkeeping, written only by `VisionPipeline._settle_zones`.
    #: `last_in_arrival_ts` is the last frame the ground point was observed INSIDE the arrival
    #: zone; `zone_exit_frames` counts consecutive outside samples since the track moved.
    last_in_arrival_ts: Optional[float] = None
    zone_exit_frames: int = 0
    #: Set when visitd closed this track's visit while the track stayed visible. The track is
    #: then a candidate again, and the next visit it opens starts here, not at `born_ts`.
    rearmed_at: Optional[float] = None

    @property
    def ground_point(self) -> tuple[float, float]:
        x1, _y1, x2, y2 = self.box
        return ((x1 + x2) / 2.0, y2)

    def stationary_for(self, now: float) -> float:
        """Seconds this track has been OBSERVED holding still.

        `still_since` is a timestamp, and it is written in exactly one place: the matched
        branch of `update()`, when a track moves further than `move_epsilon`. So it does
        not advance while the tracker is not being stepped -- but the clock does, and
        `now - still_since` would therefore count a blind interval as stillness.

        That matters because stillness buys `parked_max_misses` (150) instead of
        `max_misses` (12). A vehicle that was actively DRIVING when the camera lost the
        lot -- a PTZ pan, an unverified capture, an untrusted pose -- would come back
        promoted to "parked" purely because time passed while nobody was looking, and
        would then be held for ~37s after it left rather than ~3s. A ghost held that long
        sits on the departed car's last position and can absorb the next detection by IoU,
        which merges two vehicles into one visit.

        `mark_degraded()` already refuses to let a path span a blind interval, for the
        same reason in the same words: "combining outside samples from BEFORE the blind
        interval with inside samples from AFTER it reads as a portal crossing that nobody
        observed." Stillness across a blind interval is parking that nobody observed.

        The MOTION GATE is deliberately not blind time. A gated frame means the motion
        detector ran and reported nothing moving, which is real evidence of stillness --
        and it is most of the day on a quiet lot. Subtracting it would strip parked
        protection from every genuinely parked car and re-create the churn `parked_after`
        exists to stop (measured: 40 track births for ~7 stationary vehicles in 14 min).
        The three callers of `mark_degraded()` are the ones that mean "I could not see",
        and they are the only ones that accrue.
        """
        return max(0.0, now - self.still_since - self.blind_seconds)


class TrackGraph:
    def __init__(
        self,
        high_score: float = 0.55,
        match_iou: float = 0.25,
        low_match_iou: float = 0.15,
        max_misses: int = 12,
        move_epsilon: float = 14.0,
        path_max_speed_px_s: float = DEFAULT_MAX_SPEED_PX_S,
        parked_after: float = 25.0,
        parked_max_misses: int = 150,
    ) -> None:
        self.high_score = high_score
        self.match_iou = match_iou
        self.low_match_iou = low_match_iou
        self.max_misses = max_misses
        self.move_epsilon = move_epsilon
        #: Arrival evidence is a PATH claim, not merely an association claim. The matcher
        #: is IoU-only, so two overlapping cars can hand one track id from the moving car
        #: to a parked neighbour without ever "losing" the track. Measured same-camera lot
        #: traffic is below the stitcher's 45 px/s continuity ceiling. If an IoU match
        #: exceeds that physical ceiling, keep the track for occupancy but discard its
        #: pre-jump path so samples from two vehicles can never be stitched into a portal
        #: crossing. Conservative under-counting is cheaper than a fabricated customer.
        self.path_max_speed_px_s = float(path_max_speed_px_s)
        #: A track that has held still this long is treated as PARKED, and parked cars
        #: do not leave without moving first.
        self.parked_after = parked_after
        #: Miss tolerance for a parked track. Deliberately large.
        self.parked_max_misses = parked_max_misses
        self.tracks: dict[int, Track] = {}
        self._next_id = 1
        #: Timestamp of the FIRST frame of the blind interval currently in progress, or
        #: None when the tracker is being stepped normally. Set by `mark_degraded(now)`,
        #: consumed and cleared by the next `update()`.
        self._blind_from: Optional[float] = None

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
        # CLOSE ANY BLIND INTERVAL FIRST, before matching, pruning or birth. Every track
        # alive right now existed through it unobserved, so each one owes that span; a
        # track BORN below did not, and gets zero because it is created after this line.
        if self._blind_from is not None:
            blind = max(0.0, now - self._blind_from)
            for t in self.tracks.values():
                t.blind_seconds += blind
            self._blind_from = None
        dets = list(detections)
        high = [d for d in dets if d.score >= self.high_score]
        low = [d for d in dets if d.score < self.high_score]
        active = list(self.tracks.values())

        matched, rem_tracks, rem_high = self._match(active, high, self.match_iou)
        matched2, rem_tracks2, _rem_low = self._match(rem_tracks, low, self.low_match_iou)

        for t, d in matched + matched2:
            prev = t.ground_point
            prev_seen = t.last_seen
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
            step_px = ((new_pt[0] - prev[0]) ** 2 + (new_pt[1] - prev[1]) ** 2) ** 0.5
            if step_px > self.move_epsilon:
                t.still_since = now
                # The debt is cleared with the timestamp it was charged against. Leaving
                # it would keep subtracting an old blind interval from a stillness that
                # started after it, so a car that parked following a long pan could never
                # accumulate enough observed stillness to be treated as parked.
                t.blind_seconds = 0.0

            # IoU continuity is not physical identity. Two nearby cars can overlap enough
            # for the greedy matcher to hand a track from one to the other. If that handoff
            # carries an outside sample from car A and an inside sample from parked car B,
            # EntryPortal sees a perfect arrival that nobody made. The stitcher already
            # carries the measured same-camera speed ceiling; apply the same physical law
            # to each live association. A discontinuity does NOT kill occupancy or invent a
            # new track -- it only invalidates the path evidence that would carry arrival
            # authority across the jump.
            dt = max(0.0, float(now) - float(prev_seen))
            path_discontinuous = (
                dt > 0.0
                and self.path_max_speed_px_s > 0.0
                and step_px / dt > self.path_max_speed_px_s
            )
            if path_discontinuous:
                t.path.clear()
                t.degraded = True
            t.path.append(new_pt)

        died: list[Track] = []
        for t in rem_tracks2:
            t.misses += 1
            # A PARKED car and a MOVING car should not get the same patience.
            #
            # Measured on the live SHOPSIGN feed: 40 track births for ~7 stationary
            # vehicles over 14 minutes. The confidently-detected cars scored 0.60-1.00,
            # so the churn is the densely-packed background row flickering under the
            # detector floor -- and a flat 12-miss tolerance (4s at 3fps) declared those
            # cars GONE and then re-created them seconds later.
            #
            # That is not a cosmetic problem. A re-created track is a NEW track, born
            # after the boot census, and therefore a candidate for ARRIVAL. Every flicker
            # was a chance to invent a car that never drove in -- the exact false-arrival
            # class this package exists to prevent.
            #
            # A car that has not moved for `parked_after` seconds has not left in the
            # next four seconds either; it is behind a passing van or briefly under the
            # detector's confidence floor. It keeps its identity far longer. A track that
            # was still MOVING when it vanished keeps the short tolerance, so a car that
            # actually drives off is retired promptly.
            # THROUGH THE ACCESSOR, never `now - t.still_since` inline. This is the one
            # place stillness is ACTED on rather than merely read, and it held its own
            # copy of the arithmetic -- so a fix applied to `stationary_for()` alone would
            # have corrected every display of the number and changed no decision. Same
            # shape as the two disagreeing definitions of p95 that `vision/stats.py`
            # exists to prevent.
            still_for = t.stationary_for(now)
            allowed = self.parked_max_misses if still_for >= self.parked_after else self.max_misses
            if t.misses > allowed:
                t.retired_allowed = allowed
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

    def reset_authority_epoch(self) -> int:
        """Drop every live track at an authority boundary; return how many were removed."""
        count = len(self.tracks)
        self.tracks.clear()
        self._blind_from = None
        return count

    def mark_degraded(self, now: Optional[float] = None) -> None:
        """Mark every track as observed through a degraded interval.

        Also DISCARDS the ground-point history of tracks that are not yet arrivals. A
        candidate that survives a freeze, an unverified stretch or a PTZ pan would
        otherwise keep its pre-blackout samples, and combining outside samples from
        BEFORE the blind interval with inside samples from AFTER it reads as a portal
        crossing that nobody observed. An arrival keeps its path: its crossing already
        happened and is already evidenced.

        PASS `now` WHEN NOTHING WAS OBSERVED. It opens (or extends) a blind interval that
        the next `update()` charges against every surviving track's stillness -- see
        `Track.stationary_for`. The three pipeline gates that mean "I could not see the
        lot" pass it.

        The GENERATION-BREAK caller deliberately does not. A capture failover or a window
        restore swaps which pixels arrive, not whether anything was observed, and the cars
        in the new generation are overwhelmingly the same cars still parked where they
        were. Charging them for it would strip parked protection on every restore and
        re-create exactly the birth churn `parked_after` exists to stop.
        """
        if now is not None and self._blind_from is None:
            self._blind_from = now
        for t in self.tracks.values():
            t.degraded = True
            if t.evidence != "arrival":
                t.path.clear()
                t.path.append(t.ground_point)

    def get(self, track_id: int) -> Optional[Track]:
        return self.tracks.get(track_id)
