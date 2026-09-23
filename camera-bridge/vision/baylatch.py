"""
BayLatch: bay occupancy cannot depend on a detector re-discovering a stationary car
on every frame.

A car sitting in a bay for 40 minutes is the NORMAL case, and it is exactly the case a
background subtractor loses (it becomes the background) and a neural detector can drop
on a bad frame. So a verified bay ENTRY latches the bay occupied, and only positive
exit evidence -- the vehicle observed leaving, or a sustained run of frames with the
bay verifiably clear -- releases it.

Also computes the timing the shop actually cares about: waitToBay, bayDuration,
postServiceDelay, totalVisit, and abandon-before-bay.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class BayState:
    name: str
    occupied: bool = False
    track_id: Optional[int] = None
    entered_at: Optional[float] = None
    last_seen_at: Optional[float] = None
    clear_run: int = 0
    released_at: Optional[float] = None

    def duration(self, now: float) -> float:
        if self.entered_at is None:
            return 0.0
        end = self.released_at if self.released_at is not None else now
        return max(0.0, end - self.entered_at)


class BayLatch:
    def __init__(self, bay_names: list[str], clear_frames_to_release: int = 15) -> None:
        self.clear_frames_to_release = clear_frames_to_release
        self.bays: dict[str, BayState] = {n: BayState(n) for n in bay_names}

    def enter(self, bay: str, track_id: int, now: float) -> bool:
        """Latch a bay occupied. Returns False if it was already held by another track."""
        st = self.bays.setdefault(bay, BayState(bay))
        if st.occupied and st.track_id not in (None, track_id):
            return False
        st.occupied = True
        st.track_id = track_id
        st.entered_at = st.entered_at if st.entered_at is not None else now
        st.last_seen_at = now
        st.clear_run = 0
        st.released_at = None
        return True

    def observe(self, bay: str, occupied_now: bool, now: float,
                track_id: Optional[int] = None) -> None:
        """Feed per-frame evidence. Absence alone does NOT release; a sustained run does."""
        st = self.bays.setdefault(bay, BayState(bay))
        if occupied_now:
            st.clear_run = 0
            st.last_seen_at = now
            if not st.occupied:
                self.enter(bay, track_id if track_id is not None else -1, now)
            return
        if st.occupied:
            st.clear_run += 1
            if st.clear_run >= self.clear_frames_to_release:
                st.occupied = False
                st.released_at = now
                st.track_id = None

    def release(self, bay: str, now: float) -> None:
        """Positive exit evidence: the vehicle was observed leaving."""
        st = self.bays.setdefault(bay, BayState(bay))
        st.occupied = False
        st.released_at = now
        st.track_id = None
        st.clear_run = 0

    def occupied_bays(self) -> list[str]:
        return sorted(n for n, s in self.bays.items() if s.occupied)


@dataclass
class VisitTiming:
    """Shop-flow timings. Every field is Optional -- an unknown time stays unknown
    rather than being back-filled with a plausible guess."""

    arrived_at: Optional[float] = None
    wait_started_at: Optional[float] = None
    bay_entered_at: Optional[float] = None
    bay_exited_at: Optional[float] = None
    departed_at: Optional[float] = None
    estimated_fields: list[str] = field(default_factory=list)
    #: Stable across the several TRACKS one vehicle may be seen as. A tracker id is not
    #: a vehicle -- see `vision/stitch.py` for the measurement that forced this.
    episode_id: Optional[str] = None
    #: The retired track this one was judged to continue, or None if it opened a new
    #: episode. Mirrors `visitd.state_machine.Visit.continues_visit_id`.
    continues_track_id: Optional[int] = None
    #: Every track id folded into this visit, oldest first. The evidence trail: a
    #: stitched timing must be auditable back to the fragments it was assembled from.
    member_track_ids: list[int] = field(default_factory=list)

    def _delta(self, a: Optional[float], b: Optional[float]) -> Optional[float]:
        if a is None or b is None:
            return None
        return max(0.0, b - a)

    @property
    def wait_to_bay(self) -> Optional[float]:
        return self._delta(self.wait_started_at or self.arrived_at, self.bay_entered_at)

    @property
    def bay_duration(self) -> Optional[float]:
        return self._delta(self.bay_entered_at, self.bay_exited_at)

    @property
    def post_service_delay(self) -> Optional[float]:
        return self._delta(self.bay_exited_at, self.departed_at)

    @property
    def total_visit(self) -> Optional[float]:
        return self._delta(self.arrived_at, self.departed_at)

    @property
    def abandoned_before_bay(self) -> bool:
        return self.arrived_at is not None and self.departed_at is not None \
            and self.bay_entered_at is None

    def to_dict(self) -> dict:
        return {
            "arrivedAt": self.arrived_at,
            "bayEnteredAt": self.bay_entered_at,
            "bayExitedAt": self.bay_exited_at,
            "departedAt": self.departed_at,
            "waitToBay": self.wait_to_bay,
            "bayDuration": self.bay_duration,
            "postServiceDelay": self.post_service_delay,
            "totalVisit": self.total_visit,
            "abandonedBeforeBay": self.abandoned_before_bay,
            "estimatedFields": list(self.estimated_fields),
            "episodeId": self.episode_id,
            "continuesTrackId": self.continues_track_id,
            "memberTrackIds": list(self.member_track_ids),
        }
