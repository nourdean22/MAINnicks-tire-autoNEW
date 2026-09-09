"""
Live V380 -> visitd proof-of-concept (2026-09-09, Nick's Tire SHOPSIGN).

Captures the V380 desktop app window off the screen (the app already holds the
PTZ camera's cloud stream, so this works from any network), finds vehicles with
MOG2 background subtraction, and feeds Frigate-shaped events into the SHIPPED
visitd VisitTracker so the deterministic visit state machine runs on the real
feed. No Docker, no model download, no purchases.

STATUS: proof of the visitd wiring on a live feed -- NOT production detection.
Honest limitations (see docs/research/2026-09-09-camera-vision-live-poc-execution-plan.md):
  * MOG2 detects motion, not vehicles: shadows, the V380 2/2 pane refresh, the
    OSD clock, trees and re-detected parked cars all fabricate blobs.
  * `stationary` fed to visitd is SYNTHESIZED from a coast timer; in production
    that short-circuits ARRIVAL_CANDIDATE->CONFIRMED_ARRIVAL in ~20s.
  * Arrival "evidence" here is a startup-grace + after-grace-appearance PROXY,
    not a calibrated entry-line crossing. It correctly excludes cars already
    parked at startup (PREEXISTING) but MOG2 churn still mislabels some
    re-detections as arrivals -- only a real detector + entry-line geometry fix
    that (the OpenVINO crossroad-1016 / YOLOX path, next).
  * SceneGuard suppresses frames where >33% of pixels change at once (PTZ pan /
    pane refresh) so global motion never mints cars.

Run:  py -3 camera-bridge/lab/live-v380-poc.py [seconds]
Deps (isolated venv recommended, do not touch a global cv2):
      pip install opencv-python-headless numpy mss
Writes proof.png / live_annotated.png / events.jsonl next to this script.
"""
import ctypes
import ctypes.wintypes as wt
import json
import os
import sys
import time
from collections import Counter

import cv2
import numpy as np
import mss

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))          # camera-bridge/ -> import visitd
from visitd.frigate_events import parse_event       # noqa: E402
from visitd.state_machine import VisitTracker, VisitPolicy, CameraSpec  # noqa: E402

RUN_SECONDS = float(sys.argv[1]) if len(sys.argv) > 1 else 75.0
WINDOW_TITLE = os.environ.get("V380_WINDOW_TITLE", "V380")
STARTUP_GRACE = 8.0
COAST_GRACE = 6.0        # hold a momentarily-lost car this long, then let it depart
SCENE_MOTION_FRAC = 0.33
MIN_AREA_FRAC = 0.006
user32 = ctypes.windll.user32
events_fp = open(os.path.join(HERE, "events.jsonl"), "w", encoding="ascii")


def window_rect():
    hwnd = user32.FindWindowW(None, WINDOW_TITLE)
    if not hwnd:
        return None, None
    user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    r = wt.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    if (r.right - r.left) < 500 or (r.bottom - r.top) < 360 or r.left < -1000:
        user32.MoveWindow(hwnd, 0, 0, 1280, 760, True)
        user32.GetWindowRect(hwnd, ctypes.byref(r))
    return hwnd, (r.left, r.top, r.right, r.bottom)


tracker = VisitTracker(VisitPolicy(), {"sign": CameraSpec(name="sign", arrival_zones=frozenset({"front_lot"}))})
mog = cv2.createBackgroundSubtractorMOG2(history=500, varThreshold=40, detectShadows=True)
tracks, next_id, seen_states = {}, 1, Counter()


def emit(ev_type, tr, tid, now, ended=False):
    """Fed only for ARRIVAL-EVIDENCED tracks; PREEXISTING never reaches visitd."""
    x1, y1, x2, y2 = tr["box"]
    after = {
        "id": f"sign-{tid}", "camera": "sign", "label": "car", "score": 0.8, "top_score": 0.8,
        "frame_time": now, "start_time": tr["start"], "end_time": now if ended else None,
        "box": [int(x1), int(y1), int(x2), int(y2)], "area": int((x2 - x1) * (y2 - y1)),
        "stationary": (now - tr["still_since"]) > 3.0, "motionless_count": int(max(0, now - tr["still_since"]) * 5),
        "current_zones": [] if ended else ["front_lot"], "entered_zones": ["front_lot"] if ev_type == "new" else [],
    }
    for em in tracker.handle_event(parse_event({"type": ev_type, "before": {}, "after": after})):
        rec = {"at": round(now, 2), "state": em.state, "visit": em.visit_id[:8], "seq": em.seq,
               "zone": em.zone, "evidence": tr.get("evidence")}
        events_fp.write(json.dumps(rec) + "\n"); events_fp.flush()
        print(f"  {em.state:<17} visit={em.visit_id[:8]} seq={em.seq} evidence={tr.get('evidence')}", flush=True)
        seen_states[em.state] += 1


