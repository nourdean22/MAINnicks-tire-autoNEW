"""
Benchmark one Intel IR detector across CPU / GPU / NPU on the SAME frames.

OpenVINO's AUTO device does NOT pick the NPU on its own, so each device is compiled
and timed explicitly. Emits machine-readable JSON so a configuration choice is a
measurement, not a preference.

    py -3 -m vision.benchmark_openvino --model <ir.xml> [--frames <dir>] \
        [--devices CPU,GPU,NPU] [--iters 50] [--json out.json]

With no --frames it benchmarks on synthetic frames, which measures LATENCY honestly
but says nothing about detection quality. Point it at real saved shop frames for that.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vision.capture import ReplaySource, SyntheticSource  # noqa: E402
from vision.detector import DetectorUnavailable, OpenVinoVehicleDetector  # noqa: E402


def load_frames(directory: str | None, count: int) -> list[np.ndarray]:
    if directory and os.path.isdir(directory):
        src = ReplaySource(directory=directory)
        imgs = [f.image for f in iter(src) if f.image is not None]
        if imgs:
            return imgs
        print(f"warning: no images in {directory}; falling back to synthetic", flush=True)
    src = SyntheticSource([[(100 + 10 * i, 150, 220 + 10 * i, 260)] for i in range(count)],
                          size=(640, 360))
    out = []
    while True:
        f = src.read()
        if f is None:
            break
        out.append(f.image)
    return out


def bench_device(model: str, device: str, images: list[np.ndarray], iters: int) -> dict:
    try:
        det = OpenVinoVehicleDetector(model, device=device, conf=0.5)
    except DetectorUnavailable as exc:
        return {"device": device, "available": False, "error": str(exc)}
    except Exception as exc:  # a device can exist but fail to compile the model
        return {"device": device, "available": False, "error": repr(exc)}

    # Warm up: first inference includes lazy kernel compilation and is not representative.
    for _ in range(3):
        det.detect(images[0])

    latencies: list[float] = []
    detections = 0
    t_start = time.perf_counter()
    for i in range(iters):
        img = images[i % len(images)]
        out = det.detect(img)
        detections += len(out)
        latencies.append(det.last_latency_ms)
    wall = time.perf_counter() - t_start

    latencies.sort()
    return {
        "device": device,
        "available": True,
        "iters": iters,
        "meanMs": round(statistics.fmean(latencies), 2),
        "medianMs": round(statistics.median(latencies), 2),
        "p95Ms": round(latencies[int(0.95 * (len(latencies) - 1))], 2),
        "minMs": round(latencies[0], 2),
        "maxMs": round(latencies[-1], 2),
        "throughputFps": round(iters / wall, 1) if wall > 0 else 0.0,
        "detections": detections,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help="path to the Intel IR .xml")
    ap.add_argument("--frames", default=None, help="directory of real saved frames")
    ap.add_argument("--devices", default="CPU,GPU,NPU")
    ap.add_argument("--iters", type=int, default=50)
    ap.add_argument("--json", default=None)
    args = ap.parse_args()

    try:
        import openvino as ov
        core = ov.Core()
        available = list(core.available_devices)
        version = ov.__version__
    except Exception as exc:
        print(f"openvino unavailable: {exc!r}")
        return 1

    images = load_frames(args.frames, count=20)
    report = {
        "openvinoVersion": version,
        "availableDevices": available,
        "model": os.path.basename(args.model),
        "frameSource": args.frames or "synthetic",
        "frameCount": len(images),
        "frameSize": list(images[0].shape[:2][::-1]) if images else None,
        "results": [],
    }
    for device in [d.strip() for d in args.devices.split(",") if d.strip()]:
        print(f"benchmarking {device} ...", flush=True)
        report["results"].append(bench_device(args.model, device, images, args.iters))

    ok = [r for r in report["results"] if r.get("available")]
    if ok:
        best = min(ok, key=lambda r: r["meanMs"])
        report["fastest"] = best["device"]

    print(json.dumps(report, indent=2))
    if args.json:
        with open(args.json, "w", encoding="ascii") as fh:
            json.dump(report, fh, indent=2)
        print(f"\nwrote {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
