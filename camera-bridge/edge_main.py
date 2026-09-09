"""The durable edge runtime: camera pixels -> ONE VisitTracker -> SQLite -> two projections.

WHY THIS EXISTS. `vision/run_live.py` is the lab lane. It runs the whole vision chain
correctly -- FrameHealth, SceneLock, DetectorCouncil, tracks, preexisting census, entry
portal, bay latch -- and then hands its emissions to a bare HTTP sink. If that POST fails
the emission is gone: no ledger, no outbox, no restart recovery. Meanwhile `visitd` owns
all of that durability but is fed by MQTT from Frigate, which cannot see a P2P-only V380.

So the two halves of a production sensor were built and never joined. This joins them.

WHAT IT IS NOT: a second visit state machine. `VisionPipeline` already accepts an injected
tracker, and visitd's `Pipeline` already owns one alongside the ledger and both outboxes.
This module builds the visitd pipeline first and hands ITS tracker to the vision pipeline,
so there is exactly one authority for visit state and exactly one durable boundary:

    frame -> VisionPipeline.step()          (pixels -> emissions, the vision invariants)
          -> Pipeline.after_step(emissions) (visits + StateNour outbox + shop outbox, ONE txn)
          -> CloudClient worker              (drains StateNour, retries, dead-letters)
          -> Pipeline.drain_shop()           (drains the shop projection, retries)

THE TICK BELONGS TO THE VISION PIPELINE. `VisionPipeline.step()` already calls
`tracker.tick(now)` and folds those emissions into its output, so this loop must NOT also
call visitd's tick -- double-ticking would advance every visit timer twice per frame and
depart cars early. The only timers this loop owns are the heartbeat and the shop drain.
"""
from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from visitd import __version__                                    # noqa: E402
from visitd.cloud_client import CloudClient                       # noqa: E402
from visitd.config import Config, ConfigError, load_config        # noqa: E402
from visitd.ledger import Ledger                                  # noqa: E402
from visitd.main import Pipeline                                  # noqa: E402
from visitd.metrics import REGISTRY, MetricsServer                # noqa: E402

log = logging.getLogger("edge")

#: Identity of THIS process, for the heartbeat's (producerInstanceId, heartbeatSeq)
#: idempotency key. A restart is a new instance, so the cloud accepts a sequence that
#: starts again from zero instead of treating it as a stale replay.
PRODUCER_INSTANCE_ID = os.environ.get("EDGE_INSTANCE_ID") or os.urandom(8).hex()


def _iso(ts: Optional[float]) -> Optional[str]:
    """Epoch seconds -> ISO-8601 UTC. None stays None: an unobserved time is not 'now'."""
    if ts is None:
        return None
    return datetime.fromtimestamp(float(ts), tz=timezone.utc).isoformat()


def source_generation(source: Any) -> str:
    """`<mux lane>.<restore count>` -- the identity a track path must never cross.

    A failover to another lane and a forced un-minimise of the capture window are both
    discontinuities in what the pixels mean, so both bump the generation. The shop stores
    it per visit, which is what lets an evidence review say "this crossing was stitched
    across a source change" instead of trusting it.
    """
    active = getattr(source, "active", None)
    restores = int(getattr(active, "restores", 0) or 0) if active is not None else 0
    return f"{int(getattr(source, 'index', 0) or 0)}.{restores}"


