"""
Lot geometry: zones, the driveway entry portal, and an optional ground-plane map.

The rule this module exists to enforce: **presence is not arrival.** A new visit
requires an explicit outside-to-inside transition through the driveway portal (or
another trusted topology edge), observed on the vehicle's ground contact point. Dwell
timers stay -- but only to classify waiting vs service, never to invent an arrival.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Optional, Sequence

Point = tuple[float, float]


def point_in_poly(pt: Point, poly: Sequence[Point]) -> bool:
    """Ray casting. Points exactly on an edge are not guaranteed either way."""
    x, y = pt
    inside = False
    n = len(poly)
    if n < 3:
        return False
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y):
            denom = (yj - yi) or 1e-12
            x_cross = xi + (y - yi) * (xj - xi) / denom
            if x < x_cross:
                inside = not inside
        j = i
    return inside


@dataclass
class Zone:
    name: str
    polygon: list[Point]

    def contains(self, pt: Point) -> bool:
        return point_in_poly(pt, self.polygon)


@dataclass
class LotMap:
    """Named zones for one camera pose. `outside` is everything not inside `property`."""

    zones: dict[str, Zone] = field(default_factory=dict)

    def add(self, name: str, polygon: Sequence[Point]) -> "LotMap":
        self.zones[name] = Zone(name, list(polygon))
        return self

    def zones_at(self, pt: Point) -> list[str]:
        return sorted(name for name, z in self.zones.items() if z.contains(pt))


class EntryPortal:
    """Detects a genuine outside -> inside transition on a track's ground-point path.

    `inside_zone` is the property/lot polygon. A crossing is recorded only when the
    track was observed OUTSIDE for at least `min_outside_hits` samples and then
    observed INSIDE for at least `min_inside_hits` consecutive samples. Requiring
    evidence on both sides is what stops a detector that re-spawns a blob on a parked
    car from ever looking like an entry: a re-spawned blob is born inside and has no
    outside history at all.
    """

    def __init__(
        self,
        inside_zone: Zone,
        min_outside_hits: int = 2,
        min_inside_hits: int = 2,
        portal_zone: Optional[Zone] = None,
    ) -> None:
        self.inside_zone = inside_zone
        self.portal_zone = portal_zone
        self.min_outside_hits = min_outside_hits
        self.min_inside_hits = min_inside_hits

    def evaluate(self, path: Iterable[Point]) -> dict:
        """Return {'crossed': bool, 'outside_hits': int, 'inside_run': int, 'reason': str}."""
        outside_hits = 0
        inside_run = 0
        crossed = False
        seen_outside_first = False
        portal_touched = self.portal_zone is None

        for pt in path:
            inside = self.inside_zone.contains(pt)
            if self.portal_zone is not None and self.portal_zone.contains(pt):
                portal_touched = True
            if not inside:
                outside_hits += 1
                inside_run = 0
                if outside_hits >= self.min_outside_hits:
                    seen_outside_first = True
            else:
                if seen_outside_first:
                    inside_run += 1
                    if inside_run >= self.min_inside_hits and portal_touched:
                        crossed = True

        if crossed:
            reason = "outside->inside portal crossing"
        elif not seen_outside_first:
            reason = "no outside history: born inside the property (not an entry)"
        elif not portal_touched:
            reason = "never touched the driveway portal"
        else:
            reason = f"inside run {inside_run} < {self.min_inside_hits}"
        return {
            "crossed": crossed,
            "outside_hits": outside_hits,
            "inside_run": inside_run,
            "reason": reason,
        }


class GroundPlane:
    """Optional pixel -> approximate lot-coordinate map via a 3x3 homography.

    Exact speed is not the goal and is not claimed; consistent topology (direction,
    queue order, which bay) is. Without a calibrated homography the pipeline still
    works -- it just reasons in pixels.
    """

    def __init__(self, homography: Optional[Sequence[Sequence[float]]] = None) -> None:
        self.h = [list(map(float, row)) for row in homography] if homography else None

    @property
    def calibrated(self) -> bool:
        return self.h is not None

    def to_lot(self, pt: Point) -> Optional[Point]:
        if self.h is None:
            return None
        x, y = pt
        h = self.h
        w = h[2][0] * x + h[2][1] * y + h[2][2]
        if abs(w) < 1e-9:
            return None
        return (
            (h[0][0] * x + h[0][1] * y + h[0][2]) / w,
            (h[1][0] * x + h[1][1] * y + h[1][2]) / w,
        )
