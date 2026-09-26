from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from vision.hardcase import HardCaseRecorder
from vision.service_review_worker import (
    analyze_case,
    scan_cases,
)
from vision.service_shadow import ServiceCue, ServiceEvidenceLedger


VEHICLE = [100.0, 100.0, 300.0, 260.0]
PERSON = ServiceCue("person", 0.92, (80.0, 80.0, 150.0, 260.0), "fake")
JACK = ServiceCue("floor_jack", 0.88, (180.0, 220.0, 250.0, 280.0), "fake")


class _Analyzer:
    name = "fake:service-cues@1"

    def __init__(self, cues=None, fail_at=None):
        self.cues = list(cues or [])
        self.fail_at = fail_at
        self.calls = []

    def detect(self, image):
        self.calls.append(Path(image).name if isinstance(image, str) else "<array>")
        if self.fail_at is not None and len(self.calls) == self.fail_at:
            raise RuntimeError("synthetic analyzer failure")
        return list(self.cues)


def _case(tmp_path, *, name="case-a", box=VEHICLE, timestamps=None, trigger_at=1000.0):
    timestamps = list(timestamps or [995.0, 999.0, 1000.0, 1003.0, 1007.0, 1010.0])
    directory = tmp_path / name
    directory.mkdir()
    for i in range(len(timestamps)):
        # Fake analyzer never opens these bytes. The worker contract only requires numbered
        # JPEG paths; the real Grounding-DINO adapter owns image decoding.
        (directory / f"{i:04d}.jpg").write_bytes(b"jpeg-placeholder")
    meta = {
        "reason": "NO_BAY_ACTIVITY_REVIEW",
        "at": trigger_at,
        "firstFrameAt": timestamps[0],
        "lastFrameAt": timestamps[-1],
        "frames": len(timestamps),
        "frameTimestamps": timestamps,
        "context": {
            "trackId": 7,
            "vehicleBox": box,
            "stationarySeconds": 45.0,
            "zones": ["front_lot"],
            "bayNames": ["bay1", "bay2"],
            "camera": "shopsign",
            "evidence": "arrival",
        },
    }
    (directory / "case.json").write_text(json.dumps(meta), encoding="utf-8")
    return directory


def test_offline_worker_uses_exact_post_trigger_time_and_writes_shadow_candidate(tmp_path):
    case_dir = _case(tmp_path)
    ledger_path = tmp_path / "service-evidence.jsonl"
    analyzer = _Analyzer([PERSON, JACK])

    result = analyze_case(
        case_dir,
        analyzer=analyzer,
        ledger=ServiceEvidenceLedger(str(ledger_path)),
        every_seconds=3.0,
    )

    assert result.status == "ok"
    assert result.state == "OUTSIDE_SERVICE_CANDIDATE"
    assert result.candidate_written
    # 995/999 are pre-trigger and must never support a service claim. 1000/1003/1007/1010
    # are the exact sampled observation times, enough for the scorer's 3-hit/6s rule.
    assert analyzer.calls == ["0002.jpg", "0003.jpg", "0004.jpg", "0005.jpg"]

    row = json.loads(ledger_path.read_text(encoding="utf-8"))
    assert row["authority"] == "shadow_only"
    assert row["supportIsCalibratedProbability"] is False
    assert row["context"]["timingSource"] == "exact_case_json"
    assert row["trackId"] == 7

    receipt = json.loads((case_dir / "service-review.json").read_text(encoding="utf-8"))
    assert receipt["authority"] == "shadow_only"
    assert receipt["timingSource"] == "exact_case_json"
    assert receipt["vehicleBox"] == VEHICLE
    assert receipt["candidate_written"] is True


def test_no_independent_cues_stays_review_only_and_writes_no_candidate_ledger(tmp_path):
    case_dir = _case(tmp_path)
    ledger_path = tmp_path / "service-evidence.jsonl"

    result = analyze_case(
        case_dir,
        analyzer=_Analyzer([]),
        ledger=ServiceEvidenceLedger(str(ledger_path)),
        every_seconds=3.0,
    )

    assert result.status == "ok"
    assert result.state == "NO_BAY_ACTIVITY_REVIEW"
    assert not result.candidate_written
    assert not ledger_path.exists()


