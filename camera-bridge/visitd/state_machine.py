"""Pure visit state machine: Frigate sightings in, visit emissions out.

No I/O, no wall clock. Every timestamp is a Frigate frame_time (float epoch
seconds) carried by the message, or the estimate injected through tick().

Sighting  = one Frigate object id on one camera, with zone intervals.
Visit     = the business fact (UUID minted here) built from stitched sightings.
Emission  = one state transition the cloud should hear about.
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from typing import Callable, Dict, Iterable, List, Mapping, Optional, Tuple

from .frigate_events import VEHICLE_LABELS, Box, FrigateEvent, LprUpdate, ObjectSnapshot

DETECTED = "DETECTED"
ENTERED_ZONE = "ENTERED_ZONE"
ARRIVAL_CANDIDATE = "ARRIVAL_CANDIDATE"
CONFIRMED_ARRIVAL = "CONFIRMED_ARRIVAL"
IN_SERVICE = "IN_SERVICE"
DEPARTING = "DEPARTING"
LEFT = "LEFT"
PASS_THROUGH = "PASS_THROUGH"

STATES = (DETECTED, ENTERED_ZONE, ARRIVAL_CANDIDATE, CONFIRMED_ARRIVAL, IN_SERVICE, DEPARTING, LEFT, PASS_THROUGH)
TERMINAL_STATES = frozenset({LEFT, PASS_THROUGH})
_RANK = {DETECTED: 0, ENTERED_ZONE: 1, ARRIVAL_CANDIDATE: 2, CONFIRMED_ARRIVAL: 3, IN_SERVICE: 4}
MAX_AGE_CLOSED_CAP = 1000  # sighting ids remembered after a max-age close (see VisitTracker._remember_max_age_closed)

PLATE_NONE = "NONE"
PLATE_UNREADABLE = "UNREADABLE"
PLATE_CANDIDATE = "CANDIDATE"
PLATE_CONFIRMED = "CONFIRMED"

_NON_ALNUM = re.compile(r"[^A-Z0-9]")


# --------------------------------------------------------------------------- config


@dataclass(frozen=True)
class TopologyLink:
    """Camera-to-camera hop that may continue one visit (rule 3)."""

    from_camera: str
    to_camera: str
    min_seconds: float = 1.0
    max_seconds: float = 90.0


@dataclass(frozen=True)
class VisitPolicy:
    """All tunables of the state machine, with the plan's defaults."""

    candidate_seconds: float = 10.0
    confirm_seconds: float = 45.0
    stationary_confirm_seconds: float = 20.0
    leave_grace_seconds: float = 20.0
    split_track_seconds: float = 10.0
    split_track_iou: float = 0.5
    plate_reattach_minutes: float = 30.0
    plate_confirm_score: float = 0.9
    plate_candidate_score: float = 0.7
    plate_single_read_confirm_score: float = 0.95
    max_sighting_seconds: float = 43200.0
    topology: Tuple[TopologyLink, ...] = ()


@dataclass(frozen=True)
class CameraSpec:
    """Zones that matter on one Frigate camera."""

    name: str
    arrival_zones: frozenset = frozenset()
    bay_zones: frozenset = frozenset()

    @property
    def zones(self) -> frozenset:
        """Arrival and bay zones together."""
        return self.arrival_zones | self.bay_zones


# --------------------------------------------------------------------------- model


@dataclass
class ZoneInterval:
    """[start, end) presence in one zone; end is None while open."""

    zone: str
    start: float
    end: Optional[float] = None

    def seconds(self, at: float) -> float:
        """Duration measured at `at` for open intervals."""
        stop = self.end if self.end is not None else at
        return max(0.0, stop - self.start)


@dataclass
class PlateRead:
    """One plate observation."""

    text: str
    normalized: str
    score: float
    source: str
    at: float
    known_name: Optional[str] = None


@dataclass
class Sighting:
    """One Frigate tracked object on one camera."""

    id: str
    camera: str
    label: str
    start_time: float
    last_frame_time: float
    end_time: Optional[float] = None
    ended_in_zone: bool = False
    max_age_fired: bool = False  # max_sighting_seconds force-end fires once per track (see _expire_old_sightings)
    stationary: bool = False
    first_box: Optional[Box] = None
    last_box: Optional[Box] = None
    best_score: float = 0.0
    last_known_zone: Optional[str] = None
    intervals: List[ZoneInterval] = field(default_factory=list)
    reads: List[PlateRead] = field(default_factory=list)
    last_read_keys: Dict[str, Tuple[str, float]] = field(default_factory=dict)

    def open_zones(self) -> set:
        """Zones with an open interval."""
        return {iv.zone for iv in self.intervals if iv.end is None}


