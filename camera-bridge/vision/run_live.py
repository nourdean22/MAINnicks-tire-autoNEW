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
import json
import os
import uuid
from typing import Optional
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vision.capture import CaptureMux, V380WindowSource, WgcWindowSource  # noqa: E402
from vision.detector import (  # noqa: E402
    DetectorCouncil, DetectorUnavailable, Mog2MotionDetector, OpenVinoVehicleDetector,
)
from vision.evidence import EvidenceStore  # noqa: E402
from vision.geometry import EntryPortal, LotMap, Zone  # noqa: E402
from vision.panedetect import (ChannelNotFound, assert_channel_usable,  # noqa: E402
                               resolve_channel)
from vision.scenelocator import (SceneNotLocated, advance, load_atlas,  # noqa: E402
                                 locate)
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


def aim_at_channel(src, index: int, calibrated: bool,
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
    assert_channel_usable(index, kind, calibrated)
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
    found = locate(frames[-1], refs)
    binding, _ = advance(None, found)
    src.set_canonical(found.homography, calibration_size, found.scene_id, binding.epoch)
    print(f"scene located: {found.describe()} epoch={binding.epoch} "
          f"canonical={calibration_size[0]}x{calibration_size[1]}", flush=True)
    return found, binding


def title_of(src) -> str:
    return getattr(src, "window_title", None) or getattr(src, "name", "capture")


def build_source(kind: str, hwnd: int | None, title: str, crop: bool,
                 channel: int | None = None, calibrated: bool = False,
                 scene_atlas: str | None = None, scene: str | None = None,
                 canonical_size=None):
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
            aim_at_scene(src, scene_atlas, scene, canonical_size)
            return src
        if channel is None:
            return CaptureMux([src, V380WindowSource(window_title=title)])
        aim_at_channel(src, channel, calibrated)
        # NO mux fallback under --channel, deliberately. `V380WindowSource` crops by its own
        # fixed fractions and cannot honour a channel rectangle, so a silent failover would
        # hand the detector a different region than the operator asked for -- the exact
        # substitution this flag exists to prevent. One lane, or a loud failure.
        return src
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


def build_council(model: str | None, device: str, motion_gate: bool) -> DetectorCouncil:
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
    return DetectorCouncil(primary=primary, motion_gate=gate)


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
    ap.add_argument("--source", choices=["wgc", "mss"], default="wgc")
    ap.add_argument("--window-title", default=os.environ.get("V380_WINDOW_TITLE", "V380"))
    ap.add_argument("--hwnd", type=int, default=None)
    ap.add_argument("--no-crop", action="store_true", help="capture the whole window")
    ap.add_argument("--scene-atlas", default=None,
                    help="directory of reference views named <scene_id>__<variant>.png; locates the KNOWN camera anywhere in the window and warps frames into canonical coordinates")
    ap.add_argument("--scene", default=None,
                    help="which scene_id in the atlas this producer IS; omit to accept whichever known scene is on screen (refused if two are ambiguous)")
    ap.add_argument("--channel", type=int, default=None,
                    help="aim at ONE channel of a multi-lens device (0-based, left-to-right, "
                         "top row first). Resolved once at startup; refuses rather than guesses.")
    ap.add_argument("--calibration", default=None)
    ap.add_argument("--evidence", default=None, help="directory for EvidencePackets")
    ap.add_argument("--save-frame", default=None, help="write one frame here and exit")
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
                          scene_atlas=args.scene_atlas, scene=args.scene,
                          canonical_size=canonical_size_from(args.calibration))
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

    council = build_council(args.model, args.device, args.motion_gate)
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
    while time.time() < t_end:
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
