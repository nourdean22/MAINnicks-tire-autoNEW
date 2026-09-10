"""Find the LIVE VIDEO region of a camera-app window, whatever its layout or size.

WHY THIS REPLACES A CONSTANT. `WgcWindowSource.SHOPSIGN_MAIN_PANE` is a fraction tuple
measured once against the V380 client at 1280x720. It is correct for exactly that window
size and exactly that layout, and it is WRONG, silently, the moment the operator resizes
the window, switches from 1-up to 4-up, or the app ships a different chrome. Nothing fails
loudly: the producer simply analyses a rectangle that is part sidebar and part video, the
detector scores app furniture, and the health signal degrades in a way no test can see.

THE DISCRIMINATOR, and it is the same one that fixed the loop guard: application chrome is
byte-identical frame to frame, and live video NEVER is. Not "changes a lot" -- a motionless
night scene barely changes at all -- but "changes at all". Accumulate absolute inter-frame
difference over a short window and every pixel that ever moved is video; every pixel that
never moved is chrome.

WHAT IT CANNOT DO, stated rather than discovered later. Adjacent panes with no static
gutter between them cannot be separated by this signal, because there is no chrome between
them to find. That is not a gap to paper over: a capture region holding two stacked camera
panes is a region the producer must not analyse as one camera, so the aspect check below
turns that case into a loud WARN instead of a silent wrong answer.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Sequence

import numpy as np

#: A V380 camera pane is 16:9. A detected region far from this is not one camera: it is
#: several stacked panes, or a region clipped by the window edge.
NATIVE_ASPECT = 16.0 / 9.0
#: How far from 16:9 a region may sit before it is called suspect. 0.25 accepts the letter-
#: boxing and border trim a real pane shows; the observed stacked-pane case was 1.19 against
#: 1.78, a 33% miss, comfortably outside.
ASPECT_TOLERANCE = 0.25


@dataclass(frozen=True)
class LiveRegion:
    """The bounding box of everything in the window that is live video."""

    x: int
    y: int
    w: int
    h: int
    #: Fraction of the box that actually varied. A true pane fills its box.
    fill: float
    #: Fraction of the WHOLE window that is live video.
    live_fraction: float
    #: Interior rows/columns that are entirely static -- the chrome BETWEEN panes. A single
    #: pane has none; any grid layout has them by construction.
    gutters: int = 0

    @property
    def aspect(self) -> float:
        return self.w / max(1, self.h)

    @property
    def looks_like_one_camera(self) -> bool:
        """Is this plausibly a SINGLE camera pane, rather than several?

        TWO signals, because neither is sufficient alone and a test proved it.

        Aspect catches panes STACKED with no gutter -- the observed live case, 1.19 against
        a native 1.78. But aspect ALONE is blind to a grid: a 2x2 of 16:9 tiles is itself
        16:9, so a four-up layout passes an aspect check perfectly. That is not a corner
        case, it is the app's own `4` button.

        Gutters catch exactly what aspect cannot. A grid is separated by app chrome, and
        chrome is byte-identical, so an interior row or column that never varied is a
        gutter. A single pane has none, because video varies everywhere.
        """
        aspect_ok = abs(self.aspect - NATIVE_ASPECT) / NATIVE_ASPECT <= ASPECT_TOLERANCE
        return aspect_ok and self.gutters == 0

    def as_crop_frac(self, width: int, height: int) -> tuple[float, float, float, float]:
        """The `crop_frac` tuple `WgcWindowSource` takes, so this can drive the capture."""
        return (self.x / width, self.y / height,
                (self.x + self.w) / width, (self.y + self.h) / height)


def detect_live_region(frames: Sequence[np.ndarray]) -> Optional[LiveRegion]:
    """Bounding box of every pixel that changed at least once across `frames`.

    Returns None when nothing moved at all -- a frozen capture, or a window showing no
    video. That is deliberately not an exception: the caller reports it as a finding.
    """
    usable: List[np.ndarray] = [f for f in frames if f is not None]
    if len(usable) < 3:
        return None

    import cv2  # imported here so the module is importable without opencv

    grey = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32) for f in usable]
    acc = np.zeros_like(grey[0])
    for i in range(1, len(grey)):
        acc += np.abs(grey[i] - grey[i - 1])

    height, width = acc.shape
    live = (acc > 0).astype(np.uint8)
    live_fraction = float(live.mean())
    if live_fraction <= 0.001:
        return None

    # Close small holes: a dark, flat patch inside a real pane can be byte-identical for
    # the whole window without the pane being static.
    closed = cv2.morphologyEx(live, cv2.MORPH_CLOSE, np.ones((21, 21), np.uint8))
    ys, xs = np.nonzero(closed)
    if ys.size == 0:
        return None
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    box = closed[y0:y1 + 1, x0:x1 + 1]

    # GUTTERS ARE MEASURED ON THE RAW MASK, never the closed one. The 21px close exists to
    # fill holes so the bounding box is right, and it happily bridges a 20px gutter -- so
    # measuring gutters after closing reports zero for every grid. A test on a synthetic
    # 2x2 caught exactly that.
    #
    # INTERIOR only: the outer rows/columns of a real pane can be static (letterboxing, a
    # border the app draws), and counting those would call every single pane a grid.
    raw_box = live[y0:y1 + 1, x0:x1 + 1]
    margin = max(2, min(raw_box.shape) // 20)
    inner = raw_box[margin:raw_box.shape[0] - margin, margin:raw_box.shape[1] - margin]
    gutters = 0
    if inner.size:
        gutters = int((inner.mean(axis=1) < 0.02).sum() + (inner.mean(axis=0) < 0.02).sum())

    return LiveRegion(x=x0, y=y0, w=x1 - x0 + 1, h=y1 - y0 + 1,
                      fill=float(box.mean()), live_fraction=live_fraction, gutters=gutters)


def _tilings(region_w: int, region_h: int, tolerance: float = 0.06) -> List[List[int]]:
    """Every sequence of row widths (channels-per-row) whose heights sum to the region.

    A row of `n` channels side by side has height `w / (n * 16/9)`, so a layout is just an
    ordered list of `n` values. Enumerating them is cheap and avoids the greedy mistake of
    always taking the full-width row first -- which produced exactly the right SHAPES for
    the live window in exactly the wrong ORDER.
    """
    results: List[List[int]] = []

    def walk(prefix: List[int], used: float) -> None:
        if len(prefix) > 4:
            return
        if abs(used - region_h) / region_h <= tolerance and prefix:
            results.append(list(prefix))
            return
        if used > region_h * (1 + tolerance):
            return
        for n in (1, 2, 3, 4):
            h = region_w / (n * NATIVE_ASPECT)
            if h < 8:
                continue
            walk(prefix + [n], used + h)

    walk([], 0.0)
    return results


def split_into_channels(region: "LiveRegion", frame=None,
                        tolerance: float = 0.18) -> List[tuple]:
    """Split a merged live region into the 16:9 CHANNELS it is made of.

    WHY THIS IS NEEDED. The SHOPSIGN device is a 3-in-1: two fixed lenses covering the left
    and right approaches, and a PTZ. The app draws all three with NO static gutter between
    them, so `detect_live_region` correctly returns one tall box (aspect 1.19) and no pixel
    signal can separate them. What CAN separate them is that every channel is 16:9.

    Measured on the live window, the three sub-views are 339x187, 338x187 and 677x381 --
    aspects 1.81, 1.81, 1.78.

    `frame` is one captured image. When given, candidate layouts are SCORED by how much
    horizontal edge energy sits on their internal row boundaries, because a real boundary
    between two camera views is a sharp discontinuity. Without it the first arrangement is
    returned, which is a guess and is documented as one.

    An empty list means the region is not explicable as a tiling of 16:9 channels. That is
    the honest answer, not a reason to invent a split.
    """
    if abs(region.aspect - NATIVE_ASPECT) / NATIVE_ASPECT <= tolerance:
        return [(region.x, region.y, region.w, region.h)]

    candidates = _tilings(region.w, region.h)
    if not candidates:
        return []

    def boxes_for(rows: List[int]) -> List[tuple]:
        out: List[tuple] = []
        y = region.y
        for n in rows:
            h = int(round(region.w / (n * NATIVE_ASPECT)))
            cell = region.w // n
            for i in range(n):
                out.append((region.x + i * cell, y, cell, h))
            y += h
        return out

    if frame is None or len(candidates) == 1:
        return boxes_for(candidates[0])

    import cv2

    grey = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).astype(np.float32)
    # Horizontal edge energy per row: a boundary between two different camera views is a
    # strong, full-width discontinuity.
    edge = np.abs(np.diff(grey, axis=0)).mean(axis=1)

    # MEAN per boundary, never the sum. Summing rewards layouts simply for HAVING more
    # boundaries, so a 3x3 grid beat the true two-row layout on the live window purely by
    # having more edges to add up -- it returned eleven channels for a three-channel
    # device. The question is "does each proposed boundary land on a real discontinuity",
    # which is an average, and ties go to the SIMPLER layout.
    best, best_score, best_len = None, -1.0, 10 ** 6
    for rows in candidates:
        y = region.y
        scores = []
        for n in rows[:-1]:                      # internal boundaries only
            y += int(round(region.w / (n * NATIVE_ASPECT)))
            lo, hi = max(0, y - 2), min(len(edge), y + 3)
            if lo < hi:
                scores.append(float(edge[lo:hi].max()))
        score = float(np.mean(scores)) if scores else 0.0
        count = sum(rows)
        if score > best_score * 1.05 or (score > best_score * 0.95 and count < best_len):
            best, best_score, best_len = rows, max(score, best_score), count
    return boxes_for(best or candidates[0])


#: Whole-frame displacement, in pixels, above which a view is moving rather than still.
#: MEASURED: a stationary V380 channel shows 0.01-0.02 px of phase-correlation drift, so
#: this sits ~100x above the noise floor of a camera that is not moving.
PAN_THRESHOLD_PX = 2.0


def classify_motion(frames: Sequence[np.ndarray]) -> tuple[str, float]:
    """FIXED or PTZ, from whole-frame displacement. Returns `(verdict, max_shift_px)`.

    WHY THIS MATTERS MORE THAN IT LOOKS. A PTZ invalidates its own calibration every time
    it pans: a lot polygon drawn on it points at different ground the moment it moves, and
    NOTHING fails loudly -- arrivals are simply computed against the wrong geometry. So a
    PTZ channel must never carry calibrated arrival logic, and the only safe way to know
    which channel is a PTZ is to watch whether its whole frame moves.

    Phase correlation is the right instrument because it separates the two cases that look
    similar in a difference image: a car crossing a FIXED frame moves some pixels, while a
    PAN moves ALL of them together. The first has near-zero global displacement; the second
    does not.

    `unknown` is returned when there are too few frames to judge -- never a guess, because
    guessing FIXED on a PTZ is the failure this exists to prevent.
    """
    usable = [f for f in frames if f is not None]
    if len(usable) < 4:
        return "unknown", 0.0

    import cv2

    grey = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32) for f in usable]
    worst = 0.0
    for i in range(1, len(grey)):
        (dx, dy), _ = cv2.phaseCorrelate(grey[i - 1], grey[i])
        worst = max(worst, float((dx * dx + dy * dy) ** 0.5))
    return ("ptz" if worst > PAN_THRESHOLD_PX else "fixed"), worst


class ChannelNotFound(RuntimeError):
    """Raised when a requested channel cannot be resolved. NEVER falls back to a guess."""


def resolve_channel(frames: Sequence[np.ndarray], index: int) -> tuple:
    """Locate channel `index` of a multi-lens device. Returns `((x, y, w, h), kind, shift)`.

    WHY THIS FAILS CLOSED. The whole point of resolving a channel is that the producer then
    analyses THAT rectangle and nothing else. A resolver that guessed on a bad frame would
    point the detector at the wrong lens and every arrival after it would be attributed to
    the wrong side of the shop -- silently, because a wrong rectangle still yields healthy
    frames, healthy heartbeats and confident detections. So every failure here raises.

    `kind` is `fixed` or `ptz` from `classify_motion`, and the caller is expected to REFUSE
    to attach calibrated arrival logic to a `ptz`: a pan re-aims the lens and every polygon
    drawn on it then describes ground the camera is no longer looking at.
    """
    region = detect_live_region(frames)
    if region is None:
        raise ChannelNotFound(
            "no live video in the capture window -- nothing moved across the sampled frames. "
            "Open the camera's live view in the app; a menu or device-list pane is static."
        )
    channels = split_into_channels(region, frames[-1])
    if not channels:
        raise ChannelNotFound(
            f"the live region {region.w}x{region.h} (aspect {region.aspect:.2f}) is not "
            "explicable as a tiling of 16:9 channels, so no channel can be located in it."
        )
    if not 0 <= index < len(channels):
        raise ChannelNotFound(
            f"channel {index} was requested but this window holds {len(channels)} "
            f"(0..{len(channels) - 1}). Channels are numbered left-to-right, top row first."
        )
    x, y, w, h = channels[index]
    kind, shift = classify_motion([f[y:y + h, x:x + w] for f in frames])
    return (x, y, w, h), kind, shift


def assert_channel_usable(index: int, kind: str, calibrated: bool) -> None:
    """Refuse to attach CALIBRATED arrival logic to a channel that is not proven FIXED.

    A calibration file is a set of polygons in pixel coordinates: the lot, the entry portal,
    the bays. Those coordinates mean something only while the lens keeps pointing where it
    pointed when they were drawn. A PTZ does not: one pan and the polygon labelled "front
    lot" sits over the sidewalk, and nothing anywhere reports an error -- frames stay
    healthy, the detector keeps finding cars, and every arrival is now attributed to
    geometry that no longer exists.

    `unknown` is refused for the same reason as `ptz`. It means the sample was too short to
    tell, and "we could not prove this lens is fixed" is not a licence to assume it is.
    Census mode (no calibration) is unaffected -- counting cars in a frame needs no geometry.
    """
    if not calibrated:
        return
    if kind == "fixed":
        return
    detail = ("it PANS, so any polygon drawn on it describes ground the lens leaves behind"
              if kind == "ptz" else
              "its motion could not be classified from the sampled frames")
    raise ChannelNotFound(
        f"channel {index} was given a calibration file but {detail}. Point --calibration at "
        "a FIXED channel, or drop it and run this channel in census mode, which needs no "
        "geometry. Refusing rather than silently scoring arrivals against the wrong ground."
    )


def describe(region: Optional[LiveRegion], width: int, height: int) -> str:
    """One `key=value` line for the preflight to print. Never raises."""
    if region is None:
        return "pane=none detail=no-live-video-in-window"
    verdict = "single" if region.looks_like_one_camera else "multi-or-clipped"
    return (f"pane={verdict} x={region.x} y={region.y} w={region.w} h={region.h} "
            f"aspect={region.aspect:.2f} native={NATIVE_ASPECT:.2f} "
            f"gutters={region.gutters} fill={region.fill:.2f} "
            f"live_frac={region.live_fraction:.2f} window={width}x{height}")