def edge_heartbeat_body(
    *,
    camera: str,
    seq: int,
    now: float,
    mode: str,
    source: Any,
    vision: Any,
    ledger: Ledger,
    health_state: Any,
    scene_state: Any,
    calibration_version: Optional[str],
    detector_name: Optional[str],
    model_sha256: Optional[str],
    last_healthy_frame_at: Optional[float],
    commissioning_run_id: Optional[str] = None,
) -> Dict[str, object]:
    """The producer's account of itself, merging BOTH halves of what it knows.

    `run_live` could only report the vision half (fps, frame health, pose) because it has
    no ledger; `visitd` could only report the delivery half (outbox depth, dead letters)
    because it never sees a pixel. A heartbeat carrying one half is why the shop's health
    lattice had `cloud: unknown` or `frames: unknown` forever. This carries both, so every
    facet the lattice judges has a real input.

    Unknown stays None, never a guess: the lattice treats None as "unknown" and will not
    call a camera healthy on a dimension nobody measured.
    """
    active = getattr(source, "active", None)
    name = str(getattr(active, "name", "") or "")
    if "rtsp" in name:
        source_type = "rtsp"
    elif "wgc" in name:
        source_type = "wgc"
    elif active is not None:
        source_type = "window"
    else:
        source_type = None

    oldest = ledger.shop_outbox_oldest_age(now)
    return {
        "camera": camera,
        "producerInstanceId": PRODUCER_INSTANCE_ID,
        "producerVersion": f"edge {__version__}",
        "heartbeatSeq": int(seq),
        "observedAtEdge": _iso(now),
        "mode": mode,
        "commissioningRunId": commissioning_run_id,
        # --- the vision half -------------------------------------------------
        "sourceType": source_type,
        "sourceGeneration": source_generation(source),
        "sourceConnected": active is not None,
        "lastHealthyFrameAt": _iso(last_healthy_frame_at),
        "captureFps": float(getattr(health_state, "fps", 0.0) or 0.0) if health_state is not None else None,
        "frameOk": bool(health_state.ok) if health_state is not None else None,
        # Pose is UNKNOWN until a reference has been adopted -- reporting the raw
        # `pose_ok` before then would claim a match against nothing.
        "poseOk": (bool(scene_state.pose_ok) if getattr(scene_state, "reference_set", False) else None)
                  if scene_state is not None else None,
        "poseDelta": (float(scene_state.pose_delta) if getattr(scene_state, "pose_delta", None) is not None else None)
                     if scene_state is not None else None,
        "calibrationVersion": calibration_version,
        "detectorName": detector_name,
        "modelSha256": model_sha256,
        # --- the delivery half -----------------------------------------------
        "openVisits": len(vision.tracker.open_visits()),
        "outboxDepth": ledger.shop_outbox_depth(),
        "oldestOutboxAgeSeconds": None if oldest is None else int(oldest),
        "deadLetterDepth": ledger.dead_letter_depth(),
        "restores": int(getattr(active, "restores", 0) or 0) if active is not None else 0,
    }