@dataclass
class Visit:
    """The business fact: one vehicle on the property, across sightings."""

    visit_id: str
    created_at: float
    last_activity: float
    primary_camera: str
    last_camera: str
    state: str = DETECTED
    seq: int = 0
    sightings: Dict[str, Sighting] = field(default_factory=dict)
    reached_candidate: bool = False
    state_before_departing: Optional[str] = None
    departing_since: Optional[float] = None
    hold_until: Optional[float] = None
    estimated: bool = False
    emitted: bool = False
    merged_into: Optional[str] = None
    candidate_at: Optional[float] = None
    confirmed_at: Optional[float] = None
    left_at: Optional[float] = None
    continues_visit_id: Optional[str] = None  # the max-age-closed visit this one continues (same Frigate object id)
    #: Earliest time a DEPARTING visit may be declared LEFT, set by `hold_departures` while an
    #: edge producer decides whether a restored car is still parked (see `edge_main.reconcile_restart`).
    #: TRANSIENT, never serialized: a persisted hold whose producer died before releasing it would
    #: keep a departed car on the lot forever. A restart inside the hold therefore departs the car
    #: through the normal grace, which is the behaviour before holds existed.
    restart_hold_until: Optional[float] = None

    @property
    def is_terminal(self) -> bool:
        """LEFT or PASS_THROUGH."""
        return self.state in TERMINAL_STATES

    def open_sightings(self) -> List[Sighting]:
        """Sightings Frigate has not ended."""
        return [s for s in self.sightings.values() if s.end_time is None]

    def latest_sighting(self) -> Optional[Sighting]:
        """Most recently updated sighting."""
        if not self.sightings:
            return None
        return max(self.sightings.values(), key=lambda s: s.last_frame_time)

    def intervals(self) -> List[ZoneInterval]:
        """All zone intervals of all sightings."""
        return [iv for s in self.sightings.values() for iv in s.intervals]

    def reads(self) -> List[PlateRead]:
        """All plate reads of all sightings in time order."""
        return sorted((r for s in self.sightings.values() for r in s.reads), key=lambda r: r.at)


@dataclass(frozen=True)
class Emission:
    """One event for the cloud, fully computed at emission time."""

    visit_id: str
    state: str
    seq: int
    at: float
    estimated: bool
    sighting_id: str
    camera: str
    zone: Optional[str]
    priority: str
    label: str
    confidence: float
    dwell_seconds: float
    zone_dwell: Dict[str, float]
    stationary: bool
    plate: Dict[str, object]
    direction: str
    frigate_start_time: float
    frigate_end_time: Optional[float]
    merged_into: Optional[str] = None
    continues_visit_id: Optional[str] = None
    #: Episode trail (migration 0127), stamped by `VisionPipeline._emit` when the stitcher
    #: folded several tracks into one visit. REAL FIELDS, not attributes bolted on at
    #: emission time: `Emission` is a FROZEN dataclass, so `setattr` raises
    #: FrozenInstanceError -- an earlier version of this change did exactly that and would
    #: have thrown on the first stitched visit in production.
    episode_id: Optional[str] = None
    member_track_ids: Optional[List[int]] = None


# --------------------------------------------------------------------------- helpers


def normalize_plate(text: str) -> str:
    """Uppercase and strip everything that is not A-Z or 0-9."""
    return _NON_ALNUM.sub("", (text or "").upper())


