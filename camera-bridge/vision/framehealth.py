"""
FrameHealth: a frozen or duplicated V380 pane must not masquerade as a live feed.

Pure functions of the frame stream -- no camera required, no cv2 required. Uses an
8x8 difference hash to catch two DIFFERENT failures, because they need different tests:
a FROZEN pane is a run of identical CONSECUTIVE frames, while a LOOPING pane cycles a
handful of cached frames and so never produces such a run. Consecutive-run detection
alone passed a 3-frame A/B/C loop as healthy, so `distinct` over the window catches
that. Plus FPS and frame age from timestamps.

Why this matters: the desktop-capture lane reads whatever the V380 app last painted.
If the app stalls, the last good frame keeps being captured forever and every
downstream component happily reports a stable, parked, healthy lot.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Optional

import numpy as np


def dhash(image: Optional[np.ndarray], size: int = 8) -> int:
    """64-bit difference hash; nearest-neighbour resize via numpy indexing."""
    if image is None:
        return 0
    img = image
    if img.ndim == 3:
        img = img[:, :, :3].mean(axis=2)
    h, w = img.shape[:2]
    if h < 2 or w < 2:
        return 0
    ys = np.linspace(0, h - 1, size).astype(int)
    xs = np.linspace(0, w - 1, size + 1).astype(int)
    small = img[np.ix_(ys, xs)]
    diff = small[:, 1:] > small[:, :-1]
    bits = 0
    for bit in diff.flatten():
        bits = (bits << 1) | int(bit)
    return bits


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def _thumb(image: np.ndarray, stride: int = 6) -> np.ndarray:
    """Sub-sampled grayscale thumbnail, cheap enough to keep a window of them."""
    if image.ndim == 3:
        return image[::stride, ::stride, :3].mean(axis=2).astype(np.float32)
    return image[::stride, ::stride].astype(np.float32)


def mean_abs_diff(a: Optional[np.ndarray], b: Optional[np.ndarray], stride: int = 6) -> float:
    """Mean absolute pixel difference between two frames, subsampled by `stride`.

    THIS IS THE FREEZE DISCRIMINATOR, and `dhash` cannot be. Measured on the live
    SHOPSIGN feed over 29 consecutive pairs of a motionless lot:

        byte-identical pairs : 0/29
        pairs with change    : 29/29
        MAD (full res)       : min 0.26, mean 0.97
        dhash8 hamming       : 0 for most pairs

    A live sensor always carries noise, and the V380 overlay clock ticks every second,
    so a LIVE-but-static lot never repeats a frame exactly. A STALLED capture hands back
    the same buffer, giving exactly 0.0. The margin is 0.26 vs 0.0 -- clean. An 8x8
    perceptual hash throws all of it away, which is why a quiet lot read as a dead feed.

    stride=6 is free: measured 0.319 vs 0.325 against the full-resolution value on the
    same pairs, at 1/36th the work.
    """
    if a is None or b is None or a.shape != b.shape:
        return float("inf")
    if a.ndim == 3:
        sa = a[::stride, ::stride, :3].mean(axis=2)
        sb = b[::stride, ::stride, :3].mean(axis=2)
    else:
        sa = a[::stride, ::stride]
        sb = b[::stride, ::stride]
    return float(np.abs(sa.astype(np.float32) - sb.astype(np.float32)).mean())


@dataclass
class HealthState:
    fps: float
    age: float          # seconds since the last frame, measured at `now`
    dup_ratio: float    # fraction of recent frames duplicating their predecessor
    frozen: bool        # a run of near-identical CONSECUTIVE frames long enough to distrust
    looping: bool       # the window cycles too few distinct frames to be a live scene
    distinct: int       # distinct frame hashes in the window
    ok: bool


class FrameHealth:
    def __init__(
        self,
        window: int = 20,
        dup_hamming: int = 4,
        freeze_run: int = 8,
        min_fps: float = 0.5,
        max_age: float = 5.0,
        min_distinct: int = 4,
        loop_min_repeats: int = 3,
        freeze_epsilon: float = 0.02,
    ) -> None:
        self.window = window
        self.dup_hamming = dup_hamming
        self.freeze_run = freeze_run
        #: A pair whose mean absolute pixel difference is at or below this is treated as
        #: the SAME BUFFER handed back twice. Live static footage measured >= 0.26 on the
        #: real feed, so 0.02 sits an order of magnitude below anything a live sensor
        #: produces while still catching an exact repeat.
        self.freeze_epsilon = freeze_epsilon
        self.min_fps = min_fps
        self.max_age = max_age
        self.min_distinct = min_distinct
        #: How many frames in the window must be pixel-exact replays of an earlier one
        #: before the capture is called LOOPING. One is not enough: `WgcWindowSource.read()`
        #: legitimately hands back the same `_latest` buffer twice when the capture
        #: callback is a few ms late, and a single such sample must not mark the camera
        #: unhealthy and re-arm the preexisting census (Codex P1 on #2250). A real loop
        #: replays buffers CONTINUOUSLY, so it accumulates repeats across the window.
        self.loop_min_repeats = loop_min_repeats
        self._ts: deque[float] = deque(maxlen=window)
        self._dups: deque[bool] = deque(maxlen=window)
        self._hashes: deque[int] = deque(maxlen=window)
        self._prev_hash: Optional[int] = None
        self._prev_image: Optional[np.ndarray] = None
        #: Sub-sampled thumbnails of recent frames. A genuine loop REPLAYS a buffer, so
        #: the incoming frame is pixel-identical to one ALREADY IN THE WINDOW -- not
        #: necessarily the previous one, which is why a consecutive-only check misses an
        #: A/B/C loop entirely. A merely static scene never repeats exactly.
        self._thumbs: deque[np.ndarray] = deque(maxlen=window)
        self._freeze_streak = 0
        self._repeats: deque[bool] = deque(maxlen=window)
        self.last_ts: Optional[float] = None

    def update(self, ts: float, image: Optional[np.ndarray]) -> None:
        self._ts.append(ts)
        self.last_ts = ts
        h = dhash(image) if image is not None else None

        # DUPLICATE-FOR-REPORTING (dup_ratio) stays perceptual: two frames that LOOK the
        # same are the interesting thing for a human reading the ratio.
        if h is not None and self._prev_hash is not None:
            self._dups.append(hamming(h, self._prev_hash) <= self.dup_hamming)
        else:
            self._dups.append(False)

        # FROZEN is a claim about the CAPTURE, not about the scene, so it is decided on
        # raw pixels. A motionless lot is a perfectly healthy thing to be looking at; a
        # repeated buffer is not. Deciding this on the 8x8 dhash conflated the two and
        # rejected 18 of 40 frames of a real quiet lot as "frozen" -- which would mark
        # the camera unhealthy, re-arm the preexisting census, and classify every car
        # that arrived afterwards as PREEXISTING. Arrivals would never fire.
        if image is not None and self._prev_image is not None:
            same_buffer = mean_abs_diff(image, self._prev_image) <= self.freeze_epsilon
            self._freeze_streak = self._freeze_streak + 1 if same_buffer else 0
        else:
            self._freeze_streak = 0

        if image is not None:
            thumb = _thumb(image)
            # An EXACT repeat of any frame already in the window is the loop signature --
            # counted per frame, so the verdict can require a RUN of them.
            # BYTE-IDENTICAL, not "within freeze_epsilon". `freeze_epsilon` is calibrated
            # on FULL FRAMES (live static footage measures >= 0.26 there), but a thumbnail
            # is a downscale, and downscaling AVERAGES SENSOR NOISE AWAY -- so live frames
            # routinely land under 0.02 once shrunk and were counted as replays.
            #
            # MEASURED on the real V380 feed, 24 frames of a motionless lot, 276 thumb
            # pairs: 4 pairs fell below freeze_epsilon (enough to trip loop_min_repeats=3
            # and declare a healthy camera LOOPING), while ZERO pairs were byte-identical.
            # Six consecutive probes of that same feed flipped between "live" and
            # "looping" purely on where sensor noise happened to land -- a coin flip on a
            # quiet lot, which is most of the night. The consequence is the one this file
            # keeps warning about: unhealthy -> census re-arm -> every later arrival
            # classified PREEXISTING -> arrivals never fire. The guard was causing the
            # failure it exists to prevent.
            #
            # A replayed buffer is the SAME BYTES handed back, so exact equality is its
            # true signature and needs no threshold at all.
            self._repeats.append(any(np.array_equal(thumb, t) for t in self._thumbs))
            self._thumbs.append(thumb)
            self._prev_image = image
        else:
            self._repeats.append(False)
        if h is not None:
            self._prev_hash = h
            self._hashes.append(h)

    def state(self, now: float) -> HealthState:
        ts = list(self._ts)
        if len(ts) >= 2 and (ts[-1] - ts[0]) > 0:
            fps = (len(ts) - 1) / (ts[-1] - ts[0])
        else:
            fps = 0.0
        age = (now - self.last_ts) if self.last_ts is not None else float("inf")
        dup_ratio = (sum(self._dups) / len(self._dups)) if self._dups else 0.0
        frozen = self._freeze_streak >= self.freeze_run
        distinct = len(set(self._hashes))
        # Only judged once the window has filled: a cold start legitimately shows few
        # distinct frames, and calling that a loop would be a false alarm.
        # LOOPING needs the same correction as FROZEN did. Judged on the perceptual hash
        # alone, a very static scene (night, IR, heavy compression) hashes to a single
        # value and reads as "the capture is cycling a handful of buffers" -- the same
        # false alarm, with the same consequence: unhealthy -> census re-arm -> every
        # later arrival classified PREEXISTING. A real loop REPLAYS BUFFERS, so it shows
        # pixel-exact duplicates; a static lot shows none. Require both.
        looping = (
            len(self._hashes) >= self.window
            and distinct < self.min_distinct
            and sum(self._repeats) >= self.loop_min_repeats
        )
        # FPS is likewise only judged once the window has filled.
        fps_ok = fps >= self.min_fps or len(ts) < self.window
        ok = (not frozen) and (not looping) and age <= self.max_age and fps_ok
        return HealthState(fps=fps, age=age, dup_ratio=dup_ratio, frozen=frozen,
                           looping=looping, distinct=distinct, ok=ok)
