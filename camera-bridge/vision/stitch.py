"""EpisodeStitcher: one VEHICLE's visit, across the several TRACKS it was seen as.

THE DEFECT THIS EXISTS FOR
--------------------------
`pipeline.py` keys `VisitTiming` on `track_id`, and starts a fresh one with
`arrived_at=now` whenever a track is promoted to an arrival. A tracker id is not a
vehicle: it is how long the tracker managed to hold on. Measured on this shop's own
ledger on 2026-09-22 -- `shop-left` 152 track deaths in a day against a shop that
invoices 1-6 jobs, and only 13.8% of those deaths ever re-acquired; `shop-right`
81 deaths, 18.5% re-acquired.

So when a parked car's track dies and the same car is picked up again a moment later,
the shop records a SECOND arrival whose clock starts at zero. `waitToBay` and
`totalVisit` are measured from the wrong instant, and the earlier fragment's timings
are simply lost. Every stage timing downstream inherits that.

THE ASYMMETRY, WHICH GOVERNS EVERY GATE BELOW
---------------------------------------------
`appearance.py` and `fingerprint.py` already state it for identity, and it is the same
here: falsely MERGING two customers into one visit is much worse than temporarily
SPLITTING one customer into two. A false merge writes one customer's wait time onto
another's job and there is no later evidence that can unpick it. A false split is
visible, countable, and conservative.

Two silver sedans of the same model parked side by side is a Tuesday at a tire shop,
not a corner case. So every rule here is written to REFUSE when it cannot tell, and
the refusals are counted rather than swallowed.

WHAT EVIDENCE IS ACTUALLY AVAILABLE
-----------------------------------
`vision/track.py:Track` carries geometry and timing -- box, ground point, path, zones,
born_ts, last_seen -- and nothing else. It carries NO colour, NO vehicle type, NO plate
and NO ReID embedding. `fingerprint.compare()` exists and is tested, but as of this
commit nothing in `pipeline.py` ever constructs a `VehicleFingerprint`, so it is a
reader with no writer.

This module therefore stitches on SPATIO-TEMPORAL CONTINUITY ONLY, which is evidence
the pipeline genuinely has. `compare_fn` is an injection point: when appearance is
wired, a `CONTRADICTED` verdict VETOES a stitch that geometry would otherwise have
allowed. It can only ever veto. Geometry alone may never be overruled INTO a merge by
appearance, because that is the direction that merges two customers.

WHY AMBIGUITY REFUSES RATHER THAN PICKING THE BEST
--------------------------------------------------
If two retired fragments both satisfy the gates, the honest answer is that we do not
know which car this is -- and that is precisely the two-silver-sedans case. Picking the
nearest would be picking a coin flip and recording it as a fact. So it refuses, both
fragments stay unclaimed, and `refused_ambiguous` goes up where somebody can see it.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

#: How long a retired fragment stays adoptable.
#:
#: 90.0 STANDS, and the attempt to retune it is recorded here because the attempt was
#: wrong in a way worth not repeating. A sweep (`scripts/stitch_sweep.py`) appeared to
#: show 90s as the worst setting tried, and this constant was briefly changed to 30.
#: Review caught two defects in that sweep, both of which invalidated it:
#:
#:   1. It replayed EVERY row in `track_points`. `VisionPipeline` calls `adopt()` only
#:      inside `if verdict["crossed"]` and retires only `evidence == "arrival"` tracks,
#:      so parked and candidate tracks never reach the stitcher. The sweep manufactured
#:      most of the fragments and refusals it then reported -- 354 tracks where the real
#:      population is 57.
#:   2. It re-translated the ground point. `TrajectoryStore.observe()` already stores
#:      `track.ground_point` in `x`,`y`; adding `w/2` and `h` invented displacement
#:      wherever box sizes differed, which is precisely what the spatial gate reads.
#:
#: Corrected, on the population the stitcher actually sees:
#:
#:   shop-left    30s -> 11 stitched /  0 ambiguous
#:                60s -> 14 stitched /  5 ambiguous
#:                90s -> 13 stitched /  8 ambiguous
#:               150s -> 16 stitched / 11 ambiguous
#:   shop-right   30s ->  4 stitched /  2 ambiguous
#:                90s ->  4 stitched /  2 ambiguous   (identical)
#:
#: A longer window stitches MORE, not fewer -- the opposite of the retune's claim. And the
#: framing was wrong too: an ambiguity refusal is not damage. It leaves the visit exactly
#: as it was before the stitcher existed, so it is non-improvement, not regression. The
#: figure to maximise is STITCHES, subject to never false-merging.
#:
#: That argues for a LONGER window, but 16-vs-13 stitches on one day of one shop is not
#: enough to move a shipped default in either direction. Re-run the sweep across more days
#: before changing it.
DEFAULT_MAX_GAP_S = 90.0

#: Plausible ground-point travel while unobserved, in pixels per second. The spatial
#: gate is `dist <= speed * gap + slack` rather than a flat radius, because a flat
#: radius is simultaneously too tight for a 60-second gap and too loose for a 2-second
#: one. Measured lot traffic on these lenses sits well under this.
DEFAULT_MAX_SPEED_PX_S = 45.0

#: Slack on the spatial gate, absorbing box jitter and the ground-point wobble a
#: re-acquired detection has on its first frame.
DEFAULT_SLACK_PX = 40.0


@dataclass
class Fragment:
    """A retired track that might turn out to have been part of a longer visit."""
    track_id: int
    episode_id: str
    born_ts: float
    died_at: float
    last_point: Tuple[float, float]
    #: Track ids already folded into this episode, oldest first. A visit seen as four
    #: tracks carries all four, so the evidence trail survives the stitch.
    member_track_ids: List[int] = field(default_factory=list)
    arrived_at: Optional[float] = None
    fingerprint: Any = None
    #: The layout epoch these pixel coordinates were measured in. A scene relocation
    #: changes what a coordinate MEANS, so comparing a pre-relocation last_point against
    #: a post-relocation ground point is comparing two different pixel spaces and can
    #: manufacture a stitch out of nothing. `trajectory.py` guards the same hazard with
    #: `generation`; this is that guard for the stitcher.
    layout_epoch: Optional[int] = None


@dataclass
class StitchDecision:
    """Why a track did or did not continue an earlier fragment. Always emitted."""
    stitched: bool
    episode_id: str
    continues_track_id: Optional[int] = None
    reason: str = ""
    candidates_considered: int = 0
    gap_s: Optional[float] = None
    distance_px: Optional[float] = None
    #: Track ids already folded into the continued episode, oldest first. Carried ON the
    #: decision rather than looked up afterwards: `adopt()` consumes the fragment, so a
    #: post-hoc lookup by `continues_track_id` finds nothing. (Written as such a lookup
    #: first; the test for the four-fragment chain is what caught it.)
    member_track_ids: List[int] = field(default_factory=list)
    #: The ORIGINAL arrival instant, carried forward. This is the whole point: without
    #: it the re-acquired track restarts the clock at `now` and `waitToBay` is measured
    #: from the wrong instant.
    arrived_at: Optional[float] = None

    def to_dict(self) -> dict:
        return {
            "stitched": self.stitched,
            "episodeId": self.episode_id,
            "continuesTrackId": self.continues_track_id,
            "reason": self.reason,
            "candidatesConsidered": self.candidates_considered,
            "gapS": None if self.gap_s is None else round(self.gap_s, 2),
            "distancePx": None if self.distance_px is None else round(self.distance_px, 1),
            "memberTrackIds": list(self.member_track_ids),
            "arrivedAt": self.arrived_at,
        }


class EpisodeStitcher:
    """Hands out episode ids, and decides when a new track continues an old one.

    The pipeline calls `retire()` when a track dies and `adopt()` when a track is
    promoted to an arrival. Everything else is counters.
    """

    def __init__(
        self,
        camera: str = "",
        max_gap_s: float = DEFAULT_MAX_GAP_S,
        max_speed_px_s: float = DEFAULT_MAX_SPEED_PX_S,
        slack_px: float = DEFAULT_SLACK_PX,
        compare_fn: Optional[Callable[[Any, Any], Any]] = None,
    ) -> None:
        self.camera = camera
        self.max_gap_s = float(max_gap_s)
        self.max_speed_px_s = float(max_speed_px_s)
        self.slack_px = float(slack_px)
        #: Injected `fingerprint.compare`-shaped callable. VETO ONLY -- see module docs.
        self.compare_fn = compare_fn
        self._fragments: Dict[int, Fragment] = {}
        self._seq = 0
        self.counters: Dict[str, int] = {
            "episodes_opened": 0,
            "stitched": 0,
            "refused_ambiguous": 0,
            "refused_contradicted": 0,
            "refused_no_candidate": 0,
            "fragments_expired_unclaimed": 0,
        }

    # ---------------------------------------------------------------- ids

    def _new_episode_id(self, now: float) -> str:
        self._seq += 1
        cam = self.camera or "cam"
        return f"{cam}-{int(now)}-{self._seq}"

    # ---------------------------------------------------------------- retire

    def retire(self, track: Any, now: float, *, episode_id: str,
               arrived_at: Optional[float] = None,
               member_track_ids: Optional[List[int]] = None,
               fingerprint: Any = None,
               layout_epoch: Optional[int] = None) -> None:
        """Record a died track as adoptable. Called from the pipeline's death pass."""
        self._fragments[int(track.track_id)] = Fragment(
            track_id=int(track.track_id),
            episode_id=episode_id,
            born_ts=float(getattr(track, "born_ts", now)),
            died_at=float(now),
            last_point=tuple(float(v) for v in track.ground_point),  # type: ignore[arg-type]
            member_track_ids=list(member_track_ids or [int(track.track_id)]),
            arrived_at=arrived_at,
            fingerprint=fingerprint,
            layout_epoch=layout_epoch,
        )

    # ---------------------------------------------------------------- expiry

    def expire(self, now: float) -> int:
        """Drop fragments past the window. Returns how many went unclaimed.

        Counted, not silent: a high unclaimed rate is the signal that the window is
        too short or that the tracker is churning, and it must be visible to whoever
        reads the summary rather than being inferred from an absence.
        """
        stale = [tid for tid, f in self._fragments.items()
                 if now - f.died_at > self.max_gap_s]
        for tid in stale:
            self._fragments.pop(tid, None)
            self.counters["fragments_expired_unclaimed"] += 1
        return len(stale)

    # ---------------------------------------------------------------- adopt

    def _gates(self, frag: Fragment, track: Any, now: float
               ) -> Tuple[bool, float, float, str]:
        gap = now - frag.died_at
        px, py = frag.last_point
        gx, gy = track.ground_point
        dist = math.hypot(float(gx) - px, float(gy) - py)

        if gap < 0:
            return False, gap, dist, "fragment died after this track appeared"
        if gap > self.max_gap_s:
            return False, gap, dist, f"gap {gap:.1f}s over {self.max_gap_s:.0f}s"

        # A vehicle cannot be two live tracks at once. If this track was already alive
        # while the fragment was alive, they are two different objects and no amount of
        # spatial proximity makes them one. This is the gate that stops a stitcher from
        # merging two cars parked next to each other that were tracked simultaneously.
        born = float(getattr(track, "born_ts", now))
        if born < frag.died_at:
            return False, gap, dist, "lifetimes overlapped -- two simultaneous tracks"

        reach = self.max_speed_px_s * max(0.0, gap) + self.slack_px
        if dist > reach:
            return False, gap, dist, f"moved {dist:.0f}px, reachable {reach:.0f}px"
        return True, gap, dist, "spatio-temporal continuity"

    def adopt(self, track: Any, now: float, *, fingerprint: Any = None,
              layout_epoch: Optional[int] = None) -> StitchDecision:
        """Decide whether `track` continues a retired fragment, or opens a new episode."""
        self.expire(now)

        passed: List[Tuple[Fragment, float, float, str]] = []
        #: Rejections are KEPT, not discarded. "no adoptable fragment" as the only
        #: refusal reason is an absence hiding its cause: it reads identically whether
        #: the window is too short, the speed model too tight, or the lot genuinely
        #: empty -- and those call for opposite fixes. The nearest miss is reported.
        rejected: List[Tuple[Fragment, float, float, str]] = []
        for frag in self._fragments.values():
            # Cross-epoch pairs are not merely unlikely, they are UNCOMPARABLE: the two
            # points are in different pixel spaces. Refuse before the spatial gate,
            # which would otherwise treat them as though they shared a coordinate frame.
            if (layout_epoch is not None and frag.layout_epoch is not None
                    and int(layout_epoch) != int(frag.layout_epoch)):
                rejected.append((frag, now - frag.died_at, float("nan"),
                                 f"layout epoch {frag.layout_epoch} -> {layout_epoch}: "
                                 "different pixel space, not comparable"))
                continue
            ok, gap, dist, why = self._gates(frag, track, now)
            (passed if ok else rejected).append((frag, gap, dist, why))

        # Appearance may only ever VETO. A contradicted candidate is removed from the
        # running before ambiguity is judged, so a genuine plate disagreement can rescue
        # an otherwise-ambiguous pair rather than being outvoted by it.
        if self.compare_fn is not None and fingerprint is not None:
            kept: List[Tuple[Fragment, float, float, str]] = []
            for frag, gap, dist, why in passed:
                if frag.fingerprint is None:
                    kept.append((frag, gap, dist, why))
                    continue
                verdict = getattr(self.compare_fn(frag.fingerprint, fingerprint),
                                  "verdict", "UNKNOWN")
                if verdict == "CONTRADICTED":
                    self.counters["refused_contradicted"] += 1
                    continue
                kept.append((frag, gap, dist, why))
            passed = kept

        if not passed:
            self.counters["episodes_opened"] += 1
            self.counters["refused_no_candidate"] += 1
            if not rejected:
                reason, gap, dist = "no fragment was open at all", None, None
            else:
                # The most recently-died fragment is the likeliest intended
                # continuation, so its gate failure is the informative one.
                frag, gap, dist, why = max(rejected, key=lambda r: r[0].died_at)
                reason = f"nearest miss (track {frag.track_id}): {why}"
            return StitchDecision(
                stitched=False, episode_id=self._new_episode_id(now),
                reason=reason, candidates_considered=len(rejected),
                gap_s=gap, distance_px=dist,
            )

        if len(passed) > 1:
            # Refuse. See the module docstring: picking the nearest would be recording
            # a coin flip as a fact, and the cost of guessing wrong is a merged visit.
            self.counters["refused_ambiguous"] += 1
            self.counters["episodes_opened"] += 1
            return StitchDecision(
                stitched=False, episode_id=self._new_episode_id(now),
                reason=f"{len(passed)} fragments equally plausible -- refusing to guess",
                candidates_considered=len(passed),
            )

        frag, gap, dist, why = passed[0]
        self._fragments.pop(frag.track_id, None)
        self.counters["stitched"] += 1
        return StitchDecision(
            stitched=True, episode_id=frag.episode_id,
            continues_track_id=frag.track_id, reason=why,
            candidates_considered=1, gap_s=gap, distance_px=dist,
            member_track_ids=list(frag.member_track_ids) + [int(track.track_id)],
            arrived_at=frag.arrived_at,
        )

    # ---------------------------------------------------------------- readout

    def open_fragments(self) -> int:
        return len(self._fragments)

    def to_dict(self) -> dict:
        d = {k: int(v) for k, v in self.counters.items()}
        d["openFragments"] = len(self._fragments)
        return d
