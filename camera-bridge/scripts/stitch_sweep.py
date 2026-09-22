"""Sweep the EpisodeStitcher's window against RECORDED tracks, and report the cost.

WHY THIS EXISTS. `DEFAULT_MAX_GAP_S` shipped at 90.0 as a GUESS -- a plausible number for
"how long can a car be occluded". Swept against one day of this shop's own tracks it was the
worst setting tried on one lens and beaten outright on the other. A tuning constant nobody
can re-derive is a number that quietly stops being true.

WHAT IT MEASURES, AND WHY THE SECOND COLUMN IS THE IMPORTANT ONE.

  stitched          visits that got their ORIGINAL arrival instant back
  refused_ambiguous times two or more retired fragments were equally plausible, so
                    `adopt()` declined rather than guess

The refusals are the COST, not a side note: each one is a visit whose clock still restarts.
So the figure to minimise is ambiguity PER STITCH, not raw stitches. A window that doubles
its stitches while tripling its refusals has made the shop's numbers worse, not better.

The counter-intuitive result this tool exists to keep honest: a LONGER window stitches
FEWER visits. Extra seconds do not surface more re-acquisitions; they drag more irrelevant
fragments into range, and every extra candidate converts an unambiguous stitch into an
ambiguity refusal.

READ-ONLY, and it imports the shipped gates rather than reimplementing them -- a
reimplementation would measure the replica instead of the thing that runs.

Usage:  python scripts/stitch_sweep.py [--days N]
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sqlite3
import sys
from collections import defaultdict
from typing import List, Optional, Tuple

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vision.stitch import EpisodeStitcher  # noqa: E402

#: Each producer writes its OWN trajectory store -- `--trajectories` differs per producer.
#: A sweep that opened only one of them would report half the shop and look complete.
STORES = (("data/trajectories.sqlite", "shop-left", "data/calib-shop-left.json"),
          ("data/trajectories-right.sqlite", "shop-right", "data/calib-shop-right.json"))

GAPS = (15.0, 30.0, 60.0, 90.0, 150.0, 300.0)
SPEEDS = (45.0, 90.0)


class _Track:
    """Only the three attributes the stitcher reads. Mirrors the test double."""

    def __init__(self, track_id: int, born_ts: float, point: Tuple[float, float]) -> None:
        self.track_id, self.born_ts, self._point = track_id, born_ts, point

    @property
    def ground_point(self) -> Tuple[float, float]:
        return self._point


def _lot_polygon(calib_path: str):
    lot = json.load(io.open(calib_path, encoding="utf-8"))["lot"]
    return np.array([[float(p[0]), float(p[1])] for p in lot], dtype=np.float32)


def spans_for(db_path: str, scene: str, days: int, poly) -> List[tuple]:
    """Tracks the stitcher would ACTUALLY see, at the moment it would see them.

    TWO CORRECTIONS, both from review of the first version of this tool, and both of which
    invalidated its numbers:

    1. ONLY PORTAL CROSSERS. `VisionPipeline` calls `adopt()` inside `if verdict["crossed"]`
       and `retire()` only for `evidence == "arrival"`. Ordinary candidate and preexisting
       parked tracks NEVER enter the stitcher. Replaying every row in `track_points`
       manufactured most of the fragments and refusals it then reported.
    2. `x`,`y` ARE ALREADY THE GROUND POINT. `TrajectoryStore.observe()` writes
       `track.ground_point` into those columns; `w`,`h` are box dimensions only. Adding
       `w/2` and `h` translated it a SECOND time, inventing displacement whenever box sizes
       differed between fragments -- which is exactly what the spatial gate reads.

    Residual gap, stated rather than hidden: `confirmable` (whether the detector had
    arrival authority) is not recorded in the trajectory store, so a track that crossed but
    could not confirm is still included here. This over-counts relative to production.
    """
    import cv2

    db = sqlite3.connect(db_path)
    since = (f"strftime('%s','now','-{int(days)} day')" if days
             else "strftime('%s','now','start of day','localtime')")
    rows = db.execute(
        f"SELECT generation, track_id, ts, x, y FROM track_points "
        f"WHERE scene=? AND ts >= {since} ORDER BY ts", (scene,)).fetchall()
    tracks = defaultdict(list)
    for gen, tid, ts, x, y in rows:
        tracks[(gen, tid)].append((ts, float(x), float(y)))   # already the ground point

    inside = lambda px, py: cv2.pointPolygonTest(poly, (px, py), False) >= 0
    spans = []
    for (gen, tid), pts in tracks.items():
        if len(pts) < 2:
            continue
        flags = [inside(x, y) for _, x, y in pts]
        cross = next((i for i in range(1, len(flags)) if flags[i] and not flags[i - 1]), None)
        if cross is None:
            continue          # never promoted to an arrival -> never reaches the stitcher
        # adopt() fires AT the crossing, not at birth.
        spans.append((pts[cross][0], pts[-1][0], tid,
                      (pts[cross][1], pts[cross][2]), (pts[-1][1], pts[-1][2])))
    spans.sort()
    return spans


def run(spans: List[tuple], scene: str, gap: float, speed: float) -> dict:
    s = EpisodeStitcher(camera=scene, max_gap_s=gap, max_speed_px_s=speed)
    pending: List[tuple] = []
    for born, died, tid, p_born, p_die in spans:
        for d, t, ep, arrived, members in [x for x in pending if x[0] <= born]:
            s.retire(t, d, episode_id=ep, arrived_at=arrived, member_track_ids=members)
        pending = [x for x in pending if x[0] > born]
        dec = s.adopt(_Track(tid, born, p_born), born)
        pending.append((died, _Track(tid, born, p_die), dec.episode_id,
                        dec.arrived_at if dec.arrived_at is not None else born,
                        dec.member_track_ids or [tid]))
    return s.to_dict()


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=0,
                    help="look back N days (default 0 = today only)")
    args = ap.parse_args(argv)

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    any_data = False
    for rel, scene, calib in STORES:
        path = os.path.join(root, rel)
        calib_path = os.path.join(root, calib)
        if not os.path.exists(calib_path):
            print(f"\n=== {scene} ===\n  UNAVAILABLE: {calib} not found")
            continue
        if not os.path.exists(path):
            # Reported, never rendered as a zero: a missing store and an idle lens look
            # identical in the output otherwise.
            print(f"\n=== {scene} ===\n  UNAVAILABLE: {rel} not found")
            continue
        spans = spans_for(path, scene, args.days, _lot_polygon(calib_path))
        if not spans:
            print(f"\n=== {scene} ===\n  no tracks in window")
            continue
        any_data = True
        print(f"\n=== {scene}  ({len(spans)} tracks) ===")
        print(f"  {'gap':>5} {'speed':>6} | {'stitched':>8} {'ambiguous':>10} {'per-stitch':>11}")
        for speed in SPEEDS:
            for gap in GAPS:
                c = run(spans, scene, gap, speed)
                st, amb = c["stitched"], c["refused_ambiguous"]
                ratio = f"{amb / st:.2f}" if st else "inf"
                print(f"  {gap:5.0f} {speed:6.0f} | {st:8d} {amb:10d} {ratio:>11}")

    if not any_data:
        # A sweep that measured nothing must NOT exit 0 -- zero measured is not zero found.
        print("\nno trajectory data in the window; nothing was measured")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