class EdgeLoop:
    """One pass of the frame-driven loop. The frame-driven twin of visitd's `LiveLoop`.

    Every clock is injected so a test can run exact passes without sleeping, and every
    periodic job is wrapped: a heartbeat or drain defect must degrade telemetry, never
    stop the pipeline that is watching the lot.
    """

    def __init__(
        self,
        pipeline: Pipeline,
        vision: Any,
        source: Any,
        *,
        camera: str,
        mode: str,
        base_mode: Optional[str] = None,
        calibration_version: Optional[str] = None,
        detector_name: Optional[str],
        model_sha256: Optional[str] = None,
        commissioning_run_id: Optional[str] = None,
        heartbeat_seconds: float = 30.0,
        drain_seconds: float = 5.0,
        stall_exit_seconds: float = 180.0,
        persist_seconds: float = 2.0,
        clock=time.time,
    ) -> None:
        self.pipeline = pipeline
        self.vision = vision
        self.source = source
        self.camera = camera
        self.mode = mode
        #: What this producer is when NOT commissioning, passed in from the CALIBRATION
        #: rather than inferred from `mode`. Inferring it meant a runtime launched with
        #: `--commissioning-run` adopted COMMISSIONING as its own baseline and could never
        #: leave it, so the camera badge stayed lit after the run ended while rows were
        #: correctly tagged PRODUCTION again (Codex P2 on #2255).
        self.base_mode = (base_mode or ("SHADOW" if mode == "COMMISSIONING" else mode)).upper()
        self.calibration_version = calibration_version
        self.detector_name = detector_name
        self.model_sha256 = model_sha256
        self.commissioning_run_id = commissioning_run_id
        self.heartbeat_seconds = heartbeat_seconds
        self.drain_seconds = drain_seconds
        #: Deliver NOTHING for this long and the process asks to be restarted. 0 disables.
        self.stall_exit_seconds = stall_exit_seconds
        #: How stale persisted tracker state is allowed to get on quiet frames. See
        #: `_persist_due`. 0 persists on EVERY processed frame.
        self.persist_seconds = persist_seconds
        self.clock = clock

        self.heartbeat_seq = 0
        self.frames = 0
        self.read_failures = 0
        self.last_health: Any = None
        self.last_scene: Any = None
        self.last_healthy_frame_at: Optional[float] = None
        #: Any frame at all, healthy or not -- see `stalled`.
        self.last_frame_at: Optional[float] = None
        #: Set by the watchdog. `run_edge` turns it into a non-zero exit so the OS
        #: supervisor restarts, rather than trying to resurrect the process in place.
        self.stalled: Optional[str] = None
        now = clock()
        self.started_at = now
        self.next_heartbeat = now
        self.next_drain = now + drain_seconds
        self.next_persist = now + persist_seconds
        #: Commits that carried tracker state but no outbox rows -- the quiet-frame path.
        self.quiet_commits = 0
        #: The capture generation the vision pipeline is currently reasoning within.
        self.generation = source_generation(source)
        #: How many times the lane or the restore count changed under us.
        self.generation_breaks = 0

    # ------------------------------------------------------------------ one pass
    def step(self) -> Dict[str, object]:
        """Read one frame, run the vision chain, persist whatever it emitted, run due timers."""
        out: Dict[str, object] = {"emissions": [], "suppressed": None}
        try:
            frame = self.source.read()
        except Exception as exc:
            # A capture that raises is a bad minute, not a bad day: count it, run the
            # timers anyway (so the shop still learns the source is in trouble), and
            # come back next pass. Dying here would take the producer down for a
            # transient the self-heal would have cleared.
            self.read_failures += 1
            self.pipeline.metrics.inc("edge_read_failures_total")
            log.warning("capture read failed error=%s", exc)
            frame = None

        if frame is not None:
            self.frames += 1
            self.last_frame_at = self.clock()

            # A TRACK PATH MUST NEVER CROSS A CAPTURE GENERATION, and this is the only
            # place that can enforce it. `CaptureMux` falls back to the next lane after
            # repeated failed reads, and `WgcWindowSource` bumps its restore count when it
            # un-minimises the window; either way the pixels afterwards mean something
            # different from the pixels before. Feeding the first frame of a new generation
            # straight into the existing pipeline lets an OUTSIDE sample from one lane and
            # an INSIDE sample from another form a single portal-crossing path -- an
            # arrival nobody observed, which is the exact failure this system exists to
            # prevent (Codex P1 on #2255).
            #
            # `mark_degraded()` clears the ground-point history of every track that is not
            # already an arrival (an arrival keeps its path: its crossing is already
            # evidenced), and `note_reconnect()` re-arms the preexisting census so cars
            # visible in the new generation are counted as already-present rather than as
            # having just driven in.
            gen = source_generation(self.source)
            prev_generation = self.generation
            if gen != self.generation:
                self.generation_breaks += 1
                log.warning(
                    "capture generation %s -> %s: degrading tracks and re-arming the census "
                    "(no path may span a source change)", self.generation, gen,
                )
                self.generation = gen
                try:
                    self.vision.tracks.mark_degraded()
                    self.vision.census.note_reconnect(frame.ts)
                except Exception:
                    # FAIL CLOSED. If the invalidation itself failed, the old paths and an
                    # un-re-armed census are still live -- and feeding this frame in anyway
                    # is precisely how an outside sample from the previous lane joins an
                    # inside sample from the new one and fabricates an arrival. Dropping
                    # one frame costs a quarter of a second; processing it can invent a car
                    # (Codex P1 on #2255). The next frame retries, because `self.generation`
                    # is restored so the break is attempted again.
                    self.generation = prev_generation
                    self.pipeline.metrics.inc("edge_generation_break_errors_total")
                    log.exception("generation break FAILED; dropping this frame rather than "
                                  "letting a path span the change")
                    self._run_timers()
                    return {"emissions": [], "suppressed": "generation break failed"}

            try:
                out = self.vision.step(frame)
            except Exception:
                self.pipeline.metrics.inc("edge_vision_errors_total")
                log.exception("vision step error")
                out = {"emissions": [], "suppressed": "vision error"}

            hs = out.get("health") or self.vision.health.state(frame.ts)
            self.last_health = hs
            if hs is not None and getattr(hs, "ok", False):
                self.last_healthy_frame_at = frame.ts
            if out.get("scene") is not None:
                self.last_scene = out["scene"]

            emissions = list(out.get("emissions") or [])
            # THE DURABLE BOUNDARY. Visits, the StateNour outbox and the shop outbox are
            # one transaction; a raise here must propagate, because `after_step` holds the
            # rows for the next pass and swallowing it would drop them.
            #
            # ⚠ THIS RUNS ON QUIET FRAMES TOO, and that is the point. `VisionPipeline.step()`
            # mutates the SHARED tracker on ordinary frames even when it emits nothing: it
            # refreshes `last_activity`, sighting bounds and zone intervals, and those drive
            # the departure grace. Persisting only on transitions meant a crash between them
            # restored stale timers, which can delay a departure, split a visit, or close one
            # early -- and none of that is visible until it happens in the field.
            #
            # It is TIMED rather than per-frame because `commit_step` re-serialises every
            # open visit: at 4 fps with several cars on the lot that is dozens of writes a
            # second for state that moves in tens of seconds. `persist_seconds` bounds how
            # stale the on-disk copy can be (2 s by default, against a departure grace
            # measured in tens of seconds); an emission always commits immediately.
            if emissions or self._persist_due():
                if not emissions:
                    self.quiet_commits += 1
                self.pipeline.after_step(emissions)

        self._run_timers()
        return out

    def _persist_due(self) -> bool:
        """True when the quiet-frame persist interval has elapsed (and arms the next one)."""
        now = self.clock()
        if self.persist_seconds <= 0:
            return True
        if now < self.next_persist:
            return False
        self.next_persist = now + self.persist_seconds
        return True

    def check_stall(self, now: float) -> Optional[str]:
        """Has the source stopped delivering ANYTHING? Returns a reason, or None.

        THE DISTINCTION THAT MAKES THIS SAFE. A frozen or looping camera still delivers
        frames -- that is a VISION problem, and the pipeline already reports it as
        DEGRADED_VISION and suppresses detections. Restarting on it would be a restart
        loop against a dirty lens, achieving nothing but log noise and thrash. A source
        delivering NO FRAME AT ALL is a PROCESS problem, which a restart genuinely fixes:
        a dead capture session, an app that was closed and reopened, a handle that went
        stale past what `_restore_target` can heal.

        The clock runs from process start until the first frame, so a producer that never
        captured anything is caught too rather than waiting forever for a `last_frame_at`
        it will never get.
        """
        if self.stall_exit_seconds <= 0:
            return None
        since = self.last_frame_at if self.last_frame_at is not None else self.started_at
        age = now - since
        if age <= self.stall_exit_seconds:
            return None
        if self.last_frame_at is None:
            return (f"no frame was EVER captured in {age:.0f}s (limit {self.stall_exit_seconds:.0f}s) -- "
                    "the window or stream was never readable")
        return (f"no frame for {age:.0f}s (limit {self.stall_exit_seconds:.0f}s) after "
                f"{self.frames} frame(s) -- the capture source stopped delivering")

    def _run_timers(self) -> None:
        now = self.clock()
        if self.stalled is None:
            self.stalled = self.check_stall(now)
        if now >= self.next_heartbeat:
            self.next_heartbeat = now + self.heartbeat_seconds
            try:
                self.send_heartbeat(now)
            except Exception:
                self.pipeline.metrics.inc("edge_heartbeat_errors_total")
                log.exception("heartbeat error")
        if now >= self.next_drain:
            self.next_drain = now + self.drain_seconds
            try:
                self.pipeline.drain_shop()
            except Exception:
                self.pipeline.metrics.inc("edge_drain_errors_total")
                log.exception("shop drain error")

    def send_heartbeat(self, now: Optional[float] = None) -> bool:
        """Compose and post one heartbeat. False when no shop is configured."""
        if not self.pipeline.shop.enabled:
            return False
        self.heartbeat_seq += 1
        body = edge_heartbeat_body(
            camera=self.camera,
            seq=self.heartbeat_seq,
            now=self.clock() if now is None else now,
            mode=self.mode,
            source=self.source,
            vision=self.vision,
            ledger=self.pipeline.ledger,
            health_state=self.last_health,
            scene_state=self.last_scene,
            calibration_version=self.calibration_version,
            detector_name=self.detector_name,
            model_sha256=self.model_sha256,
            last_healthy_frame_at=self.last_healthy_frame_at,
            # ONLY what the mirror is currently tagging rows with. Falling back to the
            # launch flag would keep re-reporting a run the producer had already left, so
            # the admin would never see commissioning end -- and this field exists
            # precisely to prove what the edge acknowledged.
            commissioning_run_id=self.pipeline.shop.commissioning_run_id,
        )
        ok = self.pipeline.shop.heartbeat(body)
        # The reply may have switched the mode either way; keep the loop's view in step so
        # the NEXT heartbeat reports it without waiting another round trip. Returning to
        # `base_mode` is what lets the camera card's badge clear when a run ends.
        self.mode = "COMMISSIONING" if self.pipeline.shop.commissioning_run_id else self.base_mode
        return ok

    def shutdown(self) -> None:
        """Flush on the way out: commit whatever is held, then drain what we can.

        DELIBERATELY NO FINAL HEARTBEAT. A heartbeat asserts "this is my state right now",
        and the state of a process that is exiting is not something the lattice has a word
        for -- claiming HEALTHY on the way out would be a lie with a 30-second half-life,
        and claiming CAMERA_OFFLINE would be a different one. Silence is the honest signal:
        the last real heartbeat ages, and the shop derives STALE and then PRODUCER_OFFLINE
        from that age on its own. That derivation is exactly what the read-side liveness
        rules exist for.
        """
        try:
            self.pipeline.after_step([])
        except Exception:
            log.exception("final commit failed")
        try:
            self.pipeline.drain_shop()
        except Exception:
            log.exception("final shop drain failed")


