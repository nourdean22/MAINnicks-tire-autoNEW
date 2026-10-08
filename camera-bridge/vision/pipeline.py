"""
VisionPipeline: frames in, TRUSTWORTHY visit events out.

    frame -> FrameHealth -> SceneLock -> DetectorCouncil -> TrackGraph
          -> PreexistingCensus -> EntryPortal -> BayLatch -> EvidencePacket -> visitd

Invariants, each asserted by a test in tests/test_vision.py:

  1. A vehicle already present at startup or right after a reconnect is PREEXISTING.
     It counts toward occupancy and NEVER reaches visitd, so it can never become a
     CONFIRMED_ARRIVAL by sitting still. (This is the P0 the live POC exposed.)
  2. While the camera is moving or its pose is untrusted, NO visit is created. Open
     visits survive, marked visibilityDegraded.
  3. A new visit requires explicit entry evidence: an outside -> inside portal
     crossing on the vehicle's ground point. Dwell never invents an arrival.
  4. If no detector allowed to confirm is available, the pipeline reports occupancy
     and motion but creates no visits at all.
  5. A frozen or stale capture cannot mint arrivals; recovery is treated as a
     reconnect, which re-arms the preexisting census.
  6. A visit visitd has closed (LEFT / PASS_THROUGH) cannot be re-opened by a track that
     merely stays visible: the track is a candidate again and needs a fresh portal
     crossing. And an arrival parked ON the zone edge is not reported as leaving until
     it moves -- the polygon test alone made one parked car into a run of visits.

visitd itself is untouched -- it stays a pure function of the event stream it is fed.
The whole point of this module is to feed it an HONEST stream.
"""
from __future__ import annotations

import os
import sys
from collections import Counter
from dataclasses import dataclass, field, replace
from typing import Any, Optional, Sequence

from .baylatch import BayLatch, VisitTiming
from .stitch import EpisodeStitcher
from .census import PreexistingCensus
from .detector import CouncilResult, DetectorCouncil
from .evidence import EvidencePacket, EvidenceStore
from .frame import Detection, Frame
from .framehealth import FrameHealth
from .geometry import EntryPortal, LotMap
from .scenelock import SceneLock
from .track import Track, TrackGraph


def load_visitd():
    """Import the shipped visitd package from the sibling directory."""
    here = os.path.dirname(os.path.abspath(__file__))
    parent = os.path.dirname(here)          # camera-bridge/
    if parent not in sys.path:
        sys.path.insert(0, parent)
    from visitd.frigate_events import parse_event                      # noqa: E402
    from visitd.state_machine import CameraSpec, VisitPolicy, VisitTracker  # noqa: E402
    return parse_event, VisitTracker, VisitPolicy, CameraSpec


def _visitd_terminal_states() -> frozenset:
    """visitd's own terminal set, so a renamed or added terminal state cannot leave a track armed."""
    try:
        load_visitd()
        from visitd.state_machine import TERMINAL_STATES                 # noqa: E402
        return frozenset(TERMINAL_STATES)
    except Exception:  # noqa: BLE001
        return frozenset({"LEFT", "PASS_THROUGH"})