def levenshtein(a: str, b: str) -> int:
    """Edit distance between two strings."""
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def iou(a: Box, b: Box) -> float:
    """Intersection over union of two [x1, y1, x2, y2] boxes."""
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    area_a = max(0, a[2] - a[0]) * max(0, a[3] - a[1])
    area_b = max(0, b[2] - b[0]) * max(0, b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def union_seconds(intervals: Iterable[ZoneInterval], at: float) -> float:
    """Total seconds covered by the union of intervals, open ones measured at `at`."""
    spans = sorted((iv.start, iv.end if iv.end is not None else at) for iv in intervals)
    total = 0.0
    cur_start: Optional[float] = None
    cur_end = 0.0
    for start, end in spans:
        if end < start:
            end = start
        if cur_start is None or start > cur_end:
            if cur_start is not None:
                total += cur_end - cur_start
            cur_start, cur_end = start, end
        else:
            cur_end = max(cur_end, end)
    if cur_start is not None:
        total += cur_end - cur_start
    return total


def snapshot_reads(after: ObjectSnapshot) -> List[Tuple[str, float, str, Optional[str]]]:
    """Plate reads carried by one event snapshot: (text, score, source, known_name)."""
    reads: List[Tuple[str, float, str, Optional[str]]] = []
    if after.recognized_license_plate:
        reads.append((after.recognized_license_plate, after.recognized_license_plate_score or 0.0, "frigate_event", None))
    if after.sub_label and after.label in VEHICLE_LABELS:
        reads.append((after.recognized_license_plate or after.sub_label, 1.0, "known_plate", after.sub_label))
    return reads


def plate_summary(reads: List[PlateRead], policy: VisitPolicy) -> Dict[str, object]:
    """Fold reads into the contract's plate block."""
    if not reads:
        return {"status": PLATE_NONE, "text": None, "normalizedText": None, "confidence": 0.0, "reads": 0}
    groups: Dict[str, List[PlateRead]] = {}
    for r in reads:
        groups.setdefault(r.normalized, []).append(r)
    best_group = max(groups.values(), key=lambda g: (max(x.score for x in g), len(g)))
    best = max(best_group, key=lambda x: x.score)
    agreeing = len(best_group)
    if best.score >= policy.plate_single_read_confirm_score or (best.score >= policy.plate_confirm_score and agreeing >= 2):
        status = PLATE_CONFIRMED
    elif best.score >= policy.plate_candidate_score:
        status = PLATE_CANDIDATE
    else:
        status = PLATE_UNREADABLE
    out: Dict[str, object] = {
        "status": status,
        "text": best.text,
        "normalizedText": best.normalized,
        "confidence": round(best.score, 4),
        "reads": len(reads),
    }
    known = [r.known_name for r in reads if r.known_name]
    if known:
        out["knownName"] = known[-1]
    return out


# --------------------------------------------------------------------------- tracker


class VisitTracker:
    """Owns open visits; feed it FrigateEvent / LprUpdate / tick and collect Emissions."""

    def __init__(
        self,
        policy: VisitPolicy,
        cameras: Mapping[str, CameraSpec],
        id_factory: Optional[Callable[[], str]] = None,
    ) -> None:
        self.policy = policy
        self.cameras = dict(cameras)
        self._visits: Dict[str, Visit] = {}
        self._by_sighting: Dict[str, str] = {}
        self._closed: List[Visit] = []
        self._force_ended: Dict[str, int] = {}
        # sighting id -> (visit id, closed at) for max-aged sightings whose visit closed; insertion-ordered, capped
        self._max_age_closed: Dict[str, Tuple[str, float]] = {}
        self._new_id = id_factory or (lambda: str(uuid.uuid4()))
        self.counters: Dict[str, int] = {
            "split_joins": 0,
            "plate_joins": 0,
            "topology_joins": 0,
            "new_visits": 0,
            "unzoned_closed": 0,
            "plate_conflicts": 0,
            "ignored_unknown_camera": 0,
            "ignored_unknown_object": 0,
            "max_age_continuations": 0,
        }

    # ---- public API

    def open_visits(self) -> List[Visit]:
        """Non-terminal visits."""
        return list(self._visits.values())

    def closed_visits(self) -> List[Visit]:
        """Visits closed since the last drain, left in place (peek before the ledger commit)."""
        return list(self._closed)

    def drain_closed(self) -> List[Visit]:
        """Visits closed since the last drain (for persistence)."""
        out, self._closed = self._closed, []
        return out

    def drain_force_ended(self) -> Dict[str, int]:
        """Sightings force-ended since the last drain, by reason (for the metrics counter)."""
        out, self._force_ended = self._force_ended, {}
        return out

    def force_end_open_sightings(self, at: float, reason: str,
                                 camera: Optional[str] = None) -> List[Emission]:
        """End every open sighting at the estimated time `at` (Frigate lost its object registry).

        The visits then go DEPARTING and reach LEFT / PASS_THROUGH through the normal grace,
        exactly as a Frigate `end` would, with estimated=True on what is emitted.

        `camera` scopes it to one producer's sightings. Frigate owns every camera at once, so it
        passes None and ends them all; an EDGE producer owns exactly ONE camera while sharing the
        ledger path with its siblings, so ending everything on its restart would depart cars the
        other producers are still watching.
        """
        ended = 0
        for visit in list(self._visits.values()):
            for sighting in visit.open_sightings():
                if camera is not None and sighting.camera != camera:
                    continue
                self._force_end(sighting, at)
                ended += 1
        if not ended:
            return []
        self._force_ended[reason] = self._force_ended.get(reason, 0) + ended
        return self._evaluate_all(at, estimated=True)

    def hold_departures(self, visit_ids: Iterable[str], until: Optional[float]) -> int:
        """Keep these visits from being declared LEFT before `until` (None releases the hold).

        An edge producer restarts with no way to recognise the cars it was tracking: its new
        tracks carry new object ids. It force-ends the restored sightings, which sends their
        visits DEPARTING with dwell frozen at the last activity, and holds them here while it
        looks for each car where its last box was. A car that is still parked gets an update
        under its OLD object id, and `_apply_snapshot` + `_evaluate` resurrect the sighting
        and restore the visit's state exactly as for a max-age force-end. A car that is gone
        departs through the normal grace once the hold is released or lapses. The hold only
        ever DELAYS a departure; it never shortens the grace. Returns the visits held.
        """
        held = 0
        for visit_id in visit_ids:
            visit = self._visits.get(visit_id)
            if visit is None:
                continue
            visit.restart_hold_until = until
            held += 1
        return held

    def discard_camera_state(self, camera: str) -> int:
        """Discard open visit state belonging entirely to one camera.

        Mixed-camera visits are refused rather than partially rewritten: an authority
        handoff in one camera must never silently amputate a cross-camera stitched visit.
        Edge producers use camera-scoped ledgers, so a mixed visit here is an invariant
        violation and promotion should fail closed.
        """
        doomed: List[str] = []
        for visit_id, visit in self._visits.items():
            cameras = {s.camera for s in visit.sightings.values()}
            if camera not in cameras:
                continue
            if cameras != {camera}:
                raise RuntimeError(
                    f"cannot discard camera {camera!r}: visit {visit_id} spans {sorted(cameras)}"
                )
            doomed.append(visit_id)
        for visit_id in doomed:
            visit = self._visits.pop(visit_id)
            for sid in visit.sightings:
                self._by_sighting.pop(sid, None)
        self._closed = [
            v for v in self._closed
            if not any(s.camera == camera for s in v.sightings.values())
        ]
        return len(doomed)

    def handle_event(self, ev: FrigateEvent) -> List[Emission]:
        """Apply one frigate/events message and evaluate every timer at its frame time."""
        at = ev.time
        out: List[Emission] = []
        spec = self.cameras.get(ev.after.camera)
        if spec is None:
            self.counters["ignored_unknown_camera"] += 1
            return self._evaluate_all(at, estimated=False)
        visit_id = self._by_sighting.get(ev.after.id)
        if visit_id is None:
            if ev.type == "end":
                self.counters["ignored_unknown_object"] += 1
                return self._evaluate_all(at, estimated=False)
            sighting = self._new_sighting(ev.after)
            continues = self._continued_visit(sighting, at)
            visit = self._stitch(sighting, ev.after, at, continues)
        else:
            visit = self._visits[visit_id]
            sighting = visit.sightings[ev.after.id]
        self._apply_snapshot(visit, sighting, spec, ev, at, out)
        visit = self._visits.get(self._by_sighting.get(sighting.id, ""), visit)
        if visit.estimated and not visit.is_terminal:
            visit.estimated = False
            out.append(self._emit(visit, visit.state, at, False, sighting))
        out.extend(self._evaluate(visit, at, False, sighting))
        out.extend(self._evaluate_all(at, estimated=False, exclude=visit.visit_id))
        return out

    def handle_lpr(self, update: LprUpdate) -> List[Emission]:
        """Apply one frigate/tracked_object_update lpr read."""
        out: List[Emission] = []
        visit_id = self._by_sighting.get(update.id)
        if visit_id is None:
            self.counters["ignored_unknown_object"] += 1
            return out
        visit = self._visits[visit_id]
        sighting = visit.sightings[update.id]
        at = update.timestamp if update.timestamp is not None else sighting.last_frame_time
        self._add_read(visit, sighting, update.plate, update.score, "frigate_lpr", at, None, out)
        visit = self._visits.get(self._by_sighting.get(sighting.id, ""), visit)
        out.extend(self._evaluate(visit, at, False, sighting))
        out.extend(self._evaluate_all(at, estimated=False, exclude=visit.visit_id))
        return out

    def tick(self, now: float) -> List[Emission]:
        """Evaluate timers at an estimated frame time; promotions are flagged estimated."""
        self._expire_old_sightings(now)
        return self._evaluate_all(now, estimated=True)

    def export_state(self) -> Dict[str, object]:
        """JSON-able snapshot of open visits (plus the max-age continuation map) for the ledger."""
        return {
            "visits": [visit_to_dict(v) for v in self._visits.values()],
            "max_age_closed": [[sid, visit_id, closed_at] for sid, (visit_id, closed_at) in self._max_age_closed.items()],
        }

    def restore_state(self, state: Mapping[str, object]) -> int:
        """Reload open visits from export_state(); returns the count restored.

        `max_age_closed` ([sighting id, visit id, closed at] rows, oldest first) refills the continuation map
        so a parked car whose max-age close preceded a restart still continues its old visit.
        """
        count = 0
        for raw in state.get("visits", []):  # type: ignore[union-attr]
            visit = visit_from_dict(raw)  # type: ignore[arg-type]
            if visit.is_terminal:
                continue
            self._visits[visit.visit_id] = visit
            for sid in visit.sightings:
                self._by_sighting[sid] = visit.visit_id
            count += 1
        rows = sorted(state.get("max_age_closed", []), key=lambda row: float(row[2]))  # type: ignore[arg-type,union-attr]
        for sid, visit_id, closed_at in rows[-MAX_AGE_CLOSED_CAP:]:
            self._max_age_closed[str(sid)] = (str(visit_id), float(closed_at))
        return count

    # ---- sighting lifecycle

    def _new_sighting(self, after: ObjectSnapshot) -> Sighting:
        """Create a Sighting from the first snapshot of an object id (its plate reads seed the stitch rules)."""
        sighting = Sighting(
            id=after.id,
            camera=after.camera,
            label=after.label,
            start_time=after.start_time,
            last_frame_time=after.frame_time,
            first_box=after.box,
            last_box=after.box,
            best_score=max(after.score, after.top_score),
        )
        for text, score, source, known in snapshot_reads(after):
            normalized = normalize_plate(text)
            if normalized:
                sighting.last_read_keys[source] = (normalized, round(score, 3))
                sighting.reads.append(PlateRead(text=text, normalized=normalized, score=score, source=source, at=after.frame_time, known_name=known))
        return sighting

    def _continued_visit(self, sighting: Sighting, at: float) -> Optional[str]:
        """The max-age-closed visit a new sighting with the SAME Frigate object id continues, or None.

        Frigate never sent `end` for the object (the car is still parked): its visit was closed by the leave grace
        after the max-age force-end, and this update would otherwise mint an unrelated second visitId. The terminal
        visit is never resurrected; the new visit only carries `continuesVisitId` and never pages at priority high.
        The entry is consumed, and the sighting is marked max_age_fired so the reopened track is not ended again.
        """
        entry = self._max_age_closed.pop(sighting.id, None)
        if entry is None:
            return None
        visit_id, closed_at = entry
        if at - closed_at > self.policy.max_sighting_seconds:
            return None
        sighting.max_age_fired = True
        return visit_id

    def _remember_max_age_closed(self, visit: Visit) -> None:
        """Record the max-aged, ended sightings of a visit being closed; TTL maxSightingSeconds, capped."""
        closed_at = visit.left_at if visit.left_at is not None else visit.last_activity
        ttl = self.policy.max_sighting_seconds
        for sid, (_, at) in list(self._max_age_closed.items()):
            if closed_at - at > ttl:
                del self._max_age_closed[sid]
        for sighting in visit.sightings.values():
            if sighting.max_age_fired and sighting.end_time is not None:
                self._max_age_closed.pop(sighting.id, None)
                self._max_age_closed[sighting.id] = (visit.visit_id, closed_at)
        while len(self._max_age_closed) > MAX_AGE_CLOSED_CAP:
            del self._max_age_closed[next(iter(self._max_age_closed))]

    def _stitch(self, sighting: Sighting, after: ObjectSnapshot, at: float, continues: Optional[str] = None) -> Visit:
        """Ordered identity rules: split-track, plate, topology, else a new visit (continuing `continues`)."""
        visit = self._match_split_track(sighting, after)
        if visit is not None:
            self.counters["split_joins"] += 1
            return self._attach(visit, sighting, at)
        plate = after.recognized_license_plate or (after.sub_label if after.label in VEHICLE_LABELS else None)
        if plate:
            visit = self._find_visit_by_plate(normalize_plate(plate), at, exclude=None)
            if visit is not None and not self._plate_veto(visit, sighting):
                self.counters["plate_joins"] += 1
                return self._attach(visit, sighting, at)
        visit = self._match_topology(sighting, after)
        if visit is not None:
            self.counters["topology_joins"] += 1
            return self._attach(visit, sighting, at)
        self.counters["new_visits"] += 1
        if continues is not None:
            self.counters["max_age_continuations"] += 1
        visit = Visit(
            visit_id=self._new_id(),
            created_at=after.start_time,
            last_activity=at,
            primary_camera=sighting.camera,
            last_camera=sighting.camera,
            continues_visit_id=continues,
        )
        self._visits[visit.visit_id] = visit
        return self._attach(visit, sighting, at)

    def _force_end(self, sighting: Sighting, at: float) -> None:
        """Close a sighting and its open zone intervals at `at` as if Frigate had sent `end`."""
        sighting.ended_in_zone = bool(sighting.open_zones())
        for iv in sighting.intervals:
            if iv.end is None:
                iv.end = at
        sighting.end_time = at
        sighting.last_frame_time = max(sighting.last_frame_time, at)

    def _expire_old_sightings(self, at: float) -> None:
        """Force-end open sightings older than max_sighting_seconds (a track Frigate will never end).

        Once per track: a sighting Frigate keeps updating after the force-end is resurrected by
        _apply_snapshot and is a real (parked) vehicle, so it stays one visit until Frigate ends it
        instead of being re-ended on every later tick and split at the next update gap.
        """
        limit = self.policy.max_sighting_seconds
        if limit <= 0:
            return
        ended = 0
        for visit in list(self._visits.values()):
            for sighting in visit.open_sightings():
                if not sighting.max_age_fired and at - sighting.start_time >= limit:
                    sighting.max_age_fired = True
                    self._force_end(sighting, at)
                    ended += 1
        if ended:
            self._force_ended["max_age"] = self._force_ended.get("max_age", 0) + ended

    def _attach(self, visit: Visit, sighting: Sighting, at: float) -> Visit:
        """Bind a sighting to a visit; a DEPARTING visit restarts its grace from the join."""
        visit.sightings[sighting.id] = sighting
        self._by_sighting[sighting.id] = visit.visit_id
        visit.last_camera = sighting.camera
        visit.last_activity = max(visit.last_activity, at)
        if visit.state == DEPARTING and visit.departing_since is not None:
            visit.departing_since = max(visit.departing_since, at)
        return visit

    def _match_split_track(self, sighting: Sighting, after: ObjectSnapshot) -> Optional[Visit]:
        """Rule 1: same camera, starts within split window of an ended sighting, IoU >= threshold."""
        if after.box is None:
            return None
        for visit in self._visits.values():
            for other in visit.sightings.values():
                if other.camera != sighting.camera or other.end_time is None or other.last_box is None:
                    continue
                gap = after.start_time - other.end_time
                if 0 <= gap <= self.policy.split_track_seconds and iou(other.last_box, after.box) >= self.policy.split_track_iou:
                    if not self._plate_veto(visit, sighting):
                        return visit
        return None

    def _match_topology(self, sighting: Sighting, after: ObjectSnapshot) -> Optional[Visit]:
        """Rule 3: previous visit left `from` camera and this sighting starts on `to` within the window."""
        links = [l for l in self.policy.topology if l.to_camera == sighting.camera]
        if not links:
            return None
        for visit in self._visits.values():
            if visit.open_sightings() or not visit.sightings:
                continue
            last_end = max(s.end_time or 0.0 for s in visit.sightings.values())
            gap = after.start_time - last_end
            for link in links:
                if visit.last_camera == link.from_camera and link.min_seconds <= gap <= link.max_seconds:
                    if not self._plate_veto(visit, sighting):
                        return visit
        return None

    def _find_visit_by_plate(self, normalized: str, at: float, exclude: Optional[str]) -> Optional[Visit]:
        """Rule 2: an open visit holding the same normalized plate, present or recently active."""
        window = self.policy.plate_reattach_minutes * 60.0
        best: Optional[Tuple[float, float, Visit]] = None
        for visit in self._visits.values():
            if visit.visit_id == exclude:
                continue
            if not visit.open_sightings() and at - visit.last_activity > window:
                continue
            score = max((r.score for r in visit.reads() if r.normalized == normalized), default=-1.0)
            if score < self.policy.plate_candidate_score:
                continue
            key = (score, -visit.created_at, visit)
            if best is None or key[:2] > best[:2]:
                best = key
        return best[2] if best else None

    def _plate_veto(self, visit: Visit, sighting: Sighting) -> bool:
        """Hard reject: two high-confidence reads that differ by Levenshtein >= 2."""
        high = self.policy.plate_confirm_score
        mine = {r.normalized for r in sighting.reads if r.score >= high}
        theirs = {r.normalized for r in visit.reads() if r.score >= high}
        return any(levenshtein(a, b) >= 2 for a in mine for b in theirs)

    # ---- applying messages

    def _apply_snapshot(self, visit: Visit, sighting: Sighting, spec: CameraSpec, ev: FrigateEvent, at: float, out: List[Emission]) -> None:
        """Update sighting facts and zone intervals from one message (no state transitions here)."""
        after = ev.after
        if ev.type != "end" and sighting.end_time is not None:
            sighting.end_time = None  # we force-ended it (restart / max age) but Frigate still tracks it
        sighting.last_frame_time = max(sighting.last_frame_time, after.frame_time)
        sighting.last_box = after.box or sighting.last_box
        sighting.best_score = max(sighting.best_score, after.score, after.top_score)
        sighting.stationary = after.stationary
        sighting.label = after.label
        visit.last_activity = max(visit.last_activity, at)
        visit.last_camera = sighting.camera
        wanted = (set(after.current_zones) & spec.zones) if ev.type != "end" else set()
        for iv in sighting.intervals:
            if iv.end is None and iv.zone not in wanted:
                iv.end = at
        for zone in sorted(wanted - sighting.open_zones()):
            sighting.intervals.append(ZoneInterval(zone=zone, start=at))
            sighting.last_known_zone = zone
        if ev.type == "end":
            sighting.end_time = at
            sighting.ended_in_zone = bool(set(after.current_zones) & spec.zones)
        for text, score, source, known in snapshot_reads(after):
            self._add_read(visit, sighting, text, score, source, at, known, out)
            # a read may have re-parented the sighting; the next read must see its current visit
            visit = self._visits.get(self._by_sighting.get(sighting.id, ""), visit)

    def _add_read(self, visit: Visit, sighting: Sighting, text: str, score: float, source: str, at: float, known_name: Optional[str], out: List[Emission]) -> None:
        """Record a plate read (deduped per source); a match to another open visit merges this sighting into it."""
        normalized = normalize_plate(text)
        if not normalized:
            return
        key = (normalized, round(score, 3))
        if sighting.last_read_keys.get(source) == key:
            return
        sighting.last_read_keys[source] = key
        high = self.policy.plate_confirm_score
        if score >= high and any(r.score >= high and levenshtein(r.normalized, normalized) >= 2 for r in visit.reads()):
            self.counters["plate_conflicts"] += 1
        sighting.reads.append(PlateRead(text=text, normalized=normalized, score=score, source=source, at=at, known_name=known_name))
        if visit.is_terminal:
            return
        target = self._find_visit_by_plate(normalized, at, exclude=visit.visit_id)
        if target is not None and not self._plate_veto(target, sighting):
            self._move_sighting(sighting, visit, target, at, out)

    def _move_sighting(self, sighting: Sighting, src: Visit, dst: Visit, at: float, out: List[Emission]) -> None:
        """Re-parent a sighting (plate rule); an emptied, already-emitted visit gets a LEFT tombstone.

        Idempotent: a sighting that already belongs to `dst` is left alone, and `src` is only
        tombstoned when this call is the one that empties it.
        """
        if sighting.id in dst.sightings and self._by_sighting.get(sighting.id) == dst.visit_id:
            return
        self.counters["plate_joins"] += 1
        if sighting.id in src.sightings and len(src.sightings) == 1:
            src.merged_into = dst.visit_id
            if src.emitted:
                out.append(self._emit(src, LEFT, at, False, sighting, merged_into=dst.visit_id))
            else:
                src.state = LEFT
                src.left_at = at
                self._close(src)
        src.sightings.pop(sighting.id, None)
        self._attach(dst, sighting, at)

    # ---- evaluation

    def _evaluate_all(self, at: float, estimated: bool, exclude: Optional[str] = None) -> List[Emission]:
        """Evaluate every open visit's timers at `at`."""
        out: List[Emission] = []
        for visit in list(self._visits.values()):
            if visit.visit_id == exclude:
                continue
            out.extend(self._evaluate(visit, max(at, visit.last_activity), estimated, None))
        return out

    def _evaluate(self, visit: Visit, at: float, estimated: bool, trigger: Optional[Sighting]) -> List[Emission]:
        """Run the transition table for one visit at time `at`."""
        out: List[Emission] = []
        if visit.is_terminal or visit.visit_id not in self._visits:
            return out
        sighting = trigger or visit.latest_sighting()
        if sighting is None:
            return out
        in_arrival, in_bay, stationary_in_arrival, ever_zone = self._zone_facts(visit)
        in_zone = in_arrival or in_bay
        if visit.state == DEPARTING:
            if in_zone:
                visit.state = visit.state_before_departing or ENTERED_ZONE
                visit.state_before_departing = visit.departing_since = visit.hold_until = None
                # Back in a zone: a restart hold has done its job, and a later real departure
                # must get the normal grace, not one stretched to the old hold.
                visit.restart_hold_until = None
            else:
                visit.hold_until = self._departure_hold(visit)
                if at >= visit.hold_until:
                    out.append(self._emit(visit, LEFT if visit.reached_candidate else PASS_THROUGH, at, estimated, sighting))
                return out
        elif not in_zone:
            if ever_zone:
                visit.state_before_departing = visit.state
                visit.state = DEPARTING
                visit.departing_since = max((iv.end for iv in visit.intervals() if iv.end is not None), default=at)
                visit.hold_until = self._departure_hold(visit)
                if at >= visit.hold_until:
                    out.append(self._emit(visit, LEFT if visit.reached_candidate else PASS_THROUGH, at, estimated, sighting))
            elif not visit.open_sightings():
                visit.state = PASS_THROUGH
                visit.left_at = at
                self.counters["unzoned_closed"] += 1
                self._close(visit)
            return out
        dwell = union_seconds([iv for iv in visit.intervals() if self._is_arrival(iv.zone, visit)], at)
        p = self.policy
        if visit.state == DETECTED and in_arrival:
            out.append(self._emit(visit, ENTERED_ZONE, at, estimated, sighting))
        if visit.state == ENTERED_ZONE and (dwell >= p.candidate_seconds or stationary_in_arrival):
            out.append(self._emit(visit, ARRIVAL_CANDIDATE, at, estimated, sighting))
        if visit.state == ARRIVAL_CANDIDATE and (dwell >= p.confirm_seconds or (stationary_in_arrival and dwell >= p.stationary_confirm_seconds)):
            out.append(self._emit(visit, CONFIRMED_ARRIVAL, at, estimated, sighting))
        if in_bay and _RANK.get(visit.state, 0) < _RANK[IN_SERVICE]:
            out.append(self._emit(visit, IN_SERVICE, at, estimated, sighting))
        return out

    def _is_arrival(self, zone: str, visit: Visit) -> bool:
        """Whether a zone name is an arrival zone on any camera of this visit."""
        return any(zone in self.cameras[s.camera].arrival_zones for s in visit.sightings.values() if s.camera in self.cameras)

    def _zone_facts(self, visit: Visit) -> Tuple[bool, bool, bool, bool]:
        """(in_arrival, in_bay, stationary_in_arrival, ever_in_any_zone)."""
        in_arrival = in_bay = stationary_in_arrival = ever = False
        for s in visit.sightings.values():
            spec = self.cameras.get(s.camera)
            if spec is None:
                continue
            for iv in s.intervals:
                ever = True
                if iv.end is not None:
                    continue
                if iv.zone in spec.arrival_zones:
                    in_arrival = True
                    stationary_in_arrival = stationary_in_arrival or s.stationary
                if iv.zone in spec.bay_zones:
                    in_bay = True
        return in_arrival, in_bay, stationary_in_arrival, ever

    def _departure_hold(self, visit: Visit) -> float:
        """When a DEPARTING visit may be declared LEFT: the leave grace after the later of the zone exit and the
        last track end, or the topology window when that is longer. A Frigate `end` therefore never emits LEFT
        by itself (rule 1: a split track within splitTrackSeconds <= leaveGraceSeconds can still rejoin)."""
        base = visit.departing_since if visit.departing_since is not None else visit.last_activity
        if not visit.open_sightings():
            base = max(base, max((s.end_time or 0.0 for s in visit.sightings.values()), default=base))
        topo = max((l.max_seconds for l in self.policy.topology if l.from_camera == visit.last_camera), default=0.0)
        hold = base + max(self.policy.leave_grace_seconds, topo)
        if visit.restart_hold_until is not None:
            hold = max(hold, visit.restart_hold_until)
        return hold

    def _emit(self, visit: Visit, state: str, at: float, estimated: bool, sighting: Sighting, merged_into: Optional[str] = None) -> Emission:
        """Transition to `state`, bump seq, and build the Emission snapshot."""
        visit.state = state
        visit.seq += 1
        visit.emitted = True
        visit.estimated = estimated
        if state == ARRIVAL_CANDIDATE:
            visit.reached_candidate = True
            visit.candidate_at = visit.candidate_at or at
        elif state == CONFIRMED_ARRIVAL:
            visit.reached_candidate = True
            visit.confirmed_at = visit.confirmed_at or at
        elif state == IN_SERVICE:
            visit.reached_candidate = True
        terminal = state in TERMINAL_STATES
        if terminal:
            visit.left_at = at
        zone_dwell: Dict[str, float] = {}
        for iv in visit.intervals():
            zone_dwell.setdefault(iv.zone, 0.0)
        for zone in zone_dwell:
            zone_dwell[zone] = round(union_seconds([iv for iv in visit.intervals() if iv.zone == zone], at), 1)
        dwell = round(union_seconds([iv for iv in visit.intervals() if self._is_arrival(iv.zone, visit)], at), 1)
        open_zones = sorted(sighting.open_zones())
        zone = open_zones[0] if open_zones else sighting.last_known_zone
        if zone is None:
            zone = next((s.last_known_zone for s in visit.sightings.values() if s.last_known_zone), None)
        # a continuation of a max-age-closed visit is the same parked car: never page for it at priority high
        priority = "high" if state == CONFIRMED_ARRIVAL and not visit.continues_visit_id else "low" if state == PASS_THROUGH else "normal"
        emission = Emission(
            visit_id=visit.visit_id,
            state=state,
            seq=visit.seq,
            at=at,
            estimated=estimated,
            sighting_id=sighting.id,
            camera=sighting.camera,
            zone=zone,
            priority=priority,
            label=sighting.label,
            confidence=round(sighting.best_score, 4),
            dwell_seconds=dwell,
            zone_dwell=zone_dwell,
            stationary=any(s.stationary for s in visit.open_sightings()),
            plate=plate_summary(visit.reads(), self.policy),
            direction="leaving" if terminal else "entering",
            frigate_start_time=min(s.start_time for s in visit.sightings.values()),
            frigate_end_time=None if visit.open_sightings() else max(s.end_time or 0.0 for s in visit.sightings.values()),
            merged_into=merged_into,
            continues_visit_id=visit.continues_visit_id,
        )
        if terminal:
            self._close(visit)
        return emission

    def _close(self, visit: Visit) -> None:
        """Forget a terminal visit and its sighting ids; keep it for the ledger, and remember its max-aged
        sighting ids so a later update for the same Frigate object continues this visit instead of starting
        an unrelated one."""
        self._visits.pop(visit.visit_id, None)
        for sid in list(visit.sightings):
            if self._by_sighting.get(sid) == visit.visit_id:
                del self._by_sighting[sid]
        self._remember_max_age_closed(visit)
        self._closed.append(visit)


# --------------------------------------------------------------------------- (de)serialization


def visit_to_dict(visit: Visit) -> Dict[str, object]:
    """JSON-able form of a Visit."""
    return {
        "visit_id": visit.visit_id,
        "created_at": visit.created_at,
        "last_activity": visit.last_activity,
        "primary_camera": visit.primary_camera,
        "last_camera": visit.last_camera,
        "state": visit.state,
        "seq": visit.seq,
        "reached_candidate": visit.reached_candidate,
        "state_before_departing": visit.state_before_departing,
        "departing_since": visit.departing_since,
        "hold_until": visit.hold_until,
        "estimated": visit.estimated,
        "emitted": visit.emitted,
        "merged_into": visit.merged_into,
        "candidate_at": visit.candidate_at,
        "confirmed_at": visit.confirmed_at,
        "left_at": visit.left_at,
        "continues_visit_id": visit.continues_visit_id,
        "sightings": [
            {
                "id": s.id,
                "camera": s.camera,
                "label": s.label,
                "start_time": s.start_time,
                "last_frame_time": s.last_frame_time,
                "end_time": s.end_time,
                "ended_in_zone": s.ended_in_zone,
                "max_age_fired": s.max_age_fired,
                "stationary": s.stationary,
                "first_box": list(s.first_box) if s.first_box else None,
                "last_box": list(s.last_box) if s.last_box else None,
                "best_score": s.best_score,
                "last_known_zone": s.last_known_zone,
                "intervals": [{"zone": iv.zone, "start": iv.start, "end": iv.end} for iv in s.intervals],
                "reads": [
                    {"text": r.text, "normalized": r.normalized, "score": r.score, "source": r.source, "at": r.at, "known_name": r.known_name}
                    for r in s.reads
                ],
                "last_read_keys": {k: list(v) for k, v in s.last_read_keys.items()},
            }
            for s in visit.sightings.values()
        ],
    }


def visit_from_dict(raw: Mapping[str, object]) -> Visit:
    """Inverse of visit_to_dict."""
    visit = Visit(
        visit_id=str(raw["visit_id"]),
        created_at=float(raw["created_at"]),  # type: ignore[arg-type]
        last_activity=float(raw["last_activity"]),  # type: ignore[arg-type]
        primary_camera=str(raw["primary_camera"]),
        last_camera=str(raw["last_camera"]),
        state=str(raw.get("state", DETECTED)),
        seq=int(raw.get("seq", 0)),  # type: ignore[arg-type]
        reached_candidate=bool(raw.get("reached_candidate", False)),
        state_before_departing=raw.get("state_before_departing"),  # type: ignore[arg-type]
        departing_since=raw.get("departing_since"),  # type: ignore[arg-type]
        hold_until=raw.get("hold_until"),  # type: ignore[arg-type]
        estimated=bool(raw.get("estimated", False)),
        emitted=bool(raw.get("emitted", False)),
        merged_into=raw.get("merged_into"),  # type: ignore[arg-type]
        candidate_at=raw.get("candidate_at"),  # type: ignore[arg-type]
        confirmed_at=raw.get("confirmed_at"),  # type: ignore[arg-type]
        left_at=raw.get("left_at"),  # type: ignore[arg-type]
        continues_visit_id=raw.get("continues_visit_id"),  # type: ignore[arg-type]
    )
    for s in raw.get("sightings", []):  # type: ignore[union-attr]
        sighting = Sighting(
            id=str(s["id"]),
            camera=str(s["camera"]),
            label=str(s.get("label", "unknown")),
            start_time=float(s["start_time"]),
            last_frame_time=float(s["last_frame_time"]),
            end_time=s.get("end_time"),
            ended_in_zone=bool(s.get("ended_in_zone", False)),
            max_age_fired=bool(s.get("max_age_fired", False)),
            stationary=bool(s.get("stationary", False)),
            first_box=tuple(s["first_box"]) if s.get("first_box") else None,  # type: ignore[arg-type]
            last_box=tuple(s["last_box"]) if s.get("last_box") else None,  # type: ignore[arg-type]
            best_score=float(s.get("best_score", 0.0)),
            last_known_zone=s.get("last_known_zone"),
            intervals=[ZoneInterval(zone=iv["zone"], start=float(iv["start"]), end=iv.get("end")) for iv in s.get("intervals", [])],
            reads=[
                PlateRead(text=r["text"], normalized=r["normalized"], score=float(r["score"]), source=r["source"], at=float(r["at"]), known_name=r.get("known_name"))
                for r in s.get("reads", [])
            ],
            last_read_keys={str(k): (str(v[0]), float(v[1])) for k, v in (s.get("last_read_keys") or {}).items()},
        )
        visit.sightings[sighting.id] = sighting
    return visit
