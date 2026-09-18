"""Click V380's "Reconnection" link, but ONLY when the disconnect banner is actually on screen.

WHY THIS EXISTS. The SHOPSIGN camera drops its cloud connection repeatedly -- measured
2026-09-18: 32 drops for `sign` and 22 for `right` across three hours, while both admin
badges read `healthy` to anyone who happened to look. The producer survives every drop and
keeps heartbeating; what it loses is the picture. Recovery has required a person to notice
and click a link inside a desktop app, which is why the lot went unwatched for most of a
morning three separate times.

WHY NOT JUST DRIVE THE UI. `bring-up.ps1` says driving the V380 UI is the most fragile thing
that could sit under the lot's geometry, and that is right about DRIVING it -- walking menus,
switching channels, resizing panes. This does something much narrower: it looks for one
specific failure banner and clicks the one link inside it. It never navigates, never changes
a setting, never touches a channel.

THE SAFETY PROPERTIES, in order of how much they matter:

  1. IT CLICKS ONLY WHAT IT CAN SEE. The click target is the matched location of the banner
     in THIS frame, not a remembered coordinate. If the window moves or resizes, the match
     moves with it or fails; it cannot click a stale position.
  2. IT REFUSES ON A WEAK MATCH. Below `--threshold` it does nothing and says so. A wrong
     click inside a camera app could change a setting, so "not sure" must mean "hands off".
  3. IT IS RATE LIMITED. One click per `--cooldown` seconds. A camera that is down for a
     structural reason must not be clicked forty times a minute.
  4. `--check` NEVER CLICKS. That is the mode the canary runs in.

THIS IS A WORKAROUND, NOT A FIX. The structural answer is the `ceshi.ini` SD-card unlock,
which turns the stream into an RTSP socket that our own code reconnects with no window, no
desktop session and nobody clicking anything. Until that lands, this keeps the lot watched.
"""
from __future__ import annotations

import argparse
import ctypes
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

#: The template was cut from a real disconnect frame at this width, so a captured frame is
#: scaled to match before matching. Template matching is not scale invariant: comparing a
#: 1400-wide template against a 2304-wide frame finds nothing, silently.
TEMPLATE_WIDTH = 1400

MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004


def find_banner(frame, template, threshold: float):
    """Return (score, centre_x, centre_y) in FRAME coordinates, or (score, None, None)."""
    import cv2

    scale = TEMPLATE_WIDTH / float(frame.shape[1])
    small = cv2.resize(frame, (TEMPLATE_WIDTH, max(1, int(frame.shape[0] * scale))),
                       interpolation=cv2.INTER_AREA)
    if small.shape[0] < template.shape[0] or small.shape[1] < template.shape[1]:
        return 0.0, None, None
    res = cv2.matchTemplate(small, template, cv2.TM_CCOEFF_NORMED)
    _, score, _, loc = cv2.minMaxLoc(res)
    if score < threshold:
        return score, None, None
    # Centre of the match, mapped back out of the scaled frame.
    cx = (loc[0] + template.shape[1] / 2) / scale
    cy = (loc[1] + template.shape[0] / 2) / scale
    return score, cx, cy


def window_rect(title: str):
    """(hwnd, x, y, w, h) of the named window on screen, or None."""
    import ctypes.wintypes as wt

    user32 = ctypes.windll.user32
    hwnd = user32.FindWindowW(None, title)
    if not hwnd:
        return None
    rect = wt.RECT()
    if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
        return None
    return hwnd, rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--template", default=str(Path(__file__).resolve().parent.parent
                                              / "assets" / "v380-disconnected.png"))
    ap.add_argument("--window-title", default="V380")
    ap.add_argument("--threshold", type=float, default=0.75)
    ap.add_argument("--check", action="store_true",
                    help="report what it would do and exit; never clicks")
    ap.add_argument("--image", default="",
                    help="match against this file instead of a live capture (for canaries)")
    ap.add_argument("--cooldown", type=float, default=120.0)
    args = ap.parse_args(argv)

    import cv2

    template = cv2.imread(args.template)
    if template is None:
        print(f"NO TEMPLATE at {args.template}")
        return 2

    if args.image:
        frame = cv2.imread(args.image)
        if frame is None:
            print(f"could not read {args.image}")
            return 2
        geom = None
    else:
        from vision.capture import WgcWindowSource
        src = WgcWindowSource(window_title=args.window_title)
        frame = None
        for _ in range(6):
            f = src.read()
            img = getattr(f, "image", None) if f is not None else None
            if img is not None:
                frame = img
                break
            time.sleep(0.2)
        if frame is None:
            print("NO CAPTURE - cannot tell whether the banner is showing")
            return 2
        geom = window_rect(args.window_title)

    score, cx, cy = find_banner(frame, template, args.threshold)
    if cx is None:
        print(f"NO BANNER (best match {score:.3f} < {args.threshold}) - nothing to do")
        return 0

    print(f"BANNER FOUND score={score:.3f} at {int(cx)},{int(cy)} in {frame.shape[1]}x{frame.shape[0]}")
    if args.check:
        print("--check: would click, but this mode never does")
        return 0
    if geom is None:
        print("matched an IMAGE, not the live window - refusing to click")
        return 0

    # A cooldown marker beside the template keeps state across scheduled runs without a
    # daemon. A camera down for a structural reason must not be clicked every cycle.
    marker = Path(args.template).with_suffix(".lastclick")
    if marker.exists() and (time.time() - marker.stat().st_mtime) < args.cooldown:
        left = args.cooldown - (time.time() - marker.stat().st_mtime)
        print(f"COOLDOWN - clicked {int(args.cooldown - left)}s ago, {int(left)}s remaining")
        return 0

    hwnd, wx, wy, ww, wh = geom
    sx = wx + cx * (ww / float(frame.shape[1]))
    sy = wy + cy * (wh / float(frame.shape[0]))
    user32 = ctypes.windll.user32
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.5)
    user32.SetCursorPos(int(sx), int(sy))
    time.sleep(0.2)
    user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    marker.write_text(str(time.time()), encoding="utf-8")
    print(f"CLICKED at screen {int(sx)},{int(sy)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