@dataclass
class PipelineStats:
    frames: int = 0
    suppressed_camera_motion: int = 0
    suppressed_unhealthy: int = 0
    suppressed_unverified: int = 0
    detector_skipped_no_motion: int = 0
    preexisting: int = 0
    #: Tracks the census called `preexisting` that the entry portal later saw perform a full
    #: outside -> inside crossing. RECORDED, never promoted. A non-zero here is a car this
    #: system watched drive in while counting it as already-there -- an under-count, and
    #: until this existed the census had no way to be wrong.
    preexisting_crossed: int = 0
    candidates: int = 0
    arrivals: int = 0
    #: Arrivals with re-acquisitions folded out: a track judged to CONTINUE an earlier
    #: visit does not increment this, while `arrivals` above is left exactly as it was.
    #: Reported ALONGSIDE, never instead of -- the operator's 2026-09-18 instruction was
    #: to keep the counter running and unhidden and let the data prove itself, so this
    #: is a shadow measurement of what de-duplication WOULD do, not a silent correction.
    arrivals_after_stitch: int = 0
    rejected_no_entry_evidence: int = 0
    motion_only_frames: int = 0
    #: Frames on which an ARRIVAL track's ground point read outside the arrival zone while the
    #: track had not moved since its last inside sample, and the zone was HELD. A parked car on
    #: the polygon edge shows up here instead of as a DEPARTING -> LEFT -> new-visit cycle.
    zone_exit_held: int = 0
    #: Tracks still visible after visitd closed their visit (LEFT / PASS_THROUGH), demoted to
    #: candidates so they need a fresh portal crossing before they can open another visit.
    rearmed_after_terminal: int = 0
    visitd_states: Counter = field(default_factory=Counter)

    def to_dict(self) -> dict:
        d = {k: v for k, v in self.__dict__.items() if k != "visitd_states"}
        d["visitdStates"] = dict(self.visitd_states)
        return d


#: Sentinel: "the caller said nothing about parsing", which is different from an explicit
#: `parse_event=None` (a stub tracker that wants the raw dict). Telling those apart is what
#: keeps tracker injection from silently disabling the parser.
_USE_VISITD_PARSER = object()


