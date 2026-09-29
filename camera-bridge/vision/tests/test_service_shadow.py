from __future__ import annotations

import json

from vision.service_shadow import (
    OutsideServiceShadow,
    ServiceCue,
    ServiceEvidenceLedger,
)


VEHICLE = (100.0, 100.0, 300.0, 260.0)
PERSON = ServiceCue("person", 0.91, (80.0, 80.0, 150.0, 260.0), "open-set")
JACK = ServiceCue("floor jack", 0.87, (180.0, 220.0, 250.0, 280.0), "open-set")
FAR_TOOL = ServiceCue("impact wrench", 0.99, (800.0, 800.0, 850.0, 850.0), "open-set")


def test_stationary_without_independent_cues_is_review_not_service():
    s = OutsideServiceShadow(min_stationary_seconds=20)
    out = s.observe(
        track_id=1, vehicle_box=VEHICLE, stationary_seconds=90,
        in_bay=False, cues=[], at=1000,
    )
    assert out.state == "NO_BAY_ACTIVITY_REVIEW"
    assert not out.person_near
    assert out.mechanical_cues == ()
    assert not out.newly_candidate


def test_person_plus_tool_needs_temporal_persistence_before_candidate():
    s = OutsideServiceShadow(
        min_stationary_seconds=20,
        min_observation_hits=3,
        min_evidence_span_seconds=6,
    )
    first = s.observe(
        track_id=7, vehicle_box=VEHICLE, stationary_seconds=30,
        in_bay=False, cues=[PERSON, JACK], at=1000,
    )
    second = s.observe(
        track_id=7, vehicle_box=VEHICLE, stationary_seconds=34,
        in_bay=False, cues=[PERSON, JACK], at=1003,
    )
    third = s.observe(
        track_id=7, vehicle_box=VEHICLE, stationary_seconds=38,
        in_bay=False, cues=[PERSON, JACK], at=1007,
    )
    assert first.state == "NO_BAY_ACTIVITY_REVIEW"
    assert second.state == "NO_BAY_ACTIVITY_REVIEW"
    assert third.state == "OUTSIDE_SERVICE_CANDIDATE"
    assert third.newly_candidate
    assert third.observation_hits == 3
    assert third.evidence_span_seconds == 7
    assert "floor_jack" in third.mechanical_cues


def test_bay_entry_resets_outside_service_evidence():
    s = OutsideServiceShadow(
        min_observation_hits=2,
        min_evidence_span_seconds=1,
    )
    s.observe(
        track_id=3, vehicle_box=VEHICLE, stationary_seconds=40,
        in_bay=False, cues=[PERSON, JACK], at=1000,
    )
    inside = s.observe(
        track_id=3, vehicle_box=VEHICLE, stationary_seconds=50,
        in_bay=True, cues=[PERSON, JACK], at=1002,
    )
    after = s.observe(
        track_id=3, vehicle_box=VEHICLE, stationary_seconds=25,
        in_bay=False, cues=[PERSON, JACK], at=1004,
    )
    assert inside.state == "NO_BAY_ACTIVITY_REVIEW"
    assert inside.observation_hits == 0
    assert after.observation_hits == 1
    assert not after.newly_candidate


def test_far_mechanical_cue_cannot_support_this_vehicle():
    s = OutsideServiceShadow(min_observation_hits=1, min_evidence_span_seconds=0)
    out = s.observe(
        track_id=5, vehicle_box=VEHICLE, stationary_seconds=30,
        in_bay=False, cues=[PERSON, FAR_TOOL], at=1000,
    )
    assert out.person_near
    assert out.mechanical_cues == ()
    assert out.state == "NO_BAY_ACTIVITY_REVIEW"


def test_support_score_is_explicitly_not_probability(tmp_path):
    s = OutsideServiceShadow(min_observation_hits=1, min_evidence_span_seconds=0)
    assessment = s.observe(
        track_id=9, vehicle_box=VEHICLE, stationary_seconds=30,
        in_bay=False, cues=[PERSON, JACK], at=1000,
    )
    assert assessment.newly_candidate

    ledger = ServiceEvidenceLedger(str(tmp_path / "service.jsonl"))
    assert ledger.note(
        assessment,
        camera="shopsign",
        cues=[PERSON, JACK],
        context={"visitId": "candidate-only"},
    )
    row = json.loads((tmp_path / "service.jsonl").read_text(encoding="utf-8"))
    assert row["state"] == "OUTSIDE_SERVICE_CANDIDATE"
    assert row["supportIsCalibratedProbability"] is False
    assert row["authority"] == "shadow_only"


def test_candidate_is_written_once_until_evidence_run_resets(tmp_path):
    s = OutsideServiceShadow(min_observation_hits=1, min_evidence_span_seconds=0)
    ledger = ServiceEvidenceLedger(str(tmp_path / "service.jsonl"))
    first = s.observe(
        track_id=11, vehicle_box=VEHICLE, stationary_seconds=30,
        in_bay=False, cues=[PERSON, JACK], at=1000,
    )
    later = s.observe(
        track_id=11, vehicle_box=VEHICLE, stationary_seconds=35,
        in_bay=False, cues=[PERSON, JACK], at=1002,
    )
    assert first.newly_candidate
    assert not later.newly_candidate
    assert ledger.note(first, camera="shopsign", cues=[PERSON, JACK])
    assert not ledger.note(later, camera="shopsign", cues=[PERSON, JACK])
    assert len((tmp_path / "service.jsonl").read_text(encoding="utf-8").splitlines()) == 1
