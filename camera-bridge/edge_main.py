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
from collections import deque
from datetime import datetime, timezone
from typing import Any, Deque, Dict, Optional, Tuple

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

#: Priority-bearing identity of THIS process. The prefix is interpreted by the shop
#: heartbeat route as the failover order; the random suffix still makes every restart a
#: fresh heartbeat instance, so its sequence may safely restart at zero.
#: Unknown/legacy roles keep the old opaque id and therefore receive no priority privilege.
_EDGE_ROLE_PREFIX = {
    "shop": "p1-shop",
    "nicksmax": "p2-nicksmax",
    "nattynour": "p3-nattynour",
}
_edge_role = os.environ.get("EDGE_ROLE", "").strip().lower()
_edge_prefix = _EDGE_ROLE_PREFIX.get(_edge_role)
PRODUCER_INSTANCE_ID = (
    os.environ.get("EDGE_INSTANCE_ID")
    or (f"{_edge_prefix}-{os.urandom(6).hex()}" if _edge_prefix else os.urandom(8).hex())
)


def _refresh_progress_lease(path: Optional[str]) -> None:
    """Best-effort out-of-process liveness lease.

    The supervisor uses this to distinguish a producer that merely owns its metrics port
    from one whose main loop is actually making progress. The refresh happens only after
    EdgeLoop.step() returns, so a capture backend wedged inside source.read() naturally
    leaves the lease stale and becomes restartable from outside the blocked process.
    """
    if not path:
        return
    try:
        with open(path, "a", encoding="ascii"):
            pass
        os.utime(path, None)
    except OSError as exc:
        log.warning("progress lease refresh failed path=%s error=%s", path, exc)


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
    # THE LAYOUT EPOCH IS PART OF THE IDENTITY, and folding it in here is what makes a
    # re-located scene safe. A track at x=650 before a layout change and a detection at
    # x=650 after it are not the same place; joining them manufactures a portal crossing no
    # car ever made. The generation-break path above already degrades tracks and re-arms the
    # census for a lane failover -- which is exactly the right response -- so a layout change
    # needs no second mechanism, only membership in the same identity.
    epoch = int(getattr(active, "layout_epoch", 0) or 0)
    return f"{int(getattr(source, 'index', 0) or 0)}.{restores}.{epoch}"


_GIT_SHA_CACHE: Dict[str, Optional[str]] = {}


def _git_sha() -> Optional[str]:
    """The commit this producer is running, or None. Resolved once and cached.

    None on any failure, never a guess and never a placeholder like "unknown": the shop
    renders this string, and a producer confidently reporting a SHA it invented is worse
    than one reporting nothing. Cached because it cannot change while the process runs and
    the heartbeat fires every 30 seconds.
    """
    if "sha" not in _GIT_SHA_CACHE:
        sha = os.environ.get("EDGE_GIT_SHA")          # baked at install, if the installer did
        if not sha:
            try:
                import subprocess

                out = subprocess.run(["git", "rev-parse", "HEAD"],
                                     cwd=os.path.dirname(os.path.abspath(__file__)),
                                     capture_output=True, text=True, timeout=5)
                sha = out.stdout.strip() if out.returncode == 0 else None
            except Exception:  # noqa: BLE001 - no git, no repo, no answer. Not a failure.
                sha = None
        _GIT_SHA_CACHE["sha"] = (sha or None) and sha[:40]
    return _GIT_SHA_CACHE["sha"]


def _model_sha256(model_path: Optional[str]) -> Optional[str]:
    """Digest of the model actually loaded: topology AND weights, or None.

    `EdgeLoop` has always accepted `model_sha256`, threaded it into the heartbeat and had it
    rendered on the shop's camera card -- and `main()` never passed one, so the answer to
    "which weights is this producer running" has always been blank. That is the question
    `fetch_models.py` exists to make answerable; it pins every artifact by sha256, and then
    nothing reported which pinned artifact was in use.

    BOTH FILES, hashed in a fixed order. An OpenVINO model is an `.xml` topology beside a
    `.bin` of weights, and a change to either changes what the detector does -- digesting
    only the xml would report a match across two different sets of weights, which is the
    one thing this field must never do. Prefixed `ov:` so the value is self-describing:
    a bare 64 hex characters invites someone to compare it against a single-file digest
    from somewhere else and conclude the models differ when they do not.
    """
    if not model_path:
        return None
    try:
        import hashlib

        digest = hashlib.sha256()
        base = os.path.splitext(os.path.abspath(model_path))[0]
        found = False
        for suffix in (".xml", ".bin"):
            candidate = base + suffix
            if not os.path.exists(candidate):
                continue
            found = True
            with open(candidate, "rb") as fh:
                for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                    digest.update(chunk)
        if not found:
            return None
        return "ov:" + digest.hexdigest()[:56]
    except Exception:  # noqa: BLE001 - an unreadable model file is a None, never a guess
        return None


def _disk_free_bytes(ledger: Any) -> Optional[int]:
    """Free space on the filesystem holding the LEDGER, or None if it cannot be read.

    None rather than 0. A zero here says "the disk is full", which is the single most
    alarming value this field can take -- reporting it because a stat call failed would page
    someone to a disk that is fine.
    """
    try:
        import shutil

        path = getattr(ledger, "path", None)
        if not path or path == ":memory:":
            # NOT the current directory. Falling back to "." answers a question we cannot
            # answer -- the cwd can sit on an entirely different volume from the ledger, so
            # the number would be real, plausible, and about the wrong disk. An in-memory
            # ledger has no disk at all.
            return None
        return int(shutil.disk_usage(os.path.dirname(os.path.abspath(path))).free)
    except Exception:  # noqa: BLE001
        return None


#: How long after a track dies a new one nearby still counts as the SAME car coming back.
#: Long enough to cover a car passing behind another; short enough that two customers
#: arriving in the same spot a minute apart are not called one.
#: The modes the shop's heartbeat schema accepts. Mirrored from `HEARTBEAT_MODES` in
#: cameraVisitsRoutes.ts; `test_heartbeat_contract.py` fails if the two ever disagree.
def _round_or_none(value: Any, places: int = 3) -> Optional[float]:
    """Round a float, or keep None as None.

    `round(x or 0.0, 3)` would turn "not measured" into a confident 0.0 -- and for
    `poseDelta` a zero reads as a PERFECT match to the reference, which is the opposite of
    "we have no reference to compare against".
    """
    if value is None:
        return None
    try:
        return round(float(value), places)
    except Exception:  # noqa: BLE001
        return None


#: A match is called THIN when a quality figure sits within this multiple of the floor that
#: would have refused it outright. 1.5 is a band, not a threshold: nothing changes behaviour
#: at 1.5, it only decides which accepted matches are worth keeping a clip of.
LOCATE_THIN_FACTOR = 1.5


def _locate_quality(located: Any) -> Optional[Dict[str, Any]]:
    """The figures a `Located` carries, flattened for a clip payload and a log.

    None when there is nothing to report, never a dict of zeros -- an unmeasured match and a
    match that scored zero are different claims and only one of them can be true.
    """
    if located is None:
        return None
    try:
        return {
            "sceneId": str(getattr(located, "scene_id", "")),
            "variant": str(getattr(located, "variant", "")),
            "inliers": int(getattr(located, "inliers", 0)),
            "inlierRatio": _round_or_none(getattr(located, "inlier_ratio", None)),
            "reprojectionPx": _round_or_none(getattr(located, "reprojection_error", None)),
            "runnerUp": getattr(located, "runner_up", None),
            "margin": _round_or_none(getattr(located, "margin", None)),
            "homographyId": str(getattr(located, "homography_id", "")),
        }
    except Exception:  # noqa: BLE001 - never cost a frame over a log field
        return None


def _locate_is_thin(quality: Dict[str, Any]) -> Optional[str]:
    """Name the figure that was nearly a refusal, or None when the match was comfortable.

    WHAT THIS DOES NOT CATCH, said here rather than discovered later. The worst locator
    failure this shop has actually seen was not thin: a PTZ that had been moved matched its
    stored reference at 158 INLIERS -- nearly nine times the floor of 18 -- with a 0.81 ratio
    and 1.33px reprojection. It was confidently, precisely wrong. What caught it was an
    INDEPENDENT signal (the located quad sat 623px from the detected live pane, failing
    `MIN_PANE_IOU`), and nothing about its own fit quality would ever have raised a flag.

    So this is not a guard against binding the wrong scene. It is a record of the accepted
    matches that came closest to being refused, which is a different and much smaller class,
    and it is worth having because those are the ones whose margin is being eaten by
    something -- a dirty lens, a re-encoded stream, a slow layout drift -- and the corpus is
    where that trend becomes visible before the refusal.
    """
    from vision import scenelocator as sl

    inliers = quality.get("inliers")
    if isinstance(inliers, int) and inliers < sl.MIN_INLIERS * LOCATE_THIN_FACTOR:
        return f"inliers={inliers} against a floor of {sl.MIN_INLIERS}"
    ratio = quality.get("inlierRatio")
    if ratio is not None and ratio < sl.MIN_INLIER_RATIO * LOCATE_THIN_FACTOR:
        return f"inlierRatio={ratio} against a floor of {sl.MIN_INLIER_RATIO}"
    margin = quality.get("margin")
    # `inf` is the honest value for "no runner-up scene was a candidate at all", and it must
    # never read as a near-tie. It does not, and NO EXPLICIT GUARD IS WRITTEN FOR IT: `inf`
    # already fails this `<`, so an `and margin != float("inf")` clause would sit here
    # advertising a protection it can never provide. A mutation sweep proved exactly that --
    # deleting the clause turned nothing red. Same finding, and the same decision, as the
    # reprojection cap `scenelocator.py` declines to write for the same reason.
    if margin is not None and margin < sl.AMBIGUITY_MARGIN * LOCATE_THIN_FACTOR:
        return (f"margin={margin} over {quality.get('runnerUp')!r} against a floor of "
                f"{sl.AMBIGUITY_MARGIN}")
    return None


