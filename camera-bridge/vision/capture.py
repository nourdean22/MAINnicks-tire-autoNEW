"""
CaptureMux: camera transport is a replaceable detail, not an architecture.

Every source yields the same `Frame`, so the whole vision stack is identical whether
pixels arrive from native RTSP (after the HsAK unlock), from a local V380 protocol
bridge, from the V380 desktop window (works from ANY network because the app holds the
vendor's P2P cloud stream), or from a recording on disk. Getting native RTSP later
requires no rewrite downstream.

`CaptureMux` holds an ordered list of sources and hot-swaps to the next one when the
current source goes stale, so transport research never blocks the vision system.
"""
from __future__ import annotations

import glob
import os
import time
from typing import Iterator, Optional, Sequence

import numpy as np

from .frame import Frame


class CaptureSource:
    name: str = "source"

    def open(self) -> None:
        return None

    def read(self) -> Optional[Frame]:  # pragma: no cover - interface
        raise NotImplementedError

    def close(self) -> None:
        return None


class ReplaySource(CaptureSource):
    """Frames from memory or a directory of images. The backbone of offline testing.

    `fps` drives VIRTUAL timestamps so a replay can run far faster than real time
    while every downstream timer still sees a plausible clock.
    """

    def __init__(self, images: Optional[Sequence[np.ndarray]] = None,
                 directory: Optional[str] = None, fps: float = 4.0,
                 start_ts: float = 1_000_000.0, name: str = "replay") -> None:
        self.name = name
        self.fps = fps
        self.start_ts = start_ts
        self._seq = 0
        if images is not None:
            self._images = list(images)
        elif directory:
            import cv2
            paths = sorted(glob.glob(os.path.join(directory, "*.png"))
                           + glob.glob(os.path.join(directory, "*.jpg")))
            self._images = [cv2.imread(p) for p in paths]
        else:
            self._images = []

    def read(self) -> Optional[Frame]:
        if self._seq >= len(self._images):
            return None
        img = self._images[self._seq]
        # Recorded frames ARE the intended content by construction, so they are verified.
        # The pipeline fails CLOSED on a missing `window_verified`, which is right for a
        # screen-capture source that might be occluded and wrong to leave unset here.
        f = Frame(seq=self._seq, ts=self.start_ts + self._seq / self.fps,
                  source=self.name, image=img, meta={"window_verified": True})
        self._seq += 1
        return f

    def __iter__(self) -> Iterator[Frame]:
        while True:
            f = self.read()
            if f is None:
                return
            yield f


class SyntheticSource(CaptureSource):
    """Programmatic frames: a grey lot plus solid rectangles for vehicles.

    Lets startup/PTZ/entry/occlusion scenarios be built and replayed deterministically
    without waiting for a real car.
    """

    def __init__(self, boxes_per_frame: Sequence[Sequence[tuple]], size: tuple[int, int] = (640, 360),
                 fps: float = 4.0, start_ts: float = 1_000_000.0,
                 shift_per_frame: Sequence[tuple[int, int]] | None = None,
                 name: str = "synthetic") -> None:
        self.name = name
        self.w, self.h = size
        self.fps = fps
        self.start_ts = start_ts
        self._boxes = [list(b) for b in boxes_per_frame]
        self._shift = list(shift_per_frame or [])
        self._seq = 0

    def read(self) -> Optional[Frame]:
        if self._seq >= len(self._boxes):
            return None
        # A deterministic sawtooth on ALL channels: two different frames get different
        # dHashes, and a whole-frame roll changes grayscale enough to read as camera
        # motion (a single-channel pattern would be diluted by the mean-to-gray step).
        # Period 100, not 64: rolled by the 32 px step a period-64 pattern alternates
        # between just two images, which the frame-health loop detector correctly calls a
        # loop. Period 100 gives 25 distinct frames under the same step, while a shift of
        # 32 still moves every pixel by 32 levels -- well past the motion threshold.
        row = ((np.arange(self.w, dtype=np.int16) % 100) + 40).astype(np.uint8)
        img = np.repeat(np.repeat(row[None, :, None], self.h, axis=0), 3, axis=2)
        dx, dy = self._shift[self._seq] if self._seq < len(self._shift) else (0, 0)
        if dx or dy:
            img = np.roll(np.roll(img, dx, axis=1), dy, axis=0)
        for (x1, y1, x2, y2) in self._boxes[self._seq]:
            x1, y1 = max(0, int(x1)), max(0, int(y1))
            x2, y2 = min(self.w, int(x2)), min(self.h, int(y2))
            if x2 > x1 and y2 > y1:
                img[y1:y2, x1:x2] = 220
        f = Frame(seq=self._seq, ts=self.start_ts + self._seq / self.fps,
                  source=self.name, image=img, meta={"window_verified": True})
        self._seq += 1
        return f