class VisionPipeline:
    def __init__(
        self,
        council: DetectorCouncil,
        lot_map: LotMap,
        entry_portal: EntryPortal,
        camera: str = "sign",
        arrival_zone: str = "front_lot",
        bay_names: Optional[list[str]] = None,
        evidence: Optional[EvidenceStore] = None,
        tracker: Any = None,
        parse_event: Any = _USE_VISITD_PARSER,
        startup_grace: float = 8.0,
        scene_lock: Optional[SceneLock] = None,
        frame_health: Optional[FrameHealth] = None,
        track_graph: Optional[TrackGraph] = None,
        zone_exit_frames: int = 3,
    ) -> None:
        self.council = council
        #: Consecutive OUTSIDE samples an arrival track that HAS moved must show before the
        #: arrival zone is dropped from what visitd is told. One noisy box edge is not an exit.
        self.zone_exit_frames = max(1, int(zone_exit_frames))
        self._terminal_states = _visitd_terminal_states()
        self.lot_map = lot_map
        self.portal = entry_portal
        #: Track ids already recorded as a census/portal disagreement. The path keeps
        #: satisfying the portal on every later frame, so without this the counter would
        #: measure FRAMES rather than cars.
        self._preexisting_crossed: set[int] = set()
        self.camera = camera
        self.arrival_zone = arrival_zone
        self.health = frame_health or FrameHealth()
        self.scene = scene_lock or SceneLock()
        self.tracks = track_graph or TrackGraph()
        self.census = PreexistingCensus(startup_grace=startup_grace)
        self.bays = BayLatch(bay_names or [])
        self.evidence = evidence or EvidenceStore(enabled=False)
        self.stats = PipelineStats()
        self.timings: dict[int, VisitTiming] = {}
        self._track_visit: dict[int, str] = {}
        #: Re-acquisition stitcher. `compare_fn` is left unset deliberately: nothing in
        #: this pipeline builds a `VehicleFingerprint` yet, and injecting a comparer with
        #: no fingerprints to compare would be a gate that cannot fail.
        self.stitch = EpisodeStitcher(camera=camera)
        self._start_ts: Optional[float] = None
        self._was_unhealthy = False
        self._in_blind_interval = False
        self._last_image = None

        # PARSING AND TRACKER OWNERSHIP ARE ORTHOGONAL, and conflating them was a real bug.
        # This used to read `if tracker is not None: self._parse_event = None`, so injecting
        # visitd's OWN tracker -- the whole point of the parameter, and the shape the durable
        # edge lane needs -- handed `handle_event` a raw dict. `VisitTracker.handle_event(ev)`
        # reads `ev.time` / `ev.after.camera`, so it died with
        #   AttributeError: 'dict' object has no attribute 'time'
        # on the FIRST emission. Nothing caught it because the only test that injected a
        # tracker injected a RECORDING STUB that accepts dicts, which proves the wiring calls
        # something, not that it calls a real tracker correctly.
        #
        # So: a caller may override the parser, including to None for a dict-accepting stub,
        # but injecting a tracker no longer silently turns parsing off.
        if parse_event is _USE_VISITD_PARSER:
            loaded_parse, VisitTracker, VisitPolicy, CameraSpec = load_visitd()
            self._parse_event = loaded_parse
        else:
            self._parse_event = parse_event
            VisitTracker = VisitPolicy = CameraSpec = None
        if tracker is not None:
            self.tracker = tracker
        else:
            if VisitTracker is None:
                loaded_parse, VisitTracker, VisitPolicy, CameraSpec = load_visitd()
            self.tracker = VisitTracker(
                VisitPolicy(),
                {camera: CameraSpec(name=camera, arrival_zones=frozenset({arrival_zone}))},
            )

    def reset_authority_epoch(self, now: float) -> dict:
        """Erase standby-era tracking/visit state before this camera becomes authoritative."""
        tracks = self.tracks.reset_authority_epoch()
        visits = self.tracker.discard_camera_state(self.camera)
        self.timings.clear()
        self._track_visit.clear()
        self._preexisting_crossed.clear()
        self.stitch = EpisodeStitcher(camera=self.camera)
        self.census.note_reconnect(now)
        self._start_ts = None
        return {"tracks": tracks, "visits": visits}

    # ---------------------------------------------------------------- visitd bridge
    def _emit(self, kind: str, track: Track, now: float, ended: bool = False) -> list:
        if kind == "new" and self.arrival_zone not in track.zones:
            # The crossing that produced this event IS entry into the arrival zone.
            track.zones = sorted({*track.zones, self.arrival_zone})
        x1, y1, x2, y2 = track.box
        after = {
            "id": f"{self.camera}-{track.track_id}",
            "camera": self.camera,
            "label": "car",
            "score": float(track.score),
            "top_score": float(track.score),
            "frame_time": now,
            # A track re-armed after visitd closed its visit starts its NEXT visit at the
            # re-arm, not at a birth that belongs to the previous one.
            "start_time": (track.born_ts if getattr(track, "rearmed_at", None) is None
                           else track.rearmed_at),
            "end_time": now if ended else None,
            "box": [int(x1), int(y1), int(x2), int(y2)],
            "area": int(max(0.0, x2 - x1) * max(0.0, y2 - y1)),
            "stationary": track.stationary_for(now) > 3.0,
            "motionless_count": int(track.stationary_for(now) * 5),
            # The track's OBSERVED zones, not a hardcoded arrival zone. Reporting the
            # arrival zone unconditionally meant a vehicle that drove back out of the lot
            # while still visible kept accruing dwell forever, because visitd never saw it
            # leave and so never started its departure grace.
            "current_zones": [] if ended else list(track.zones),
            "entered_zones": [self.arrival_zone] if kind == "new" else [],
        }
        payload = {"type": kind, "before": {}, "after": after}
        event = self._parse_event(payload) if self._parse_event else payload
        emissions = list(self.tracker.handle_event(event))
        tm = self.timings.get(track.track_id)
        stamped: list = []
        for em in emissions:
            self.stats.visitd_states[getattr(em, "state", "?")] += 1
            vid = getattr(em, "visit_id", None)
            if vid:
                self._track_visit[track.track_id] = vid
            # STAMP THE EPISODE TRAIL ON THE EMISSION, not on a sink.
            # `ShopMirror.row_for()` is the DURABLE path -- `edge_main` never touches
            # `VisitSink`, which is the lab lane only. Attaching this to the sink left
            # every production visit without a trail while the tests passed, because the
            # tests drive the lab lane. `row_for` already lifts per-emission attributes
            # (source_generation, camera_pose, ...) off the emission, so this rides the
            # same seam instead of inventing a second one.
            if tm is not None and (tm.episode_id or tm.member_track_ids):
                # `dataclasses.replace`, NOT setattr: `Emission` is frozen. The replaced
                # copy goes back into the list so downstream readers see the trail.
                stamped.append(replace(
                    em,
                    episode_id=tm.episode_id,
                    member_track_ids=(list(tm.member_track_ids)
                                      if tm.member_track_ids else None),
                ))
                continue
            stamped.append(em)
        self._absorb_terminal(stamped, now)
        return stamped

    def _absorb_terminal(self, emissions: list, now: float) -> None:
        """A visit visitd closed ends the arrival authority of every track that fed it.

        LEFT and PASS_THROUGH pop the visit inside visitd; the track here could stay alive for
        hours (a car parked on the street in view, a car straddling the zone edge). Every later
        "update" for it was an object id visitd no longer knew, so visitd minted a new visit --
        sign-188 became a run of visits for one parked car. Now the track is a candidate again
        with a cleared path: occupancy, not a customer, until the portal sees it cross.
        """
        for em in emissions:
            if getattr(em, "state", None) not in self._terminal_states:
                continue
            vid = getattr(em, "visit_id", None)
            if not vid:
                continue
            for tid in [tid for tid, mapped in self._track_visit.items() if mapped == vid]:
                self._track_visit.pop(tid, None)
                self.timings.pop(tid, None)
                t = self.tracks.get(tid)
                if t is None or t.evidence != "arrival":
                    continue
                t.evidence = "candidate"
                t.entry_reason = ""
                t.path.clear()
                t.path.append(t.ground_point)
                t.last_in_arrival_ts = None
                t.zone_exit_frames = 0
                t.rearmed_at = now
                self.stats.rearmed_after_terminal += 1
                self.evidence.write(EvidencePacket(
                    event="VISIT_CLOSED_TRACK_REARMED", ts=now, camera=self.camera, track_id=tid,
                    visit_id=vid,
                    rule="visitd closed the visit; a still-visible track needs a fresh portal "
                         "crossing before it can open another",
                    reasons=[f"state={getattr(em, 'state', '?')}", "path cleared; evidence=candidate"],
                    box=t.box, zones=t.zones,
                ))

    def _settle_zones(self, t: Track, observed: list[str], now: float) -> list[str]:
        """Arrival-zone membership for an ARRIVAL track, with the physics the polygon lacks.

        `zones_at` is a point-in-polygon test on the box's bottom-centre. For a car parked ON
        the polygon edge that point reads outside for long stretches and inside for a few frames;
        visitd saw the zone close, waited its 20 s leave grace, closed the visit, and the next
        inside sample minted a brand-new visit for the same parked car.

        A parked car does not leave without moving. So an arrival track keeps the arrival zone
        while it has not moved (beyond the tracker's move epsilon) since the last sample that WAS
        inside; once it has moved it still needs `zone_exit_frames` consecutive outside samples
        before the zone is dropped. Candidates and preexisting tracks are untouched: hysteresis
        only ever protects a visit that already exists, never helps create one.
        """
        if self.arrival_zone in observed:
            t.last_in_arrival_ts = now
            t.zone_exit_frames = 0
            return observed
        if t.evidence != "arrival" or self.arrival_zone not in t.zones:
            t.zone_exit_frames = 0
            return observed
        held = sorted({*observed, self.arrival_zone})
        moved_since_inside = (
            t.last_in_arrival_ts is None or t.still_since > t.last_in_arrival_ts
        )
        if not moved_since_inside:
            self.stats.zone_exit_held += 1
            return held
        t.zone_exit_frames += 1
        if t.zone_exit_frames < self.zone_exit_frames:
            return held
        return observed

    def _tick(self, now: float, out: dict) -> None:
        """visitd's own clock; its terminal emissions disarm the tracks that fed them."""
        emissions = list(self.tracker.tick(now))
        for em in emissions:
            self.stats.visitd_states[getattr(em, "state", "?")] += 1
        out["emissions"].extend(emissions)
        self._absorb_terminal(emissions, now)

    # -------------------------------------------------------------------- main step
    def step(self, frame: Frame, detections: Optional[Sequence[Detection]] = None,
             detections_can_confirm: bool = True) -> dict:
        now = frame.ts
        if self._start_ts is None:
            self._start_ts = now
        self.stats.frames += 1
        # Stamped by `WgcWindowSource.set_canonical`. None on sources that do not stamp
        # it, and None is handled as "unknown" rather than as a distinct epoch -- an
        # unstamped source must not have every stitch refused for lack of a field it was
        # never going to provide.
        _layout_epoch = (frame.meta or {}).get("layoutEpoch")
        out: dict[str, Any] = {"emissions": [], "suppressed": None, "born": [], "died": []}

        # 0. Is this frame even OF the camera? -----------------------------------
        # A screen-region capture silently returns whatever window overlaps the target.
        # An unverified frame is not evidence about the lot, so it cannot be allowed to
        # start, advance or end a visit.
        # `is not True`, not `is False`: a capture source that FORGETS the key must not
        # silently inherit arrival authority. Absent evidence is not evidence.
        if frame.meta.get("window_verified") is not True:
            self.stats.suppressed_unverified += 1
            self._was_unhealthy = True          # recovery re-arms the preexisting census
            self.tracks.mark_degraded(now)
            out["suppressed"] = "capture window occluded: frame is not the camera"
            return out

        # 1. Frame health -------------------------------------------------------
        self.health.update(now, frame.image)
        hs = self.health.state(now)
        if not hs.ok:
            self.stats.suppressed_unhealthy += 1
            self._was_unhealthy = True
            self.tracks.mark_degraded(now)
            out["suppressed"] = f"capture unhealthy (frozen={hs.frozen}, fps={hs.fps:.2f})"
            out["health"] = hs
            return out
        if self._was_unhealthy:
            # Recovery is a reconnect: anything visible now may have been there all along.
            # Safe to fire here because the unhealthy branch RETURNS above, so reaching
            # this line already proves the frame is usable.
            self.census.note_reconnect(now)
            self._was_unhealthy = False

        # 2. Scene lock ---------------------------------------------------------
        scene = self.scene.update(frame.image)
        out["scene"] = scene
        if not scene.may_create_visits:
            self.stats.suppressed_camera_motion += 1
            self.tracks.mark_degraded(now)
            self._in_blind_interval = True
            out["suppressed"] = f"camera motion / untrusted pose (change={scene.change_frac:.2f})"
            return out

        if self._in_blind_interval:
            # FIRST usable frame after a blind interval: re-arm the census exactly once.
            # This must live BELOW the scene gate. A flag test placed above it is cleared
            # and re-set within the same step() for every frame of a long pan -- measured
            # 14 note_reconnect calls across a 14-frame pan, i.e. no change at all from
            # the per-frame call it was meant to replace.
            self.census.note_reconnect(now)
            self._in_blind_interval = False

        # 3. Detection ----------------------------------------------------------
        if detections is not None:
            # Injected detections bypass the council, so the caller must say whether they
            # came from something allowed to confirm. Defaulting to True is safe for the
            # test/replay harnesses that use it, but a caller feeding MOTION-derived boxes
            # must pass detections_can_confirm=False or it inherits arrival authority.
            dets = list(detections)
            confirmable = detections_can_confirm
            result = CouncilResult(detections=dets, can_confirm_arrival=detections_can_confirm,
                                   reason="detections injected")
        else:
            result = self.council.run(frame.image)
            dets = result.detections
            confirmable = result.can_confirm_arrival
            if result.skipped_no_motion:
                self.stats.detector_skipped_no_motion += 1
            if result.motion_only:
                self.stats.motion_only_frames += 1
        out["council"] = result
        self._last_image = frame.image

        # 4. Track --------------------------------------------------------------
        # A motion-gated SKIP means the heavy detector never ran, which is not the same
        # as "the scene is empty". Feeding [] to the tracker would age out a legitimately
        # STATIONARY vehicle -- exactly the parked car the motion gate stops reporting --
        # and produce a departure that never happened.
        if getattr(result, "skipped_no_motion", False):
            out["suppressed"] = "no motion: detector skipped, tracks held"
            self._tick(now, out)
            return out

        born, died = self.tracks.update(dets, now, confirmable=confirmable)
        out["born"] = born
        out["died"] = died

        # 5. Census: classify every newborn -------------------------------------
        for t in born:
            t.evidence = self.census.classify_birth(t.born_ts, self._start_ts)
            if t.evidence == "preexisting":
                self.stats.preexisting += 1
                t.entry_reason = "visible during startup/reconnect blind window"
                self.evidence.write(EvidencePacket(
                    event="PREEXISTING", ts=now, camera=self.camera, track_id=t.track_id,
                    rule="census: born inside the blind window -> occupancy only, no visit",
                    reasons=[t.entry_reason], box=t.box,
                    detector_scores={"score": t.score, "source": t.source},
                ))
            else:
                self.stats.candidates += 1

        # 6. Entry evidence: the ONLY way to become an arrival -------------------
        for t in list(self.tracks.tracks.values()):
            t.zones = self._settle_zones(t, self.lot_map.zones_at(t.ground_point), now)
            if t.evidence != "candidate":
                # THE CENSUS'S DECISION, MEASURED INSTEAD OF ASSUMED.
                #
                # A track born inside the startup/reconnect blind window is classed
                # `preexisting` and is never tested against the portal, so it can never
                # become an arrival. That is deliberate and it is what stops a boot census
                # from inventing a lot full of arrivals.
                #
                # But it also makes the census UNFALSIFIABLE. A car that genuinely drove in
                # DURING the blind window is classed preexisting, and its arrival is lost --
                # silently, permanently, with no counter anywhere. That is an UNDER-count,
                # the exact mirror of the over-count everything else here guards against, and
                # the blind windows are real: 8.5s of continuous pose suppression measured on
                # recorded pixels, plus every capture reconnect.
                #
                # So the portal is asked anyway, for the RECORD ONLY. A preexisting track
                # that goes on to perform a full outside -> inside crossing is a car this
                # system watched drive in while counting it as already-there.
                #
                # IT MUST NOT PROMOTE. Turning this into an arrival would hand exactly the
                # boot census the portal-crossing authority it was denied, which is the
                # false-arrival class this package exists to prevent -- and it would do it on
                # the tracks least likely to be real crossings. `t.evidence` is untouched
                # below; only the counter, the evidence packet and the corpus see it.
                if (t.evidence == "preexisting" and t.confirmable
                        and t.track_id not in self._preexisting_crossed):
                    verdict = self.portal.evaluate(t.path)
                    if verdict["crossed"]:
                        # ONCE PER TRACK. The path keeps satisfying the portal on every
                        # later frame, so without this the counter would measure frames
                        # rather than cars and the corpus would fill with one vehicle.
                        self._preexisting_crossed.add(t.track_id)
                        self.stats.preexisting_crossed += 1
                        out.setdefault("preexistingCrossed", []).append(t)
                        self.evidence.write(EvidencePacket(
                            event="PREEXISTING_DISAGREEMENT", ts=now, camera=self.camera,
                            track_id=t.track_id,
                            rule="census called it preexisting; the entry portal saw it cross",
                            reasons=[verdict["reason"],
                                     f"outside_hits={verdict['outside_hits']}",
                                     f"inside_run={verdict['inside_run']}",
                                     "RECORDED ONLY: this track is not promoted to arrival"],
                            box=t.box, zones=t.zones,
                            detector_scores={"score": t.score, "source": t.source,
                                             "confirmable": t.confirmable},
                        ))
                continue
            if not t.confirmable:
                self.stats.rejected_no_entry_evidence += 1
                continue
            verdict = self.portal.evaluate(t.path)
            if verdict["crossed"]:
                t.evidence = "arrival"
                t.entry_reason = verdict["reason"]
                self.stats.arrivals += 1
                # Does this track CONTINUE a visit already in progress? The arrival
                # counter above is deliberately incremented first and left alone: this
                # decides TIMING ATTRIBUTION and episode identity, not whether the shop
                # saw an arrival. A stitch that carried the original `arrived_at` is the
                # whole fix -- without it the re-acquired track restarts the clock at
                # `now` and `waitToBay` is measured from the wrong instant.
                sd = self.stitch.adopt(t, now, layout_epoch=_layout_epoch)
                if not sd.stitched:
                    self.stats.arrivals_after_stitch += 1
                started = sd.arrived_at if (sd.stitched and sd.arrived_at is not None) else now
                self.timings[t.track_id] = VisitTiming(
                    arrived_at=started, wait_started_at=started,
                    episode_id=sd.episode_id,
                    continues_track_id=sd.continues_track_id,
                    member_track_ids=(sd.member_track_ids or [t.track_id]),
                )
                emissions = self._emit("new", t, now)
                out["emissions"].extend(emissions)
                self.evidence.write(EvidencePacket(
                    event="ARRIVAL_EVIDENCE", ts=now, camera=self.camera, track_id=t.track_id,
                    visit_id=self._track_visit.get(t.track_id),
                    rule="entry portal: outside -> inside crossing on the ground point",
                    reasons=[verdict["reason"],
                             f"outside_hits={verdict['outside_hits']}",
                             f"inside_run={verdict['inside_run']}"],
                    box=t.box, zones=t.zones,
                    detector_scores={"score": t.score, "source": t.source,
                                     "confirmable": t.confirmable},
                    pose={"changeFrac": round(scene.change_frac, 4), "poseOk": scene.pose_ok},
                ))

        # 7. Ongoing arrivals -> visitd updates; bay observations ----------------
        for t in self.tracks.tracks.values():
            if t.evidence == "arrival" and t.misses == 0:
                out["emissions"].extend(self._emit("update", t, now))
            for bay in self.bays.bays:
                self.bays.observe(bay, bay in t.zones, now, t.track_id)
                if bay in t.zones:
                    tm = self.timings.get(t.track_id)
                    if tm and tm.bay_entered_at is None:
                        tm.bay_entered_at = now

        # 8. Departures ---------------------------------------------------------
        for t in died:
            if t.evidence == "arrival":
                out["emissions"].extend(self._emit("end", t, now, ended=True))
                tm = self.timings.get(t.track_id)
                if tm:
                    tm.departed_at = now
                    # A death is NOT necessarily a departure -- 86% of deaths on this
                    # shop's ledger were never re-acquired, but the ones that are were
                    # a car that never left. So the fragment stays adoptable for the
                    # stitch window, carrying the episode and its original arrival.
                    self.stitch.retire(
                        t, now, episode_id=tm.episode_id or f"{self.camera}-{t.track_id}",
                        arrived_at=tm.arrived_at,
                        member_track_ids=tm.member_track_ids or [t.track_id],
                        layout_epoch=_layout_epoch,
                    )
            self._track_visit.pop(t.track_id, None)

        # 8b. Fragment expiry runs EVERY step, not only inside `adopt()`. Overnight a
        # producer has deaths and no new arrivals, so an expiry that only fired on adopt
        # would let the fragment store grow without bound -- and the unclaimed counter,
        # which is the signal that the window is mistuned, would never advance.
        self.stitch.expire(now)

        # 9. visitd's own clock -------------------------------------------------
        self._tick(now, out)

        return out

    # ------------------------------------------------------------------- summary
    def summary(self) -> dict:
        d = self.stats.to_dict()
        d["openVisits"] = len(getattr(self.tracker, "open_visits", lambda: [])())
        d["occupiedBays"] = self.bays.occupied_bays()
        d["falseArrivalsFromPreexisting"] = 0  # structural: preexisting never reaches visitd
        # Refusals included: a stitcher that never stitches and a stitcher that merges
        # everything both show up as "stitched" alone, and they need opposite fixes.
        d["stitch"] = self.stitch.to_dict()
        return d
