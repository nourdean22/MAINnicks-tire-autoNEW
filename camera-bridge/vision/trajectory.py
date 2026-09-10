"""Derive the lot's geometry from cars that actually drove on it.

Today's `lot` polygon is five points somebody drew by eye over a screenshot
(`data/calib-shop-left.json`). It decides every arrival. Nothing measures whether it is
right, and its failure modes are silent in both directions: too big and cars are "on the
lot" while they are still on Euclid; too small and a real arrival never crosses in.

Vehicles have been driving the correct answer across the frame all along. `TrajectoryStore`
records where they went; `TrajectoryCommissioner` turns thousands of those points into a
PROPOSED calibration and, more usefully, into a diff against the polygon in force.

IT PROPOSES. IT NEVER APPLIES.
-----------------------------
A geometry change breaks track continuity by design (the layout epoch folds into
`source_generation`), and a wrong one silently rewrites what "arrival" means for the shop.
So the output is a file for a human to look at. There is no code path here that writes a
calibration, and `test_trajectory.py` asserts that by trying.

THE INSET RULE -- the constraint that makes this work at all
------------------------------------------------------------
`geometry.py:89` sets `portal_touched = self.portal_zone is None`, so with no portal the lot
polygon ALONE carries the crossing: a track must be seen OUTSIDE it (>=2 samples) and then
INSIDE it (>=2 samples). Neither fixed lens can see the driveway -- only the PTZ can, and a
PTZ may never carry calibrated geometry -- so every arrival at this shop is detected by that
outside-then-inside transition across the lot polygon and nothing else.

Which means the naive commissioner is worse than the hand-drawn polygon it replaces. Fit the
polygon to the full drivable region and there is no outside left: cars appear already inside
it, never cross, and the shop records zero arrivals under a green producer. The measured
region is the APPROACH plus the lot; the polygon has to be the lot with the approach left
outside. So the drivable region is ERODED by `INSET_PX` before it is proposed, and the
proposal reports how wide the surviving approach band is. A proposal whose band is too thin
to hold two samples of an approaching car is refused rather than shipped.
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

#: Ground points are sampled at most this often per track. Commissioning geometry needs
#: coverage over days, not frame rate: at 4 fps a single parked car would otherwise
#: contribute 14,400 identical points an hour and outvote every car that actually moved.
MIN_INTERVAL_S = 1.0

#: Row cap, oldest evicted first. ~2 vehicles at 1 Hz over a 10-hour day is ~72k rows/day,
#: so this holds roughly a fortnight -- comfortably more than the few days of real traffic
#: a proposal needs, and bounded so the edge SQLite cannot grow without limit.
MAX_ROWS = 1_000_000

#: Row cap for the death ledger, oldest evicted first. Deaths are rare next to points --
#: measured at ~2.7/min on the live feed, so ~1,600/day -- and each one is a decision the
#: tracker made, not a sample. 200k holds months.
MAX_DEATHS = 200_000

#: Refusal floors. A polygon fitted to a handful of cars is a guess wearing a measurement's
#: clothes, and it would be believed precisely because it came out of a tool.
MIN_TRACKS = 40
MIN_POINTS = 2_000

#: Grid resolution for the occupancy map, in source pixels.
CELL_PX = 8

#: A cell counts as drivable once this many DISTINCT tracks have touched it. Distinct tracks,
#: never point counts: one car parked in one spot for a week would otherwise mint a
#: high-confidence region nothing ever drove through.
MIN_TRACKS_PER_CELL = 3

#: How far the measured drivable region is pulled in before being proposed. See THE INSET
#: RULE above -- this is what leaves an approach band outside the polygon for the crossing
#: to happen in. Roughly a car length at this frontage.
INSET_PX = 45.0

#: The inset must LEAVE a lot behind. Erosion that keeps only a sliver still passes a
#: "did it vanish?" test while proposing something absurd -- measured on synthetic frontage
#: traffic it produced a READY proposal of 768 px against a 93,407 px polygon in force, and
#: the fabricated "approach band" metric alongside it read a comfortable 55.6px. Same lesson
#: as the scene locator's sliver quads: an area floor is not a shape check.
MIN_RETAINED_FRACTION = 0.25

#: A track holding still this long is dwelling, not driving. Feeds the bay proposal.
DWELL_S = 90.0

#: Below this many deaths in a band, `reacquisition_rates` refuses to report a rate. A
#: difference between two small proportions is noise, and a number that came out of a tool
#: gets quoted whether or not it means anything.
MIN_DEATHS_PER_BAND = 30

#: A recorded `allowed` at or above this was `parked_max_misses` (150); below it was
#: `max_misses` (12). A SEPARATOR between the two tolerances, never a threshold of its own
#: -- it only has to sit between them, so it survives either constant being retuned.
PARKED_TOLERANCE_FLOOR = 100

_SCHEMA = """
CREATE TABLE IF NOT EXISTS track_points (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         REAL    NOT NULL,
  track_id   INTEGER NOT NULL,
  scene      TEXT    NOT NULL,
  generation TEXT    NOT NULL,
  x          REAL    NOT NULL,
  y          REAL    NOT NULL,
  w          REAL    NOT NULL,
  h          REAL    NOT NULL,
  still      REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_track_points_scene ON track_points(scene, ts);

-- EVERY track the tracker retires, and the decision it made retiring it.
--
-- WHY THIS TABLE EXISTS. `TrackGraph.update()` returns a `died` list on every frame, and
-- until now it had exactly two consumers: a departure emission for tracks whose evidence is
-- `arrival` (`pipeline.py`), and the re-acquisition detector, which records only the deaths
-- that happened to coincide with a nearby birth. Every other death was discarded.
--
-- That left the re-acquisition corpus with a NUMERATOR and no DENOMINATOR. "Of the tracks
-- that die, what fraction die inside the settling window?" was unanswerable, and answering
-- it by inference from `track_points` produces artifacts: that table skips every suppressed
-- frame, so it has recording gaps of over a minute and cannot be split into track lifetimes
-- by time alone. Two attempts at it returned two confident, mutually inconsistent numbers.
--
-- `allowed` is the field that makes a row self-explaining: it is the miss tolerance the
-- tracker actually applied, so `allowed = max_misses` vs `parked_max_misses` says whether
-- this vehicle was being treated as settling or as parked WITHOUT re-deriving the threshold
-- from `still_s` and hoping the constant has not moved since.
CREATE TABLE IF NOT EXISTS track_deaths (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         REAL    NOT NULL,
  scene      TEXT    NOT NULL,
  generation TEXT    NOT NULL,
  track_id   INTEGER NOT NULL,
  age_s      REAL    NOT NULL,
  still_s    REAL    NOT NULL,   -- OBSERVED stillness, blind intervals already subtracted
  hits       INTEGER NOT NULL,   -- cumulative
  misses     INTEGER NOT NULL,   -- CONSECUTIVE; resets to 0 on a match
  allowed    INTEGER NOT NULL,   -- the tolerance applied: max_misses or parked_max_misses
  evidence   TEXT    NOT NULL,
  degraded   INTEGER NOT NULL,
  score      REAL    NOT NULL,
  x          REAL    NOT NULL,
  y          REAL    NOT NULL,
  -- Set by `mark_reacquired()` when the re-acquisition detector later matches a birth to
  -- this death. 0 is "not matched", never "unknown": every death is written here first, so
  -- a 0 means the detector looked and found nothing within its window.
  reacquired INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_track_deaths_scene ON track_deaths(scene, ts);
CREATE INDEX IF NOT EXISTS idx_track_deaths_lookup ON track_deaths(scene, track_id, ts);
"""


class TrajectoryStats:
    __slots__ = ("points", "deaths", "reacquired", "dropped", "evicted", "last_error")

    def __init__(self) -> None:
        self.points = 0
        self.deaths = 0
        self.reacquired = 0
        self.dropped = 0
        self.evicted = 0
        self.last_error: Optional[str] = None

    def describe(self) -> str:
        base = (f"points={self.points} deaths={self.deaths} "
                f"reacquired={self.reacquired} evicted={self.evicted}")
        return base if not self.dropped else f"{base} dropped={self.dropped} ({self.last_error})"

    @property
    def healthy(self) -> bool:
        """No attempted write failed. NOT "has points" -- a shop with no traffic yet is not
        a broken store, and conflating the two is the failure this codebase keeps removing."""
        return self.dropped == 0


class TrajectoryStore:
    """Where vehicles went, at 1 Hz, bounded. Never raises at the caller."""

    def __init__(self, path: str, *, min_interval: float = MIN_INTERVAL_S,
                 max_rows: int = MAX_ROWS, max_deaths: int = MAX_DEATHS):
        self.path = path
        self.min_interval = min_interval
        self.max_rows = max_rows
        self.max_deaths = max_deaths
        self.stats = TrajectoryStats()
        self._last: Dict[int, float] = {}
        self._since_evict = 0
        self._since_death_evict = 0
        self._conn: Optional[sqlite3.Connection] = None
        try:
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            self._conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
            # WAL + synchronous=NORMAL, because this runs on the capture thread's clock.
            # sqlite3's default autocommit does a full fsync per statement, and `observe()`
            # is called on EVERY frame at 4 fps: measured at ~80ms per insert on this box,
            # which is a third of the frame budget spent flushing commissioning data to
            # disk, on the machine whose actual job is watching the lot. (It showed up as a
            # 7-minute test suite before it would have shown up as dropped frames.)
            # The trade is the right one: on a power cut this loses the last few seconds of
            # TRAJECTORY SAMPLES -- not visits, not the outbox, not evidence. Those live in
            # the ledger, which keeps its own durability settings.
            self._conn.execute("PRAGMA journal_mode = WAL")
            self._conn.execute("PRAGMA synchronous = NORMAL")
            self._conn.executescript(_SCHEMA)
        except Exception as exc:  # noqa: BLE001 - a producer must start without this
            self.stats.dropped += 1
            self.stats.last_error = f"open: {type(exc).__name__}: {exc}"
            self._conn = None

    @property
    def open(self) -> bool:
        return self._conn is not None

    def observe(self, now: float, tracks: Iterable[Any], *, scene: str,
                generation: str) -> int:
        """Record the ground point of every live track. Returns rows written."""
        if self._conn is None:
            return 0
        rows = []
        for t in tracks:
            tid = getattr(t, "track_id", None)
            if tid is None:
                continue
            if now - self._last.get(tid, -1e9) < self.min_interval:
                continue
            try:
                gx, gy = t.ground_point
                x1, y1, x2, y2 = t.box
                still = t.stationary_for(now)
            except Exception:  # noqa: BLE001 - a malformed track is skipped, never fatal
                self.stats.dropped += 1
                self.stats.last_error = "a track had no usable geometry"
                continue
            self._last[tid] = now
            rows.append((now, int(tid), scene, generation, float(gx), float(gy),
                         float(x2 - x1), float(y2 - y1), float(still)))
        if not rows:
            return 0
        try:
            self._conn.executemany(
                "INSERT INTO track_points(ts,track_id,scene,generation,x,y,w,h,still) "
                "VALUES (?,?,?,?,?,?,?,?,?)", rows)
        except Exception as exc:  # noqa: BLE001
            self.stats.dropped += len(rows)
            self.stats.last_error = f"insert: {type(exc).__name__}: {exc}"
            return 0
        self.stats.points += len(rows)
        self._since_evict += len(rows)
        # Amortised: counting rows on every frame would read the whole table 4x a second.
        if self._since_evict >= 5_000:
            self._since_evict = 0
            self._evict()
        return len(rows)

    # ------------------------------------------------------------------ the death ledger
    def note_deaths(self, now: float, dead: Iterable[Any], *, scene: str,
                    generation: str) -> int:
        """Record every track the tracker just retired. Returns rows written.

        UNTHROTTLED, unlike `observe()`. A death is a DECISION, not a sample: there are
        roughly 2.7 a minute against 4 points a second per track, and dropping one loses the
        event rather than some resolution. It is also unconditional on suppression -- the
        four gates in `pipeline.step()` all return before `tracks.update()` runs, so `died`
        is empty on a suppressed frame anyway, and writing that invariant into a caller's
        `if` would make a silent blind spot out of a refactor that moved one of them.

        Never raises at the caller, on the same terms as `observe()`: this runs on the
        capture thread and a commissioning table must not cost a frame.
        """
        if self._conn is None:
            return 0
        rows = []
        for t in dead:
            try:
                gx, gy = t.ground_point
                allowed = t.retired_allowed
                if allowed is None:
                    # A track handed here without the tracker having retired it. Recording a
                    # guessed tolerance would put a fabricated decision in the one table that
                    # exists to hold real ones, so it is a counted drop instead.
                    self.stats.dropped += 1
                    self.stats.last_error = "a track reached the death ledger un-retired"
                    continue
                rows.append((float(now), scene, generation, int(t.track_id),
                             float(max(0.0, now - t.born_ts)), float(t.stationary_for(now)),
                             int(t.hits), int(t.misses), int(allowed), str(t.evidence),
                             1 if t.degraded else 0, float(t.score), float(gx), float(gy)))
            except Exception:  # noqa: BLE001 - a malformed track is skipped, never fatal
                self.stats.dropped += 1
                self.stats.last_error = "a dead track had no usable vitals"
        if not rows:
            return 0
        try:
            self._conn.executemany(
                "INSERT INTO track_deaths(ts,scene,generation,track_id,age_s,still_s,hits,"
                "misses,allowed,evidence,degraded,score,x,y) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
        except Exception as exc:  # noqa: BLE001
            self.stats.dropped += len(rows)
            self.stats.last_error = f"insert deaths: {type(exc).__name__}: {exc}"
            return 0
        self.stats.deaths += len(rows)
        self._since_death_evict += len(rows)
        if self._since_death_evict >= 1_000:
            self._since_death_evict = 0
            self._evict_deaths()
        return len(rows)

    def mark_reacquired(self, scene: str, track_id: int, death_ts: float,
                        tolerance: float = 0.5) -> bool:
        """Flag a recorded death that the re-acquisition detector later matched to a birth.

        The join has to be by TIME as well as id, because track ids restart at 1 on every
        producer restart and the ledger outlives a restart by design. `tolerance` bounds the
        float round-trip through SQLite, not the search: a death and its ledger row share one
        timestamp, so anything wider would risk flagging the WRONG restart's track.

        False when nothing matched, and the caller must not read that as a failure -- a
        producer whose ledger was enabled mid-run has re-acquisitions whose deaths predate
        the table.
        """
        if self._conn is None:
            return False
        try:
            cur = self._conn.execute(
                "UPDATE track_deaths SET reacquired = 1 WHERE scene = ? AND track_id = ? "
                "AND ts BETWEEN ? AND ? AND reacquired = 0",
                (scene, int(track_id), float(death_ts) - tolerance,
                 float(death_ts) + tolerance))
        except Exception as exc:  # noqa: BLE001
            self.stats.dropped += 1
            self.stats.last_error = f"mark_reacquired: {type(exc).__name__}: {exc}"
            return False
        if not cur.rowcount:
            return False
        self.stats.reacquired += cur.rowcount
        return True

    def _evict_deaths(self) -> None:
        try:
            (n,) = self._conn.execute("SELECT COUNT(*) FROM track_deaths").fetchone()
            if n <= self.max_deaths:
                return
            over = n - self.max_deaths
            self._conn.execute(
                "DELETE FROM track_deaths WHERE id IN "
                "(SELECT id FROM track_deaths ORDER BY id LIMIT ?)", (over,))
            self.stats.evicted += over
        except Exception as exc:  # noqa: BLE001
            if self.stats.last_error is None:
                self.stats.last_error = f"evict deaths: {type(exc).__name__}: {exc}"

    def deaths(self, scene: Optional[str] = None) -> List[tuple]:
        """Every recorded death, oldest first.

        Columns: ts, scene, generation, track_id, age_s, still_s, hits, misses, allowed,
        evidence, degraded, score, x, y, reacquired.
        """
        if self._conn is None:
            return []
        sql = ("SELECT ts,scene,generation,track_id,age_s,still_s,hits,misses,allowed,"
               "evidence,degraded,score,x,y,reacquired FROM track_deaths")
        args: tuple = ()
        if scene:
            sql += " WHERE scene = ?"
            args = (scene,)
        try:
            return list(self._conn.execute(sql + " ORDER BY ts", args))
        except Exception:  # noqa: BLE001
            return []

    def _evict(self) -> None:
        try:
            (n,) = self._conn.execute("SELECT COUNT(*) FROM track_points").fetchone()
            if n <= self.max_rows:
                return
            over = n - self.max_rows
            self._conn.execute(
                "DELETE FROM track_points WHERE id IN "
                "(SELECT id FROM track_points ORDER BY id LIMIT ?)", (over,))
            self.stats.evicted += over
        except Exception as exc:  # noqa: BLE001
            if self.stats.last_error is None:
                self.stats.last_error = f"evict: {type(exc).__name__}: {exc}"

    def points(self, scene: Optional[str] = None) -> List[tuple]:
        if self._conn is None:
            return []
        sql = "SELECT ts,track_id,x,y,w,h,still FROM track_points"
        args: tuple = ()
        if scene:
            sql += " WHERE scene = ?"
            args = (scene,)
        try:
            return list(self._conn.execute(sql + " ORDER BY ts", args))
        except Exception:  # noqa: BLE001
            return []

    def scenes(self) -> List[str]:
        """Scene ids that actually have points, most-recorded first.

        Exists so a refusal can NAME the alternatives. "0 points for shop-left" and "0 points
        for anything" are different problems with different fixes, and an operator told only
        the first will wait for traffic that is arriving under another name.
        """
        if self._conn is None:
            return []
        try:
            return [r[0] for r in self._conn.execute(
                "SELECT scene, COUNT(*) c FROM track_points GROUP BY scene ORDER BY c DESC")]
        except Exception:  # noqa: BLE001
            return []

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            finally:
                self._conn = None


# --------------------------------------------------------------------------------------
# The commissioner
# --------------------------------------------------------------------------------------

def _occupancy(points: Sequence[tuple], size: Tuple[int, int]) -> np.ndarray:
    """Cells touched by at least MIN_TRACKS_PER_CELL DISTINCT tracks.

    Distinct tracks is the whole point. Counting samples would let one car parked in one
    spot over a weekend mint a confident "drivable" region that nothing ever drove through,
    and parked cars are the majority of what this camera sees.
    """
    w, h = size
    gw, gh = max(1, w // CELL_PX), max(1, h // CELL_PX)
    seen: Dict[int, set] = {}
    for _ts, tid, x, y, _bw, _bh, _still in points:
        cx, cy = int(x) // CELL_PX, int(y) // CELL_PX
        if 0 <= cx < gw and 0 <= cy < gh:
            seen.setdefault(cy * gw + cx, set()).add(tid)
    grid = np.zeros((gh, gw), np.uint8)
    for cell, tids in seen.items():
        if len(tids) >= MIN_TRACKS_PER_CELL:
            grid[cell // gw, cell % gw] = 255
    return grid


def _region_mask(grid: np.ndarray) -> np.ndarray:
    """The occupancy grid as a filled REGION, which is what everything downstream needs.

    A grid of touched cells is a SAMPLE of a continuous surface, not the surface: measured
    on synthetic frontage traffic it was 400 filled cells out of 5,238, speckled with the
    gaps between where cars happened to be at each sampling instant. Eroding that speckle
    for the inset left ZERO cells and the commissioner refused every proposal -- while the
    `drivable` polygon it reported alongside came from a CLOSED copy of the same grid. Two
    different regions under two names, and only one of them ever reached the operator.

    So the region is built once, here: close the sampling gaps, keep the largest connected
    component, and fill its contour so interior holes (a spot no car parked in) become part
    of the surface rather than a lake in the middle of the lot.
    """
    import cv2

    closed = cv2.morphologyEx(grid, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return np.zeros_like(grid)
    filled = np.zeros_like(grid)
    cv2.drawContours(filled, [max(contours, key=cv2.contourArea)], -1, 255, thickness=-1)
    return filled


def _largest_polygon(mask: np.ndarray, scale: int) -> Optional[List[List[int]]]:
    """Contour of an ALREADY-FILLED mask. Does no closing of its own -- that belongs in
    `_region_mask`, so the polygon and the erosion can never describe different regions."""
    import cv2

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    biggest = max(contours, key=cv2.contourArea)
    approx = cv2.approxPolyDP(biggest, 0.01 * cv2.arcLength(biggest, True), True)
    return [[int(p[0][0] * scale + scale // 2), int(p[0][1] * scale + scale // 2)]
            for p in approx]


def _erode_px(mask: np.ndarray, px: float, scale: int) -> np.ndarray:
    import cv2

    k = max(1, int(round(px / scale)))
    return cv2.erode(mask, np.ones((2 * k + 1, 2 * k + 1), np.uint8))


def _poly_area(poly: Sequence[Sequence[float]]) -> float:
    if len(poly) < 3:
        return 0.0
    a = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


class TrajectoryCommissioner:
    """Turns recorded trajectories into a PROPOSED calibration and a diff against the
    calibration in force. Writes no calibration, ever."""

    def __init__(self, store: TrajectoryStore, *, canonical: Tuple[int, int],
                 inset_px: float = INSET_PX):
        self.store = store
        self.canonical = canonical
        self.inset_px = inset_px

    def propose(self, scene: Optional[str] = None,
                current: Optional[dict] = None) -> Dict[str, Any]:
        """A proposal, or a refusal that says exactly what is missing.

        `ready` is False for every reason the answer would be untrustworthy, and `why` names
        it. A commissioner that always returns a polygon is worse than no commissioner: the
        polygon came out of a tool, so it gets believed.
        """
        pts = self.store.points(scene)
        tracks = {p[1] for p in pts}
        base: Dict[str, Any] = {
            "scene": scene, "points": len(pts), "tracks": len(tracks),
            "canonical": list(self.canonical), "generatedAt": time.time(),
        }
        # A scene NOBODY HAS RECORDED is not a quiet scene. Both render as zero points, and
        # "not enough traffic yet" tells an operator to wait for data that is being filed
        # under another name -- or under no name, because of a typo. Say which.
        if scene is not None and not pts:
            known = self.store.scenes()
            return {**base, "ready": False, "why": (
                f"no points are recorded for scene {scene!r}. "
                + (f"The store has: {', '.join(known)}. Did you mean one of those?"
                   if known else
                   "The store has NO points for any scene, so nothing is being recorded at "
                   "all -- check that the producer was started with --trajectories."))}

        if len(tracks) < MIN_TRACKS or len(pts) < MIN_POINTS:
            return {**base, "ready": False, "why": (
                f"not enough traffic yet: {len(tracks)}/{MIN_TRACKS} tracks, "
                f"{len(pts)}/{MIN_POINTS} points. A polygon fitted to this much data is a "
                f"guess that would be believed because a tool produced it.")}

        grid = _occupancy(pts, self.canonical)
        if not grid.any():
            return {**base, "ready": False, "why": (
                f"no cell reached {MIN_TRACKS_PER_CELL} distinct tracks -- the traffic is "
                f"there but it never repeats a route, which is not a lot this method can "
                f"describe.")}

        region = _region_mask(grid)
        if not region.any():
            return {**base, "ready": False, "why": (
                "the touched cells never join into a region -- the traffic is scattered "
                "rather than following ground a lot polygon could describe")}
        drivable = _largest_polygon(region, CELL_PX)
        inset_mask = _erode_px(region, self.inset_px, CELL_PX)
        if not inset_mask.any():
            return {**base, "ready": False, "why": (
                f"the drivable region vanishes when inset by {self.inset_px:.0f}px -- it is "
                f"narrower than the approach band an arrival needs. Widen the view or lower "
                f"the inset deliberately; do not ship a polygon with no outside.")}
        lot = _largest_polygon(inset_mask, CELL_PX)
        if lot is None or len(lot) < 3:
            return {**base, "ready": False, "why": "the inset region has no usable contour"}

        retained = np.count_nonzero(inset_mask) / max(1, np.count_nonzero(region))
        inradius = self._inradius_px(region)
        if retained < MIN_RETAINED_FRACTION:
            return {**base, "ready": False, "why": (
                f"inset by {self.inset_px:.0f}px leaves only {retained:.0%} of the drivable "
                f"region (need {MIN_RETAINED_FRACTION:.0%}). The ground this camera sees is "
                f"{inradius:.0f}px deep at its widest, so an inset that size is eating the "
                f"lot rather than trimming an approach off it. A polygon this small would "
                f"be READY, absurd, and believed because a tool produced it.")}

        out = {**base, "ready": True, "lot": lot, "drivable": drivable,
               "retainedFraction": round(float(retained), 3),
               "regionInradiusPx": round(inradius, 1), "insetPx": self.inset_px,
               "entries": self._entries(pts, lot), "dwell": self._dwell(pts)}
        if current is not None:
            out["diff"] = self._diff(current, lot, region)
        return out

    def _inradius_px(self, region: np.ndarray) -> float:
        """How far the deepest point of the region is from its edge, in source pixels.

        This replaces a metric this module invented and then believed: "approach band" was
        lost-cells divided by a guessed perimeter, which returned a confident 55.6px for a
        region the inset had already destroyed. The distance transform is the actual answer
        to the actual question -- an inset larger than this cannot leave anything behind,
        and the width it reports is measured rather than estimated.
        """
        import cv2

        if not region.any():
            return 0.0
        dist = cv2.distanceTransform(region, cv2.DIST_L2, 3)
        return float(dist.max()) * CELL_PX

    def _entries(self, pts: Sequence[tuple], lot: Sequence[Sequence[int]]) -> List[dict]:
        """Where tracks are first seen. Not yet a portal polygon -- a list of first-sighting
        clusters for an operator to look at, because turning them into a portal needs a
        judgement about which are the driveway and which are cars appearing from behind the
        building, and this method has no way to tell those apart."""
        first: Dict[int, tuple] = {}
        for ts, tid, x, y, _w, _h, _s in pts:
            if tid not in first or ts < first[tid][0]:
                first[tid] = (ts, x, y)
        cells: Dict[Tuple[int, int], int] = {}
        for _ts, x, y in first.values():
            key = (int(x) // (CELL_PX * 4), int(y) // (CELL_PX * 4))
            cells[key] = cells.get(key, 0) + 1
        ranked = sorted(cells.items(), key=lambda kv: -kv[1])[:6]
        step = CELL_PX * 4
        return [{"at": [k[0] * step + step // 2, k[1] * step + step // 2], "tracks": n}
                for k, n in ranked if n >= 3]

    def _dwell(self, pts: Sequence[tuple]) -> List[dict]:
        """Where vehicles STOP for a long time. Bay candidates, named by nobody."""
        cells: Dict[Tuple[int, int], set] = {}
        for _ts, tid, x, y, _w, _h, still in pts:
            if still >= DWELL_S:
                cells.setdefault((int(x) // (CELL_PX * 4), int(y) // (CELL_PX * 4)),
                                 set()).add(tid)
        step = CELL_PX * 4
        ranked = sorted(cells.items(), key=lambda kv: -len(kv[1]))[:8]
        return [{"at": [k[0] * step + step // 2, k[1] * step + step // 2],
                 "vehicles": len(v)} for k, v in ranked if len(v) >= 3]

    def _diff(self, current: dict, lot: Sequence[Sequence[int]],
              grid: np.ndarray) -> Dict[str, Any]:
        """The part an operator actually acts on: how wrong is the polygon in force?

        Two numbers, both about the CURRENT polygon and both directional. "Dead" pixels are
        area it claims that no vehicle has ever occupied -- cars are counted as on the lot
        while they are somewhere else. "Missed" is drivable ground it excludes -- real
        arrivals that never cross in.
        """
        import cv2

        cur = current.get("lot") or []
        if len(cur) < 3:
            return {"current": "none", "note": "no lot polygon is configured to compare against"}
        w, h = self.canonical
        gh, gw = grid.shape
        cur_mask = np.zeros((gh, gw), np.uint8)
        cv2.fillPoly(cur_mask, [np.array([[int(x) // CELL_PX, int(y) // CELL_PX]
                                          for x, y in cur], np.int32)], 255)
        claimed = int(np.count_nonzero(cur_mask))
        drivable = int(np.count_nonzero(grid))
        dead = int(np.count_nonzero((cur_mask > 0) & (grid == 0)))
        missed = int(np.count_nonzero((cur_mask == 0) & (grid > 0)))
        return {
            "currentAreaPx": round(_poly_area(cur), 1),
            "proposedAreaPx": round(_poly_area(lot), 1),
            "deadFraction": round(dead / claimed, 3) if claimed else None,
            "missedFraction": round(missed / drivable, 3) if drivable else None,
            "reading": (
                f"{dead / claimed:.0%} of the current polygon has never had a vehicle on it, "
                f"and {missed / drivable:.0%} of the ground vehicles do use is outside it"
            ) if claimed and drivable else "not enough coverage to read a difference",
        }


def reacquisition_rates(store: "TrajectoryStore", scene: Optional[str] = None,
                        parked_after: float = 25.0) -> Dict[str, Any]:
    """How often a retired track comes straight back, split by how it was being treated.

    THE DECISION THIS IS FOR. `max_misses` is 12 (~3s at 4fps) and `parked_max_misses` is
    150 (~37s), and which one a track gets turns on whether it has held still for
    `parked_after` (25s). A vehicle that has stopped but not yet earned that promotion is in
    a window where three seconds of detector dropout retires it -- and if it is retired while
    still physically present, the next detection is a NEW track, born after the boot census,
    and therefore a candidate for ARRIVAL. That is a car invented out of a flicker.

    Whether that window is actually where cars are lost is an empirical question, and the
    honest answer needs both halves: the re-acquisitions AND the deaths that were not
    re-acquired. Comparing bands without the denominator is how a correlation gets believed.

    `settling` and `parked` are split by the tolerance the TRACKER APPLIED (`allowed`), not
    by re-deriving it from `still_s` here. If `parked_after` moves, old rows keep telling the
    truth about the decision that was actually made at the time.

    `insufficient` is not a hedge -- it is the refusal. Under 30 deaths in a band, a
    difference in rates is noise wearing a measurement's clothes, and this returns
    `verdict: "insufficient"` rather than a number somebody will quote.
    """
    rows = store.deaths(scene)
    bands: Dict[str, Dict[str, Any]] = {
        "settling": {"deaths": 0, "reacquired": 0},
        "parked": {"deaths": 0, "reacquired": 0},
    }
    for r in rows:
        allowed, reacq = r[8], r[14]
        # `allowed` IS the tolerance the tracker used, so the band is read off the decision
        # rather than recomputed: a row written under one `parked_after` stays honest after
        # somebody changes it. The 100 is a separator between the two tolerances (12 and
        # 150), not a threshold of its own -- it only has to sit between them.
        band = "parked" if allowed >= PARKED_TOLERANCE_FLOOR else "settling"
        bands[band]["deaths"] += 1
        bands[band]["reacquired"] += 1 if reacq else 0
    out: Dict[str, Any] = {"scene": scene, "deaths": len(rows), "parkedAfter": parked_after,
                           "bands": bands}
    for name, b in bands.items():
        # None, never 0.0, when the band is empty. A rate of zero out of zero renders as
        # "we never lose these", which is the opposite of "we have not seen one yet".
        b["rate"] = round(b["reacquired"] / b["deaths"], 4) if b["deaths"] else None
    thin = [n for n, b in bands.items() if b["deaths"] < MIN_DEATHS_PER_BAND]
    if thin:
        out["verdict"] = "insufficient"
        out["why"] = (f"{', '.join(thin)} has fewer than {MIN_DEATHS_PER_BAND} recorded "
                      f"deaths; a rate from that is noise, not evidence")
        return out
    s, p = bands["settling"]["rate"], bands["parked"]["rate"]
    out["verdict"] = "settling-window-loses-more" if s > p else "no-settling-penalty"
    out["ratio"] = round(s / p, 3) if p else None
    out["why"] = (f"a track retired under the SHORT tolerance came back {s:.1%} of the time "
                  f"against {p:.1%} under the parked tolerance")
    return out


def diagnose(store: "TrajectoryStore", canonical: Tuple[int, int],
             scene: Optional[str] = None) -> Dict[str, Any]:
    """Where the vehicles ACTUALLY were, and which insets survive it.

    A refusal that only says "too narrow" leaves the operator with no next move. This
    reports the measurement behind it: how much ground the traffic covers, where, how deep
    it is at its widest, and what each candidate inset would keep. From that they can widen
    the view, lower the inset deliberately, or -- the answer this shop's first real run gave
    -- discover that the camera is not seeing the ground they thought it was.
    """
    import cv2

    pts = store.points(scene)
    grid = _occupancy(pts, canonical)
    region = _region_mask(grid)
    out: Dict[str, Any] = {
        "scene": scene, "points": len(pts), "tracks": len({p[1] for p in pts}),
        "cellsTouched": int(np.count_nonzero(grid)),
        "regionCells": int(np.count_nonzero(region)),
        "canonical": list(canonical),
    }
    if not region.any():
        out["why"] = "no region: no cell was touched by enough distinct tracks"
        return out
    dist = cv2.distanceTransform(region, cv2.DIST_L2, 3)
    ys, xs = np.nonzero(region)
    out["inradiusPx"] = round(float(dist.max()) * CELL_PX, 1)
    out["bbox"] = {"x0": int(xs.min()) * CELL_PX, "x1": int(xs.max()) * CELL_PX,
                   "y0": int(ys.min()) * CELL_PX, "y1": int(ys.max()) * CELL_PX}
    out["coverageOfFrame"] = round(
        float(np.count_nonzero(region)) / max(1, region.size), 4)
    out["insets"] = [
        {"px": px,
         "keepsFraction": round(float(np.count_nonzero(_erode_px(region, float(px), CELL_PX)))
                                / max(1, np.count_nonzero(region)), 3),
         "usable": bool(np.count_nonzero(_erode_px(region, float(px), CELL_PX))
                        / max(1, np.count_nonzero(region)) >= MIN_RETAINED_FRACTION)}
        for px in (8, 16, 24, 32, 40, 45, 60)]
    return out


def write_proposal(proposal: Dict[str, Any], path: str) -> str:
    """Write the proposal to `path`. Refuses to write over a calibration.

    The refusal is not paranoia. A commissioner and a calibration are the same shape, the
    file names differ by a few characters, and the failure -- silently replacing the geometry
    in force with an unreviewed guess -- is exactly what this module promises never to do.
    """
    name = os.path.basename(path).lower()
    if name.startswith("calib") or name.endswith(".calib.json"):
        raise ValueError(
            f"refusing to write a PROPOSAL to {path!r}: that name is a live calibration. "
            "A proposal is reviewed by a person and copied in deliberately.")
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(proposal, fh, indent=2)
    return path


def main(argv: Optional[Sequence[str]] = None) -> int:
    """`python -m vision.trajectory` -- read a store, print a proposal, optionally save it.

    Prints the DIFF first and loudest. The polygon is the interesting artefact, but the
    number an operator acts on is "how wrong is the one I am running now", and burying that
    under a list of coordinates is how a commissioning tool becomes a thing nobody runs.
    """
    import argparse

    ap = argparse.ArgumentParser(description="propose a lot polygon from observed traffic")
    ap.add_argument("--store", required=True, help="the --trajectories SQLite the producer wrote")
    ap.add_argument("--scene", default=None, help="scene id to commission (omit for all)")
    ap.add_argument("--calibration", default=None, help="the calibration IN FORCE, to diff against")
    ap.add_argument("--canonical", default=None, metavar="WxH",
                    help="frame size the points are in; read from --calibration when omitted")
    ap.add_argument("--inset-px", type=float, default=INSET_PX,
                    help="how far to pull the lot in from the measured drivable region")
    ap.add_argument("--out", default=None, help="write the proposal here (never a calib name)")
    ap.add_argument("--diagnose", action="store_true",
                    help="report WHERE the vehicles actually were and which insets survive, "
                         "instead of proposing. Use it when a proposal is refused.")
    args = ap.parse_args(argv)

    current = None
    canonical = None
    if args.calibration:
        with open(args.calibration, encoding="utf-8") as fh:
            current = json.load(fh)
        c = current.get("canonical")
        if c:
            canonical = (int(c[0]), int(c[1]))
    if args.canonical:
        w, h = args.canonical.lower().split("x")
        canonical = (int(w), int(h))
    if canonical is None:
        ap.error("need --canonical WxH, or a --calibration that carries one: the points are "
                 "in frame pixels and mean nothing without the frame they were measured in")

    store = TrajectoryStore(args.store)
    if not store.open:
        print(f"cannot read {args.store}: {store.stats.last_error}")
        return 2
    if args.diagnose:
        d = diagnose(store, canonical, args.scene)
        print(f"scene={d['scene']}  tracks={d['tracks']}  points={d['points']}")
        print(f"cells touched by >= {MIN_TRACKS_PER_CELL} distinct tracks: {d['cellsTouched']}"
              f"  -> region {d['regionCells']} cells")
        if "bbox" in d:
            b = d["bbox"]
            print(f"the ground vehicles actually use: x {b['x0']}..{b['x1']}  "
                  f"y {b['y0']}..{b['y1']}  of a {d['canonical'][0]}x{d['canonical'][1]} frame")
            print(f"  that is {d['coverageOfFrame']:.1%} of the frame, "
                  f"{d['inradiusPx']:.0f}px deep at its widest")
            print()
            for row in d["insets"]:
                print(f"  inset {row['px']:2d}px -> keeps {row['keepsFraction']:6.1%}"
                      + ("   <- usable" if row["usable"] else ""))
        else:
            print(d.get("why", ""))
        return 0
    p = TrajectoryCommissioner(store, canonical=canonical,
                               inset_px=args.inset_px).propose(args.scene, current)

    print(f"scene={p['scene']}  tracks={p['tracks']}  points={p['points']}")
    if not p["ready"]:
        print()
        print("NOT READY -- " + p["why"])
        return 1

    reading = (p.get("diff") or {}).get("reading")
    if reading:
        print()
        print("AGAINST THE CALIBRATION IN FORCE:")
        print("  " + reading)
    print()
    print(f"proposed lot: {len(p['lot'])} points, inset {p['insetPx']:.0f}px, keeping "
          f"{p['retainedFraction']:.0%} of ground {p['regionInradiusPx']:.0f}px deep at its widest")
    for e in p["entries"]:
        print(f"  entry cluster at {e['at']}  ({e['tracks']} tracks first seen there)")
    for d in p["dwell"]:
        print(f"  dwell cluster at {d['at']}  ({d['vehicles']} vehicles stopped there)")
    if args.out:
        print()
        print("wrote " + write_proposal(p, args.out))
        print("REVIEW IT, then copy the polygon into the calibration by hand. Nothing here "
              "changes what the producer is running.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