# ---------------------------------------------------------------------------- wiring
def seed_track_ids(vision: Any, tracker: Any, camera: str) -> int:
    """Push the vision track counter past every RESTORED sighting id. Returns the new floor.

    THE COLLISION THIS PREVENTS. `VisionPipeline._emit` derives a sighting id as
    `"{camera}-{track_id}"`, and a fresh `TrackGraph` restarts `_next_id` at 1. After a
    restart the tracker holds restored sightings like `sign-1`, so the FIRST car the new
    process sees is handed `sign-1` too -- and visitd looks a sighting up by that id, so a
    completely different vehicle is attached to the old visit. It would inherit that
    visit's arrival time, its bay, and its commissioning class.

    Seeding the counter above the highest restored id makes the ids disjoint by
    construction, which is cheaper and far more robust than trying to detect the clash
    afterwards.

    This is HALF the restart story; `reconcile_restart` is the other half.
    """
    highest = 0
    prefix = f"{camera}-"
    try:
        for visit in tracker.open_visits():
            for sighting_id in getattr(visit, "sightings", {}):
                sid = str(sighting_id)
                if not sid.startswith(prefix):
                    continue
                tail = sid[len(prefix):]
                if tail.isdigit():
                    highest = max(highest, int(tail))
    except Exception:
        log.exception("could not read restored sightings; leaving the track counter alone")
        return 0
    if highest:
        vision.tracks._next_id = highest + 1
        log.info("restored %s sighting(s); vision track ids start at %s so a new car cannot "
                 "inherit an old visit", highest, highest + 1)
    return highest


