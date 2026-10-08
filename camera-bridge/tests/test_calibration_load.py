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
