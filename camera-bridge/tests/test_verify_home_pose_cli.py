from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "verify_home_pose.py"

_spec = importlib.util.spec_from_file_location("verify_home_pose_cli", SCRIPT)
assert _spec and _spec.loader
_cli = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_cli)


def _scene() -> np.ndarray:
    image = np.zeros((180, 300, 3), dtype=np.uint8)
    image[:] = (40, 50, 60)
    cv2.rectangle(image, (15, 15), (285, 165), (140, 110, 80), 3)
    cv2.circle(image, (150, 90), 36, (220, 210, 70), -1)
    return image


def test_ffmpeg_error_never_leaks_rtsp_credentials(monkeypatch):
    raw = "rtsp://private-user:private-pass@127.0.0.1:8554/office"
    fake = SimpleNamespace(
        returncode=1,
        stdout=b"",
        stderr=f"could not open {raw}\nretry {raw}".encode(),
    )
    monkeypatch.setattr(_cli.subprocess, "run", lambda *args, **kwargs: fake)

    with pytest.raises(_cli.HomePoseError) as caught:
        _cli._capture_rtsp(raw, ffmpeg="ffmpeg", timeout_seconds=1)

    text = str(caught.value)
    assert "private-user" not in text
    assert "private-pass" not in text
    assert "rtsp://127.0.0.1:8554/office" in text


def test_cli_runs_from_an_unrelated_working_directory(tmp_path: Path):
    ref = tmp_path / "home.png"
    receipt = tmp_path / "receipt.json"
    assert cv2.imwrite(str(ref), _scene())

    proc = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--serial",
            "T8410P522517180B",
            "--reference",
            str(ref),
            "--current",
            str(ref),
            "--receipt",
            str(receipt),
        ],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        timeout=20,
    )

    assert proc.returncode == 0, proc.stderr
    payload = json.loads(receipt.read_text(encoding="utf-8"))
    assert payload["isHome"] is True
    assert payload["poseShiftPx"] <= 0.1