def reconcile_restart(pipeline: Any, camera: str) -> int:
    """Force-end this camera's restored sightings; returns how many visits it touched.

    WHY A RESTART MUST END THEM. Every path visitd has for recognising a car it has already
    seen -- `_by_sighting`, `_continued_visit`'s `max_age_closed` map -- is keyed on the
    PRODUCER-ASSIGNED object id, and a fresh `TrackGraph` cannot reproduce the ids the dead
    process handed out. So after a restart visitd genuinely cannot tell that the car now in
    bay 2 is the car that was in bay 2 before: vision identity does not survive the process.

    Leaving the orphans open was the worse of the two available wrongs. Nothing ends them --
    no live track exists to send the `end` -- so they sat until the 12-hour
    `max_sighting_seconds` expiry and then departed at a time the car was demonstrably long
    gone, with the whole downtime billed into the visit. On a producer that lives on a
    laptop, restarts are the NORMAL case, not the exception.

    Force-ending is the same call visitd already makes when Frigate's object registry is
    lost (`frigate_availability` -> `force_end_open_sightings("frigate_restart")`), and it
    is right for the same reason: the registry that minted those ids is gone. The sightings
    close at the last activity the OLD process recorded -- NOT at now, so the downtime is
    not billed to the customer -- the visits go DEPARTING, and the ordinary leave grace
    resolves them.

    WHAT IT COSTS, stated rather than hidden: a car still parked through the restart opens a
    NEW visit with a new arrival time instead of continuing its old one. That is a visible,
    conservative wrong number -- one visit split in two -- and it is strictly better than the
    alternative the id-seeding fix rules out, where a DIFFERENT customer silently inherits a
    stranger's arrival time, bay and data class. Continuity across a restart would require
    vision identity to be durable, which is a different piece of work.
    """
    try:
        before = {v.visit_id for v in pipeline.tracker.open_visits()}
        if not before:
            return 0
        pipeline.force_end_open_sightings("producer_restart", time.time(), camera)
    except Exception:
        log.exception("could not reconcile restored sightings; they will expire on max age instead")
        return 0
    log.info("restart reconcile: force-ended %s camera's open sightings across %s restored visit(s) "
             "at their last recorded activity", camera, len(before))
    return len(before)


