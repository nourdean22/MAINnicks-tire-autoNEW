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


def _orientation(p: Point, q: Point, r: Point) -> int:
    """Sign of the turn p->q->r: 1 counter-clockwise, -1 clockwise, 0 collinear (with a tolerance)."""
    v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    if abs(v) < 1e-9:
        return 0
    return 1 if v > 0 else -1


def segments_cross(a: Point, b: Point, c: Point, d: Point) -> bool:
    """Do segments ab and cd cross PROPERLY (one interior point in common, not a shared endpoint
    or a collinear overlap)? A portal edge that only touches the lot boundary gives a car no
    point that is both in the portal and outside the lot, so touching does not count."""
    o1, o2 = _orientation(a, b, c), _orientation(a, b, d)
    o3, o4 = _orientation(c, d, a), _orientation(c, d, b)
    return o1 != 0 and o2 != 0 and o3 != 0 and o4 != 0 and o1 != o2 and o3 != o4


def _on_segment(p: Point, a: Point, b: Point) -> bool:
    """Is p on the closed segment ab (collinear, within its bounding box)?"""
    if _orientation(a, b, p) != 0:
        return False
    eps = 1e-9
    return (min(a[0], b[0]) - eps <= p[0] <= max(a[0], b[0]) + eps
            and min(a[1], b[1]) - eps <= p[1] <= max(a[1], b[1]) + eps)


def side_of_boundary(pt: Point, poly: Sequence[Point]) -> int:
    """1 strictly inside the polygon, -1 strictly outside, 0 on one of its edges.

    `point_in_poly` leaves a point on an edge undecided, and either answer is wrong for a
    question about sides: a portal corner snapped onto a lot corner is on neither side.
    """
    n = len(poly)
    if n < 3:
        return -1
    if any(_on_segment(pt, poly[i], poly[(i + 1) % n]) for i in range(n)):
        return 0
    return 1 if point_in_poly(pt, poly) else -1


def portal_straddles(lot: Sequence[Point], portal: Sequence[Point]) -> dict:
    """Does the driveway portal actually sit across the lot boundary?

    An entry is "outside, then inside, having touched the portal". A portal drawn wholly
    inside the lot can be touched only by cars that are already in; one drawn wholly outside
    only by cars that never enter. Either way `EntryPortal` can never fire and the lane reports
    zero arrivals while every health surface stays green -- the 2026-10-07 audit's B5 question.

    A portal straddles the boundary when any of three things holds:
      1. one of its edges properly crosses one of the lot's edges (a closed curve with points on
         both sides must cross the boundary);
      2. it holds a lot vertex strictly inside it (it then holds a neighbourhood of a boundary
         point, so points on both sides): a portal drawn around the whole lot, a full-frame
         portal for one, crosses no edge at all;
      3. for the degenerate crossings through a lot vertex that neither test sees, the sampled
         points (each portal vertex, each edge midpoint, the centroid) land STRICTLY on both
         sides. A sample on the lot boundary counts for neither: the 2026-09-16 shop calibration
         snapped two portal corners onto lot corners, and counting one of them as "outside"
         accepted a portal drawn wholly inside the lot -- the exact failure this check exists for.
    Sampling alone was the first version and it was blind to a long band whose middle crosses
    the lot while every sample sits outside it (Codex on #2925): the loader would then have
    refused a working calibration and put the edge into census mode. What is left undecided is a
    portal whose vertices all sit on the lot boundary or on one side of it while its area reaches
    the other side through a lot vertex alone; nobody draws a driveway band like that. Returns
    {ok, inside, outside, boundary, samples, crossings, contained, reason}; callers that get
    ok=False must not claim arrivals.
    """
    lot_pts = [(float(x), float(y)) for x, y in lot]
    portal_pts = [(float(x), float(y)) for x, y in portal]
    if len(lot_pts) < 3:
        return {"ok": False, "inside": 0, "outside": 0, "boundary": 0, "samples": 0, "crossings": 0, "contained": 0,
                "reason": "lot polygon has fewer than 3 points"}
    if len(portal_pts) < 3:
        return {"ok": False, "inside": 0, "outside": 0, "boundary": 0, "samples": 0, "crossings": 0, "contained": 0,
                "reason": "portal polygon has fewer than 3 points"}
    samples: list[Point] = list(portal_pts)
    n = len(portal_pts)
    for i in range(n):
        (x1, y1), (x2, y2) = portal_pts[i], portal_pts[(i + 1) % n]
        samples.append(((x1 + x2) / 2.0, (y1 + y2) / 2.0))
    samples.append((sum(p[0] for p in portal_pts) / n, sum(p[1] for p in portal_pts) / n))
    sides = [side_of_boundary(s, lot_pts) for s in samples]
    inside, outside, boundary = sides.count(1), sides.count(-1), sides.count(0)
    m = len(lot_pts)
    crossings = 0
    for i in range(n):
        a, b = portal_pts[i], portal_pts[(i + 1) % n]
        for j in range(m):
            if segments_cross(a, b, lot_pts[j], lot_pts[(j + 1) % m]):
                crossings += 1
    contained = sum(1 for p in lot_pts if side_of_boundary(p, portal_pts) == 1)
    ok = crossings > 0 or contained > 0 or bool(inside and outside)
    if ok:
        reason = "portal straddles the lot boundary"
    elif inside:
        reason = "portal lies wholly inside the lot: only cars already on the lot can touch it"
    elif outside:
        reason = "portal lies wholly outside the lot: a car touching it never becomes inside"
    else:
        reason = "portal lies along the lot boundary: no part of it is on either side"
    return {"ok": ok, "inside": inside, "outside": outside, "boundary": boundary, "samples": len(samples),
            "crossings": crossings, "contained": contained, "reason": reason}


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