def _track_vitals(track: Any, now: float) -> Dict[str, Any]:
    """A dead or newborn track's own account of itself, for the hard-case context.

    The geometry of a re-acquisition says WHERE and WHEN; these say what the tracker knew
    about the vehicle it lost. Recorded because the question the corpus needs to answer --
    "was this a car lost while stationary, or one lost while moving?" -- cannot be answered
    from a distance and a gap, and answering it wrong points any fix at the wrong threshold.

    Every field is read defensively: this runs on the hard-case path, which must never cost
    a frame, and a Track that grows or loses an attribute must not take the corpus with it.
    """
    def _get(name, default=None):
        try:
            value = getattr(track, name, default)
            return round(value, 2) if isinstance(value, float) else value
        except Exception:  # noqa: BLE001
            return default

    out: Dict[str, Any] = {
        "hits": _get("hits"), "misses": _get("misses"), "score": _get("score"),
        "evidence": _get("evidence"), "degraded": _get("degraded"),
    }
    try:
        born = getattr(track, "born_ts", None)
        out["ageSeconds"] = round(now - born, 2) if born is not None else None
    except Exception:  # noqa: BLE001
        out["ageSeconds"] = None
    try:
        out["stationarySeconds"] = round(track.stationary_for(now), 2)
    except Exception:  # noqa: BLE001
        out["stationarySeconds"] = None
    return out


VALID_MODES = frozenset({"PRODUCTION", "SHADOW", "COMMISSIONING"})

