"""Put the V380 client back into the layout the producer is aimed at.

WHY THIS EXISTS. `v380-watchdog.ps1` can restart the client and un-minimise its window,
and both were necessary and neither was sufficient: a freshly launched V380 comes up as an
EMPTY 2x2 grid with no device loaded. The window is present, visible and renderable, so
every health check upstream reads green -- while the producer captures four grey boxes and
the lot goes uncounted. Measured on the shop PC 2026-09-16, straight after the watchdog's
own relaunch.

Restoring it is three operator gestures, in this order, and the order is load-bearing:

  1. DOUBLE-click the device in the sidebar. A single click only selects it; the double
     click is what loads it into a pane.
  2. Click the "1" layout button. This shows the SELECTED pane -- so doing it before step 1,
     or while a different pane is selected, cheerfully gives you a full-screen empty pane.
  3. Maximise. `ShowWindow(SW_MAXIMIZE)` and not the client's own expand control: expand
     puts it in FULLSCREEN, which hides the sidebar and toolbar, so a later pass has no
     controls left to click and the next restore cannot run.

SHOPSIGN is the target because it is the 3-in-1 covering the lot; its channel 2 is the
wide view the producer crops to. SHOPINSIDE watches the bays and cannot see arrivals.

Exits 0 when the view is good (already, or after repair), 1 when it could not be fixed --
so the watchdog can log a real outcome instead of assuming one.
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import sys
import time

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

from vision.capture import WgcWindowSource, largest_titled_window  # noqa: E402

user32 = ctypes.windll.user32
user32.SetProcessDPIAware()
SCREEN_W = user32.GetSystemMetrics(0)
SCREEN_H = user32.GetSystemMetrics(1)

_UP = ctypes.c_ulonglong if ctypes.sizeof(ctypes.c_void_p) == 8 else ctypes.c_ulong


class _MOUSE(ctypes.Structure):
    _fields_ = [("dx", wt.LONG), ("dy", wt.LONG), ("data", wt.DWORD),
                ("flags", wt.DWORD), ("time", wt.DWORD), ("extra", _UP)]


class _KEY(ctypes.Structure):
    _fields_ = [("vk", wt.WORD), ("scan", wt.WORD), ("flags", wt.DWORD),
                ("time", wt.DWORD), ("extra", _UP)]


class _INPUT(ctypes.Structure):
    class _U(ctypes.Union):
        _fields_ = [("mi", _MOUSE), ("ki", _KEY)]
    _anonymous_ = ("u",)
    _fields_ = [("type", wt.DWORD), ("u", _U)]


_MOVE_ABS, _DOWN, _UP_ = 0x8001, 0x0002, 0x0004

#: SHOPSIGN is a 3-in-1 (two fixed lenses plus a PTZ), so a usable view is exactly
#: three channels. Any other count is a layout the producer's --channel aim cannot
#: address, including the transient counts a half-painted window reports.
EXPECTED_CHANNELS = 3


def _key(vk: int) -> None:
    for flags in (0, 2):      # keydown, keyup
        inp = _INPUT(type=1)
        inp.ki = _KEY(vk, 0, flags, 0, 0)
        user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(_INPUT))
        time.sleep(0.05)


def _send(x: int, y: int, flags: int) -> None:
    nx = int(x * 65535 / (SCREEN_W - 1))
    ny = int(y * 65535 / (SCREEN_H - 1))
    inp = _INPUT(type=0, mi=_MOUSE(nx, ny, 0, flags, 0, 0))
    user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(_INPUT))


def click(x: int, y: int, double: bool = False) -> None:
    """A real SendInput click. Qt ignores PostMessage-synthesised clicks here (measured)."""
    _send(x, y, _MOVE_ABS)
    time.sleep(0.30)          # let Qt register the hover before the press
    for _ in range(2 if double else 1):
        _send(x, y, _DOWN)
        time.sleep(0.06)
        _send(x, y, _UP_)
        time.sleep(0.09)
    time.sleep(0.25)


def rect(hwnd: int) -> tuple[int, int, int, int]:
    r = wt.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    return r.left, r.top, r.right - r.left, r.bottom - r.top


#: A loaded view is far less uniform than an empty panel, and the gap is not close.
#: Measured on this box 2026-09-16 over the central half of the window:
#:   loaded and streaming        51.1, 58.0, 49.1
#:   empty 2x2 grid              5.7, 7.3
#:   empty fullscreen (navy)     9.9
#:   one pane still "loading..." 7.8
#: 25 sits in the middle of a 5x gap.
#:
#: This replaced a motion-based check (`detect_live_region`, which finds the video area by
#: what CHANGES between frames). That check is right for locating a pane and wrong for
#: this question: on a quiet lot with nothing moving it found no region, reported an empty
#: view, and this script "repaired" a perfectly good one -- clicking on a machine somebody
#: was working at. Content, not motion, is what distinguishes loaded from empty.
LOADED_STD_THRESHOLD = 25.0


def view_content_std(hwnd: int) -> float:
    """Uniformity of the window's central region. High means video, low means empty panel.

    Returns -1.0 when nothing could be captured at all, which is a different failure from
    "captured, and it is blank".
    """
    src = WgcWindowSource(window_hwnd=hwnd)
    try:
        src.open()
        frames = []
        # A few frames is enough: this measures CONTENT, not motion, so it does not need a
        # sample long enough for something in the scene to move. Taking the last frame
        # rather than the first avoids the partially-painted one a fresh capture can hand
        # back.
        for _ in range(40):
            f = src.read()
            if f is not None and f.image is not None:
                frames.append(f.image)
                if len(frames) >= 3:
                    break
            time.sleep(0.25)
    except Exception:
        return -1.0
    finally:
        try:
            src.close()
        except Exception:
            pass
    if not frames:
        return -1.0
    import numpy as np
    img = frames[-1]
    h, w = img.shape[:2]
    centre = img[int(h * 0.25):int(h * 0.80), int(w * 0.35):int(w * 0.85)]
    return float(np.std(centre))


def main() -> int:
    hwnd = largest_titled_window("V380")
    if not hwnd:
        print("FAIL no V380 window")
        return 1

    # Un-minimise FIRST. A minimised window reports the (-32000,-32000) 160x28 placement,
    # so every coordinate derived from its rect lands off-screen -- which is exactly how an
    # earlier attempt sent a click to (-30746,-31341) and silently did nothing.
    # Only un-minimise, and only when it IS minimised. Do NOT maximise on a healthy pass:
    # this runs every few minutes on a machine people are working at, and raising the
    # window each time would put a camera feed over their screen for no reason. WGC does
    # not care about z-order, only that the window is not minimised.
    if user32.IsIconic(hwnd) or not user32.IsWindowVisible(hwnd):
        user32.ShowWindow(hwnd, 4)     # SW_SHOWNOACTIVATE
        time.sleep(1.5)

    n = view_content_std(hwnd)
    if n >= LOADED_STD_THRESHOLD:
        print(f"OK view already loaded (content std {n:.1f}); no clicks sent")
        return 0

    # CONFIRM BEFORE TOUCHING ANYTHING. Shop staff use this machine, and every repair below
    # moves their mouse and takes their foreground window. A view that is merely
    # mid-repaint recovers on its own within a second or two, and acting on that transient
    # would yank the cursor out from under whoever is working. One re-check turns "looked
    # wrong once" into "is actually wrong".
    time.sleep(3.0)
    n2 = view_content_std(hwnd)
    if n2 >= LOADED_STD_THRESHOLD:
        print(f"OK view was mid-transition (std {n:.1f} then {n2:.1f}); no clicks sent")
        return 0

    print(f"ACTION view unusable (content std {n:.1f} then {n2:.1f}) -- restoring SHOPSIGN 1-camera layout")
    # Give the operator their cursor back afterwards; SendInput physically moves it.
    cursor = wt.POINT()
    user32.GetCursorPos(ctypes.byref(cursor))
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.8)

    # LEAVE FULLSCREEN FIRST. The client's own expand control goes fullscreen, which hides
    # the sidebar and the layout bar -- so every control this function clicks stops
    # existing, and the clicks land on video. Measured 2026-09-16: a restore attempt
    # against a fullscreen window reported "still empty" having hit nothing at all.
    # ESC is a no-op when it is not fullscreen, so this is safe to send unconditionally.
    _key(0x1B)
    time.sleep(2.0)

    # Maximised only for the repair itself: the controls have to be on screen to be
    # clicked, and a bigger window means a bigger video pane for the detector afterwards.
    user32.ShowWindow(hwnd, 3)         # SW_MAXIMIZE
    time.sleep(1.5)

    x, y, w, h = rect(hwnd)
    if w < 400 or h < 300:
        print(f"FAIL window is {w}x{h}; too small to hold the controls")
        return 1

    # Sidebar entries sit at a fixed offset: the panel is a constant width regardless of
    # how the window is sized, so these are window-relative constants, not fractions.
    click(x + 129, y + 219, double=True)      # SHOPSIGN
    time.sleep(6.0)                            # the device shows "loading..." before it paints
    click(x + w - 226, y + h - 20)             # the "1" layout button, offset from bottom-right

    # POLL, do not sleep a guess. A COLD client has to finish its cloud auto-login and
    # populate the device list before the sidebar entry is even clickable, and the stream
    # then takes seconds more to paint. A fixed wait was measured failing at ~12s after a
    # relaunch (channels=-1) and succeeding on the next pass a minute later -- same code,
    # same machine, only patience differed. Poll to ~45s so a cold start recovers on the
    # FIRST pass instead of the second.
    # POLL, do not sleep a guess, and be patient enough for a COLD client. A relaunched
    # V380 has to finish its cloud auto-login, reconnect the device, and paint the stream.
    # Measured on this box: 45s was not enough and reported FAIL on a restore that had in
    # fact worked -- the video appeared moments later. Launch to first painted frame ran
    # ~75-90s. 150s leaves margin and still fits the task's 10-minute limit.
    deadline = time.time() + 150.0
    n = -1.0
    while time.time() < deadline:
        n = view_content_std(hwnd)
        if n >= LOADED_STD_THRESHOLD:
            break
        time.sleep(3.0)

    # Hand the desktop back: put V380 at the BOTTOM of the z-order and return the cursor.
    # WGC reads the window's own composited surface, so being buried behind whatever the
    # staff are using costs the producer nothing -- this whole session was captured with a
    # browser sitting on top of it. HWND_BOTTOM (1), with NOSIZE|NOMOVE|NOACTIVATE.
    user32.SetWindowPos(hwnd, 1, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)
    user32.SetCursorPos(cursor.x, cursor.y)

    if n >= LOADED_STD_THRESHOLD:
        print(f"OK view restored (content std {n:.1f}); window sent to back, cursor returned")
        return 0
    print(f"FAIL view still empty after restore (content std {n:.1f})")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
