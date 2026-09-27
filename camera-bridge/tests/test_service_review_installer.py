"""Production wiring guards for the offline outside-service review worker.

The Grounding-DINO sidecar can be perfectly implemented and still do zero work if the shop
box only ever runs edge_main. These tests pin the unattended path without importing torch or
downloading any model.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts" / "install-service-review-worker.ps1"
DOCTOR = ROOT / "scripts" / "doctor-service-review-worker.ps1"
REQUIREMENTS = ROOT / "requirements-service-review.txt"
README = ROOT / "vision" / "README.md"


def _text(path: Path) -> str:
    assert path.is_file(), f"missing production wiring file: {path}"
    return path.read_text(encoding="utf-8")


def _wrapper_command(text: str) -> str:
    rows = [
        line
        for line in text.splitlines()
        if "vision.service_review_worker" in line and "-m " in line
    ]
    assert len(rows) == 1, f"expected one worker command, found {len(rows)}"
    return rows[0]


def test_installed_command_reaches_the_real_shadow_worker_with_reproducible_inputs():
    text = _text(INSTALLER)
    command = _wrapper_command(text)
    for token in (
        "--cases-dir",
        "--ledger",
        "--model",
        "--revision",
        "--threshold",
        "--text-threshold",
        "--every-seconds",
    ):
        assert token in command, f"{token} is not on the installed worker command"
    assert "vision.service_review_worker" in command
    assert "--force" not in command


def test_scheduler_is_non_overlapping_and_not_allowed_to_run_too_frequently():
    text = _text(INSTALLER)
    assert "MultipleInstances IgnoreNew" in text
    assert "-Priority 7" in text
    assert re.search(r"\[int\]\$IntervalMinutes\s*=\s*15\b", text)
    assert "$IntervalMinutes -lt 5" in text
    assert "IntervalMinutes must be >= 5" in text


def test_installer_preflights_the_actual_ml_environment_before_registering_task():
    text = _text(INSTALLER)
    register_at = text.index("Register-ScheduledTask")
    preflight_at = text.index("import torch, transformers")
    worker_import_at = text.index("from vision.service_review_worker")
    assert preflight_at < register_at
    assert worker_import_at < register_at
    assert "requirements-service-review.txt" in text


def test_doctor_checks_task_overlap_real_worker_and_shadow_authority():
    text = _text(DOCTOR)
    assert "MultipleInstances" in text and "IgnoreNew" in text
    assert "vision.service_review_worker" in text
    assert "--force" in text  # it must explicitly detect a dangerous forced wrapper
    assert 'authority -ne "shadow_only"' in text
    assert "NO_BAY_ACTIVITY_REVIEW" in text


def test_heavy_dependencies_stay_out_of_the_live_camera_requirements():
    review = _text(REQUIREMENTS)
    live = _text(ROOT / "requirements.txt")
    assert "transformers" in review
    assert "Pillow" in review
    assert "transformers" not in live
    assert "Pillow" not in live


def test_operator_docs_name_both_installer_and_doctor():
    text = _text(README)
    assert "install-service-review-worker.ps1" in text
    assert "doctor-service-review-worker.ps1" in text