def build_edge(cfg: Config, args: argparse.Namespace):
    """Build the visitd pipeline first, then hand ITS tracker to the vision pipeline.

    Order matters: `Pipeline.__init__` restores open visits from the ledger into its
    tracker, so building it first means a restarted producer resumes the cars that were
    on the lot rather than re-arming from empty. Those restored visits have no live
    vision TRACK -- the pixels moved on while the process was down -- and that is correct:
    visitd's own timers age them out through the normal departure grace instead of the
    vision layer inventing a track it never saw.
    """
    from vision.evidence import EvidenceStore
    from vision.geometry import EntryPortal, LotMap, Zone
    from vision.pipeline import VisionPipeline
    from vision.run_live import build_council, build_source

    ledger = Ledger(
        args.ledger or cfg.ledger_path,
        outbox_max_depth=cfg.backend.outbox_max_depth,
        policy=cfg.policy,
    )
    cloud = CloudClient(cfg.backend, ledger, REGISTRY, dry_run=args.dry_run)
    pipeline = Pipeline(cfg, ledger, cloud, REGISTRY)

    camera = args.camera
    if camera not in cfg.cameras:
        raise ConfigError(
            f"--camera {camera!r} is not in the config (cameras: {', '.join(cfg.cameras) or 'none'}). "
            "The edge posts under this name and the shop's expected-camera registry keys on it, "
            "so a mismatch would render as an unregistered producer."
        )
    cam = cfg.cameras[camera]

    source = build_source(args.source, args.hwnd, args.window_title, not args.no_crop)

    calibration_version = None
    lot_poly = portal_poly = None
    bays: dict = {}
    if args.calibration and os.path.exists(args.calibration):
        import hashlib
        import json as _json

        raw = open(args.calibration, "rb").read()
        calibration_version = "sha256:" + hashlib.sha256(raw).hexdigest()[:12]
        cal = _json.loads(raw.decode("utf-8"))
        lot_poly = [tuple(p) for p in cal["lot"]]
        portal_poly = [tuple(p) for p in (cal.get("portal") or [])]
        bays = {k: [tuple(p) for p in v] for k, v in (cal.get("bays") or {}).items()}

    arrival_zone = (cam.arrival_zones or ("front_lot",))[0]
    if lot_poly:
        lot_map = LotMap().add(arrival_zone, lot_poly)
        for name, poly in bays.items():
            lot_map.add(name, poly)
        portal = EntryPortal(
            Zone(arrival_zone, lot_poly),
            portal_zone=Zone("portal", portal_poly) if portal_poly else None,
        )
    else:
        # CENSUS MODE. An empty portal polygon cannot be crossed, so no arrival can be
        # fabricated from an uncalibrated guess -- and the heartbeat reports a missing
        # calibration, which the shop renders as CALIBRATION_INVALID rather than healthy.
        log.warning("no calibration: census mode -- occupancy and health only, arrivals are NOT claimed")
        lot_map = LotMap().add(arrival_zone, [(0.0, 0.0), (1e6, 0.0), (1e6, 1e6), (0.0, 1e6)])
        portal = EntryPortal(Zone(arrival_zone, []), portal_zone=Zone("portal", []))

    council = build_council(args.model, args.device, args.motion_gate)
    vision = VisionPipeline(
        council=council,
        lot_map=lot_map,
        entry_portal=portal,
        camera=camera,
        arrival_zone=arrival_zone,
        bay_names=list(bays.keys()),
        evidence=EvidenceStore(args.evidence, enabled=bool(args.evidence)),
        # THE JOIN: one tracker, owned by visitd, driven by vision.
        tracker=pipeline.tracker,
    )
    seed_track_ids(vision, pipeline.tracker, camera)
    reconcile_restart(pipeline, camera)

    # The mode this producer returns to when NOT commissioning. Derived from the
    # CALIBRATION, never from the launch flag: a runtime started with
    # `--commissioning-run` would otherwise treat COMMISSIONING as its own baseline and
    # never leave it, so the camera badge would stay lit after the run ended even though
    # rows were correctly tagged PRODUCTION again (Codex P2 on #2255).
    base_mode = args.mode if args.mode in ("production", "shadow") else (
        "production" if calibration_version else "shadow"
    )
    mode = args.mode or ("commissioning" if args.commissioning_run else base_mode)
    if args.commissioning_run:
        mode = "commissioning"
    data_class = "COMMISSIONING" if mode == "commissioning" else "PRODUCTION"
    pipeline.shop.data_class = data_class
    pipeline.shop.commissioning_run_id = args.commissioning_run
    # Provenance the shop stores per visit. Config values win where set; the calibration
    # hash is computed here because only this process knows which file it loaded.
    prov = dict(cam.provenance())
    if calibration_version and not prov.get("calibrationVersion"):
        prov["calibrationVersion"] = calibration_version
    detector_name = getattr(council, "name", None) or type(council).__name__
    if not prov.get("detectorName"):
        prov["detectorName"] = detector_name
    pipeline.shop.provenance = prov

    return pipeline, vision, source, calibration_version, detector_name, mode, data_class, base_mode


