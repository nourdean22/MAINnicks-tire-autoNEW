"""The adjudicator slot has existed since the council was written and production never filled it.

`DetectorCouncil` escalates to a second, stronger model on an ambiguous box or an entry-critical
frame -- the two places where a mistake actually costs something. The logic was complete and
tested; `build_council()`, the only constructor production uses, simply never passed one. These
tests cover the wiring and, more importantly, the refusal that has to come with it.
"""
from __future__ import annotations

import numpy as np
import pytest

from vision.detector import Detection, DetectorCouncil, DetectorUnavailable
from vision.run_live import build_council, same_model


def test_a_council_MAY_NOT_ADJUDICATE_ITSELF():
    """The load-bearing refusal. `_fuse` promotes an ambiguous detection by +0.25 when the
    adjudicator agrees with it -- and a model always agrees with itself. Pointing both slots at
    one file would hand every uncertain box a free confidence boost backed by no independent
    evidence, while the logs showed a perfectly healthy escalation."""
    with pytest.raises(DetectorUnavailable, match="same model file"):
        build_council("models/vehicle-detection-0200.xml", "CPU", False,
                      adjudicator_model="models/vehicle-detection-0200.xml")


def test_the_refusal_survives_a_DIFFERENT_SPELLING_of_the_same_path(tmp_path):
    """A guard that only catches string equality is a guard anyone defeats by accident: the
    same file reached through `./models/../models/x.xml` is still the same file."""
    real = tmp_path / "m.xml"
    real.write_text("<net/>", encoding="utf-8")
    sneaky = str(tmp_path / "sub" / ".." / "m.xml")
    (tmp_path / "sub").mkdir()
    assert same_model(str(real), sneaky), "the same file under two spellings must compare equal"
    with pytest.raises(DetectorUnavailable, match="same model file"):
        build_council(str(real), "CPU", False, adjudicator_model=sneaky)


def test_two_DIFFERENT_models_are_not_treated_as_the_same():
    """The positive control. Without it, a `same_model` that returned True for everything
    would make the refusal test pass while blocking every legitimate council."""
    assert not same_model("models/a.xml", "models/b.xml")
    assert not same_model(None, "models/b.xml")
    assert not same_model("models/a.xml", None)


def test_NO_adjudicator_flag_leaves_the_council_exactly_as_it_has_always_run():
    council = build_council(None, "CPU", False)
    assert council.adjudicator is None


def test_an_UNAVAILABLE_adjudicator_warns_and_degrades_rather_than_killing_the_producer(capsys):
    """A council without an adjudicator is the system as it has run all along. Refusing to
    start would turn an optional upgrade into a new single point of failure -- but going
    silent would be worse, because the escalation would appear to exist and never fire."""
    council = build_council(None, "CPU", False,
                            adjudicator_model="C:/nope/not-a-model.xml")
    assert council.adjudicator is None
    printed = capsys.readouterr().out
    assert "adjudicator unavailable" in printed and "DISABLED" in printed


# --- Why the refusal matters: the promotion it would silently corrupt --------------------


def test_fuse_PROMOTES_an_ambiguous_box_the_adjudicator_agrees_with():
    """This is the mechanism the self-adjudication guard protects. It is correct behaviour --
    an independent second model agreeing is real evidence -- and it is exactly why the two
    slots must not hold the same model."""
    ambiguous = Detection((10, 10, 60, 60), 0.50, "vehicle", "primary")
    agreed = Detection((11, 11, 61, 61), 0.80, "vehicle", "adjudicator")
    fused = DetectorCouncil._fuse([], [ambiguous], [agreed])
    promoted = [d for d in fused if "adjudicated" in d.source]
    assert promoted, "an agreed-with ambiguous box must be promoted"
    assert promoted[0].score > ambiguous.score


