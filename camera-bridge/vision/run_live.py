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
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vision.capture import CaptureMux, V380WindowSource, WgcWindowSource  # noqa: E402
from vision.detector import (  # noqa: E402
    DetectorCouncil, DetectorUnavailable, Mog2MotionDetector, OpenVinoVehicleDetector,
)
from vision.evidence import EvidenceStore  # noqa: E402
from vision.geometry import EntryPortal, LotMap, Zone  # noqa: E402
from vision.pipeline import VisionPipeline  # noqa: E402


def build_source(kind: str, hwnd: int | None, title: str, crop: bool):
    if kind == "wgc":
        src = WgcWindowSource(
            window_hwnd=hwnd, window_title=title,
            crop_frac=WgcWindowSource.SHOPSIGN_MAIN_PANE if crop else None,
        )
        return CaptureMux([src, V380WindowSource(window_title=title)])
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
    ap.add_argument("--calibration", default=None)
    ap.add_argument("--evidence", default=None, help="directory for EvidencePackets")
    ap.add_argument("--save-frame", default=None, help="write one frame here and exit")
    ap.add_argument("--motion-gate", action="store_true",
                    help="use MOG2 as a compute trigger (it can never confirm)")
    args = ap.parse_args()

    source = build_source(args.source, args.hwnd, args.window_title, not args.no_crop)
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
        council_res = out.get("council")
        if council_res is not None:
            vehicles_seen.append(len(council_res.detections))
        for em in out.get("emissions", []):
            print(f"  {getattr(em, 'state', '?'):<18} visit={getattr(em, 'visit_id', '')[:8]} "
                  f"seq={getattr(em, 'seq', '')}", flush=True)
        time.sleep(interval)

    s = pipe.summary()
    print("\n=== run summary ===")
    print(json.dumps(s, indent=2))
    if vehicles_seen:
        avg = sum(vehicles_seen) / len(vehicles_seen)
        print(f"vehicles per analysed frame: mean {avg:.2f}, max {max(vehicles_seen)}")
    if not calibrated:
        print("\nARRIVALS NOT REPORTED: no calibration. Re-run with --save-frame, draw "
              "the lot and driveway polygons, then pass --calibration.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