def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        prog="edge_main",
        description="Durable edge runtime: camera pixels through visitd's ledger and both outboxes.",
    )
    ap.add_argument("--config", default="config.yaml", help="visitd config (cameras, backend, policy)")
    ap.add_argument("--camera", default="sign", help="which configured camera this producer IS")
    ap.add_argument("--ledger", default=None, help="override the SQLite ledger path (':memory:' for a throwaway)")
    ap.add_argument("--source", default="wgc", help="capture lane: wgc | window")
    ap.add_argument("--hwnd", type=int, default=None, help="explicit window handle (else resolved by title)")
    ap.add_argument("--window-title", default="V380", help="capture window title")
    ap.add_argument("--no-crop", action="store_true", help="capture the whole window, not the measured pane")
    ap.add_argument("--calibration", default=None, help="lot/portal/bay polygons; without it, census mode")
    # Honour the same env vars `vision.run_live` does. Without a model `build_council`
    # returns a council with no primary detector, whose `can_confirm_arrival` is always
    # False -- so the pipeline rejects every candidate and NO arrival is ever emitted, no
    # matter how good the calibration is (Codex P1 on #2255). The installer passes it
    # explicitly; this fallback means a hand-run producer inherits the same setting.
    ap.add_argument("--model", default=os.environ.get("VISION_OV_MODEL"),
                    help="OpenVINO model xml (env VISION_OV_MODEL). WITHOUT IT the council is "
                         "motion-only and cannot confirm an arrival")
    ap.add_argument("--device", default=os.environ.get("VISION_OV_DEVICE", "AUTO"),
                    help="OpenVINO device (env VISION_OV_DEVICE)")
    ap.add_argument("--motion-gate", action="store_true", default=True, help="skip the detector on still frames")
    ap.add_argument("--evidence", default=None, help="directory for evidence packets")
    ap.add_argument("--fps", type=float, default=4.0, help="analysis rate")
    ap.add_argument("--seconds", type=float, default=0.0, help="stop after N seconds (0 = until signalled)")
    ap.add_argument("--mode", choices=["production", "shadow", "commissioning"], default=None,
                    help="default: shadow without a calibration, production with one")
    ap.add_argument("--commissioning-run", default=None,
                    help="commissioning run id; rows are tagged COMMISSIONING and excluded from shop KPIs")
    ap.add_argument("--heartbeat-seconds", type=float, default=30.0)
    ap.add_argument("--drain-seconds", type=float, default=5.0)
    ap.add_argument("--persist-seconds", type=float, default=2.0,
                    help="how stale persisted tracker state may get on frames that emit nothing; "
                         "0 persists every frame. An emission always commits immediately")
    ap.add_argument("--stall-exit-seconds", type=float, default=180.0,
                    help="exit(3) after this long with NO frame at all so the supervisor restarts; "
                         "0 disables. A frozen-but-delivering camera is NOT a stall -- that is "
                         "reported as degraded vision, and restarting on it would only thrash")
    ap.add_argument("--dry-run", action="store_true", help="never POST to StateNour; the shop lane is unaffected")
    ap.add_argument("--log-level", default="INFO")
    return ap.parse_args(argv)