REACQUIRE_SECONDS = 8.0
#: ...and how close, on the ground plane, in source pixels. Roughly a car length.
REACQUIRE_PX = 90.0
#: A birth this close to a track that is still ALIVE is one vehicle becoming two.
SPLIT_PX = 45.0


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
    last_inference_at: Optional[float] = None,
    inference_p95_ms: Optional[float] = None,
    last_frame_at: Optional[float] = None,
    last_cloud_ack_at: Optional[float] = None,
    detector_name: Optional[str],
    model_sha256: Optional[str],
    last_healthy_frame_at: Optional[float],
    commissioning_run_id: Optional[str] = None,
    relocate_failures: Optional[int] = None,
    preexisting_crossed: Optional[int] = None,
    arrivals_after_stitch: Optional[int] = None,
    stitched_total: Optional[int] = None,
    stitch_refused_ambiguous: Optional[int] = None,
    detections_last_10m: Optional[int] = None,
    portal_crossings_last_60m: Optional[int] = None,
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
        # Which BUILD is running. `producerVersion` is a hand-bumped string that says
        # "edge 2.1.2" for every commit in a release, so it cannot answer "is the shop
        # running the fix I merged an hour ago" -- which is the question actually asked.
        "gitSha": _git_sha(),
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
        # The shop has had a column, a Zod field and an ADMIN CARD for both of these since
        # migration 0120, and the producer has never sent either -- so `inferenceP95Ms`
        # rendered blank on the camera detail card forever while `CouncilResult.latency_ms`
        # was being measured on every frame and thrown away. A reader with no writer.
        #
        # SEMANTICS, because the pair is only useful if both ends agree what it means:
        # an "inference" is the DETECTOR running, never the motion gate. A gated frame is a
        # decision not to infer, so on a quiet lot these go stale BY DESIGN and staleness
        # alone is not a fault.
        #
        # BE EXACT ABOUT WHAT THIS PROVES, because a health field is read as a promise.
        # These do NOT separate a dead detector from a still lot at any single instant --
        # both render null, and on a genuinely motionless lot there is no evidence either
        # way, which is the honest answer rather than a shortcoming. What they give you is
        # the separation OVER TIME: a healthy producer stamps a fresh `lastInferenceAt`
        # every time anything moves, so once the lot has had any traffic at all, a producer
        # still reporting null has stopped inferring. Before this, no amount of traffic
        # distinguished the two -- both were silence for as long as you cared to watch.
        # Separating them at an instant needs a gated-frame COUNT, which needs a column.
        # THREE MORE COLUMNS THE SHOP RENDERS AND NOBODY EVER FILLED. Found by diffing the
        # route's HEARTBEAT_COLUMNS against the keys this body actually carries: of 30
        # columns, 5 were never sent. `state` is derived server-side and correctly absent;
        # the other four are here.
        #
        # `lastFrameAt` vs `lastHealthyFrameAt`: a frozen camera keeps delivering frames,
        # just not healthy ones, so the pair is what separates "no frames at all" from
        # "frames that are no good". `lot.ts:257` carries a comment from whoever hit this
        # first -- they wanted lastFrameAt, grepped camera-bridge, found ZERO producers
        # writing it, and switched to lastHealthyFrameAt rather than gate a run on a column
        # that would be NULL forever. The value was already tracked on this loop; it was
        # simply never put in the envelope.
        "lastFrameAt": _iso(last_frame_at) if last_frame_at else None,
        # Depth alone cannot say whether a queue is draining: a depth of 40 that is falling
        # and a depth of 40 stuck since Tuesday read the same. This is what CLOUD_BACKLOG
        # ("sensing fine, durable queue not draining") needs to mean anything.
        "lastCloudAckAt": _iso(last_cloud_ack_at) if last_cloud_ack_at else None,
        # The producer writes clips, episodes, a ledger and a trajectory store to this disk.
        # It has a byte budget for the clips and nothing at all for the rest, and the shop
        # renders this number -- so filling the disk was invisible from the only screen
        # anyone watches. Measured against the LEDGER's own filesystem, which is the one
        # that actually matters: a full disk there stops the producer recording visits.
        "diskFreeBytes": _disk_free_bytes(ledger),
        "lastInferenceAt": _iso(last_inference_at) if last_inference_at else None,
        "inferenceP95Ms": (round(float(inference_p95_ms), 1)
                           if inference_p95_ms is not None else None),
        # --- the delivery half -----------------------------------------------
        "openVisits": len(vision.tracker.open_visits()),
        "outboxDepth": ledger.shop_outbox_depth(),
        "oldestOutboxAgeSeconds": None if oldest is None else int(oldest),
        "deadLetterDepth": ledger.dead_letter_depth(),
        "restores": int(getattr(active, "restores", 0) or 0) if active is not None else 0,
        # BOTH None-PRESERVING, and that is the whole reason they are Optional rather than
        # defaulted to 0. A producer that does not track one of these has NOT measured zero
        # of them, and the shop's card says "not reported" for null and a number for 0 --
        # collapsing them here would put a confident zero on the card for a question nobody
        # asked, which is the defect shape this repo keeps removing.
        "relocateFailures": None if relocate_failures is None else int(relocate_failures),
        "preexistingCrossed": (None if preexisting_crossed is None
                               else int(preexisting_crossed)),
        # Stitch counters. `arrivalsAfterStitch` is the de-duplicated SHADOW of
        # `arrivals` -- reported ALONGSIDE it, never instead of it. The refusal count
        # ships too, because a stitcher that never fires and one that merges everything
        # look identical if only successes are recorded, and they need opposite fixes.
        "arrivalsAfterStitch": (None if arrivals_after_stitch is None
                                else int(arrivals_after_stitch)),
        "stitchedTotal": None if stitched_total is None else int(stitched_total),
        "stitchRefusedAmbiguous": (None if stitch_refused_ambiguous is None
                                   else int(stitch_refused_ambiguous)),
        # Rolling windows (shop migration 0144). `lastInferenceAt` says the detector RAN;
        # these say what it SAW: vehicles the detector reported in the last ten minutes, and
        # arrival-portal crossings in the last hour. Frames fine, detector running, zero
        # detections for an hour inside business hours is a blind camera, and on 2026-10-05
        # (4 arrivals counted on a ~40-car day) nothing in the heartbeat could say so. Both
        # None-preserving: a loop that has never run the detector has not measured zero.
        "detectionsLast10m": None if detections_last_10m is None else int(detections_last_10m),
        "portalCrossingsLast60m": (None if portal_crossings_last_60m is None
                                   else int(portal_crossings_last_60m)),
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
        hard_cases: Any = None,
        trajectories: Any = None,
        shadow: Any = None,
        challenger: Any = None,
        relocate_seconds: float = 120.0,
        service_review_seconds: float = 30.0,
        clock=time.time,
    ) -> None:
        self.pipeline = pipeline
        self.vision = vision
        self.source = source
        #: Optional `HardCaseRecorder`. None means the producer runs exactly as it always
        #: has -- the corpus is an upgrade, never a dependency of watching the lot.
        self.hard_cases = hard_cases
        #: Optional `TrajectoryStore`. Where vehicles actually went, so the lot polygon can
        #: one day be measured instead of drawn by eye. Same contract as the recorder: an
        #: upgrade, never a dependency of watching the lot.
        self.trajectories = trajectories
        #: When the DETECTOR last ran, and how long its recent runs took. Motion-gated
        #: frames are deliberately excluded -- see `_note_inference`.
        #: Recently-dead tracks, for spotting a re-acquisition. Bounded: this is a
        #: few-seconds window, not a history.
        self._recent_deaths: Deque[Tuple[int, float, float, float, dict]] = deque(maxlen=64)
        self.last_inference_at: Optional[float] = None
        self._inference_ms: Deque[float] = deque(maxlen=200)
        #: (frame ts, detections the DETECTOR reported) for every inference, kept ten minutes.
        #: Gated frames are not appended -- see `_note_inference`.
        self._detection_counts: Deque[Tuple[float, int]] = deque()
        #: Frame timestamps at which the vision layer's `arrivals` counter advanced, kept an
        #: hour. Read as a delta so the loop never re-implements what counts as a crossing.
        self._crossing_times: Deque[float] = deque()
        self._arrivals_seen: Optional[int] = None
        #: How often to re-check that the located scene is still where it was. 0 disables.
        #: A startup fix is only true at startup: the operator resizes the window or goes
        #: fullscreen mid-shift and a boot-time binding then warps every frame through stale
        #: geometry while still claiming the old sceneId.
        self.relocate_seconds = relocate_seconds
        self.next_relocate = clock() + relocate_seconds if relocate_seconds > 0 else 0.0
        self.revalidations = 0
        self.relocations = 0
        #: Revalidation passes that produced NO binding -- distinct from a pass that
        #: confirmed an unchanged layout, which is the happy case many times an hour.
        self.relocate_failures = 0
        #: Optional `ShadowLedger`. None means no challenger is being observed, which is
        #: the system as it has always run.
        self.shadow = shadow
        #: Observed, never consulted. Kept out of `DetectorCouncil` on purpose --
        #: a model inside the council votes through `_fuse`, and a voting model's
        #: disagreements are not a counterfactual.
        self.challenger = challenger
        self._last_layout_epoch = None
        # Corpus sampler only. This number is NOT a service classifier threshold; it says
        # when an arrived, no-bay, stationary vehicle has become worth one review clip.
        self.service_review_seconds = max(0.0, float(service_review_seconds))
        self._service_review_armed: set[int] = set()
        self._service_review_attempted: Dict[int, float] = {}
        self.camera = camera
        # REJECT an unknown mode at construction. Uppercasing whatever arrives turns a
        # programming error into a value the shop rejects 400 -- and it did: a local named
        # `mode` in main()'s hard-case block clobbered the producer's own mode, EdgeLoop
        # cheerfully made it "BOTH", and the first heartbeat after every restart was thrown
        # away by the shop's enum while heartbeats 2 onward looked fine.
        #
        # Failing HERE is the whole point. A bad mode is a bug in this file, so it should
        # stop this file at startup where the traceback names the line, not travel across
        # the network to be diagnosed from a Zod error in a truncated log.
        if mode is not None and str(mode).upper() not in VALID_MODES:
            raise ValueError(
                f"mode={mode!r} is not one of {sorted(VALID_MODES)}. The shop's heartbeat "
                f"schema is an enum and would reject it 400; something has assigned a "
                f"non-mode value to this variable.")
        # UPPERCASE at assignment, exactly as `base_mode` does two lines below.
        # `--mode` takes lowercase choices ("production"), the shop's heartbeat schema is a
        # Zod enum of UPPERCASE ones, and `self.mode` was only uppercased later, inside the
        # loop. So every heartbeat sent before that line ran was rejected 400 -- the shop's
        # camera-health lattice heard nothing from a producer that was running perfectly.
        # Witnessed live on the first heartbeat of a real run, 2026-09-10.
        self.mode = (mode or "PRODUCTION").upper()
        #: What this producer is when NOT commissioning, passed in from the CALIBRATION
        #: rather than inferred from `mode`. Inferring it meant a runtime launched with
        #: `--commissioning-run` adopted COMMISSIONING as its own baseline and could never
        #: leave it, so the camera badge stayed lit after the run ended while rows were
        #: correctly tagged PRODUCTION again (Codex P2 on #2255).
        self.base_mode = (base_mode or ("SHADOW" if mode == "COMMISSIONING" else mode)).upper()
        if self.base_mode not in VALID_MODES:
            # `base_mode` is what `self.mode` FALLS BACK TO after every heartbeat, so an
            # invalid one poisons every send from the second onward -- the mirror image of
            # the bug above, and even quieter because the first heartbeat would look fine.
            raise ValueError(f"base_mode={self.base_mode!r} is not one of {sorted(VALID_MODES)}")
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
        # If authority-boundary invalidation fails, do not renew the server lease until
        # a later local retry succeeds. Otherwise this broken producer can block failover
        # forever by refreshing a lease it refuses to use.
        self.authority_recovery_blocked = False

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
            # FEED THE ROLLING WINDOW FIRST, before any gate can return early. A frame
            # dropped for a generation break or an untrusted pose is often the single most
            # interesting frame in the clip, and a buffer fed after the gates would be
            # missing exactly the moments the recorder exists to capture.
            self._observe_hard_case(frame)

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
                # The corpus wants this one: a lane failover or a window restore is where
                # tracks get degraded, and the clip around it is what shows whether the
                # break was handled correctly. Declared in `TRIGGERS_WIRED`, so it needs a
                # caller -- this is it.
                if self.hard_cases is not None:
                    try:
                        self.hard_cases.trigger("SOURCE_FAILOVER", frame.ts,
                                                {"from": prev_generation, "to": gen})
                    except Exception:  # noqa: BLE001
                        log.exception("hard-case trigger failed on a generation break")
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

            # The recorder got the pixels before vision gates. Now that this frame has
            # actually been reasoned over, attach the canonical track snapshot to that same
            # buffered frame before any trigger can arm a service-review clip.
            self._annotate_hard_case_vision(frame, out)
            self._note_hard_cases(frame, out)
            self._note_trajectory(frame, out)
            self._note_deaths(frame, out)
            self._note_inference(frame, out)
            self._note_crossings(frame)
            self._note_reacquisition(frame, out)
            self._note_preexisting_disagreement(frame, out)
            # SEPARATE CALL, and separate on purpose. Nesting this inside the hard-case
            # bookkeeping coupled two independent subsystems: with no recorder configured
            # the ledger silently recorded nothing, and nested one level deeper it fired
            # only on DISAGREEMENT -- so agreements never reached the denominator and the
            # rate a promotion gate reads would have been 1.0 forever. Both were caught by
            # the wiring test, not by review.
            self._note_shadow(out.get("council"), frame.ts, frame.image)

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
        if self.relocate_seconds > 0 and now >= self.next_relocate:
            self.next_relocate = now + self.relocate_seconds
            revalidate = getattr(self.source, "revalidate", None)
            if revalidate is not None:
                # COUNTED, not just acted on. A revalidator that silently never ran looks
                # exactly like a layout that never moved -- both produce no log line and no
                # epoch change -- and the first of those means the producer has been warping
                # through a boot-time binding all shift with nobody the wiser.
                self.revalidations += 1
                try:
                    result = revalidate()
                    quality = _locate_quality(getattr(result, "located", None))
                    failure = getattr(result, "failure", None)
                    if failure:
                        # A PASS THAT FOUND NOTHING IS NOT A STABLE LAYOUT. Both used to
                        # return False and print a line, so a locator failing every pass for
                        # an hour was indistinguishable from a window nobody had touched --
                        # while the producer went on warping every frame through a binding
                        # it had stopped being able to confirm. `edge_relocate_errors_total`
                        # does not cover it: a clean SceneNotLocated is not an exception.
                        self.relocate_failures += 1
                        self.pipeline.metrics.inc("edge_relocate_unconfirmed_total")
                        if not getattr(self, "_relocate_failure_logged", False):
                            self._relocate_failure_logged = True
                            log.warning(
                                "scene revalidation is not confirming the binding (%s); the "
                                "producer keeps warping through the existing geometry", failure)
                    elif quality is not None:
                        self._note_locate_quality(now, quality)
                    if result:

                        # The epoch is part of `source_generation`, so the NEXT frame takes
                        # the existing generation-break path: tracks degraded, census
                        # re-armed, no path spanning the change. Nothing extra to keep in
                        # step, which is the point of folding it into that identity.
                        self.relocations += 1
                        self.pipeline.metrics.inc("edge_scene_relocations_total")
                        log.warning("scene re-located; the layout epoch advanced and the "
                                    "next frame will break the track generation")
                        if self.hard_cases is not None:
                            # WITH THE FIGURES. A clip that records "geometry was
                            # re-bound" and not how good the new match was cannot answer the
                            # only question worth asking about it later.
                            self.hard_cases.trigger(
                                "LAYOUT_CHANGE", now,
                                {"source": "revalidation", "locate": quality})
                except Exception:
                    self.pipeline.metrics.inc("edge_relocate_errors_total")
                    log.exception("scene revalidation failed; the existing binding stands")

        if now >= self.next_drain:
            self.next_drain = now + self.drain_seconds
            try:
                self.pipeline.drain_shop()
            except Exception:
                self.pipeline.metrics.inc("edge_drain_errors_total")
                log.exception("shop drain error")
            # Ledger retention (terminal visits past retentionDays, dead letters past 7 d).
            # visitd's LiveLoop has called this every pass since the ledger existed; this
            # loop never did, so the edge ledger on NicksMax only ever grew (audit
            # 2026-10-07, B3). `housekeeping` throttles itself to once an hour, so riding the
            # drain tick costs one float compare. Both clocks are wall time here: the edge's
            # frame times ARE the clock, unlike a replayed MQTT epoch.
            housekeeping = getattr(self.pipeline, "housekeeping", None)
            if housekeeping is not None:
                try:
                    housekeeping(now, now)
                except Exception:
                    self.pipeline.metrics.inc("edge_housekeeping_errors_total")
                    log.exception("ledger housekeeping error")

    def send_heartbeat(self, now: Optional[float] = None) -> bool:
        """Compose and post one heartbeat. False when no shop is configured."""
        if not self.pipeline.shop.enabled:
            return False
        heartbeat_now = self.clock() if now is None else now
        if self.authority_recovery_blocked:
            try:
                self.vision.reset_authority_epoch(heartbeat_now)
                self.pipeline.ledger.discard_camera_state(self.camera)
                self.authority_recovery_blocked = False
                log.warning("authority-boundary reset recovered locally; heartbeat renewal may resume")
            except Exception:
                self.pipeline.metrics.inc("edge_authority_promotion_errors_total")
                log.exception("authority-boundary reset still failing; NOT renewing server lease")
                return False
        authority_before = self.pipeline.shop.is_authoritative(self.camera)
        self.heartbeat_seq += 1
        # Empty dict, not None: a vision layer without a stitcher then reports NOTHING for
        # each counter (`.get` -> None) rather than a fabricated 0, which is the same
        # discipline the `relocate_failures` / `preexisting_crossed` getattrs below use.
        stitch_counts = getattr(getattr(self.vision, "stitch", None), "counters", {}) or {}
        body = edge_heartbeat_body(
            camera=self.camera,
            seq=self.heartbeat_seq,
            now=heartbeat_now,
            mode=self.mode,
            source=self.source,
            vision=self.vision,
            ledger=self.pipeline.ledger,
            health_state=self.last_health,
            scene_state=self.last_scene,
            calibration_version=self.calibration_version,
            last_inference_at=self.last_inference_at,
            inference_p95_ms=self.inference_p95_ms,
            last_frame_at=self.last_frame_at,
            last_cloud_ack_at=getattr(self.pipeline.shop, "last_ack_at", None),
            detector_name=self.detector_name,
            model_sha256=self.model_sha256,
            last_healthy_frame_at=self.last_healthy_frame_at,
            # ONLY what the mirror is currently tagging rows with. Falling back to the
            # launch flag would keep re-reporting a run the producer had already left, so
            # the admin would never see commissioning end -- and this field exists
            # precisely to prove what the edge acknowledged.
            commissioning_run_id=self.pipeline.shop.commissioning_run_id,
            # `getattr` with a None default, deliberately: a vision layer or loop that does
            # not carry the counter reports NOTHING rather than a fabricated 0.
            relocate_failures=getattr(self, "relocate_failures", None),
            preexisting_crossed=getattr(
                getattr(self.vision, "stats", None), "preexisting_crossed", None),
            arrivals_after_stitch=getattr(
                getattr(self.vision, "stats", None), "arrivals_after_stitch", None),
            stitched_total=stitch_counts.get("stitched"),
            stitch_refused_ambiguous=stitch_counts.get("refused_ambiguous"),
            detections_last_10m=self.detections_last_10m,
            portal_crossings_last_60m=self.portal_crossings_last_60m,
        )
        ok = self.pipeline.shop.heartbeat(body)
        authority_after = self.pipeline.shop.is_authoritative(self.camera)
        if not authority_before and authority_after:
            # Promotion is a hard evidence boundary. Standby-era tracks and open visits
            # cannot be allowed to become authoritative later with their original times.
            try:
                reset = self.vision.reset_authority_epoch(heartbeat_now)
                durable = self.pipeline.ledger.discard_camera_state(self.camera)
                self.pipeline.metrics.inc("edge_authority_promotions_total")
                log.warning(
                    "producer promoted to shop authority: discarded standby state "
                    "tracks=%s visits=%s durable=%s", reset.get("tracks"), reset.get("visits"), durable,
                )
            except Exception:
                # The server has already granted a lease. Revoke it LOCALLY and block
                # future heartbeat renewal until the reset succeeds, so a lower-priority
                # producer can take over once this lease expires.
                self.pipeline.shop.revoke_authority(self.camera)
                self.authority_recovery_blocked = True
                self.pipeline.metrics.inc("edge_authority_promotion_errors_total")
                log.exception("authority promotion reset FAILED; lease will NOT be renewed")
                ok = False
        # The reply may have switched the mode either way; keep the loop's view in step so
        # the NEXT heartbeat reports it without waiting another round trip. Returning to
        # `base_mode` is what lets the camera card's badge clear when a run ends.
        self.mode = "COMMISSIONING" if self.pipeline.shop.commissioning_run_id else self.base_mode
        return ok

    def _note_reacquisition(self, frame, out) -> None:
        """Flag the moment a track died and another was born in the same place.

        WHY THIS IS THE EXPENSIVE ONE. When the tracker loses a car and re-acquires it as a
        new id, the visit layer can open a SECOND visit for the same vehicle -- so the shop's
        arrival count, the one number anyone actually reads, goes up by one for a car that
        never left. It is silent by construction: both visits look perfectly well-formed.

        Geometry and time only, deliberately. `TRACK_REACQUIRED` fires on a birth close in
        space and time to a death; `TRACK_SPLIT` on a birth that lands on top of a track that
        is still ALIVE, which is one vehicle becoming two. Appearance would sharpen both, and
        `AppearanceBank` is written and tested for exactly this -- but no re-id model is
        fetchable at the path this repo pins (`vehicle-reid-0001` is not at the OMZ 2023.0
        URL; that host answers a missing path with a directory listing at HTTP 200). Wiring
        the embedder today would add a branch that never executes on the only box that
        matters. The context carries `appearance: null` so the field EXISTS and is honestly
        empty, and the day a model lands it is one call, not a redesign.

        This RECORDS. It does not merge, split or renumber anything -- an appearance model
        that decides identity will happily merge two customers' cars of the same colour, and
        the tracker's own doc says so. What it produces is a labelled clip of a moment the
        system probably got wrong, which is what the corpus is for.
        """
        if self.hard_cases is None:
            return
        try:
            born = list(out.get("born") or [])
            died = list(out.get("died") or [])
            now = frame.ts
            for t in died:
                gx, gy = t.ground_point
                self._recent_deaths.append(
                    (int(t.track_id), float(gx), float(gy), now, _track_vitals(t, now)))
            if not born:
                return
            live = {int(k): v for k, v in getattr(self.vision, "tracks", None).tracks.items()}                 if getattr(self.vision, "tracks", None) is not None else {}
            for t in born:
                bx, by = t.ground_point
                bid = int(t.track_id)
                for did, dx, dy, dts, vitals in reversed(self._recent_deaths):
                    gap = now - dts
                    if gap > REACQUIRE_SECONDS:
                        break               # the deque is in time order; older are worse
                    dist = ((bx - dx) ** 2 + (by - dy) ** 2) ** 0.5
                    if dist <= REACQUIRE_PX:
                        self.hard_cases.trigger("TRACK_REACQUIRED", now, {
                            "diedTrack": did, "bornTrack": bid,
                            "gapSeconds": round(gap, 2), "distancePx": round(dist, 1),
                            # The dying track's own vitals, because the geometry alone cannot
                            # say WHY it died. `max_misses` is 12 at 4 fps, so a moving track
                            # must go 3 SECONDS undetected to be pruned -- these are sustained
                            # detection failures, never one-frame blips. And `parked_after` is
                            # 25s, so a vehicle that has just stopped is protected only after
                            # 25 seconds of stillness while 3 seconds of dropout can kill it:
                            # `stationarySeconds` on the dead track is what distinguishes a
                            # car lost in that window from one lost while genuinely moving.
                            "died": vitals, "born": _track_vitals(t, now),
                            "appearance": None,
                        })
                        # FLAG THE LEDGER ROW. `_note_deaths` wrote this death a moment ago
                        # with `reacquired = 0`; without this the ledger holds a correct
                        # denominator and no numerator, which is the same table this whole
                        # change exists to stop being. Best-effort by construction: it fails
                        # to match when the ledger was enabled mid-run and the death predates
                        # the table, and that is a real 0 rather than an error.
                        if self.trajectories is not None:
                            try:
                                self.trajectories.mark_reacquired(
                                    self._scene_id(frame), did, dts)
                            except Exception:  # noqa: BLE001
                                self.pipeline.metrics.inc("edge_track_death_errors_total")
                        break
                else:
                    # No death explains it. Did it appear ON TOP of a car already tracked?
                    for other_id, other in live.items():
                        if other_id == bid:
                            continue
                        ox, oy = other.ground_point
                        if ((bx - ox) ** 2 + (by - oy) ** 2) ** 0.5 <= SPLIT_PX:
                            self.hard_cases.trigger("TRACK_SPLIT", now, {
                                "bornTrack": bid, "overlapsTrack": other_id,
                                "born": _track_vitals(t, now),
                                "overlaps": _track_vitals(other, now),
                                "distancePx": round(((bx - ox) ** 2 + (by - oy) ** 2) ** 0.5, 1),
                                "appearance": None,
                            })
                            break
        except Exception:  # noqa: BLE001 - corpus bookkeeping never costs a frame
            self.pipeline.metrics.inc("edge_reacquire_note_errors_total")

    def _note_inference(self, frame, out) -> None:
        """Record that the DETECTOR ran, and how long it took.

        The motion gate is excluded on purpose. A gated frame is a decision NOT to infer,
        so counting it would make a producer whose detector has died look perfectly healthy
        for as long as the lot stayed still -- which is most of the day. `mog2` is the gate,
        named the same way `_note_shadow` excludes it from being mistaken for a challenger.

        The converse is the cost, and it is the right trade: on a genuinely quiet lot these
        two fields go stale, so a reader must not treat staleness ALONE as a fault. What
        they buy is the distinction that did not exist before, when a dead detector and an
        empty lot were both simply silence.
        """
        council = out.get("council")
        if council is None:
            return
        try:
            by = dict(getattr(council, "by_detector", {}) or {})
            if not any(name != "mog2" for name in by):
                return                      # the gate ran and nothing else did
            self.last_inference_at = frame.ts
            latency = getattr(council, "latency_ms", None)
            if latency:
                self._inference_ms.append(float(latency))
            # What the detector SAW on this inference. Zero is a real measurement here: the
            # detector ran over the frame and reported no vehicle.
            self._detection_counts.append((float(frame.ts), len(getattr(council, "detections", None) or [])))
            self._prune_windows(float(frame.ts))
        except Exception:  # noqa: BLE001 - health bookkeeping never costs a frame
            self.pipeline.metrics.inc("edge_inference_note_errors_total")

    DETECTIONS_WINDOW_SECONDS = 600.0
    CROSSINGS_WINDOW_SECONDS = 3600.0

    def _prune_windows(self, now: float) -> None:
        while self._detection_counts and self._detection_counts[0][0] < now - self.DETECTIONS_WINDOW_SECONDS:
            self._detection_counts.popleft()
        while self._crossing_times and self._crossing_times[0] < now - self.CROSSINGS_WINDOW_SECONDS:
            self._crossing_times.popleft()

    def _note_crossings(self, frame) -> None:
        """Stamp every advance of the vision layer's `arrivals` counter with the frame time."""
        try:
            stats = getattr(self.vision, "stats", None)
            arrivals = getattr(stats, "arrivals", None) if stats is not None else None
            if arrivals is None:
                return
            arrivals = int(arrivals)
            if self._arrivals_seen is None:
                self._arrivals_seen = arrivals          # a restart is not a burst of crossings
                return
            for _ in range(max(0, arrivals - self._arrivals_seen)):
                self._crossing_times.append(float(frame.ts))
            self._arrivals_seen = arrivals
            self._prune_windows(float(frame.ts))
        except Exception:  # noqa: BLE001 - health bookkeeping never costs a frame
            self.pipeline.metrics.inc("edge_inference_note_errors_total")

    @property
    def detections_last_10m(self) -> Optional[int]:
        """Vehicles the detector reported in the last ten minutes of frames; None until it has run.

        None, never 0, before the first inference: a loop that has not inferred has not looked.
        After that a 0 is the honest reading of an empty lot -- or of a blind camera, which is
        exactly the distinction the shop's plausibility canary draws from frames + this.
        """
        if self.last_inference_at is None:
            return None
        self._prune_windows(float(self.last_frame_at if self.last_frame_at is not None else self.last_inference_at))
        return int(sum(count for _ts, count in self._detection_counts))

    @property
    def portal_crossings_last_60m(self) -> Optional[int]:
        """Arrival-portal crossings in the last hour of frames; None when the vision layer keeps no stats."""
        if self._arrivals_seen is None:
            return None
        if self.last_frame_at is not None:
            self._prune_windows(float(self.last_frame_at))
        return len(self._crossing_times)

    @property
    def inference_p95_ms(self) -> Optional[float]:
        """p95 of recent detector latencies, or None when it has not run.

        None, never 0.0. A zero renders on the admin card as an impossibly fast detector;
        the absence has to stay an absence, because "we have not measured this" and "this
        took no time" are different claims and only one of them is ever true.

        NEAREST RANK, from `vision.stats.p95`, which is the convention
        `benchmark_openvino.py` already used. This computed `int(len * 0.95)` and picked a
        different sample on any run of twenty -- so the latency the shop displayed and the
        latency the benchmark printed could disagree about the same measurements, with
        nothing anywhere saying which one "p95" meant (Codex P2 on #2275).
        """
        from vision.stats import p95

        return p95(self._inference_ms)

    def _scene_id(self, frame) -> str:
        """Which pixel space this frame is of. ONE definition, three callers.

        The trajectory store, the death ledger and the re-acquisition flag all key on this,
        and they must agree exactly: a writer and a reader that each spell the fallback
        chain out inline are one edit away from disagreeing silently, and the symptom would
        be a ledger reporting a 0% re-acquisition rate -- which reads as a finding rather
        than as a wiring fault. (I wrote that exact mismatch while adding the flag: the
        write used the full chain and the lookup used two thirds of it.)

        The FRAME'S OWN `sceneId` is authoritative. `WgcWindowSource.set_canonical` stamps
        it into every frame's meta; `source.binding` is the fallback for sources that do
        not, and it does not exist on the WGC source -- reading it first filed every point
        under "default" for four hours of real traffic.
        """
        return str((frame.meta or {}).get("sceneId")
                   or getattr(getattr(self.source, "binding", None), "scene_id", None)
                   or "unattributed")

    def _note_locate_quality(self, now: float, quality: Dict[str, Any]) -> None:
        """Keep a clip of an accepted scene match that came close to being refused.

        The binding decides which pixels every polygon is evaluated against, and re-binding
        to the wrong scene is unrecoverable. A match that passed while sitting just above a
        refusal floor is the one whose margin is being eaten by something, and a clip is what
        makes that trend visible before the pass that refuses outright.

        See `_locate_is_thin` for what this deliberately does NOT catch: the confidently
        wrong match, which scored 158 inliers against a floor of 18.
        """
        if self.hard_cases is None:
            return
        try:
            why = _locate_is_thin(quality)
            if why is None:
                return
            self.hard_cases.trigger("SCENE_LOCATOR_LOW_CONFIDENCE", now,
                                    {"why": why, "locate": quality})
        except Exception:  # noqa: BLE001 - corpus bookkeeping never costs a frame
            self.pipeline.metrics.inc("edge_locate_quality_errors_total")

    def _note_preexisting_disagreement(self, frame, out) -> None:
        """Record a car the census called already-there and the portal watched drive in.

        THE UNDER-COUNT NOBODY WAS WATCHING FOR. Every other guard in this package exists to
        stop the shop's arrival count going UP for a car that never arrived. This is the same
        error with the sign flipped: a vehicle that genuinely drove in during a startup or
        reconnect blind window is classed `preexisting`, is never tested against the portal,
        and its arrival is lost silently and permanently.

        Both readings are defensible for any single clip -- a car parked at boot really does
        look like a car that just arrived, from pixels alone -- which is exactly why the
        answer is a labelled clip for a human rather than a threshold. The pipeline records
        the disagreement; it does NOT promote the track, because handing the boot census
        portal authority would recreate the false-arrival class this whole package exists to
        prevent.
        """
        if self.hard_cases is None:
            return
        crossed = out.get("preexistingCrossed") or []
        if not crossed:
            return
        try:
            for t in crossed:
                self.hard_cases.trigger("PREEXISTING_DISAGREEMENT", frame.ts, {
                    "trackId": int(t.track_id),
                    "entryReason": str(getattr(t, "entry_reason", "")),
                    "evidence": str(getattr(t, "evidence", "")),
                    "vitals": _track_vitals(t, frame.ts),
                    # Said in the payload, not just in a docstring: whoever reads this clip
                    # in six months must not have to work out whether it changed the count.
                    "promoted": False,
                })
        except Exception:  # noqa: BLE001 - corpus bookkeeping never costs a frame
            self.pipeline.metrics.inc("edge_preexisting_note_errors_total")

    def _note_deaths(self, frame, out) -> None:
        """Record EVERY track the tracker just retired, and why it was allowed to die.

        THE ASYMMETRY THIS EXISTS TO FIX. `TRACK_REACQUIRED` records the deaths that were
        followed by a nearby birth -- a numerator. Nothing recorded the rest, so the question
        the corpus is for ("of the tracks that die, which ones do we lose and get back?")
        had no denominator, and the only remaining route to one was inference over
        `track_points`. That route does not work: `_note_trajectory` skips every suppressed
        frame, so the point table has recording gaps over a minute long and cannot be split
        into track lifetimes by time alone. Two attempts at it produced two confident,
        mutually inconsistent answers, which is the correct amount of trust to place in
        either.

        NOT gated on `out["suppressed"]`, unlike `_note_trajectory`. Every suppression
        branch in `VisionPipeline.step()` returns before `tracks.update()` runs, so `died`
        is empty on a suppressed frame and the gate would be a no-op today -- but writing
        that invariant into an `if` here turns a future refactor that moves one branch below
        the tracker into a silent blind spot in the one table that would have shown it.

        A death is also not a SAMPLE, so unlike a trajectory point it is never downsampled:
        measured at ~2.7 a minute against 4 points a second per track.
        """
        if self.trajectories is None:
            return
        dead = out.get("died") or []
        if not dead:
            return
        try:
            # Same attribution as `_note_trajectory`, and for the same reason: the frame's
            # own `sceneId` is the only authoritative one, and pooling two lenses into a
            # single bucket produces a confident answer from data that merely looks abundant.
            scene = self._scene_id(frame)
            self.trajectories.note_deaths(
                frame.ts, dead, scene=str(scene),
                generation=str(source_generation(self.source)))
        except Exception as exc:  # noqa: BLE001 - a ledger is never worth a producer
            self.pipeline.metrics.inc("edge_track_death_errors_total")
            if not getattr(self, "_deaths_logged", False):
                self._deaths_logged = True
                log.warning("the track-death ledger is failing and will stay off: %s: %s",
                            type(exc).__name__, exc)

    def _note_trajectory(self, frame, out) -> None:
        """Record where every live track is standing, for later commissioning.

        Deliberately NOT recorded on a SUPPRESSED frame. A frame the pipeline refused for
        pose or motion reasons is exactly a frame whose geometry is untrusted, and a point
        taken from one would poison the very map it feeds -- the commissioner cannot tell a
        bad point from a good one once it is a row in a table.
        """
        if self.trajectories is None or out.get("suppressed"):
            return
        try:
            # THE FRAME'S OWN sceneId. `WgcWindowSource.set_canonical` stamps it into every
            # frame's meta, which is the only place it is authoritative -- `source.binding`
            # does not exist, so this read `None` and filed EVERY point under "default".
            # Measured after four hours of real traffic: 7,228 points, 69 tracks, one bucket.
            #
            # Pooling is not a cosmetic loss. A two-lens device is two different pixel
            # spaces, and a commissioner fitting one polygon across both would produce a
            # confident, meaningless answer from data that looks abundant.
            scene = self._scene_id(frame)
            # `self.vision`, NOT `self.pipeline`. The visitd pipeline carries metrics, the
            # shop lane and the visit tracker; the TRACK GRAPH lives on the vision layer.
            # Reading it off the wrong object raised on every single frame -- 128 of them
            # before anyone looked -- and the producer carried on perfectly, because this
            # is the one subsystem that must never take the lot down.
            self.trajectories.observe(
                frame.ts, list(self.vision.tracks.tracks.values()),
                scene=str(scene), generation=str(source_generation(self.source)))
        except Exception as exc:  # noqa: BLE001 - commissioning data is never worth a producer
            self.pipeline.metrics.inc("edge_trajectory_errors_total")
            # LOG IT, once. The counter alone said 128 somethings had gone wrong and named
            # none of them; finding out which line meant reproducing the call by hand.
            # A swallowed exception that is counted but never described is only half a
            # decision -- the half that protects the producer, not the half that is
            # actionable. `_trajectory_logged` keeps a per-frame failure out of the log.
            if not getattr(self, "_trajectory_logged", False):
                self._trajectory_logged = True
                log.warning("trajectory recording is failing and will stay off: %s: %s",
                            type(exc).__name__, exc)


    def _observe_hard_case(self, frame) -> None:
        """Push a frame into the recorder's window. Never raises: this is not the lot's job."""
        if self.hard_cases is None:
            return
        try:
            self.hard_cases.observe(frame.ts, frame.image, frame.meta)
        except Exception:  # noqa: BLE001
            log.exception("hard-case observe failed; the corpus loses a frame, not the lot")

    def _annotate_hard_case_vision(self, frame, out: Dict[str, object]) -> None:
        """Join post-vision canonical track facts to the pre-vision buffered pixels.

        A suppressed frame is deliberately left without a snapshot: the tracker did not
        observe the lot on that frame, so copying its previous box forward would turn
        absence of observation into evidence.
        """
        if self.hard_cases is None or out.get("suppressed") is not None:
            return
        try:
            tracks = getattr(getattr(self.vision, "tracks", None), "tracks", {}) or {}
            snapshots = {}
            for track in tracks.values():
                track_id = int(getattr(track, "track_id", -1))
                if track_id < 0:
                    continue
                snapshots[str(track_id)] = {
                    "trackId": track_id,
                    "box": [round(float(v), 3) for v in getattr(track, "box", ())],
                    "zones": list(getattr(track, "zones", None) or []),
                    "evidence": str(getattr(track, "evidence", "unknown")),
                    "misses": int(getattr(track, "misses", 0) or 0),
                    "stationarySeconds": round(float(track.stationary_for(frame.ts)), 3),
                }
            if not self.hard_cases.annotate(frame.ts, {"visionTracks": snapshots}):
                self.pipeline.metrics.inc("edge_hard_case_annotation_miss_total")
        except Exception:  # noqa: BLE001 - corpus metadata must never take the lot down
            self.pipeline.metrics.inc("edge_hard_case_annotation_errors_total")
            log.exception("hard-case vision annotation failed; frame kept without track provenance")

    def _note_hard_cases(self, frame, out: Dict[str, object]) -> None:
        """Arm a clip for anything the system just told us it was unsure about.

        ONLY signals that genuinely exist here are wired. A trigger with no real producer is
        a class of hard case the corpus will never contain, and read back later an absent
        class looks like a shop that never had one rather than like nothing that was ever
        watching -- so `TRIGGERS_WIRED` names exactly these and nothing more.
        """
        if self.hard_cases is None:
            return
        try:
            ts = frame.ts

            # LAYOUT CHANGE. `WgcWindowSource.set_canonical` stamps the epoch into the frame,
            # so this is a real signal the moment a scene is relocated -- and a layout change
            # is the boundary at which geometry stops being comparable.
            epoch = (frame.meta or {}).get("layoutEpoch")
            changed = (epoch is not None and self._last_layout_epoch is not None
                       and epoch != self._last_layout_epoch)
            if changed:
                self.hard_cases.trigger("LAYOUT_CHANGE", ts, {
                    "from": self._last_layout_epoch, "to": epoch,
                    "sceneId": (frame.meta or {}).get("sceneId")})
            if epoch is not None:
                self._last_layout_epoch = epoch

            # POSE OFF HOME. The scene gate already decides this; the clip is the evidence
            # an operator needs to tell a real bump from a passing truck filling the frame.
            #
            # RECORD WHICH CONDITION FIRED. `may_create_visits` is `(not moving) and
            # pose_ok`, so it goes false for TWO unrelated reasons -- the camera is panning
            # right now, or the view no longer matches its reference -- and this used to
            # record only `changeFrac`, the input to the SECOND one. Measured over 32 clips
            # from a real shift: 14 of them carried changeFrac <= 0.005, which is
            # essentially no change at all. Read back, those say "the pose gate suppressed
            # frames while the pose was perfect", which is not what happened and points any
            # investigation at the wrong half of the condition.
            #
            # The name stays POSE_OFF_HOME because it is the vocabulary the corpus already
            # uses and renaming a trigger orphans every clip recorded under the old one;
            # `cause` is what a reader should believe.
            scene = out.get("scene")
            if scene is not None and not getattr(scene, "may_create_visits", True):
                moving = bool(getattr(scene, "moving", False))
                pose_ok = bool(getattr(scene, "pose_ok", True))
                self.hard_cases.trigger("POSE_OFF_HOME", ts, {
                    # "moving" and "pose" are the two halves; "both" is a real third case and
                    # collapsing it into either one would hide a panning camera whose view
                    # has ALSO drifted, which is the worst of the three.
                    "cause": ("both" if moving and not pose_ok
                              else "moving" if moving
                              else "pose" if not pose_ok
                              else "neither"),
                    "moving": moving,
                    "poseOk": pose_ok,
                    "changeFrac": round(float(getattr(scene, "change_frac", 0.0)), 3),
                    "poseDelta": _round_or_none(getattr(scene, "pose_delta", None)),
                    "inlierRatio": _round_or_none(getattr(scene, "inlier_ratio", None)),
                    "referenceSet": bool(getattr(scene, "reference_set", False)),
                })

            council = out.get("council")
            if council is not None:
                by = dict(getattr(council, "by_detector", {}) or {})
                # DETECTOR DISAGREEMENT. Escalation alone is not disagreement -- the council
                # escalates on ambiguity and the adjudicator often simply confirms. What is
                # worth a label is the two models returning DIFFERENT counts, which is the
                # case a human can actually adjudicate from a clip.
                if getattr(council, "escalated", False) and len(by) >= 2:
                    counts = sorted(by.values())
                    if counts[0] != counts[-1]:
                        self.hard_cases.trigger("DETECTOR_DISAGREEMENT", ts, {"byDetector": by})

                # PORTAL LOW CONFIDENCE. An emission on this frame means the lot's state
                # changed; a weak best detection behind that change is the expensive kind of
                # uncertainty, because it is the frame that creates or denies a visit.
                if out.get("emissions"):
                    scores = [float(getattr(d, "score", 0.0))
                              for d in (getattr(council, "detections", None) or [])]
                    if scores and max(scores) < 0.60:
                        self.hard_cases.trigger("PORTAL_LOW_CONFIDENCE", ts, {
                            "bestScore": round(max(scores), 3), "detections": len(scores)})

            # NO-BAY ACTIVITY REVIEW. This is deliberately a DATASET trigger, not a service
            # classification. Nick's legitimately changes tires/plugs outside on jacks, but
            # customers also wait or park in the same geometry. The only honest claim the
            # deterministic edge can make is: an ARRIVED vehicle stayed still outside every
            # calibrated bay long enough to be worth one labelled clip.
            #
            # One successful clip per live track. If the recorder's global per-reason
            # cooldown suppresses a concurrent car, retry no faster than that cooldown
            # instead of hammering trigger() four times a second and turning the drop counter
            # into frames rather than opportunities.
            tracks = getattr(getattr(self.vision, "tracks", None), "tracks", {}) or {}
            live_ids = {int(tid) for tid in tracks}
            self._service_review_armed.intersection_update(live_ids)
            for old in list(self._service_review_attempted):
                if old not in live_ids:
                    self._service_review_attempted.pop(old, None)

            bay_names = set(getattr(getattr(self.vision, "bays", None), "bays", {}) or {})
            if self.service_review_seconds > 0:
                for track in tracks.values():
                    track_id = int(getattr(track, "track_id", -1))
                    if track_id < 0 or track_id in self._service_review_armed:
                        continue
                    if getattr(track, "evidence", None) != "arrival":
                        continue
                    if int(getattr(track, "misses", 0) or 0) != 0:
                        continue
                    zones = set(getattr(track, "zones", None) or [])
                    if zones & bay_names:
                        continue
                    stationary = float(track.stationary_for(ts))
                    if stationary < self.service_review_seconds:
                        continue
                    last_attempt = self._service_review_attempted.get(track_id)
                    retry_after = float(getattr(self.hard_cases, "cooldown_seconds", 60.0))
                    if last_attempt is not None and ts - last_attempt < retry_after:
                        continue
                    self._service_review_attempted[track_id] = ts
                    if self.hard_cases.trigger("NO_BAY_ACTIVITY_REVIEW", ts, {
                        "trackId": track_id,
                        # Snapshot the canonical track box AT THE REVIEW TRIGGER. The
                        # offline service sidecar needs an anchor for "near this vehicle";
                        # without it, a jack beside another car can support the wrong one.
                        "vehicleBox": [round(float(v), 3) for v in track.box],
                        "stationarySeconds": round(stationary, 3),
                        "zones": sorted(zones),
                        "bayNames": sorted(bay_names),
                        "camera": self.camera,
                        "evidence": "arrival",
                        "meaning": "review ambiguity only; NOT proof of outside service",
                    }):
                        self._service_review_armed.add(track_id)

            for path in self.hard_cases.flush_ready(ts):
                log.info("hard case saved %s", path)
        except Exception:  # noqa: BLE001 - the corpus must never take the lot down
            # ONCE. This runs on every frame, so an exception that persists -- a recorder
            # whose `observe` signature no longer matches, say -- writes four stack traces a
            # second, and a log nobody can read is a log nobody reads. Counted every time so
            # the frequency is still visible; described the first time so it is actionable.
            self.pipeline.metrics.inc("edge_hard_case_errors_total")
            if not getattr(self, "_hard_case_logged", False):
                self._hard_case_logged = True
                log.exception("hard-case bookkeeping failed and will stay off")

    def _note_shadow(self, council: Any, ts: float, image: Any = None) -> None:
        """Record what the adjudicator ALONE would have counted, beside the primary.

        A real counterfactual with a real source: both numbers already exist on an escalated
        frame, and the question a promotion gate asks later -- "how often does the stronger
        model see a different number of vehicles than the cheap one, and on which frames?" --
        cannot be answered from an aggregate score.

        The adjudicator never gets a vote here. `_fuse` already decided what the council
        returns; this only writes down what the alternative would have been.
        """
        if self.shadow is None or council is None:
            return
        if not getattr(council, "escalated", False):
            # No escalation means no second opinion was computed. Writing the primary
            # against itself would fill the ledger with rows that agree by construction and
            # drag the disagreement rate toward zero for reasons having nothing to do with
            # the challenger.
            return
        if self.challenger is None or image is None:
            return
        try:
            by = dict(getattr(council, "by_detector", {}) or {})
            primary = next((n for n in by if n != "mog2"), None)
            if primary is None:
                return
            # THE CHALLENGER RUNS HERE, out of band, on the same frame the council just
            # judged. Its boxes go into the ledger and nowhere else -- they never reach
            # `_fuse`, the tracker or a visit.
            challenger_boxes = self.challenger.detect(image)
            self.shadow.note("VEHICLE_COUNT", by[primary], len(challenger_boxes), at=ts,
                             context={"champion": primary,
                                      "challenger": getattr(self.challenger, "name", "?"),
                                      "camera": self.camera, "mode": self.mode})
        except Exception:  # noqa: BLE001 - a research artefact never outranks the lot
            log.exception("shadow ledger note failed")

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
        if self.hard_cases is not None:
            # A producer that stops right after something confusing happened is describing a
            # moment especially worth keeping. Dropping armed clips on the way out loses
            # exactly the wrong ones.
            try:
                for path in self.hard_cases.flush_all(self.clock()):
                    log.info("hard case saved on shutdown %s", path)
            except Exception:
                log.exception("final hard-case flush failed")
            # REPORT THE CORPUS AT THE ONE MOMENT SOMEONE LOOKS. An empty directory is a
            # legitimate outcome -- a quiet shift genuinely produces no hard cases -- and it
            # is indistinguishable on disk from a recorder whose every write failed. The
            # heartbeat carries this for the shop; this line carries it for whoever is
            # reading the producer's own log after a run.
            try:
                stats = self.hard_cases.stats
                log.info("hard-case corpus %s healthy=%s", stats.describe(), stats.healthy)
            except Exception:
                log.exception("hard-case stats unreadable")
        if self.shadow is not None:
            try:
                st = self.shadow.stats
                log.info("shadow ledger %s healthy=%s", st.describe(), st.healthy)
            except Exception:
                log.exception("shadow stats unreadable")
        if self.relocate_seconds > 0:
            # THE THIRD NUMBER IS THE POINT. Ran-vs-moved was already two facts, and the
            # missing one is the fault: a pass that could not confirm the binding at all.
            # Without it, "ran 24, moved 0" reads as a stable shift whether the locator
            # confirmed the scene 24 times or failed to find it 24 times.
            #
            # This log line is currently the ONLY reader of `relocate_failures`. The
            # heartbeat cannot carry it without a new column in `HEARTBEAT_COLUMNS`
            # (`cameraVisitsRoutes.ts`), which needs a hand-applied TiDB migration and is
            # operator-gated -- so it is named here as a known gap rather than left as a
            # counter nobody reads. `edge_relocate_unconfirmed_total` is on the metrics
            # registry in the meantime.
            log.info("scene revalidation ran %d time(s); the layout moved %d time(s); "
                     "%d pass(es) could not confirm the binding",
                     self.revalidations, self.relocations, self.relocate_failures)


