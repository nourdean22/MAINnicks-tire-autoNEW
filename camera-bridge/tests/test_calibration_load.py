"""B5 (camera audit 2026-10-07): a driveway portal that cannot be crossed must refuse the calibration.

`EntryPortal` records an entry only for "outside, then inside, having touched the portal". A portal
drawn wholly inside the lot is touched only by cars already in; one wholly outside only by cars that
never enter. Either way the lane counts zero arrivals while every health surface stays green. The
loader now samples the portal against the lot polygon and refuses a file whose portal does not
straddle the boundary, exactly as if the file were missing: census mode, no calibrationVersion in
the heartbeat, which the shop renders as CALIBRATION_INVALID.

The first fixture is the calibration running on NicksMax, read from
data/calib-nicksmax-sign-rtsp.json on 2026-10-08 (canonical 640x360): it straddles, so the check
is a guard for the next calibration, not a finding against this one.
"""
from __future__ import annotations

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from edge_main import load_calibration  # noqa: E402
from vision.geometry import portal_straddles  # noqa: E402

NICKSMAX_LOT = [(173, 143), (618, 143), (638, 186), (638, 359), (101, 359), (137, 323), (173, 287)]
NICKSMAX_PORTAL = [(29, 280), (209, 273), (180, 359), (29, 359)]
PORTAL_INSIDE_LOT = [(300, 200), (400, 200), (400, 300), (300, 300)]
PORTAL_OUTSIDE_LOT = [(10, 10), (60, 10), (60, 60), (10, 60)]


def test_the_live_nicksmax_calibration_straddles_the_lot_boundary():
    verdict = portal_straddles(NICKSMAX_LOT, NICKSMAX_PORTAL)
    assert verdict["ok"] is True, verdict
    assert verdict["inside"] >= 1 and verdict["outside"] >= 1
    assert verdict["samples"] == 4 + 4 + 1  # vertices, edge midpoints, centroid
    assert verdict["crossings"] >= 1  # its edges cross the lot boundary, the exact test agrees


# Codex on #2925: sampling at vertices, midpoints and the centroid is blind to a long band whose
# middle crosses the lot while every sample sits outside. Positive control: the pre-fix sampler
# returned ok=False with reason "wholly outside" for this portal; the edge test sees two crossings.
LOT_SQUARE = [(100, 100), (200, 100), (200, 200), (100, 200)]
BAND_THROUGH_THE_LOT = [(-200, 140), (-200, 160), (300, 160), (300, 140)]


def test_a_long_band_whose_middle_crosses_the_lot_straddles_even_when_every_sample_is_outside():
    verdict = portal_straddles(LOT_SQUARE, BAND_THROUGH_THE_LOT)
    assert verdict["inside"] == 0  # the sampler alone sees nothing inside...
    assert verdict["crossings"] == 4  # ...the band's top and bottom edges each cross the lot's left and right edges
    assert verdict["ok"] is True, verdict
    assert "straddles" in verdict["reason"]


FULL_FRAME = [(0, 0), (1000, 0), (1000, 1000), (0, 1000)]


def test_a_portal_drawn_around_the_whole_lot_straddles():
    # A full-frame portal crosses no lot edge, and with the lot off-centre every sample (its
    # vertices, edge midpoints, centroid) lands outside the lot too. It still holds the lot's
    # corners, so a car inside it passes from outside the lot to inside. Positive control: before
    # the containment rule this returned ok=False, "portal lies wholly outside the lot".
    verdict = portal_straddles(LOT_SQUARE, FULL_FRAME)
    assert verdict["ok"] is True, verdict
    assert verdict["crossings"] == 0 and verdict["inside"] == 0
    assert verdict["contained"] == 4


SHOP_LOT_2026_09_16 = [(143, 117), (535, 130), (535, 294), (55, 294), (55, 192)]
SHOP_PORTAL_2026_09_16 = [(55, 192), (143, 117), (187, 130), (99, 210)]


def test_the_2026_09_16_shop_calibration_is_refused_by_the_edge_loader(tmp_path):
    # The hand-drawn calibration caught on the shop PC: the portal sits wholly inside the lot with
    # two corners snapped onto lot corners. Positive control (2026-10-08): with boundary samples
    # counted by `point_in_poly`, the corner (143, 117) read as outside, the sampler saw both
    # sides, and the production loader ACCEPTED it (the dev runner's grid refused it).
    verdict = portal_straddles(SHOP_LOT_2026_09_16, SHOP_PORTAL_2026_09_16)
    assert verdict["ok"] is False, verdict
    assert verdict["outside"] == 0 and verdict["boundary"] == 3  # two snapped corners and the shared edge's midpoint
    refused = load_calibration(_write(tmp_path, SHOP_LOT_2026_09_16, SHOP_PORTAL_2026_09_16))
    assert refused.fault and "wholly inside" in refused.fault