def run_edge(args: argparse.Namespace) -> int:
    logging.basicConfig(level=getattr(logging, str(args.log_level).upper(), logging.INFO),
                        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    cfg = load_config(args.config)
    pipeline, vision, source, calibration_version, detector_name, mode, data_class, base_mode = build_edge(cfg, args)

    log.info(
        "edge start version=%s instance=%s camera=%s mode=%s dataClass=%s calibration=%s ledger=%s",
        __version__, PRODUCER_INSTANCE_ID, args.camera, mode, data_class,
        calibration_version or "none", pipeline.ledger.path,
    )
    if not args.model:
        log.warning(
            "NO DETECTOR MODEL (--model / VISION_OV_MODEL): the council is motion-only, so "
            "`can_confirm_arrival` is False and NO ARRIVAL WILL EVER BE EMITTED. Occupancy "
            "and health still report honestly; run `python -m vision.fetch_models --dest "
            "ov_models` and pass the xml to make arrivals possible."
        )
    if not pipeline.shop.enabled:
        log.warning("shop ingest is NOT configured (needs backend.shopUrl and CAMERA_INGEST_KEY); "
                    "visits will persist locally and queue, but the shop admin will not update")

    metrics_server: Optional[MetricsServer] = None
    try:
        metrics_server = MetricsServer(cfg.metrics_host, cfg.metrics_port, REGISTRY)
        metrics_server.start()
    except OSError as exc:
        log.error("metrics server unavailable host=%s port=%s error=%s", cfg.metrics_host, cfg.metrics_port, exc)

    pipeline.cloud.start()
    loop = EdgeLoop(
        pipeline, vision, source,
        camera=args.camera, mode=mode.upper(), base_mode=base_mode.upper(),
        calibration_version=calibration_version, detector_name=detector_name,
        commissioning_run_id=args.commissioning_run,
        heartbeat_seconds=args.heartbeat_seconds, drain_seconds=args.drain_seconds,
        stall_exit_seconds=args.stall_exit_seconds, persist_seconds=args.persist_seconds,
    )

    stop = threading.Event()

    def _signal(signum: int, _frame: object) -> None:
        log.info("shutdown signal=%s", signum)
        stop.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, _signal)
        except (ValueError, OSError):
            pass   # not the main thread, or unsupported on this platform

    interval = 1.0 / max(0.5, args.fps)
    deadline = (time.time() + args.seconds) if args.seconds else None
    exit_code = 0
    try:
        while not stop.is_set():
            if deadline is not None and time.time() >= deadline:
                break
            started = time.time()
            loop.step()
            if loop.stalled:
                # Ask to be restarted rather than trying to resurrect in place. The OS
                # supervisor already knows how to restart with a budget and a backoff;
                # re-implementing that here would be a second, worse supervisor.
                log.error("edge stalled: %s -- exiting for the supervisor to restart", loop.stalled)
                exit_code = 3
                break
            time.sleep(max(0.0, interval - (time.time() - started)))
    finally:
        # Attempts are not deliveries. Logging only `heartbeat_seq` meant a run whose
        # every heartbeat was rejected read exactly like a healthy one -- the same
        # empty-vs-error shape this project keeps paying for.
        log.info(
            "edge stopping frames=%s read_failures=%s quiet_commits=%s generation_breaks=%s "
            "heartbeats=%s/%s delivered visits=%s/%s outbox=%s shop_queue=%s dead_letters=%s",
            loop.frames, loop.read_failures, loop.quiet_commits, loop.generation_breaks,
            pipeline.shop.heartbeats_sent, loop.heartbeat_seq,
            pipeline.shop.sent, pipeline.shop.sent + pipeline.shop.failed,
            pipeline.ledger.outbox_depth(), pipeline.ledger.shop_outbox_depth(),
            pipeline.ledger.dead_letter_depth(),
        )
        loop.shutdown()
        pipeline.cloud.stop()
        pipeline.ledger.close()
        if metrics_server is not None:
            metrics_server.stop()
    return exit_code


def main(argv=None) -> int:
    try:
        return run_edge(parse_args(argv))
    except ConfigError as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
