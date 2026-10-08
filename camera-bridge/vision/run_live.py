"""
Run the vision pipeline against the live V380 desktop app (or a recording).

    py -3 -m vision.run_live --seconds 120 --model <ir.xml> --device GPU \
        [--calibration lot.json] [--source wgc|mss] [--evidence out/]

Without `--calibration` this runs in CENSUS mode: it reports vehicles, occupancy,
capture health and PTZ state, and it REFUSES to claim arrivals. An entry-line crossing
is meaningless until someone has drawn where the driveway actually is, and reporting
arrivals from an uncalibrated polygon is exactly the false confidence this project
exists to remove.

Calibration file (pixel coordinates in the captured pane):

    {
      "lot":    [[x,y], ...],          # the property polygon
      "portal": [[x,y], ...],          # the driveway mouth
      "bays":   {"bay_1": [[x,y], ...]}
    }

Use --save-frame to write one frame you can draw those polygons on.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import os
import uuid
from typing import Optional
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vision.capture import CaptureMux, RtspSource, V380WindowSource, WgcWindowSource  # noqa: E402
from vision.detector import (  # noqa: E402
    DetectorCouncil, DetectorUnavailable, Mog2MotionDetector, OpenVinoVehicleDetector,
)
from vision.evidence import EvidenceStore  # noqa: E402
from vision.geometry import EntryPortal, LotMap, Zone, portal_straddles  # noqa: E402
from vision.panedetect import (ChannelNotFound, assert_channel_usable,  # noqa: E402
                               classify_motion, detect_live_region,
                               resolve_channel, split_into_channels)
from vision.scenelocator import (SceneNotLocated, advance,  # noqa: E402
                                 canonicalise, load_atlas, locate)
from vision.pipeline import VisionPipeline  # noqa: E402


class VisitSink:
    """POSTs emissions to the nickstire visit ingest.

    WHY THIS EXISTS: without it `run_live` only PRINTS, so nothing this package computes
    reaches the ledger or the shop admin, and the honest reading of "the false-arrival P0
    is fixed" would be "fixed in a lane nothing consumes". This is the lab lane's sink.
    It is NOT the deployed path -- see the deployment note in README.md.

    Failures are reported and swallowed: a cloud outage must never take down the vision
    loop, and visitd already owns durable delivery for the production path.
    """

    def __init__(self, url: str, key: str, data_class: str = "PRODUCTION",
                 commissioning_run_id: Optional[str] = None) -> None:
        self.url = url
        self._key = key
        self.sent = 0
        self.failed = 0
        self.heartbeats_sent = 0
        self.heartbeats_failed = 0
        #: PRODUCTION | COMMISSIONING | REPLAY -- stamped on every row so a test drive
        #: is excluded from the shop's KPIs by default (never deleted).
        self.data_class = data_class
        self.commissioning_run_id = commissioning_run_id

    @property
    def heartbeat_url(self) -> str:
        """`/api/camera/visits` -> `/api/camera/heartbeat` on the same host."""
        base = self.url
        if base.endswith("/api/camera/visits"):
            return base[: -len("/visits")] + "/heartbeat"
        return base.rstrip("/") + "/heartbeat"

    def _post(self, url: str, payload: dict, timeout: float = 10.0) -> bool:
        import json as _json
        import urllib.error
        import urllib.request

        req = urllib.request.Request(url, data=_json.dumps(payload).encode(), method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("x-sync-key", self._key)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status in (200, 207)

    def heartbeat(self, body: dict) -> bool:
        """POST one producer heartbeat. Failures are reported and swallowed, like visits."""
        import urllib.error

        try:
            ok = self._post(self.heartbeat_url, body)
        except (urllib.error.URLError, OSError) as exc:
            self.heartbeats_failed += 1
            print(f"  ! heartbeat POST failed ({exc}); the loop continues", flush=True)
            return False
        if ok:
            self.heartbeats_sent += 1
        else:
            self.heartbeats_failed += 1
        return ok

    def send(self, emission, camera: str, pipeline) -> bool:
        import urllib.error

        visit_id = getattr(emission, "visit_id", None)
        if not visit_id:
            return False
        timing = None
        for tid, tm in getattr(pipeline, "timings", {}).items():
            if pipeline._track_visit.get(tid) == visit_id:
                timing = tm
                break

        def iso(ts):
            if ts is None:
                return None
            import datetime as _dt
            return _dt.datetime.fromtimestamp(ts, _dt.timezone.utc).isoformat()

        row = {
            "visitId": visit_id,
            "camera": camera,
            "state": getattr(emission, "state", "UNKNOWN"),
            "seq": int(getattr(emission, "seq", 0) or 0),
            "arrivedAt": iso(getattr(timing, "arrived_at", None)),
            "waitStartedAt": iso(getattr(timing, "wait_started_at", None)),
            "bayEnteredAt": iso(getattr(timing, "bay_entered_at", None)),
            "bayExitedAt": iso(getattr(timing, "bay_exited_at", None)),
            "departedAt": iso(getattr(timing, "departed_at", None)),
            # Episode trail (migration 0127). A tracker id is not a vehicle: when a track
            # dies and the car is re-acquired, `arrivedAt` above is the ORIGINAL arrival
            # carried forward by the stitcher, not the re-acquisition. These three make
            # that correction AUDITABLE -- without them the shop sees a corrected time
            # with no way to ask which fragments produced it.
            "episodeId": getattr(timing, "episode_id", None),
            "memberTrackIds": list(getattr(timing, "member_track_ids", None) or []) or None,
            # `continuesVisitId` is deliberately NOT sent, and stays NULL in the column.
            # The stitcher works in TRACK ids -- `continues_track_id` is the retired
            # TRACK this visit continued -- while the column asks for a VISIT id. The
            # pipeline cannot resolve one here: `_track_visit` is popped when the track
            # dies, which is the same moment the fragment becomes adoptable. Writing a
            # track id into a column named `...VisitId` would be a value that reads as
            # one thing and means another, which is worse than an honest NULL.
            # `memberTrackIds` already carries the track-level trail.
            "preexisting": False,   # preexisting objects never reach visitd at all
            "dataClass": self.data_class,
            "commissioningRunId": self.commissioning_run_id,
        }
        try:
            ok = self._post(self.url, {"visits": [row]})
        except (urllib.error.URLError, OSError) as exc:
            print(f"  ! visit POST failed ({exc}); the loop continues", flush=True)
            self.failed += 1
            return False
        self.sent += 1
        return ok


def declared_fixed_lens(calibration_path) -> bool:
    """Does the calibration DECLARE this lens fixed? Absent means no, deliberately.

    Eligibility to carry calibrated arrival geometry is a durable fact about the hardware,
    and it has to be stated rather than inferred: a PTZ idle for four seconds is
    indistinguishable from a camera bolted to a wall, so no length of observation can
    establish it. Defaulting to False means an operator who says nothing gets census mode,
    which is the safe half of the mistake.
    """
    if not calibration_path or not os.path.exists(calibration_path):
        return False
    import json as _json

    try:
        cal = _json.loads(open(calibration_path, "rb").read().decode("utf-8"))
    except Exception:  # noqa: BLE001 - an unreadable calibration declares nothing
        return False
    return str(cal.get("lensType", "")).lower() == "fixed"


def aim_at_channel(src, index: int, calibrated: bool, declared_fixed: bool = False,
                   samples: int = 16, interval: float = 0.25) -> tuple:
    """Point `src` at ONE channel of a multi-lens device. Returns `((x,y,w,h), kind, shift)`.

    WHY A DEVICE NEEDS THIS. SHOPSIGN is a 3-in-1: two FIXED lenses covering the left and
    right approaches to the shop, and a PTZ. The app draws all three in one window, so a
    producer cropped to "the live video" analyses three unrelated scenes as one -- a car on
    the left approach, the right approach and whatever the PTZ happens to face are summed
    into a single frame, and no count taken from it means anything. Aiming at one channel is
    what turns a 3-in-1 from one confused camera into three usable ones.

    The resolution happens ONCE, at startup, against the window as it actually is, and every
    failure raises. A resolver that fell back to a guess would point the detector at the
    wrong lens and attribute every later arrival to the wrong side of the shop, silently.
    """
    src.crop_frac = None                       # the resolver needs the WHOLE window
    frames = []
    for _ in range(samples):
        try:
            frame = src.read()
        except Exception:                      # noqa: BLE001 - a read failure is data here
            frame = None
        if frame is not None:
            frames.append(frame.image)
        time.sleep(interval)
    if len(frames) < 4:
        raise ChannelNotFound(
            f"only {len(frames)} of {samples} frames could be captured from {title_of(src)!r}, "
            "which is too few to locate a channel. The window is up but not rendering video."
        )
    box, kind, shift = resolve_channel(frames, index)
    assert_channel_usable(index, kind, calibrated, declared_fixed=declared_fixed)
    x, y, w, h = box
    height, width = frames[0].shape[:2]
    src.crop_frac = (x / width, y / height, (x + w) / width, (y + h) / height)
    print(f"channel {index}: x={x} y={y} {w}x{h} motion={kind} shift={shift:.2f}px "
          f"of a {width}x{height} window", flush=True)
    return box, kind, shift


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


def aim_at_scene(src, atlas_dir: str, scene_id: Optional[str], calibration_size,
                 calibrated: bool = False, declared_fixed: bool = False,
                 samples: int = 12, interval: float = 0.25):
    """Find a KNOWN scene in the window and deliver it in canonical coordinates.

    This is the layout-blind path and it supersedes both `--channel` and the measured
    `SHOPSIGN_MAIN_PANE` constant for any camera that has an atlas. `--channel` still finds
    a rectangle by motion; this finds THE CAMERA by appearance, which is the difference
    between "there is video here" and "this is the left approach".

    `calibration_size` is the canonical frame the lot polygon and entry portal were drawn
    in. Every frame is warped back into it, so the pane's position and SIZE stop being
    inputs to any geometric decision -- which is the property a crop can never have.

    Refuses on: an unreadable atlas, no recognisable scene, an ambiguous one, or a named
    scene that is not on screen. Each of those, answered with a guess, binds calibrated
    geometry to the wrong ground and reports perfect health while doing it.
    """
    refs = load_atlas(atlas_dir)
    # A CALIBRATION BELONGS TO ONE CAMERA. With `--scene` omitted, every reference stays
    # eligible and `locate` returns whichever matched strongest -- so a single calibration
    # file's lot and portal polygons could land on a sibling lens or the PTZ, silently, while
    # the log cheerfully names the scene it chose. Census mode may roam; calibrated geometry
    # may not.
    if calibrated and scene_id is None and len({r.scene_id for r in refs}) > 1:
        raise SceneNotLocated(
            f"the atlas in {atlas_dir!r} holds "
            f"{sorted({r.scene_id for r in refs})} and a calibration file was supplied, but "
            "no --scene was named. A calibration describes ONE camera's ground; letting the "
            "strongest match claim it would put those polygons on whichever lens happened to "
            "win. Name the scene, or drop --calibration to run census-only."
        )
    if scene_id is not None:
        refs = [r for r in refs if r.scene_id == scene_id]
        if not refs:
            raise SceneNotLocated(
                f"the atlas in {atlas_dir!r} has no reference for scene {scene_id!r}; it "
                f"holds {sorted({r.scene_id for r in load_atlas(atlas_dir)})}"
            )
    src.crop_frac = None                       # the locator needs the WHOLE window
    frames = []
    for _ in range(samples):
        try:
            frame = src.read()
        except Exception:                      # noqa: BLE001 - a read failure is data here
            frame = None
        if frame is not None:
            frames.append(frame.image)
        time.sleep(interval)
    if not frames:
        raise SceneNotLocated(
            f"no frames could be captured from {title_of(src)!r}, so no scene can be located"
        )
    # CROSS-CHECK AGAINST AN INDEPENDENT SIGNAL before binding any geometry. `panedetect`
    # finds live video by temporal variance and knows nothing about appearance, so the two
    # agreeing about WHERE the pane is means something that neither can establish alone.
    #
    # This is not defensive padding. Measured on the real window after the operator nudged
    # the PTZ, its stored reference matched at 158 inliers with a 0.81 ratio and a 1.33px
    # reprojection error -- every match-quality gate green -- and placed the pane 623px from
    # where that camera's pixels actually are. The lens had panned, so the old view's content
    # genuinely does sit elsewhere now; the homography was faithful and useless. No match
    # quality can catch that, because the fit is correct. Only a second opinion can.
    panes = None
    try:
        region = detect_live_region(frames)
        if region is not None:
            panes = split_into_channels(region, frames[-1]) or None
    except Exception:  # noqa: BLE001 - no second opinion is not a reason to refuse to start
        panes = None
    found = locate(frames[-1], refs, panes=panes)
    # THE REFERENCE'S OWN SIZE IS THE COORDINATE SYSTEM. `locate` returns a homography that
    # maps FROM the matched reference's width and height; handing `warpPerspective` a
    # different output size does not rescale that, it crops or pads it. So a calibration
    # whose `canonical` disagrees with the reference silently shifts every polygon.
    chosen = next((r for r in refs if r.scene_id == found.scene_id
                   and r.variant == found.variant), None)
    if chosen is not None and (chosen.width, chosen.height) != tuple(calibration_size):
        raise SceneNotLocated(
            f"reference {found.scene_id}/{found.variant} is {chosen.width}x{chosen.height} "
            f"but the calibration's canonical frame is "
            f"{calibration_size[0]}x{calibration_size[1]}. The homography maps from the "
            "REFERENCE's coordinates, so a different output size crops or pads the result "
            "rather than rescaling it -- every polygon would sit off its ground."
        )
    binding, _ = advance(None, found)
    src.set_canonical(found.homography, calibration_size, found.scene_id, binding.epoch)
    # The canonical view of a PROVEN scene is the known-good pose `SceneLock` has always
    # asked for and never been given. Until now it auto-adopted whatever settled first,
    # which detects drift from WHERE THE PROCESS STARTED -- useful, but blind to the case
    # where the camera was already off-aim at start-up, because the wrong view then becomes
    # "home" and every later frame agrees with it.
    #
    # Handing it a frame that appearance-matched a calibrated reference upgrades the gate
    # from "has it moved since boot" to "is it where the polygons were drawn".
    # THE SAME ELIGIBILITY RULE AS `--channel`, and it was missing here. Locating a scene by
    # appearance proves WHICH camera it is; it says nothing about whether that camera can
    # re-aim itself. Without this the atlas path took a calibration file onto any lens at
    # all -- including a PTZ -- which is exactly the check `--channel` refuses to skip.
    x0 = int(min(p[0] for p in found.quad))
    y0 = int(min(p[1] for p in found.quad))
    x1 = int(max(p[0] for p in found.quad))
    y1 = int(max(p[1] for p in found.quad))
    pane_frames = [f[max(0, y0):y1, max(0, x0):x1] for f in frames]
    kind, shift = classify_motion([f for f in pane_frames if f.size])
    assert_channel_usable(found.scene_id, kind, calibrated, declared_fixed=declared_fixed)
    print(f"lens motion: {kind} (max {shift:.2f}px) declared_fixed={declared_fixed}",
          flush=True)

    reference = canonicalise(frames[-1], found, calibration_size)
    print(f"scene located: {found.describe()} epoch={binding.epoch} "
          f"canonical={calibration_size[0]}x{calibration_size[1]}", flush=True)

    # RE-LOCATION, because a startup fix is only true at startup. The operator resizes the
    # window, reorders panes or goes fullscreen mid-shift, and a binding installed once at
    # boot then warps every later frame through stale geometry while still claiming the old
    # sceneId and epoch -- detections evaluated against ground the pane no longer covers.
    #
    # It has to read RAW pixels. Once `set_canonical` is applied, `read()` returns the warped
    # pane, so re-locating from it would search for the scene inside a picture of the scene
    # and "find" it at the origin every time.
    held = {"binding": binding}

    def revalidate() -> RevalidateResult:
        """Re-locate and re-bind if the layout moved.

        Truthy when the epoch changed, so `if revalidate():` still reads correctly; the
        result also carries WHY a pass produced nothing and, on a re-bind, how good the
        match was. See `RevalidateResult`.
        """
        raw = []
        for _ in range(6):
            try:
                image = src.read_raw()
            except Exception:  # noqa: BLE001
                image = None
            if image is not None:
                raw.append(image)
            time.sleep(0.15)
        if len(raw) < 3:
            # Not a locator failure: the WINDOW did not give us enough to look at. Named
            # separately because the response differs -- this one is a capture problem.
            return RevalidateResult(False, failure=f"only {len(raw)}/6 raw frames readable")
        try:
            region = detect_live_region(raw)
            current_panes = split_into_channels(region, raw[-1]) if region is not None else None
            fresh = locate(raw[-1], refs, panes=current_panes or None)
        except SceneNotLocated as exc:
            # NOT a re-bind and NOT a shutdown. Losing the scene for one sample is usually a
            # truck filling the pane or a momentary layout animation; the pose gate -- now
            # anchored to the calibrated view -- is the thing that catches a real drift, and
            # it does so without tearing down a producer mid-shift.
            print(f"scene revalidation found nothing this pass ({str(exc)[:90]}); "
                  "keeping the existing binding", flush=True)
            return RevalidateResult(False, failure=f"SceneNotLocated: {str(exc)[:160]}")
        new_binding, changed = advance(held["binding"], fresh)
        if changed:
            held["binding"] = new_binding
            src.set_canonical(fresh.homography, calibration_size, fresh.scene_id,
                              new_binding.epoch)
            print(f"scene RE-LOCATED: {fresh.describe()} epoch={new_binding.epoch}",
                  flush=True)
        # `fresh` is carried on BOTH branches. An unchanged pass still measured the match,
        # and that measurement is how a binding that is quietly getting worse becomes
        # visible before the day it flips to the wrong scene.
        return RevalidateResult(changed, located=fresh)

    src.revalidate = revalidate
    return found, binding, reference


@dataclass(frozen=True)
class RevalidateResult:
    """What a re-location pass actually found, not just whether it re-bound.

    `revalidate()` used to return a bare bool, and the two facts it conflated are the two
    that matter. `False` meant EITHER "the layout has not moved" -- the happy case, many
    times an hour -- OR "the locator found nothing this pass", which is the producer failing
    to confirm the binding every polygon depends on. Both printed a line and returned the
    same value, so a locator that had failed every pass for an hour was indistinguishable
    from a stable window, and the only counter in the loop
    (`edge_relocate_errors_total`) counts EXCEPTIONS, which a clean `SceneNotLocated` is not.

    And when it DID re-bind, `Located`'s quality figures -- the inlier count, the ratio, the
    margin over the runner-up scene -- went to a print statement and nowhere else. So the
    `LAYOUT_CHANGE` clip recorded that geometry had been re-bound without recording any
    evidence about whether the new binding was any good, on the one operation this module's
    own docstring calls unrecoverable when it is wrong.

    TRUTHY WHEN THE EPOCH CHANGED, so every existing `if revalidate():` caller and every
    test stub that returns a plain bool keeps working unchanged. Readers that want the
    detail ask for it defensively.
    """

    changed: bool
    located: Optional["Located"] = None
    #: Why a pass produced no binding, or None when it succeeded. A STRING rather than a
    #: flag: "found nothing" and "the window was not readable" want different responses.
    failure: Optional[str] = None

    def __bool__(self) -> bool:
        return bool(self.changed)


def title_of(src) -> str:
    return getattr(src, "window_title", None) or getattr(src, "name", "capture")


def build_source(kind: str, hwnd: int | None, title: str, crop: bool,
                 channel: int | None = None, calibrated: bool = False,
                 scene_atlas: str | None = None, scene: str | None = None,
                 canonical_size=None, declared_fixed: bool = False,
                 source_url: str | None = None):
    # --channel and --scene-atlas are two answers to the same question and cannot both be
    # the answer. `--channel` finds a rectangle by MOTION; the atlas finds THE CAMERA by
    # APPEARANCE. Silently letting one win would make the producer's aim depend on argument
    # order, which is the kind of thing nobody discovers until the geometry is already wrong.
    if channel is not None and scene_atlas:
        raise ChannelNotFound(
            "--channel and --scene-atlas both aim the producer and cannot be combined. The "
            "atlas is strictly stronger: it proves WHICH camera it found, where --channel "
            "only proves that a rectangle holds moving pixels. Use --channel only for a "
            "camera with no atlas entry yet."
        )
    if kind == "rtsp":
        if channel is not None:
            raise ChannelNotFound(
                "--channel is a V380/WGC pane selector; an RTSP URL already names one "
                "stream. Point the URL at the intended camera instead."
            )
        if scene_atlas:
            raise SceneNotLocated(
                "--scene-atlas currently proves identity inside the V380/WGC window. "
                "RTSP is already a single stream and has no atlas binding path yet."
            )
        if not source_url:
            raise ValueError(
                "--source rtsp needs a URL from the environment named by "
                "--source-url-env (default CAMERA_SOURCE_URL)."
            )
        return _solo(RtspSource(source_url))
    if kind == "wgc":
        src = WgcWindowSource(
            window_hwnd=hwnd, window_title=title,
            crop_frac=WgcWindowSource.SHOPSIGN_MAIN_PANE if crop else None,
        )
        if scene_atlas:
            if not canonical_size:
                raise SceneNotLocated(
                    "--scene-atlas needs the canonical frame size the calibration was drawn "
                    "in, so frames can be warped back into it. Without it the warp target "
                    "would be a guess, which defeats the point of locating the scene."
                )
            _, _, reference = aim_at_scene(src, scene_atlas, scene, canonical_size,
                                           calibrated=calibrated,
                                           declared_fixed=declared_fixed)
            # Stash it on the source: `build_source` has no pipeline to hand it to, and the
            # caller that builds the pipeline does. Anything else would locate twice.
            src.calibrated_reference = reference
            return _solo(src, reference)
        if channel is None:
            return CaptureMux([src, V380WindowSource(window_title=title)])
        aim_at_channel(src, channel, calibrated, declared_fixed=declared_fixed)
        # NO FALLBACK LANE under --channel, deliberately: `V380WindowSource` crops by its own
        # fixed fractions and cannot honour a channel rectangle, so a silent failover would
        # hand the detector a different region than the operator asked for.
        #
        # But "no fallback" is not the same as "no wrapper". Returning the bare source broke
        # the contract BOTH consumers rely on: `run_live` reads `source.active` and would
        # raise AttributeError, and `edge_main` reads a missing `active` as DISCONNECTED and
        # loses `source_generation()`, which is what stops a track spanning a capture
        # restoration. A one-lane mux keeps the refusal and keeps the interface.
        return _solo(src)
    if channel is not None:
        raise ChannelNotFound(
            f"--channel needs the 'wgc' capture lane; {kind!r} crops by fixed fractions and "
            "cannot be aimed at a channel rectangle."
        )
    if scene_atlas:
        raise SceneNotLocated(
            f"--scene-atlas needs the 'wgc' capture lane; {kind!r} crops by fixed fractions "
            "and cannot deliver a canonically warped frame."
        )
    return CaptureMux([V380WindowSource(window_title=title)])


def same_model(a: str | None, b: str | None) -> bool:
    """Do these two paths name the SAME model file? Used to refuse a self-adjudicating council."""
    if not a or not b:
        return False
    try:
        return os.path.samefile(a, b)
    except OSError:
        return os.path.normcase(os.path.abspath(a)) == os.path.normcase(os.path.abspath(b))


def _solo(src, calibrated_reference=None):
    """Wrap one aimed source in a single-lane `CaptureMux`.

    The mux is the INTERFACE, not just the failover. `source.active` and
    `source_generation()` are read by both consumers, and a bare source silently fails the
    first and blinds the second -- which is how a track ends up spanning a capture
    restoration. One lane keeps the deliberate no-fallback behaviour and the contract.
    """
    mux = CaptureMux([src])
    if calibrated_reference is not None:
        mux.calibrated_reference = calibrated_reference
    # Forward the revalidation hook: the loop holds the mux, not the lane inside it.
    if getattr(src, "revalidate", None) is not None:
        mux.revalidate = src.revalidate
    return mux


class PortalNotUsable(Exception):
    """A portal that cannot be crossed inward. See `assert_portal_straddles`."""


def assert_portal_straddles(lot_poly, portal_poly) -> None:
    """Refuse a portal that does not span the lot boundary.

    An arrival is a vehicle crossing INTO the lot through the portal. A portal drawn
    wholly INSIDE the lot can never be crossed inward -- there is no outside half to come
    from -- so the producer records zero arrivals forever while every other signal stays
    green: frames arrive, vehicles are detected and tracked, the health lattice is happy,
    and the shop board simply shows a lot nobody ever drove into. That is indistinguishable
    from a genuinely quiet week, which is why it has to fail at LOAD time and loudly.

    Caught on the shop PC 2026-09-16 against a hand-drawn calibration: 75 of 75 sampled
    portal cells were inside the lot, 0 outside. The polygons looked perfectly sensible
    drawn over the camera view; only counting the two halves showed it.

    A portal wholly OUTSIDE is refused for the mirror reason: nothing can land in the lot
    through it either.

    The decision is `vision.geometry.portal_straddles`, the check the production edge's
    calibration loader (`edge_main.load_calibration`) applies. This runner used to carry its
    own grid sampler: two answers to one question can disagree, and a band thinner than a grid
    cell found no cell on either side and was refused as "entirely INSIDE" (2026-10-08).
    """
    if not portal_poly:
        return                      # census mode: no portal is a deliberate, honest state
    verdict = portal_straddles(lot_poly, portal_poly)
    if verdict["ok"]:
        return
    if verdict["samples"] == 0:
        raise PortalNotUsable(f"the calibration cannot be checked: {verdict['reason']}")
    if verdict["inside"] and not verdict["outside"]:
        where = "entirely INSIDE the lot"
    elif verdict["outside"] and not verdict["inside"]:
        where = "entirely OUTSIDE the lot"
    else:
        where = "along the lot boundary, on neither side of it"
    raise PortalNotUsable(
        f"the portal is {where} ({verdict['inside']} of {verdict['samples']} sampled points inside, "
        "no edge crossing the lot boundary), so no vehicle can ever cross INTO the lot through it "
        "and no arrival will ever be recorded -- which looks exactly like a quiet lot. Redraw the "
        "portal as a band STRADDLING the lot's entry edge, with part of it outside the lot polygon."
    )


def build_council(model: str | None, device: str, motion_gate: bool,
                  adjudicator_model: str | None = None,
                  adjudicator_device: str | None = None) -> DetectorCouncil:
    primary = None
    if model:
        try:
            primary = OpenVinoVehicleDetector(model, device=device, conf=0.35)
            print(f"detector: {primary.name} on {device}")
        except DetectorUnavailable as exc:
            print(f"WARNING: neural detector unavailable ({exc}); "
                  "running motion-only -- NO arrival can be confirmed")
    gate = None
    if motion_gate:
        try:
            gate = Mog2MotionDetector()
        except DetectorUnavailable as exc:
            print(f"motion gate unavailable: {exc}")

    # THE ADJUDICATOR SLOT, which `DetectorCouncil` has always had and production has never
    # filled. The council escalates to it on an ambiguous box or an entry-critical frame --
    # the two places where a mistake actually costs something -- so the intelligence is spent
    # where it changes an outcome instead of on every quiet frame.
    #
    # A COUNCIL MAY NOT ADJUDICATE ITSELF, and this refusal is the load-bearing part. `_fuse`
    # promotes an ambiguous detection by +0.25 when the adjudicator agrees with it. A model
    # always agrees with itself, so pointing both slots at one file would hand every uncertain
    # box a free confidence boost backed by no independent evidence at all -- silently turning
    # "uncertain" into "confident" while the logs show a healthy escalation.
    adjudicator = None
    if adjudicator_model:
        if same_model(adjudicator_model, model):
            raise DetectorUnavailable(
                "the adjudicator is the same model file as the primary. A model agrees with "
                "itself, so every ambiguous box would be promoted on its own say-so. Point "
                "--adjudicator-model at a DIFFERENT, stronger model, or leave it unset."
            )
        try:
            # A LOWER threshold than the primary, deliberately. The adjudicator is the careful
            # second look at a frame the primary already found ambiguous; running it at the
            # primary's own cut-off would make it silent on exactly those boxes.
            adjudicator = OpenVinoVehicleDetector(
                adjudicator_model, device=adjudicator_device or device, conf=0.25)
            print(f"adjudicator: {adjudicator.name} on {adjudicator_device or device}")
        except DetectorUnavailable as exc:
            # NOT fatal, and not silent. The council without an adjudicator is the system as
            # it has always run; pretending the escalation exists would be the defect.
            print(f"WARNING: adjudicator unavailable ({exc}); escalation is DISABLED and "
                  "ambiguous frames will be judged by the primary alone")
    return DetectorCouncil(primary=primary, motion_gate=gate, adjudicator=adjudicator)


PRODUCER_INSTANCE_ID = uuid.uuid4().hex[:16]


def _iso(ts: Optional[float]) -> Optional[str]:
    if ts is None:
        return None
    import datetime as _dt
    return _dt.datetime.fromtimestamp(ts, _dt.timezone.utc).isoformat()


def heartbeat_body(*, camera: str, seq: int, now: float, mode: str, source, pipeline,
                   health_state, scene_state, calibration_version: Optional[str],
                   detector_name: Optional[str], model_sha256: Optional[str],
                   last_healthy_frame_at: Optional[float],
                   commissioning_run_id: Optional[str] = None) -> dict:
    """The producer's own account of itself, for `POST /api/camera/heartbeat`.

    Every field is what THIS process observed; the cloud stamps its own receipt time,
    so transport delay and clock skew stay distinguishable. `lastHealthyFrameAt` is
    the last frame `FrameHealth` accepted, NOT the last frame read: a frozen capture
    keeps delivering frames, and it is the healthy one that proves the camera is alive.
    """
    active = getattr(source, "active", None)
    restores = int(getattr(active, "restores", 0) or 0) if active is not None else 0
    generation = f"{getattr(source, 'index', 0)}.{restores}"
    open_visits = len(getattr(getattr(pipeline, "tracker", None), "open_visits", lambda: [])())
    return {
        "camera": camera,
        "producerInstanceId": PRODUCER_INSTANCE_ID,
        "producerVersion": "vision.run_live",
        "heartbeatSeq": int(seq),
        "observedAtEdge": _iso(now),
        "mode": mode,
        "commissioningRunId": commissioning_run_id,
        "sourceType": "wgc" if active is not None and "wgc" in str(getattr(active, "name", "")) else
                      ("rtsp" if active is not None and "rtsp" in str(getattr(active, "name", "")) else "window"),
        "sourceGeneration": generation,
        "sourceConnected": active is not None,
        "lastHealthyFrameAt": _iso(last_healthy_frame_at),
        "captureFps": float(getattr(health_state, "fps", 0.0) or 0.0) if health_state is not None else None,
        "frameOk": bool(health_state.ok) if health_state is not None else None,
        "poseOk": (bool(scene_state.pose_ok) if getattr(scene_state, "reference_set", False) else None)
                  if scene_state is not None else None,
        "poseDelta": (float(scene_state.pose_delta) if getattr(scene_state, "pose_delta", None) is not None else None)
                     if scene_state is not None else None,
        "calibrationVersion": calibration_version,
        "detectorName": detector_name,
        "modelSha256": model_sha256,
        "openVisits": int(open_visits),
        "restores": restores,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=60.0)
    ap.add_argument("--fps", type=float, default=4.0)
    ap.add_argument("--model", default=os.environ.get("VISION_OV_MODEL"))
    ap.add_argument("--device", default=os.environ.get("VISION_OV_DEVICE", "GPU"))
    ap.add_argument("--source", choices=["wgc", "mss", "rtsp"], default="wgc")
    ap.add_argument("--source-url-env", default="CAMERA_SOURCE_URL",
                    help="env var holding the RTSP/source URL. Keep credential-bearing URLs "
                         "out of the process command line.")
    ap.add_argument("--window-title", default=os.environ.get("V380_WINDOW_TITLE", "V380"))
    ap.add_argument("--hwnd", type=int, default=None)
    ap.add_argument("--no-crop", action="store_true", help="capture the whole window")
    ap.add_argument("--relocate-seconds", type=float, default=120.0,
                    help="how often to re-check that the located scene is still where it "
                         "was. A startup fix is only true at startup. 0 disables.")
    ap.add_argument("--scene-atlas", default=None,
                    help="directory of reference views named <scene_id>__<variant>.png; "
                         "locates the KNOWN camera anywhere in the window and warps every "
                         "frame into canonical coordinates")
    ap.add_argument("--scene", default=None,
                    help="which scene_id in the atlas this producer IS; omit to accept "
                         "whichever known scene is on screen (refused if ambiguous)")
    ap.add_argument("--channel", type=int, default=None,
                    help="aim at ONE channel of a multi-lens device (0-based, left-to-right, "
                         "top row first). Resolved once at startup; refuses rather than guesses.")
    ap.add_argument("--calibration", default=None)
    ap.add_argument("--evidence", default=None, help="directory for EvidencePackets")
    ap.add_argument("--save-frame", default=None, help="write one frame here and exit")
    ap.add_argument("--adjudicator-model", default=os.environ.get("VISION_OV_ADJUDICATOR"),
                    help="a SECOND, stronger model consulted only on ambiguous or entry-critical "
                         "frames. Must differ from --model; a model agrees with itself.")
    ap.add_argument("--adjudicator-device", default=os.environ.get("VISION_OV_ADJUDICATOR_DEVICE"),
                    help="device for the adjudicator (default: same as --device). Put it on CPU "
                         "when the primary holds the GPU, so escalation does not contend.")
    ap.add_argument("--motion-gate", action="store_true",
                    help="use MOG2 as a compute trigger (it can never confirm)")
    ap.add_argument("--post-to", default=os.environ.get("CAMERA_VISITS_URL"),
                    help="POST visits to the nickstire ingest endpoint, "
                         "e.g. https://nickstire.org/api/camera/visits")
    ap.add_argument("--sync-key-env", default="CAMERA_INGEST_KEY",
                    help="env var holding the ingest shared secret (never pass the key itself)")
    ap.add_argument("--mode", choices=["production", "shadow", "commissioning"], default=None,
                    help="what this run IS. Default: shadow without a calibration, production with one; "
                         "--commissioning-run forces commissioning")
    ap.add_argument("--commissioning-run", default=None,
                    help="commissioning run id (e.g. C-20260909-001). Rows are tagged COMMISSIONING and "
                         "excluded from the shop's KPIs by default")
    ap.add_argument("--heartbeat-seconds", type=float, default=30.0,
                    help="how often to POST a producer heartbeat when --post-to is set")
    args = ap.parse_args()

    source = build_source(args.source, args.hwnd, args.window_title, not args.no_crop,
                          channel=args.channel, calibrated=bool(args.calibration),
                          declared_fixed=declared_fixed_lens(args.calibration),
                          scene_atlas=args.scene_atlas, scene=args.scene,
                          source_url=(os.environ.get(args.source_url_env)
                                      if args.source_url_env else None),
                          # ONLY the atlas path warps, so only it needs the canonical frame.
                          # Evaluating this unconditionally aborted every EXISTING calibrated
                          # producer -- ones using the documented lot/portal/bays format with no
                          # atlas -- before `build_source` could pick the crop or channel path
                          # that never uses the value. A new key may not be made retroactively
                          # mandatory for callers that do not need it.
                          canonical_size=(canonical_size_from(args.calibration)
                                          if args.scene_atlas else None))
    try:
        first = source.read()
    except Exception as exc:
        print(f"capture failed: {exc}")
        return 1
    if first is None:
        print("capture produced no frame")
        return 1
    w, h = first.size
    print(f"capture: {source.active.name if source.active else '?'} {w}x{h}")

    if args.save_frame:
        import cv2
        cv2.imwrite(args.save_frame, first.image)
        print(f"wrote {args.save_frame} -- draw the lot/portal polygons on it")
        return 0

    calibrated = bool(args.calibration and os.path.exists(args.calibration))
    if calibrated:
        with open(args.calibration, encoding="ascii") as fh:
            cal = json.load(fh)
        lot_poly = [tuple(p) for p in cal["lot"]]
        portal_poly = [tuple(p) for p in cal.get("portal", [])]
        assert_portal_straddles(lot_poly, portal_poly)
        lot_map = LotMap().add("front_lot", lot_poly)
        for name, poly in (cal.get("bays") or {}).items():
            lot_map.add(name, [tuple(p) for p in poly])
        portal = EntryPortal(Zone("front_lot", lot_poly),
                             portal_zone=Zone("portal", portal_poly) if portal_poly else None)
        bays = list((cal.get("bays") or {}).keys())
    else:
        # CENSUS MODE. The portal is an empty polygon, so nothing can ever cross it and
        # no arrival can be fabricated from an uncalibrated guess.
        print("NO CALIBRATION: census mode -- vehicles/occupancy/health only, "
              "arrivals are NOT claimed")
        lot_map = LotMap().add("front_lot", [(0.0, 0.0), (float(w), 0.0),
                                             (float(w), float(h)), (0.0, float(h))])
        portal = EntryPortal(Zone("front_lot", []), portal_zone=Zone("portal", []))
        bays = []

    council = build_council(args.model, args.device, args.motion_gate,
                            adjudicator_model=args.adjudicator_model,
                            adjudicator_device=args.adjudicator_device)
    store = EvidenceStore(args.evidence, enabled=bool(args.evidence))
    pipe = VisionPipeline(council=council, lot_map=lot_map, entry_portal=portal,
                          camera="sign", bay_names=bays, evidence=store)

    mode = args.mode or ("commissioning" if args.commissioning_run else ("production" if calibrated else "shadow"))
    if args.commissioning_run:
        mode = "commissioning"
    data_class = "COMMISSIONING" if mode == "commissioning" else "PRODUCTION"
    calibration_version = None
    if calibrated:
        import hashlib
        with open(args.calibration, "rb") as fh:
            calibration_version = "sha256:" + hashlib.sha256(fh.read()).hexdigest()[:12]
    print(f"mode: {mode}  dataClass: {data_class}  calibration: {calibration_version or 'none'}")

    sink = None
    if args.post_to:
        key = os.environ.get(args.sync_key_env, "")
        if not key:
            print(f"--post-to given but {args.sync_key_env} is unset; refusing to POST "
                  "unauthenticated. Emissions will be printed only.")
        else:
            sink = VisitSink(args.post_to, key, data_class=data_class,
                             commissioning_run_id=args.commissioning_run)
            print(f"posting visits to {args.post_to} (heartbeat every {args.heartbeat_seconds:g}s)")

    heartbeat_seq = 0
    next_heartbeat = time.time()
    last_health = None
    last_scene = None
    last_healthy_frame_at: Optional[float] = None
    detector_name = getattr(council, "name", None) or type(council).__name__
    model_sha = None
    try:
        # The weights this system was measured against are pinned by sha256 in
        # fetch_models.PINNED; the .bin digest identifies the model in the heartbeat.
        from vision.fetch_models import PINNED as _PINNED
        model_sha = next(
            (f.sha256 for f in _PINNED if str(getattr(f, "rel_path", "")).endswith(".bin")),
            None,
        )
    except Exception:
        model_sha = None

    interval = 1.0 / max(0.5, args.fps)
    t_end = time.time() + args.seconds
    vehicles_seen: list[int] = []
    print(f"running {args.seconds:.0f}s at ~{args.fps:g} fps ...\n", flush=True)
    # THE LAB LOOP REVALIDATES TOO. `aim_at_scene` installs the hook and `EdgeLoop` calls
    # it, but this standalone loop did not -- so a lab run with `--scene-atlas` kept its
    # startup warp indefinitely through a resize, a pane reorder or a switch to fullscreen.
    # That matters more than "it is only the lab": this loop can post visits with `--post-to`.
    next_relocate = time.time() + args.relocate_seconds if args.relocate_seconds > 0 else 0.0
    while time.time() < t_end:
        now = time.time()
        if args.relocate_seconds > 0 and now >= next_relocate:
            next_relocate = now + args.relocate_seconds
            revalidate = getattr(source, "revalidate", None)
            if revalidate is not None:
                try:
                    if revalidate():
                        print("scene re-located; the layout epoch advanced", flush=True)
                except Exception as exc:  # noqa: BLE001
                    print(f"scene revalidation failed ({exc}); the binding stands", flush=True)
        frame = source.read()
        if frame is None:
            time.sleep(interval)
            continue
        out = pipe.step(frame)
        hs = out.get("health") or pipe.health.state(time.time())
        last_health = hs
        if hs is not None and getattr(hs, "ok", False):
            last_healthy_frame_at = frame.ts
        if out.get("scene") is not None:
            last_scene = out["scene"]
        if sink is not None and time.time() >= next_heartbeat:
            next_heartbeat = time.time() + args.heartbeat_seconds
            heartbeat_seq += 1
            sink.heartbeat(heartbeat_body(
                camera="sign", seq=heartbeat_seq, now=time.time(), mode=mode.upper(), source=source,
                pipeline=pipe, health_state=last_health, scene_state=last_scene,
                calibration_version=calibration_version, detector_name=detector_name,
                model_sha256=model_sha, last_healthy_frame_at=last_healthy_frame_at,
                commissioning_run_id=args.commissioning_run,
            ))
        council_res = out.get("council")
        if council_res is not None:
            vehicles_seen.append(len(council_res.detections))
        for em in out.get("emissions", []):
            print(f"  {getattr(em, 'state', '?'):<18} visit={getattr(em, 'visit_id', '')[:8]} "
                  f"seq={getattr(em, 'seq', '')}", flush=True)
            if sink is not None:
                sink.send(em, camera="sign", pipeline=pipe)
        time.sleep(interval)

    s = pipe.summary()
    print("\n=== run summary ===")
    print(json.dumps(s, indent=2))
    if vehicles_seen:
        avg = sum(vehicles_seen) / len(vehicles_seen)
        print(f"vehicles per analysed frame: mean {avg:.2f}, max {max(vehicles_seen)}")
    if sink is not None:
        print(f"visits posted: {sink.sent} sent, {sink.failed} failed; "
              f"heartbeats: {sink.heartbeats_sent} sent, {sink.heartbeats_failed} failed")
    if not calibrated:
        print("\nARRIVALS NOT REPORTED: no calibration. Re-run with --save-frame, draw "
              "the lot and driveway polygons, then pass --calibration.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