def main():
    global next_id
    sct = mss.mss()
    hwnd, rect = window_rect()
    if not rect:
        print(f"window '{WINDOW_TITLE}' not found - open the V380 app."); return 1
    user32.SetWindowPos(hwnd, wt.HWND(-1), rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1], 0x0040)
    time.sleep(1.0)
    start, best, best_n, last_save, frames = time.time(), None, -1, 0.0, 0
    scene_motion_frames, prev_gray, preexisting, arrivals = 0, None, 0, 0
    print(f"watching {WINDOW_TITLE} {int(RUN_SECONDS)}s -- arrival REQUIRES evidence; parked/startup cars = PREEXISTING\n", flush=True)
    while time.time() - start < RUN_SECONDS:
        now = time.time()
        in_grace = (now - start) < STARTUP_GRACE
        hwnd, rect = window_rect()
        if not rect:
            break
        L, T, R, B = rect
        vx, vy, vb = L + int((R - L) * 0.20), T + 40, B - 55
        cw, ch = R - vx, vb - vy
        if cw < 60 or ch < 60:
            time.sleep(0.3); continue
        frame = np.ascontiguousarray(np.array(sct.grab({"left": vx, "top": vy, "width": cw, "height": ch}))[:, :, :3])
        h, w = frame.shape[:2]
        fa = h * w
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        camera_motion = False
        if prev_gray is not None and prev_gray.shape == gray.shape:
            if float(np.count_nonzero(cv2.absdiff(gray, prev_gray) > 25)) / fa > SCENE_MOTION_FRAC:
                camera_motion = True; scene_motion_frames += 1
        prev_gray = gray
        if camera_motion:
            for tr in tracks.values():
                tr["degraded"] = True
            cv2.putText(frame, "CAMERA MOTION - detection suppressed", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
            if now - last_save > 1.5:
                cv2.imwrite(os.path.join(HERE, "live_annotated.png"), frame); last_save = now
            frames += 1; time.sleep(0.25); continue
        fg = mog.apply(cv2.GaussianBlur(frame, (5, 5), 0))
        _, fg = cv2.threshold(fg, 200, 255, cv2.THRESH_BINARY)
        fg = cv2.dilate(cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)), np.ones((9, 9), np.uint8), 2)
        cnts, _ = cv2.findContours(fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        dets = []
        for c in cnts:
            if cv2.contourArea(c) < fa * MIN_AREA_FRAC:
                continue
            x, y, ww, hh = cv2.boundingRect(c)
            if not (0.6 <= ww / float(hh) <= 4.5) or hh < 24:
                continue
            dets.append(((x, y, x + ww, y + hh), (x + ww // 2, y + hh // 2)))
        used = set()
        for tid, tr in list(tracks.items()):
            pick, pd = None, 120
            for j, (box, c) in enumerate(dets):
                if j in used:
                    continue
                d = ((c[0] - tr["cx"]) ** 2 + (c[1] - tr["cy"]) ** 2) ** 0.5
                if d < pd:
                    pd, pick = d, j
            if pick is not None:
                box, c = dets[pick]; used.add(pick)
                if ((c[0] - tr["last_xy"][0]) ** 2 + (c[1] - tr["last_xy"][1]) ** 2) ** 0.5 > 14:
                    tr["still_since"] = now; tr["last_xy"] = c
                tr.update(cx=c[0], cy=c[1], box=box, seen=now, degraded=False)
                if tr["evidence"] != "preexisting":
                    emit("update", tr, tid, now)
            elif (now - tr["still_since"]) > 2.0 and (now - tr["seen"]) < COAST_GRACE:
                # Coasting holds a car that the detector momentarily lost. It was bounded
                # at 900 s, which is longer than any run: `now - seen > 3` could never be
                # reached while this branch still matched, so a vanished blob stayed in
                # front_lot emitting updates forever and the DEPARTING/LEFT path this
                # script advertises was unreachable.
                tr["coast"] = True
                if tr["evidence"] != "preexisting":
                    emit("update", tr, tid, now)
            elif (now - tr["seen"]) > 3.0:
                if tr["evidence"] != "preexisting":
                    emit("end", tr, tid, now, ended=True)
                tracks.pop(tid)
        for j, (box, c) in enumerate(dets):
            if j in used:
                continue
            tid = next_id; next_id += 1
            tr = dict(cx=c[0], cy=c[1], box=box, start=now, seen=now, still_since=now, last_xy=c, coast=False, degraded=False)
            if in_grace:
                tr["evidence"] = "preexisting"; preexisting += 1
            else:
                tr["evidence"] = "arrival"; arrivals += 1; emit("new", tr, tid, now)
            tracks[tid] = tr
        for em in tracker.tick(now):
            events_fp.write(json.dumps({"at": round(now, 2), "state": em.state, "visit": em.visit_id[:8], "seq": em.seq, "estimated": True}) + "\n")
            print(f"  {em.state:<17} visit={em.visit_id[:8]} (estimated)", flush=True); seen_states[em.state] += 1
        ann = frame.copy()
        for tid, tr in tracks.items():
            x1, y1, x2, y2 = tr["box"]
            pre = tr["evidence"] == "preexisting"
            col = (140, 140, 140) if pre else ((0, 165, 255) if tr["coast"] else (0, 220, 0))
            tag = "preexisting" if pre else ("arrival" + (" parked" if tr["coast"] else ""))
            cv2.rectangle(ann, (x1, y1), (x2, y2), col, 2)
            cv2.putText(ann, f"#{tid} {tag} {int(now-tr['start'])}s", (x1, max(15, y1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, col, 2)
        cn = sum(1 for v in tracker.open_visits() if v.state == "CONFIRMED_ARRIVAL")
        cv2.putText(ann, f"preexisting={preexisting} arrivals={arrivals} confirmed={cn}", (8, h - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
        if now - last_save > 1.5:
            cv2.imwrite(os.path.join(HERE, "live_annotated.png"), ann); last_save = now
        if len(tracks) >= best_n:
            best_n, best = len(tracks), ann.copy()
        frames += 1; time.sleep(0.25)
    if best is not None:
        cv2.imwrite(os.path.join(HERE, "proof.png"), best)
    events_fp.close()
    print(f"\n=== {frames} frames, {scene_motion_frames} suppressed for camera motion", flush=True)
    print(f"preexisting (occupancy, no visit) = {preexisting}; arrival-evidenced -> visits = {arrivals}", flush=True)
    print(f"visitd states: {dict(seen_states)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