# ---------------------------------------------------------------------------- wiring
def camera_ledger_path(path: str, camera: str) -> str:
    """Give each camera process its OWN ledger file. `:memory:` is returned unchanged.

    WHY THIS IS NOT OPTIONAL. `ledger_path` is a property of the CONFIG, not of a camera,
    because visitd proper runs every camera in ONE process off one Frigate feed. The edge
    inverts that: one process per camera, each with its own capture and its own
    `VisitTracker`. Point two of them at one SQLite file and they do not merely interleave
    -- `Pipeline.__init__` restores EVERY open visit in the ledger, and `after_step`
    serialises that whole tracker back out, so each process periodically overwrites the
    other camera's fresh state with its own stale copy of it, and its timers age and close
    the other camera's sightings (Codex P1 on #2255, round 8).

    Round 6b scoped the restart force-end to one camera, which was necessary and nowhere
    near sufficient: it fixed one caller while the general last-writer-wins overwrite went
    on every commit. Separate files remove the shared state instead of guarding each use
    of it, which is the only version of this that stays fixed.

    The derivation is applied to whatever path is in play -- config or `--ledger` -- so
    isolation cannot be lost by passing the path a different way.
    """
    if path == ":memory:" or not path:
        return path
    base, dot, ext = path.rpartition(".")
    if not dot or "/" in ext or "\\" in ext:
        return f"{path}-{camera}"
    return f"{base}-{camera}.{ext}"


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