def test_fuse_does_NOT_promote_an_ambiguous_box_the_adjudicator_missed():
    """The other half. Without this, a `_fuse` that promoted everything would pass the test
    above while making the adjudicator decorative."""
    ambiguous = Detection((10, 10, 60, 60), 0.50, "vehicle", "primary")
    elsewhere = Detection((400, 400, 460, 460), 0.90, "vehicle", "adjudicator")
    fused = DetectorCouncil._fuse([], [ambiguous], [elsewhere])
    assert not [d for d in fused if "adjudicated" in d.source]


class _Fake:
    """A detector stand-in. Real IRs are not loadable in a unit test and are not the subject."""

    def __init__(self, name, dets, can_confirm=True):
        self.name, self._dets, self.can_confirm = name, dets, can_confirm

    def detect(self, image):
        return list(self._dets)


def test_the_council_ESCALATES_on_an_ambiguous_box_and_records_that_it_did():
    primary = _Fake("primary", [Detection((10, 10, 60, 60), 0.50, "vehicle", "primary")])
    adj = _Fake("adjudicator", [Detection((11, 11, 61, 61), 0.85, "vehicle", "adjudicator")])
    council = DetectorCouncil(primary=primary, adjudicator=adj)
    res = council.run(np.zeros((80, 80, 3), np.uint8))
    assert res.escalated, "an ambiguous primary box must reach the adjudicator"
    assert "adjudicator" in res.by_detector


def test_the_council_does_NOT_escalate_when_the_primary_is_already_confident():
    """Escalation is asymmetric compute: it buys accuracy exactly where a mistake costs
    something. Spending it on a confident frame buys nothing and slows the producer."""
    primary = _Fake("primary", [Detection((10, 10, 60, 60), 0.95, "vehicle", "primary")])
    adj = _Fake("adjudicator", [Detection((11, 11, 61, 61), 0.85, "vehicle", "adjudicator")])
    council = DetectorCouncil(primary=primary, adjudicator=adj)
    res = council.run(np.zeros((80, 80, 3), np.uint8))
    assert not res.escalated
    assert "adjudicator" not in res.by_detector


def test_an_ENTRY_CRITICAL_frame_escalates_even_with_a_confident_primary():
    """A portal crossing is the frame that creates or denies a customer visit. Being confident
    there is not the same as being right, and it is the one place worth paying for certainty."""
    primary = _Fake("primary", [Detection((10, 10, 60, 60), 0.95, "vehicle", "primary")])
    adj = _Fake("adjudicator", [Detection((11, 11, 61, 61), 0.85, "vehicle", "adjudicator")])
    council = DetectorCouncil(primary=primary, adjudicator=adj)
    assert council.run(np.zeros((80, 80, 3), np.uint8), entry_critical=True).escalated


def test_a_CORRUPT_model_file_degrades_instead_of_crashing_the_producer(tmp_path):
    """Found by a test in this very file. Everything above the load in
    `OpenVinoVehicleDetector.__init__` raises `DetectorUnavailable` -- "not installed", "not
    found", "device missing" -- and then `core.read_model` was left bare. OpenVINO raises a
    plain RuntimeError for an IR it cannot parse, so a truncated download killed the producer
    at startup rather than degrading to the documented motion-only path.

    `fetch_models.py` pins a size and a sha256 precisely because half-finished downloads
    happen, which is what makes this reachable rather than theoretical."""
    # This one needs OpenVINO actually installed. Without it the constructor raises
    # DetectorUnavailable at the IMPORT check, several branches before the load this test is
    # about -- the right exception type for the wrong reason, which is not evidence. CI runs
    # without the runtime, so the dependency is declared instead of the test failing there.
    pytest.importorskip("openvino", reason="the load path only exists when the runtime does")
    from vision.detector import OpenVinoVehicleDetector

    corrupt = tmp_path / "truncated.xml"
    corrupt.write_text("<net/>", encoding="utf-8")     # a real file, not a real IR
    with pytest.raises(DetectorUnavailable, match="could not be loaded"):
        OpenVinoVehicleDetector(str(corrupt), device="CPU")