class V380WindowSource(CaptureSource):
    """Captures the V380 desktop app window off-screen (Windows only).

    The app already holds the PTZ camera's vendor P2P cloud stream, so this lane works
    from ANY network. That is exactly why it is worth keeping even after native RTSP
    lands: it is the fallback that needs no shop LAN.

    Crops the video pane out of the app chrome. The fractions are conservative defaults
    for the app's 1/1 layout; override for a different layout.
    """

    WHY_RAISE = (
        "mss grabs SCREEN pixels in a rectangle, not a window's own back buffer. If the "
        "V380 window is not on top, this silently captures whatever overlaps it -- during "
        "development that was a browser, and the vehicle detector duly scored the browser "
        "screenshot as one whole-frame 'vehicle' at every confidence threshold. So the "
        "window is forced topmost, and every frame carries `window_verified` so a "
        "mis-capture is DETECTABLE instead of silent."
    )

    def __init__(self, window_title: str = "V380", pane_left_frac: float = 0.20,
                 top_px: int = 55, bottom_px: int = 78, name: str = "v380-window",
                 raise_window: bool = False, min_content_std: float = 12.0,
                 hwnd: Optional[int] = None) -> None:
        self.name = name
        self.window_title = window_title
        self.pane_left_frac = pane_left_frac
        self.top_px = top_px
        self.bottom_px = bottom_px
        # Default OFF: this runs on the operator's own desktop. Forcing the app topmost
        # (and, previously, resizing it) fights the person using the machine. On a
        # dedicated edge box, turn it on.
        self.raise_window = raise_window
        self.min_content_std = min_content_std
        self._seq = 0
        self._sct = None
        self._user32 = None
        self._hwnd = hwnd
        self._content_score = -1.0
        self.unverified_frames = 0

    def open(self) -> None:
        import ctypes
        import mss
        self._user32 = ctypes.windll.user32
        self._sct = mss.mss()  # must exist before find_window: it samples content
        hwnd = self.find_window()
        if hwnd is None:
            raise ConnectionError(
                f"no window titled {self.window_title!r} large enough to hold video; "
                f"candidates: {[t for _h, t in self.list_windows()]}"
            )
        if self._content_score < self.min_content_std:
            raise ConnectionError(
                f"window {self.window_title!r} (hwnd {hwnd}) looks blank "
                f"(pixel std {self._content_score:.1f} < {self.min_content_std}). "
                "Open the live view in the V380 app, or pass the right hwnd explicitly."
            )

    def find_window(self):
        """Pick the matching window that actually CONTAINS VIDEO.

        Two dead ends, both measured on this machine on 2026-09-09:
          * `FindWindowW` returns an arbitrary one of the several top-level windows the
            V380 app publishes under the same title -- there were two titled 'V380'.
          * "Pick the largest" then chose a blank white one, and the vehicle detector
            happily scored the blank window.

        So candidates are scored on their pixel standard deviation: a live video pane has
        a lot of it, a blank or solid-colour window has almost none. The winner is cached,
        because the choice must not flicker between frames.
        """
        import ctypes
        import ctypes.wintypes as wt

        if self._hwnd is not None and self._user32.IsWindow(self._hwnd):
            return self._hwnd

        best, best_score = None, -1.0
        for hwnd, _title in self.list_windows(match=self.window_title):
            r = wt.RECT()
            self._user32.GetWindowRect(hwnd, ctypes.byref(r))
            w, h = r.right - r.left, r.bottom - r.top
            if w < 320 or h < 240:
                continue
            try:
                sample = self._sct.grab({"left": r.left, "top": r.top,
                                         "width": w, "height": h})
                arr = np.array(sample)[:, :, :3]
                score = float(arr.std())
            except Exception:
                score = 0.0
            if score > best_score:
                best, best_score = hwnd, score

        self._content_score = best_score
        if best is not None and best_score >= self.min_content_std:
            self._hwnd = best
            return best
        # Nothing looked like video. Return the best candidate anyway so the caller can
        # report an honest "found the window, but it is blank" instead of "no window".
        self._hwnd = best
        return best

    def list_windows(self, match: Optional[str] = None) -> list:
        """Enumerate visible top-level windows as (hwnd, title)."""
        import ctypes
        import ctypes.wintypes as wt

        results: list = []
        proto = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)

        def cb(hwnd, _lparam):
            if not self._user32.IsWindowVisible(hwnd):
                return True
            n = self._user32.GetWindowTextLengthW(hwnd)
            if n <= 0:
                return True
            buf = ctypes.create_unicode_buffer(n + 1)
            self._user32.GetWindowTextW(hwnd, buf, n + 1)
            title = buf.value
            if match is None or match.lower() in title.lower():
                results.append((hwnd, title))
            return True

        self._user32.EnumWindows(proto(cb), 0)
        return results

    def _rect(self):
        """Read the window's geometry. Deliberately does NOT move, resize or restore it.

        An earlier version called ShowWindow/MoveWindow to force a workable size; on a
        machine the operator is using, that pops up and rearranges their app. If the
        window is too small or off-screen, that is reported, not silently corrected.
        """
        import ctypes
        import ctypes.wintypes as wt
        hwnd = self.find_window()
        if not hwnd:
            return None, None
        if self.raise_window:
            # HWND_TOPMOST | SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
            self._user32.SetWindowPos(hwnd, wt.HWND(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)
        r = wt.RECT()
        self._user32.GetWindowRect(hwnd, ctypes.byref(r))
        return hwnd, (r.left, r.top, r.right, r.bottom)

    def _verify(self, hwnd, x: int, y: int) -> bool:
        """Is the target window really the thing painted at this point?"""
        import ctypes.wintypes as wt
        pt = wt.POINT(x, y)
        top = self._user32.WindowFromPoint(pt)
        if not top:
            return False
        root = self._user32.GetAncestor(top, 2)  # GA_ROOT
        return root == hwnd or top == hwnd

    def read(self) -> Optional[Frame]:
        if self._sct is None:
            self.open()
        hwnd, rect = self._rect()
        if not rect:
            return None
        left, top, right, bottom = rect
        vx = left + int((right - left) * self.pane_left_frac)
        vy = top + self.top_px
        vb = bottom - self.bottom_px
        cw, ch = right - vx, vb - vy
        if cw < 60 or ch < 60:
            return None
        verified = self._verify(hwnd, vx + cw // 2, vy + ch // 2)
        if not verified:
            self.unverified_frames += 1
        grab = self._sct.grab({"left": vx, "top": vy, "width": cw, "height": ch})
        img = np.ascontiguousarray(np.array(grab)[:, :, :3])
        f = Frame(seq=self._seq, ts=time.time(), source=self.name, image=img,
                  meta={"window_verified": verified, "hwnd": int(hwnd)})
        self._seq += 1
        return f


def restore_if_minimized(hwnd: int) -> bool:
    """Un-minimise a window WITHOUT stealing focus. Returns True if it was minimised.

    A minimised window renders no surface, so Windows Graphics Capture delivers nothing
    and the producer dies with "no frame within 5s". This was hit twice on 2026-09-09
    against the live V380 app: on the shop machine anyone who clicks minimise silently
    stops the lot being watched, and nothing in the failure text says which of the many
    causes it was.

    SW_SHOWNOACTIVATE (4), not SW_RESTORE (9): the operator may be using the machine, and
    a monitoring producer has no business stealing their foreground window.
    """
    try:
        import ctypes

        user32 = ctypes.windll.user32
        if not user32.IsWindow(hwnd):
            return False
        if not user32.IsIconic(hwnd):
            return False
        user32.ShowWindow(hwnd, 4)
        time.sleep(0.6)
        return True
    except Exception:
        return False



def find_windows_titled(title: str) -> list[int]:
    """Every top-level window whose title contains `title`, minimised ones included.

    `IsWindowVisible` is true for a minimised window (WS_VISIBLE stays set), so this
    enumeration is exactly what a restore path needs: the documented `run_live` default
    passes no `--hwnd`, and a restore keyed on a handle nobody supplied can never fire.
    Returns handles in Z-order (foreground first).
    """
    try:
        import ctypes
        import ctypes.wintypes as wt
    except Exception:
        return []
    user32 = ctypes.windll.user32
    proto = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    found: list[int] = []
    needle = title.lower()

    def cb(hwnd, _lparam):
        if not user32.IsWindowVisible(hwnd):
            return True
        n = user32.GetWindowTextLengthW(hwnd)
        if n <= 0:
            return True
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(hwnd, buf, n + 1)
        if needle in buf.value.lower():
            found.append(int(hwnd))
        return True

    user32.EnumWindows(proto(cb), 0)
    return found


def restore_minimized_titled(title: str) -> int:
    """Un-minimise every window matching `title`; returns how many were minimised.

    The V380 client publishes several top-level windows under one title, and which of
    them holds the video pane is decided elsewhere by pixel content. For a RESTORE that
    choice does not matter: un-minimising a blank sibling is harmless (no focus change),
    while leaving the real one minimised keeps the lot unwatched.
    """
    return sum(1 for h in find_windows_titled(title) if restore_if_minimized(h))

class WgcWindowSource(CaptureSource):
    """Windows Graphics Capture of one window. The best desktop lane, measured.

    Why this and not the alternatives (all three measured on this machine, 2026-09-09,
    against the V380 app):

      * `mss` screen-region grab -- captures SCREEN pixels, so anything overlapping the
        window is captured instead. With the operator's editor in front it silently
        returned a browser screenshot, which the vehicle detector scored as one
        whole-frame "vehicle" at every confidence threshold. Only correct if the window
        is raised, which fights the person using the machine.
      * `PrintWindow` (incl. PW_RENDERFULLCONTENT) -- returns the app chrome but a STALE
        video surface: over 10 samples only ~399 pixels ever changed (the burned-in
        clock), never the scene. Hardware-accelerated video is not re-rendered into the
        GDI DC. Rejected with evidence.
      * Windows Graphics Capture -- composited output of a specific window, correct even
        when fully occluded, no raising, no resizing. Measured 180 frames in 13.9 s
        (12.9 fps) at 1280x720 from the occluded V380 window.

    `crop_frac` isolates the video pane from the app chrome as fractions of the window,
    so it survives the operator resizing the window. `SHOPSIGN_MAIN_PANE` is the measured
    crop for the V380 app's large single-camera pane.
    """

    # Measured against the V380 client at 1280x720: main pane x 427..1105, y 255..636.
    SHOPSIGN_MAIN_PANE = (427 / 1280, 255 / 720, 1105 / 1280, 636 / 720)

    def __init__(self, window_hwnd: Optional[int] = None, window_title: Optional[str] = "V380",
                 crop_frac: Optional[tuple[float, float, float, float]] = None,
                 name: str = "v380-wgc") -> None:
        self.name = name
        self.window_hwnd = window_hwnd
        self.window_title = window_title
        self.crop_frac = crop_frac
        #: Set by `set_canonical()`. A WARP, not a crop -- see that method for why.
        self._canonical = None
        self._scene_meta: dict = {}
        self._seq = 0
        self._latest = None
        self._latest_ts = 0.0
        self._lock = None
        self._ctrl = None
        self._delivered = 0
        #: Frames older than this mean the target stopped rendering -- usually minimised.
        self.stale_restore_after = 2.0
        #: Never attempt a restore more often than this.
        self.restore_cooldown = 10.0
        self._last_restore_attempt = 0.0
        #: How many times this source had to un-minimise its target to keep working.
        #: Non-zero means somebody is minimising the camera app on the shop machine --
        #: worth surfacing as producer health rather than silently self-healing forever.
        self.restores = 0

    def _restore_target(self) -> bool:
        """Un-minimise whatever this source is capturing. True if anything was minimised.

        Keyed on the handle when one was given, otherwise on the title -- the default
        `run_live` invocation gives no handle, and a restore that only worked with one was
        dead code on exactly the path operators use (Codex P1 on #2250).
        """
        if self.window_hwnd is not None:
            hit = restore_if_minimized(int(self.window_hwnd))
        elif self.window_title:
            hit = restore_minimized_titled(self.window_title) > 0
        else:
            hit = False
        if hit:
            self.restores += 1
        return hit

    def open(self) -> None:
        import threading
        from windows_capture import WindowsCapture

        self._lock = threading.Lock()
        kwargs = {"cursor_capture": False, "draw_border": False}
        if self.window_hwnd is not None:
            kwargs["window_hwnd"] = int(self.window_hwnd)
        else:
            kwargs["window_name"] = self.window_title
        cap = WindowsCapture(**kwargs)

        @cap.event
        def on_frame_arrived(frame, control):  # noqa: ANN001 - library callback
            buf = frame.frame_buffer[:, :, :3].copy()
            with self._lock:
                self._latest = buf
                self._latest_ts = time.time()
                self._delivered += 1

        @cap.event
        def on_closed():  # noqa: ANN202 - library callback
            with self._lock:
                self._latest = None

        self._ctrl = cap.start_free_threaded()
        deadline = time.time() + 5.0
        while time.time() < deadline:
            with self._lock:
                if self._latest is not None:
                    return
            time.sleep(0.05)

        # No frame. Before giving up, check the one cause that is both common and
        # trivially fixable: the window is minimised, so it renders nothing at all.
        if self._restore_target():
            deadline = time.time() + 5.0
            while time.time() < deadline:
                with self._lock:
                    if self._latest is not None:
                        return
                time.sleep(0.05)
            raise ConnectionError(
                f"Windows Graphics Capture produced no frame for {self.window_hwnd} "
                f"even after un-minimising it -- the app may be closed or on another desk"
            )
        raise ConnectionError(
            f"Windows Graphics Capture produced no frame for "
            f"{self.window_hwnd or self.window_title!r} within 5s "
            f"(window was NOT minimised, so this is not the minimise case)"
        )

    def read(self) -> Optional[Frame]:
        if self._ctrl is None:
            self.open()

        # SELF-HEAL DURING OPERATION, not only at startup.
        #
        # Windows Graphics Capture stops delivering the moment its target is minimised,
        # but `_latest` still holds the last frame -- so `read()` keeps handing back the
        # SAME picture with a stale timestamp, and the pipeline correctly calls it frozen
        # and suppresses everything. Measured 2026-09-09 on a 5-minute live run: the
        # operator minimised the V380 window part-way through and 401 of 873 frames were
        # suppressed as unhealthy. The detection was right; the producer simply sat there.
        #
        # Restoring only in `open()` cannot help, because `open()` runs once. A cooldown
        # keeps this from thrashing if the window is genuinely gone.
        now = time.time()
        with self._lock:
            stale_for = now - (self._latest_ts or now)
        if (stale_for > self.stale_restore_after
                and now - self._last_restore_attempt > self.restore_cooldown):
            self._last_restore_attempt = now
            if self._restore_target():
                deadline = time.time() + 2.0
                while time.time() < deadline:
                    with self._lock:
                        if (self._latest_ts or 0) > now:
                            break
                    time.sleep(0.05)

        with self._lock:
            img = None if self._latest is None else self._latest.copy()
            ts = self._latest_ts
        if img is None:
            return None
        if self._canonical is not None:
            import cv2

            inverse, size = self._canonical
            img = cv2.warpPerspective(img, inverse, size, flags=cv2.INTER_LINEAR)
        elif self.crop_frac:
            h, w = img.shape[:2]
            fx1, fy1, fx2, fy2 = self.crop_frac
            img = np.ascontiguousarray(
                img[int(fy1 * h): int(fy2 * h), int(fx1 * w): int(fx2 * w)]
            )
        meta = {"window_verified": True, "delivered": self._delivered}
        # The scene identity and layout epoch ride WITH the pixels, deliberately. A frame
        # that cannot say which camera it came from and under which layout is a frame a
        # downstream consumer has to guess about, and every guess here is the silent
        # mis-binding this whole path exists to remove.
        meta.update(self._scene_meta)
        f = Frame(seq=self._seq, ts=ts or time.time(), source=self.name, image=img,
                  meta=meta)
        self._seq += 1
        return f

    def read_raw(self):
        """The latest frame WITHOUT the crop or the canonical warp.

        Re-locating a scene needs the whole window, and once `set_canonical` is applied
        `read()` returns only the warped pane -- so revalidation from `read()` would search
        for the scene inside a picture of the scene and always "find" it at the origin. This
        is the only way back to the pixels the locator actually needs.
        """
        with self._lock:
            return None if self._latest is None else self._latest.copy()

    def set_canonical(self, homography, size, scene_id: str, layout_epoch: int) -> None:
        """Deliver every frame already warped into the calibration's own coordinates.

        A WARP, NOT A CROP, and the difference is the whole point. Cropping to the located
        quad still hands the detector pixels whose SCALE depends on how big the operator
        made the pane: a lot polygon drawn when the pane was 677x381 describes different
        ground once the same pane is 338x190, and nothing reports an error -- the polygon is
        still a valid polygon, just over the wrong tarmac. Warping through the inverse
        homography puts the pixels back into the frame the calibration was drawn in, so the
        pane's size and position stop being inputs to any geometric decision downstream.

        `crop_frac` is cleared because a warp subsumes it: the homography is expressed in
        FULL-WINDOW coordinates, so cropping first would invalidate it.
        """
        import numpy as _np

        self.crop_frac = None
        self._canonical = (_np.linalg.inv(_np.asarray(homography, dtype=_np.float64)),
                           (int(size[0]), int(size[1])))
        self._scene_meta = {"sceneId": scene_id, "layoutEpoch": int(layout_epoch)}
        #: Read by `source_generation`. A layout change means observations before and after
        #: are not in the same coordinate system, so it must break a track path exactly as a
        #: lane failover or a window restore does.
        self.layout_epoch = int(layout_epoch)

    def close(self) -> None:
        if self._ctrl is not None:
            try:
                self._ctrl.stop()
            except Exception:
                pass
            self._ctrl = None


class RtspSource(CaptureSource):
    """Native RTSP via OpenCV/FFmpeg. Ready for the moment the HsAK unlock opens 554.

    Targets documented by Macro-video for manual NVR connect: ONVIF port 8899, H.264,
    TCP, path `/live/ch00_1` (main) and `/live/ch00_0`. Unverified on Nick's exact
    firmware -- `open()` raising is the honest outcome until a camera answers.
    """

    def __init__(self, url: str, name: str = "rtsp") -> None:
        self.name = name
        self.url = url
        self._cap = None
        self._seq = 0

    def open(self) -> None:
        import cv2
        os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")
        self._cap = cv2.VideoCapture(self.url)
        if not self._cap.isOpened():
            raise ConnectionError(f"RTSP did not open: {self.url}")

    def read(self) -> Optional[Frame]:
        if self._cap is None:
            self.open()
        ok, img = self._cap.read()
        if not ok:
            return None
        f = Frame(seq=self._seq, ts=time.time(), source=self.name, image=img)
        self._seq += 1
        return f

    def close(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None


class CaptureMux(CaptureSource):
    """Ordered sources; falls through to the next when the current one goes quiet."""

    def __init__(self, sources: Sequence[CaptureSource], max_consecutive_fail: int = 3,
                 name: str = "mux") -> None:
        self.name = name
        self.sources = list(sources)
        self.max_consecutive_fail = max_consecutive_fail
        self.index = 0
        self.fails = 0
        self.swaps = 0

    @property
    def active(self) -> Optional[CaptureSource]:
        return self.sources[self.index] if self.index < len(self.sources) else None

    def read(self) -> Optional[Frame]:
        while self.index < len(self.sources):
            src = self.sources[self.index]
            try:
                f = src.read()
            except Exception:
                f = None
            if f is not None:
                self.fails = 0
                return f
            self.fails += 1
            if self.fails >= self.max_consecutive_fail:
                self.index += 1
                self.fails = 0
                self.swaps += 1
                continue
            return None
        return None