def canonical_size_from(calibration_path):
    """The canonical frame size the calibration's polygons were drawn in, or None.

    A calibration file is polygons in pixels. To warp a located pane back into those
    coordinates the producer has to know how big that frame was -- and it cannot be
    inferred from the polygons, because a lot polygon need not touch the frame edges.
    So the file must say, under a "canonical": [width, height] key, and a file that does
    not say is refused rather than defaulted. Defaulting here would silently scale every
    polygon by whatever ratio happened to be wrong.
    """
    if not calibration_path or not os.path.exists(calibration_path):
        return None
    import json as _json

    cal = _json.loads(open(calibration_path, "rb").read().decode("utf-8"))
    size = cal.get("canonical")
    if not size or len(size) != 2:
        raise SceneNotLocated(
            f"{calibration_path} has no \"canonical\": [width, height] key, so there is no "
            "frame to warp located panes back into. Add the pixel size the polygons were "
            "drawn against -- guessing it would rescale every polygon silently."
        )
    return (int(size[0]), int(size[1]))


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
    from vision.detector import DetectorUnavailable
    from vision.run_live import (build_council, build_source,  # noqa: F401
                                 declared_fixed_lens, same_model)
    from vision.scenelocator import SceneNotLocated

    ledger_path = camera_ledger_path(args.ledger or cfg.ledger_path, args.camera)
    ledger = Ledger(
        ledger_path,
        outbox_max_depth=cfg.backend.outbox_max_depth,
        policy=cfg.policy,
    )
    cloud = CloudClient(cfg.backend, ledger, REGISTRY, dry_run=args.dry_run)
    pipeline = Pipeline(cfg, ledger, cloud, REGISTRY, producer_instance_id=PRODUCER_INSTANCE_ID)

    camera = args.camera
    if camera not in cfg.cameras:
        raise ConfigError(
            f"--camera {camera!r} is not in the config (cameras: {', '.join(cfg.cameras) or 'none'}). "
            "The edge posts under this name and the shop's expected-camera registry keys on it, "
            "so a mismatch would render as an unregistered producer."
        )
    cam = cfg.cameras[camera]

    # AIM BEFORE CALIBRATING. `--channel` is resolved against the live window and refuses
    # to attach a calibration file to a lens it cannot prove is FIXED, so this must know
    # whether one was supplied -- which is why it reads args.calibration rather than the
    # parsed polygons below.
    source = build_source(args.source, args.hwnd, args.window_title, not args.no_crop,
                          channel=args.channel,
                          calibrated=bool(args.calibration and os.path.exists(args.calibration)),
                          declared_fixed=declared_fixed_lens(args.calibration),
                          scene_atlas=args.scene_atlas, scene=args.scene,
                          source_url=(os.environ.get(args.source_url_env)
                                      if args.source_url_env else None),
                          canonical_size=(canonical_size_from(args.calibration)
                                          if args.scene_atlas else None))

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

    council = build_council(args.model, args.device, args.motion_gate,
                            adjudicator_model=args.adjudicator_model,
                            adjudicator_device=args.adjudicator_device)
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
    # HAND SCENELOCK THE CALIBRATED POSE when the atlas proved one. Without this the lock
    # auto-adopts whatever frame settles first, which detects drift from WHERE THE PROCESS
    # STARTED -- genuinely useful, and blind to the case that matters most: a camera already
    # off-aim at start-up. There the wrong view becomes "home", every later frame agrees with
    # it, and visits are minted forever against polygons belonging to a view the camera no
    # longer has. Silently wrong, with no symptom to notice.
    #
    # A frame that appearance-matched a calibrated reference upgrades the gate from "has it
    # moved since boot" to "is it where the polygons were drawn".
    calibrated = getattr(source, "calibrated_reference", None)
    if calibrated is not None:
        try:
            vision.scene.set_reference(calibrated)
            log.info("scene lock anchored to the CALIBRATED pose from the atlas, "
                     "not to whichever frame settled first")
        except Exception:
            log.exception("could not anchor the scene lock; it will auto-adopt instead")

    seed_track_ids(vision, pipeline.tracker, camera)
    # What is LOAD-BEARING is that this runs before the loop starts, because the pin has to
    # be in place before ANY emission reaches `after_step`. Ordering it ahead of
    # `reconcile_restart` specifically is defence in depth, not a requirement: reconcile
    # evaluates at the restored last-activity, so the leave grace has not elapsed and it
    # only ever emits DEPARTING, which queues no shop row. A mutation that swapped the two
    # did NOT fail the test -- an earlier version of this comment claimed it would, and was
    # wrong. Kept in this order so it stays correct if reconcile ever gains a terminal path.
    try:
        pipeline.shop.restore_classifications(pipeline.ledger.shop_outbox_classifications())
    except Exception:
        log.exception("could not restore queued visit classifications; a COMMISSIONING row "
                      "still queued from the previous process may be recorded as PRODUCTION")
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
    # UPPERCASE HERE, at the source. `--mode` takes lowercase choices and the shop's
    # heartbeat schema is a Zod enum of UPPERCASE ones, so every consumer of this value
    # needs the uppercase form -- the startup log line, the first heartbeat, and EdgeLoop.
    # Uppercasing it only inside EdgeLoop fixed the steady state and left the FIRST
    # heartbeat after every restart rejected 400, which is precisely the heartbeat an
    # operator watches for when they have just restarted something.
    mode = mode.upper()
    base_mode = base_mode.upper()
    # REPLAY is a first-class lane, not a mode. The shop's every counter filters on
    # `dataClass = 'PRODUCTION'`, so a replay producer can post real rows against live data --
    # which is how a challenger gets evaluated against reality without touching the lot's
    # truth. The route has accepted REPLAY since migration 0120 and nothing has ever sent it.
    base_class = "REPLAY" if args.replay else "PRODUCTION"
    # UPPERCASE both sides. `mode` is normalised above and this comparison was against the
    # lowercase literal, so it silently stopped matching: a commissioning run would have been
    # tagged dataClass=PRODUCTION and counted as a real customer in the shop's KPIs, which is
    # the exact confusion `IMMUTABLE_AFTER_INSERT` exists to prevent downstream.
    # `OneAuthorityTest` caught it in the same edit that caused it.
    data_class = "COMMISSIONING" if mode == "COMMISSIONING" else base_class
    pipeline.shop.data_class = data_class
    pipeline.shop.base_data_class = base_class
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
    ap.add_argument("--source", choices=["wgc", "window", "mss", "rtsp"], default="wgc",
                    help="capture lane: wgc | window/mss | rtsp")
    ap.add_argument("--source-url-env", default="CAMERA_SOURCE_URL",
                    help="env var holding the RTSP/source URL. Keep credential-bearing URLs "
                         "out of the scheduled-task command line.")
    ap.add_argument("--hwnd", type=int, default=None, help="explicit window handle (else resolved by title)")
    ap.add_argument("--window-title", default="V380", help="capture window title")
    ap.add_argument("--no-crop", action="store_true", help="capture the whole window, not the measured pane")
    ap.add_argument("--scene-atlas", default=None,
                    help="directory of reference views named <scene_id>__<variant>.png; "
                         "locates the KNOWN camera anywhere in the window and warps every "
                         "frame into canonical coordinates")
    ap.add_argument("--scene", default=None,
                    help="which scene_id in the atlas this producer IS; omit to accept "
                         "whichever known scene is on screen (refused if ambiguous)")
    ap.add_argument("--channel", type=int, default=None,
                    help="aim at ONE channel of a multi-lens device (0-based, left-to-right, top "
                         "row first). SHOPSIGN is a 3-in-1: two fixed lenses plus a PTZ.")
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
    ap.add_argument("--relocate-seconds", type=float, default=120.0,
                    help="how often to re-check that the located scene is still where it was. "
                         "A startup fix is only true at startup. 0 disables.")
    ap.add_argument("--challenger-model", default=os.environ.get("VISION_OV_CHALLENGER"),
                    help="a model observed but NEVER consulted for a decision. Unlike "
                         "--adjudicator-model, which votes inside the council, this one is "
                         "run out of band and only recorded.")
    ap.add_argument("--shadow-ledger", default=os.environ.get("EDGE_SHADOW_LEDGER"),
                    help="JSONL of what the adjudicator ALONE would have decided, beside the "
                         "primary. Counterfactual only -- a challenger never gets a vote.")
    ap.add_argument("--hard-cases", default=os.environ.get("EDGE_HARD_CASES"),
                    help="directory for clips of moments the system found HARD or worth "
                         "labelling -- detector disagreement, weak portal decisions, off-home "
                         "pose/layout changes, and no-bay activity review. Unset means no "
                         "corpus is collected.")
    ap.add_argument("--hard-case-max-gb", type=float, default=2.0,
                    help="disk budget for the hard-case store; oldest clips are evicted first")
    ap.add_argument(
        "--service-review-seconds",
        type=float,
        default=float(os.environ.get("EDGE_SERVICE_REVIEW_SECONDS", "30")),
        help="after this many OBSERVED stationary seconds, save one review clip for an arrived "
             "vehicle outside all calibrated bays. This samples ambiguity for labelling; it "
             "does NOT classify outside service. 0 disables.",
    )
    ap.add_argument("--trajectories", default=os.environ.get("EDGE_TRAJECTORIES"),
                    help="SQLite path recording where vehicles actually drove, at 1 Hz. Feeds "
                         "`python -m vision.trajectory`, which PROPOSES a lot polygon measured "
                         "from real traffic instead of drawn by eye, and diffs it against the "
                         "one in force. Unset means nothing is recorded.")
    ap.add_argument("--hard-case-episodes", choices=["off", "both", "replace"], default="both",
                    help="write each hard case ALSO as an MCAP episode -- one indexed, "
                         "self-contained file Foxglove/Rerun can scrub through time, instead "
                         "of a folder of pictures. 'replace' drops the numbered JPEGs once the "
                         "episode has been re-read and proven complete (measured smaller than "
                         "the JPEGs it replaces); 'off' keeps today's behaviour exactly.")
    ap.add_argument("--adjudicator-model", default=os.environ.get("VISION_OV_ADJUDICATOR"),
                    help="a SECOND, stronger model consulted only on ambiguous or entry-critical "
                         "frames. Must differ from --model; a model agrees with itself.")
    ap.add_argument("--adjudicator-device", default=os.environ.get("VISION_OV_ADJUDICATOR_DEVICE"),
                    help="device for the adjudicator (default: same as --device). Put it on CPU "
                         "when the primary holds the GPU, so escalation does not contend.")
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
    ap.add_argument("--replay", action="store_true",
                    help="tag every visit dataClass=REPLAY. The shop filters its counters on "
                         "PRODUCTION, so a replay lane can post real rows against live data "
                         "without touching the lot truth.")
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
    recorder = None
    if args.hard_cases:
        from vision.hardcase import HardCaseRecorder

        recorder = HardCaseRecorder(directory=args.hard_cases,
                                    max_bytes=int(args.hard_case_max_gb * 1024 ** 3),
                                    episodes=args.hard_case_episodes)
        os.makedirs(args.hard_cases, exist_ok=True)
        # Say WHICH it is. "episodes: both" and "episodes: off (mcap not importable)" are
        # different facts, and a log line that reported only the requested mode would let an
        # operator believe a box is recording episodes it has no library to write.
        from vision.episode import AVAILABLE as _EPISODES_AVAILABLE

        # `episode_mode`, NOT `mode`. This block used to call it `mode` and CLOBBERED the
        # producer's own mode -- the same function-scope name, computed 400 lines earlier --
        # so `EdgeLoop` was constructed with mode="both" and its FIRST heartbeat went out as
        # "BOTH" and was rejected 400 by the shop's enum. Line 502 then repaired it from
        # `base_mode` on the next tick, so heartbeats 2 onward were fine and the failure
        # looked unreproducible: it only appears with `--hard-cases`, only on the first
        # heartbeat after a restart, and only in a metric nobody was counting.
        episode_mode = args.hard_case_episodes
        if episode_mode != "off" and not _EPISODES_AVAILABLE:
            episode_mode = ("off (requested %s; mcap is not importable -- pip install mcap)"
                            % episode_mode)
        log.info("hard-case corpus at %s (budget %.1f GB, episodes: %s)", args.hard_cases,
                 args.hard_case_max_gb, episode_mode)

    trajectories = None
    if args.trajectories:
        from vision.trajectory import TrajectoryStore

        trajectories = TrajectoryStore(args.trajectories)
        # Say which. "recording" and "configured but could not open its file" are different
        # facts, and only one of them will have anything in it when someone goes to commission.
        log.info("trajectories -> %s (%s)", args.trajectories,
                 "recording at 1 Hz" if trajectories.open
                 else f"NOT recording: {trajectories.stats.last_error}")

    # A CHALLENGER IS NOT AN ADJUDICATOR, and conflating them made the previous version of
    # this a counterfactual in name only. `--adjudicator-model` is passed into the
    # AUTHORITATIVE council, where `_fuse` promotes ambiguous boxes it agrees with and adds
    # boxes it alone found -- so it changes tracking and visit emission. Recording its
    # disagreements as "what a challenger would have decided" described a model that was
    # already deciding.
    #
    # `--challenger-model` is loaded here, kept OUT of the council, and run out of band by
    # the loop. That is the only arrangement in which the ledger's central claim -- that the
    # challenger never gets a vote -- is true by construction rather than by assertion.
    shadow = challenger = None
    if args.shadow_ledger and args.challenger_model:
        from vision.detector import OpenVinoVehicleDetector
        from vision.shadow import ShadowLedger

        if same_model(args.challenger_model, args.model):
            raise ConfigError(
                "--challenger-model is the same file as --model, so the ledger would record "
                "the champion disagreeing with itself. Point it at a different model."
            )
        try:
            challenger = OpenVinoVehicleDetector(args.challenger_model,
                                                 device=args.adjudicator_device or args.device,
                                                 conf=0.25)
            shadow = ShadowLedger(path=args.shadow_ledger,
                                  champion_model=os.path.basename(args.model or "none"),
                                  challenger_model=os.path.basename(args.challenger_model))
            log.info("shadow ledger at %s observing %s (NOT in the council)",
                     args.shadow_ledger, challenger.name)
        except DetectorUnavailable as exc:
            log.warning("challenger unavailable (%s); no ledger is being kept", exc)
            challenger = shadow = None
    elif args.shadow_ledger:
        # REFUSING IS THE POINT. A ledger with no challenger records nothing and would sit
        # there as an empty file, which reads later as "the challenger agreed every time"
        # rather than "no challenger ever ran".
        log.warning("--shadow-ledger needs --challenger-model; there is no challenger to "
                    "observe, so no ledger is being kept")

    loop = EdgeLoop(
        pipeline, vision, source,
        camera=args.camera, mode=mode.upper(), base_mode=base_mode.upper(),
        calibration_version=calibration_version, detector_name=detector_name,
        model_sha256=_model_sha256(args.model),
        commissioning_run_id=args.commissioning_run,
        heartbeat_seconds=args.heartbeat_seconds, drain_seconds=args.drain_seconds,
        stall_exit_seconds=args.stall_exit_seconds, persist_seconds=args.persist_seconds,
        hard_cases=recorder, trajectories=trajectories, shadow=shadow, challenger=challenger,
        relocate_seconds=args.relocate_seconds,
        service_review_seconds=args.service_review_seconds,
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
    progress_lease = os.environ.get("EDGE_PROGRESS_LEASE")
    try:
        # Claim or confirm producer authority BEFORE the first frame can emit a visit.
        # Primary can buffer locally if the shop is temporarily unreachable; standbys
        # start fail-closed and only begin mirroring after the shop explicitly elects them.
        try:
            loop.send_heartbeat(time.time())
            loop.next_heartbeat = time.time() + loop.heartbeat_seconds
        except Exception:
            pipeline.metrics.inc("edge_heartbeat_errors_total")
            log.exception("startup heartbeat error")
        while not stop.is_set():
            if deadline is not None and time.time() >= deadline:
                break
            started = time.time()
            loop.step()
            _refresh_progress_lease(progress_lease)
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
    # LOAD THE ENV FILE, exactly as `visitd.main` does. The scheduled-task wrapper decrypts
    # and exports only CAMERA_INGEST_KEY (the shop lane), while `load_config` reads the
    # AUTHORITATIVE cloud credential from the environment as STATENOUR_SYNC_KEY. Without
    # this the scheduled child started with no such key, `CloudClient.deliver_once()`
    # returned `blocked` forever, and the StateNour outbox silently never drained -- the
    # one lane whose whole purpose is durability (Codex P1 on #2255, round 8). The wrapper
    # `cd /d`s into the camera-bridge root first, so `.env` there is what this finds.
    try:
        from dotenv import load_dotenv

        load_dotenv()
    except ImportError:
        pass
    # RE-RESOLVE after the env file is loaded. This constant is read at IMPORT time, so
    # before load_dotenv existed every env var here was ignored uniformly -- which was at
    # least predictable. Adding load_dotenv made `VISION_OV_MODEL` and `VISION_OV_DEVICE`
    # work (they are read inside `parse_args`, which runs later) while leaving this one
    # silently ignored, and a setting that works for two of three neighbours is worse than
    # one that works for none. Found in this branch's own hostile re-read, not by review.
    global PRODUCER_INSTANCE_ID
    from_env = os.environ.get("EDGE_INSTANCE_ID")
    if from_env:
        PRODUCER_INSTANCE_ID = from_env
    try:
        return run_edge(parse_args(argv))
    except ConfigError as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