def test_a_lot_corner_on_the_portal_boundary_is_not_containment():
    # The portal meets the lot only at its corner (200, 200), from outside: nothing in it is inside the lot.
    corner = [(200, 200), (300, 200), (300, 300), (200, 300)]
    verdict = portal_straddles(LOT_SQUARE, corner)
    assert verdict["contained"] == 0 and verdict["crossings"] == 0
    assert verdict["ok"] is False and "outside" in verdict["reason"]


# The dev runner (vision.run_live) once carried its own grid sampler for this question. A band thinner
# than one grid cell found no cell on either side and was refused as "entirely INSIDE" while the edge
# loader accepted it. Positive control (2026-10-08): with the grid sampler restored, the THIN_BAND case
# fails this test and the other five pass.
THIN_BAND = [(-200, 149.8), (300, 149.8), (300, 150.2), (-200, 150.2)]


@pytest.mark.parametrize(
    "lot, portal",
    [
        (NICKSMAX_LOT, NICKSMAX_PORTAL),
        (NICKSMAX_LOT, PORTAL_INSIDE_LOT),
        (NICKSMAX_LOT, PORTAL_OUTSIDE_LOT),
        (LOT_SQUARE, BAND_THROUGH_THE_LOT),
        (LOT_SQUARE, THIN_BAND),
        (LOT_SQUARE, FULL_FRAME),
        (SHOP_LOT_2026_09_16, SHOP_PORTAL_2026_09_16),
    ],
)
def test_the_dev_runner_and_the_edge_loader_give_one_answer(lot, portal):
    from vision.run_live import PortalNotUsable, assert_portal_straddles

    try:
        assert_portal_straddles(lot, portal)
        accepted = True
    except PortalNotUsable:
        accepted = False
    assert accepted is portal_straddles(lot, portal)["ok"]


def test_a_portal_that_only_touches_the_lot_boundary_is_not_crossable():
    # Shares the lot's left edge exactly and lies inside: no point is both in the portal and outside the lot.
    touching = [(100, 120), (150, 120), (150, 180), (100, 180)]
    verdict = portal_straddles(LOT_SQUARE, touching)
    assert verdict["crossings"] == 0
    assert verdict["ok"] is False and "inside" in verdict["reason"]


def test_a_portal_wholly_inside_or_wholly_outside_the_lot_cannot_be_crossed():
    inside = portal_straddles(NICKSMAX_LOT, PORTAL_INSIDE_LOT)
    outside = portal_straddles(NICKSMAX_LOT, PORTAL_OUTSIDE_LOT)
    assert inside["ok"] is False and inside["outside"] == 0 and "inside" in inside["reason"]
    assert outside["ok"] is False and outside["inside"] == 0 and "outside" in outside["reason"]


def test_degenerate_polygons_are_refused_not_guessed():
    assert portal_straddles(NICKSMAX_LOT, [(1, 1), (2, 2)])["ok"] is False
    assert portal_straddles([(0, 0), (1, 1)], NICKSMAX_PORTAL)["ok"] is False


def _write(tmp_path, lot, portal):
    path = tmp_path / "calib.json"
    path.write_text(
        json.dumps({"canonical": [640, 360], "lensType": "fixed", "lot": lot, "portal": portal, "bays": {}}),
        encoding="utf-8",
    )
    return str(path)


def test_loader_keeps_a_straddling_calibration_with_its_version(tmp_path):
    loaded = load_calibration(_write(tmp_path, NICKSMAX_LOT, NICKSMAX_PORTAL))
    assert loaded.fault is None
    assert loaded.version and loaded.version.startswith("sha256:")
    assert loaded.lot == [tuple(p) for p in NICKSMAX_LOT]
    assert loaded.portal == [tuple(p) for p in NICKSMAX_PORTAL]
    assert loaded.straddle["ok"] is True


def test_loader_refuses_an_uncrossable_portal_exactly_like_a_missing_file(tmp_path):
    refused = load_calibration(_write(tmp_path, NICKSMAX_LOT, PORTAL_INSIDE_LOT))
    assert refused.fault and "does not straddle" in refused.fault
    assert (refused.version, refused.lot, refused.portal, refused.bays) == (None, None, [], {})
    missing = load_calibration(str(tmp_path / "nope.json"))
    assert (missing.version, missing.lot, missing.portal, missing.fault) == (None, None, [], None)


def test_loader_lets_a_portal_less_census_calibration_through_unchanged(tmp_path):
    loaded = load_calibration(_write(tmp_path, NICKSMAX_LOT, []))
    assert loaded.fault is None and loaded.straddle is None
    assert loaded.version and loaded.lot and loaded.portal == []
