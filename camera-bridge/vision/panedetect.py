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


def describe(region: Optional[LiveRegion], width: int, height: int) -> str:
    """One `key=value` line for the preflight to print. Never raises."""
    if region is None:
        return "pane=none detail=no-live-video-in-window"
    verdict = "single" if region.looks_like_one_camera else "multi-or-clipped"
    return (f"pane={verdict} x={region.x} y={region.y} w={region.w} h={region.h} "
            f"aspect={region.aspect:.2f} native={NATIVE_ASPECT:.2f} "
            f"gutters={region.gutters} fill={region.fill:.2f} "
            f"live_frac={region.live_fraction:.2f} window={width}x{height}")