def test_missing_vehicle_anchor_is_invalid_not_guessed(tmp_path):
    case_dir = _case(tmp_path, box=None)
    result = analyze_case(
        case_dir,
        analyzer=_Analyzer([PERSON, JACK]),
        ledger=ServiceEvidenceLedger(str(tmp_path / "ledger.jsonl")),
    )
    assert result.status == "skipped"
    assert "vehicleBox" in result.reason
    assert not (tmp_path / "ledger.jsonl").exists()


def test_timestamp_count_mismatch_is_invalid_not_evenly_interpolated(tmp_path):
    case_dir = _case(tmp_path)
    meta_path = case_dir / "case.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["frameTimestamps"] = meta["frameTimestamps"][:-1]
    meta_path.write_text(json.dumps(meta), encoding="utf-8")

    result = analyze_case(
        case_dir,
        analyzer=_Analyzer([PERSON, JACK]),
        ledger=ServiceEvidenceLedger(str(tmp_path / "ledger.jsonl")),
    )
    assert result.status == "skipped"
    assert "exact frameTimestamps" in result.reason


def test_analyzer_failure_is_case_local_and_visible(tmp_path):
    case_dir = _case(tmp_path)
    result = analyze_case(
        case_dir,
        analyzer=_Analyzer([PERSON, JACK], fail_at=2),
        ledger=ServiceEvidenceLedger(str(tmp_path / "ledger.jsonl")),
    )
    assert result.status == "error"
    assert "synthetic analyzer failure" in result.reason
    receipt = json.loads((case_dir / "service-review.json").read_text(encoding="utf-8"))
    assert receipt["status"] == "error"


def test_batch_is_idempotent_per_analyzer_unless_forced(tmp_path):
    _case(tmp_path, name="one")
    analyzer = _Analyzer([])
    ledger = ServiceEvidenceLedger(str(tmp_path / "ledger.jsonl"))

    first = scan_cases(tmp_path, analyzer=analyzer, ledger=ledger)
    calls_after_first = len(analyzer.calls)
    second = scan_cases(tmp_path, analyzer=analyzer, ledger=ledger)

    assert first.cases_processed == 1
    assert second.cases_skipped_existing == 1
    assert len(analyzer.calls) == calls_after_first

def test_replace_mode_mcap_is_reviewable_after_numbered_jpegs_are_deleted(tmp_path):
    pytest.importorskip("mcap")
    rec = HardCaseRecorder(
        directory=str(tmp_path),
        before_seconds=8.0,
        after_seconds=10.0,
        episodes="replace",
    )
    timestamps = [995.0, 999.0, 1000.0, 1003.0, 1007.0, 1010.0]
    for index, ts in enumerate(timestamps):
        image = np.full((48, 64, 3), index * 20, dtype=np.uint8)
        rec.observe(ts, image, {"window_verified": True})
    assert rec.trigger(
        "NO_BAY_ACTIVITY_REVIEW",
        1000.0,
        {
            "trackId": 7,
            "vehicleBox": VEHICLE,
            "stationarySeconds": 45.0,
            "zones": ["front_lot"],
            "bayNames": ["bay1", "bay2"],
            "camera": "shopsign",
            "evidence": "arrival",
        },
    )
    paths = rec.flush_all(1020.0)
    assert len(paths) == 1
    case_dir = Path(paths[0])
    assert (case_dir / "episode.mcap").is_file()
    assert not list(case_dir.glob("*.jpg")), "replace mode did not delete verified duplicate JPEGs"

    analyzer = _Analyzer([PERSON, JACK])
    result = analyze_case(
        case_dir,
        analyzer=analyzer,
        ledger=ServiceEvidenceLedger(str(tmp_path / "service-evidence.jsonl")),
        every_seconds=3.0,
    )

    assert result.status == "ok"
    assert result.state == "OUTSIDE_SERVICE_CANDIDATE"
    assert result.candidate_written
    assert analyzer.calls == ["<array>", "<array>", "<array>", "<array>"]
    receipt = json.loads((case_dir / "service-review.json").read_text(encoding="utf-8"))
    assert receipt["frameSource"] == "mcap"

