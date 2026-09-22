"""EpisodeStitcher tests.

Every test here asserts a DECISION, not the presence of a field. The failure mode this
module guards against is a stitcher that quietly merges two customers, and a test that
only checks "an episode id came back" would pass just as happily for the merged case.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple

import pytest

from vision.stitch import EpisodeStitcher, StitchDecision


@dataclass
class FakeTrack:
    """Only the three attributes the stitcher actually reads."""
    track_id: int
    born_ts: float
    point: Tuple[float, float]

    @property
    def ground_point(self) -> Tuple[float, float]:
        return self.point


def _stitcher(**kw) -> EpisodeStitcher:
    return EpisodeStitcher(camera="test", **kw)


# --------------------------------------------------------------- the happy path

def test_reacquired_car_continues_the_episode_and_keeps_its_original_arrival():
    """The whole point: the clock must NOT restart at the re-acquisition."""
    s = _stitcher()
    first = FakeTrack(track_id=1, born_ts=100.0, point=(500.0, 400.0))
    s.retire(first, now=160.0, episode_id="ep-1", arrived_at=100.0)

    again = FakeTrack(track_id=2, born_ts=170.0, point=(520.0, 410.0))
    d = s.adopt(again, now=170.0)

    assert d.stitched is True
    assert d.episode_id == "ep-1"
    assert d.continues_track_id == 1
    # The original arrival survives -- this is what fixes waitToBay/totalVisit.
    assert d.arrived_at == 100.0
    assert s.counters["stitched"] == 1


def test_a_stitch_accumulates_the_whole_track_trail():
    """A visit seen as four tracks must carry all four ids, not just the last pair.

    This is the canary for a real bug in the first draft: `adopt()` consumes the
    fragment, so reading the member list back out of the store AFTER the adopt
    returned an empty list and the evidence trail silently truncated to one id.
    """
    s = _stitcher()
    t1 = FakeTrack(track_id=1, born_ts=100.0, point=(500.0, 400.0))
    s.retire(t1, now=110.0, episode_id="ep-1", arrived_at=100.0)

    members = [1]
    ep = "ep-1"
    arrived = 100.0
    for n, (tid, born) in enumerate([(2, 120.0), (3, 140.0), (4, 160.0)], start=1):
        tr = FakeTrack(track_id=tid, born_ts=born, point=(500.0, 400.0))
        d = s.adopt(tr, now=born)
        assert d.stitched is True, f"hop {n} failed to stitch"
        members = d.member_track_ids
        ep, arrived = d.episode_id, d.arrived_at
        s.retire(tr, now=born + 10.0, episode_id=ep,
                 arrived_at=arrived, member_track_ids=members)

    assert members == [1, 2, 3, 4]
    assert ep == "ep-1"
    assert arrived == 100.0


# --------------------------------------------------------------- the refusals

def test_two_plausible_fragments_refuse_rather_than_guess():
    """Two silver sedans side by side. Guessing the nearest would record a coin flip."""
    s = _stitcher()
    a = FakeTrack(track_id=1, born_ts=100.0, point=(500.0, 400.0))
    b = FakeTrack(track_id=2, born_ts=100.0, point=(540.0, 400.0))
    s.retire(a, now=160.0, episode_id="ep-a", arrived_at=100.0)
    s.retire(b, now=160.0, episode_id="ep-b", arrived_at=101.0)

    newcomer = FakeTrack(track_id=3, born_ts=170.0, point=(520.0, 400.0))
    d = s.adopt(newcomer, now=170.0)

    assert d.stitched is False
    assert d.continues_track_id is None
    assert d.candidates_considered == 2
    assert d.episode_id not in ("ep-a", "ep-b")
    assert s.counters["refused_ambiguous"] == 1
    assert s.counters["stitched"] == 0


def test_overlapping_lifetimes_can_never_stitch():
    """A vehicle cannot be two live tracks at once, however close they sit."""
    s = _stitcher()
    parked = FakeTrack(track_id=1, born_ts=100.0, point=(500.0, 400.0))
    s.retire(parked, now=200.0, episode_id="ep-1", arrived_at=100.0)

    # Born at 150 -- while track 1 was still alive. Same pixel. Still not the same car.
    neighbour = FakeTrack(track_id=2, born_ts=150.0, point=(500.0, 400.0))
    d = s.adopt(neighbour, now=205.0)

    assert d.stitched is False
    assert "overlapped" in d.reason


def test_gap_beyond_the_window_refuses_and_counts_the_fragment_as_unclaimed():
    s = _stitcher(max_gap_s=60.0)
    t1 = FakeTrack(track_id=1, born_ts=100.0, point=(500.0, 400.0))
    s.retire(t1, now=160.0, episode_id="ep-1", arrived_at=100.0)

    late = FakeTrack(track_id=2, born_ts=400.0, point=(500.0, 400.0))
    d = s.adopt(late, now=400.0)

    assert d.stitched is False
    assert s.counters["fragments_expired_unclaimed"] == 1
    assert s.open_fragments() == 0


def test_a_car_too_far_away_to_have_driven_there_refuses():
    s = _stitcher(max_speed_px_s=45.0, slack_px=40.0)
    t1 = FakeTrack(track_id=1, born_ts=100.0, point=(100.0, 100.0))
    s.retire(t1, now=160.0, episode_id="ep-1", arrived_at=100.0)

    # 2s later, 900px away: reachable is 45*2+40 = 130px.
    far = FakeTrack(track_id=2, born_ts=162.0, point=(1000.0, 100.0))
    d = s.adopt(far, now=162.0)

    assert d.stitched is False
    assert "reachable" in d.reason


def test_the_spatial_gate_scales_with_the_gap_rather_than_being_a_flat_radius():
    """Same distance, different gap: unreachable in 1s, comfortable in 30s."""
    far_point = (500.0 + 300.0, 400.0)

    quick = _stitcher()
    a = FakeTrack(track_id=1, born_ts=100.0, point=(500.0, 400.0))
    quick.retire(a, now=160.0, episode_id="ep-1", arrived_at=100.0)
    assert quick.adopt(FakeTrack(2, 161.0, far_point), now=161.0).stitched is False

    slow = _stitcher()
    b = FakeTrack(track_id=1, born_ts=100.0, point=(500.0, 400.0))
    slow.retire(b, now=160.0, episode_id="ep-1", arrived_at=100.0)
    assert slow.adopt(FakeTrack(2, 190.0, far_point), now=190.0).stitched is True


# --------------------------------------------------------------- appearance veto

class _Verdict:
    def __init__(self, verdict: str) -> None:
        self.verdict = verdict


def test_a_contradicting_fingerprint_vetoes_a_stitch_geometry_would_have_allowed():
    s = _stitcher(compare_fn=lambda a, b: _Verdict("CONTRADICTED"))
    t1 = FakeTrack(track_id=1, born_ts=100.0, point=(500.0, 400.0))
    s.retire(t1, now=160.0, episode_id="ep-1", arrived_at=100.0, fingerprint={"plate": "AAA"})

    again = FakeTrack(track_id=2, born_ts=170.0, point=(505.0, 402.0))
    d = s.adopt(again, now=170.0, fingerprint={"plate": "BBB"})

    assert d.stitched is False
    assert s.counters["refused_contradicted"] == 1


def test_appearance_may_veto_but_never_create_a_stitch():
    """SAME on a pair geometry rejected must still refuse. Veto-only, by design."""
    s = _stitcher(max_gap_s=60.0, compare_fn=lambda a, b: _Verdict("SAME"))
    t1 = FakeTrack(track_id=1, born_ts=100.0, point=(500.0, 400.0))
    s.retire(t1, now=160.0, episode_id="ep-1", arrived_at=100.0, fingerprint={"plate": "AAA"})

    way_later = FakeTrack(track_id=2, born_ts=900.0, point=(500.0, 400.0))
    d = s.adopt(way_later, now=900.0, fingerprint={"plate": "AAA"})

    assert d.stitched is False, "appearance must not rescue a geometry refusal"


def test_a_contradicted_candidate_is_removed_before_ambiguity_is_judged():
    """Ruling one of two out by plate should RESCUE the stitch, not leave it ambiguous."""
    def compare(frag_fp, new_fp):
        return _Verdict("CONTRADICTED" if frag_fp != new_fp else "SAME")

    s = _stitcher(compare_fn=compare)
    a = FakeTrack(track_id=1, born_ts=100.0, point=(500.0, 400.0))
    b = FakeTrack(track_id=2, born_ts=100.0, point=(540.0, 400.0))
    s.retire(a, now=160.0, episode_id="ep-a", arrived_at=100.0, fingerprint="AAA")
    s.retire(b, now=160.0, episode_id="ep-b", arrived_at=101.0, fingerprint="BBB")

    newcomer = FakeTrack(track_id=3, born_ts=170.0, point=(520.0, 400.0))
    d = s.adopt(newcomer, now=170.0, fingerprint="AAA")

    assert d.stitched is True
    assert d.episode_id == "ep-a"
    assert s.counters["refused_contradicted"] == 1


# --------------------------------------------------------------- observability

def test_refusals_are_visible_in_the_summary_not_swallowed():
    s = _stitcher()
    lone = FakeTrack(track_id=9, born_ts=10.0, point=(1.0, 1.0))
    s.adopt(lone, now=10.0)

    d = s.to_dict()
    assert d["refused_no_candidate"] == 1
    assert d["episodes_opened"] == 1
    assert "openFragments" in d


def test_a_refusal_names_which_gate_failed_rather_than_just_saying_no():
    """Distinct causes need distinct reasons -- they call for opposite fixes.

    Too-short a window and too-tight a speed model both present as "didn't stitch".
    If both report the same string, the operator tuning this has no signal at all.
    """
    too_far = _stitcher()
    a = FakeTrack(track_id=1, born_ts=100.0, point=(100.0, 100.0))
    too_far.retire(a, now=160.0, episode_id="ep-1", arrived_at=100.0)
    far_reason = too_far.adopt(FakeTrack(2, 162.0, (1000.0, 100.0)), now=162.0).reason

    overlap = _stitcher()
    b = FakeTrack(track_id=1, born_ts=100.0, point=(500.0, 400.0))
    overlap.retire(b, now=200.0, episode_id="ep-1", arrived_at=100.0)
    overlap_reason = overlap.adopt(FakeTrack(2, 150.0, (500.0, 400.0)), now=205.0).reason

    empty_reason = _stitcher().adopt(FakeTrack(1, 10.0, (0.0, 0.0)), now=10.0).reason

    assert "reachable" in far_reason
    assert "overlapped" in overlap_reason
    assert "no fragment was open" in empty_reason
    assert len({far_reason, overlap_reason, empty_reason}) == 3
    # And the nearest miss identifies WHICH fragment, so it can be looked up.
    assert "track 1" in far_reason


def test_every_adopt_returns_a_decision_even_when_it_refuses():
    """A refusal must never be an absence. `None` here would read as 'nothing happened'."""
    s = _stitcher()
    d = s.adopt(FakeTrack(1, 10.0, (0.0, 0.0)), now=10.0)
    assert isinstance(d, StitchDecision)
    assert d.episode_id
    assert d.reason


# ------------------------------------------------- self-audit: found in my own diff

def test_a_scene_relocation_forbids_stitching_across_the_epoch():
    """Post-relocation pixels mean something different. The points are UNCOMPARABLE.

    Found re-reading my own diff: the spatial gate happily compared a pre-relocation
    `last_point` against a post-relocation ground point, which can manufacture a stitch
    out of a coordinate change. `trajectory.py` guards the same hazard with `generation`.
    """
    s = _stitcher()
    t1 = FakeTrack(track_id=1, born_ts=100.0, point=(500.0, 400.0))
    s.retire(t1, now=160.0, episode_id="ep-1", arrived_at=100.0, layout_epoch=3)

    again = FakeTrack(track_id=2, born_ts=170.0, point=(500.0, 400.0))
    same = s.adopt(again, now=170.0, layout_epoch=3)
    assert same.stitched is True, "same epoch must still stitch"

    s2 = _stitcher()
    s2.retire(t1, now=160.0, episode_id="ep-1", arrived_at=100.0, layout_epoch=3)
    crossed = s2.adopt(again, now=170.0, layout_epoch=4)
    assert crossed.stitched is False
    assert "pixel space" in crossed.reason


def test_an_unstamped_source_is_not_punished_for_a_field_it_never_provides():
    """None epoch means unknown, not 'a distinct epoch'. Otherwise every stitch refuses."""
    s = _stitcher()
    t1 = FakeTrack(track_id=1, born_ts=100.0, point=(500.0, 400.0))
    s.retire(t1, now=160.0, episode_id="ep-1", arrived_at=100.0, layout_epoch=None)
    d = s.adopt(FakeTrack(2, 170.0, (500.0, 400.0)), now=170.0, layout_epoch=None)
    assert d.stitched is True


def test_fragments_do_not_accumulate_without_end():
    """Overnight there are deaths and no arrivals, so expiry cannot live only in adopt().

    The second defect from the same self-audit. Without a per-step expiry the store
    grows for as long as the producer runs, and `fragments_expired_unclaimed` -- the
    signal that the window is mistuned -- never advances.
    """
    s = _stitcher(max_gap_s=30.0)
    for tid in range(50):
        s.retire(FakeTrack(tid, float(tid), (5.0 * tid, 100.0)),
                 now=float(tid), episode_id=f"ep-{tid}", arrived_at=float(tid))
    assert s.open_fragments() == 50

    s.expire(now=10_000.0)
    assert s.open_fragments() == 0
    assert s.counters["fragments_expired_unclaimed"] == 50
