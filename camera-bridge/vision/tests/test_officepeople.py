"""On-box person count for office "watch" frames (2026-10-02).

Contract with the server: each posted frame may carry `"people": int | null`. null means
"not measured" -- no detector, no model, no cv2, opted out, or inference blew up. It must
never collapse to 0, because "could not look" is not "nobody there".

No real OpenVINO here: a fake `openvino` module drives the real detector class, and the
office path takes a stub detector.
"""
from __future__ import annotations

import base64
import sys
import types
from types import SimpleNamespace

import numpy as np
import pytest

from vision import officeframes
from vision.detector import DetectorUnavailable, OpenVinoPersonDetector, OpenVinoVehicleDetector
from vision.fetch_models import PINNED
from vision.frame import Detection
from vision.officepost import Transcript
from vision.officewake import Trigger, run_capture_once

from test_officewake import MONDAY_10AM, OFFICE, FakeSampler, _live_cfg, _segment  # noqa: E402

cv2 = pytest.importorskip("cv2")


def _jpeg_b64() -> str:
    ok, buf = cv2.imencode(".jpg", np.zeros((48, 64, 3), dtype=np.uint8))
    assert ok
    return base64.b64encode(buf.tobytes()).decode("ascii")


class StubPersonDetector:
    """Returns a fixed list of detections per call, in order."""

    def __init__(self, per_call):
        self.per_call = list(per_call)
        self.calls = 0

    def detect(self, image):
        assert image is not None and image.ndim == 3, "the JPEG must be decoded before detect()"
        out = self.per_call[self.calls]
        self.calls += 1
        if isinstance(out, Exception):
            raise out
        return [Detection((0.0, 0.0, 1.0, 1.0), score=s, label="person", source="stub") for s in out]


def _counter(detector=None, error=None):
    loads = []

    def loader():
        loads.append(1)
        if error is not None:
            raise error
        return detector

    return officeframes.PeopleCounter(loader=loader), loads


# ------------------------------------------------------------------ office path

def test_people_count_lands_on_each_posted_frame(tmp_path, monkeypatch):
    monkeypatch.delenv("OFFICE_PERSON_DETECT", raising=False)
    jpeg = _jpeg_b64()
    seg_a = _segment(tmp_path, "a", MONDAY_10AM, 20.0)
    seg_b = _segment(tmp_path, "b", MONDAY_10AM + 90, 20.0)
    frames = [
        {"at": MONDAY_10AM + 5, "mime": "image/jpeg", "base64": jpeg},
        {"at": MONDAY_10AM + 95, "mime": "image/jpeg", "base64": jpeg},
    ]
    # Frame 1: two confident people and one below the 0.5 cut. Frame 2: nobody.
    det = StubPersonDetector([[0.9, 0.6, 0.4], []])
    counter, loads = _counter(det)
    posted = []
    run_capture_once(
        _live_cfg(tmp_path),
        Trigger(MONDAY_10AM, "personDetected", OFFICE),
        capture_fn=lambda *a, **k: [seg_a, seg_b],
        transcribe_fn=lambda *a, **k: Transcript(segments=[], engine="fake"),
        post_fn=lambda payload, endpoint, **k: posted.append(payload) or {"posted": True, "status": 200},
        clock=lambda: MONDAY_10AM,
        frame_sampler=FakeSampler(frames),
        people_counter=counter,
    )
    assert [f["people"] for f in posted[0]["frames"]] == [2]
    # A measured zero IS zero: the detector looked and saw nobody.
    assert [f["people"] for f in posted[1]["frames"]] == [0]
    assert len(loads) == 1, "the detector loads once per process, not once per frame"


def test_unavailable_detector_posts_null_not_zero(tmp_path, monkeypatch):
    monkeypatch.delenv("OFFICE_PERSON_DETECT", raising=False)
    seg = _segment(tmp_path, "a", MONDAY_10AM, 20.0)
    frames = [
        {"at": MONDAY_10AM + 1, "mime": "image/jpeg", "base64": _jpeg_b64()},
        {"at": MONDAY_10AM + 2, "mime": "image/jpeg", "base64": _jpeg_b64()},
    ]
    counter, loads = _counter(error=DetectorUnavailable("openvino not installed"))
    posted = []
    run_capture_once(
        _live_cfg(tmp_path),
        Trigger(MONDAY_10AM, "personDetected", OFFICE),
        capture_fn=lambda *a, **k: [seg],
        transcribe_fn=lambda *a, **k: Transcript(segments=[], engine="fake"),
        post_fn=lambda payload, endpoint, **k: posted.append(payload) or {"posted": True, "status": 200},
        clock=lambda: MONDAY_10AM,
        frame_sampler=FakeSampler(frames),
        people_counter=counter,
    )
    got = [f["people"] for f in posted[0]["frames"]]
    assert got == [None, None]
    assert 0 not in got
    assert len(loads) == 1, "a failed load is remembered, not retried on every frame"
    assert "openvino not installed" in counter.unavailable_reason


def test_detector_exception_on_a_frame_is_null_for_that_frame_only(monkeypatch):
    monkeypatch.delenv("OFFICE_PERSON_DETECT", raising=False)
    jpeg = _jpeg_b64()
    det = StubPersonDetector([RuntimeError("inference died"), [0.8]])
    counter, _ = _counter(det)
    frames = [{"at": 1.0, "base64": jpeg}, {"at": 2.0, "base64": jpeg}]
    officeframes.annotate_people(frames, counter)
    assert [f["people"] for f in frames] == [None, 1]


def test_undecodable_frame_is_null(monkeypatch):
    monkeypatch.delenv("OFFICE_PERSON_DETECT", raising=False)
    counter, _ = _counter(StubPersonDetector([[0.9]]))
    frames = [{"at": 1.0, "base64": base64.b64encode(b"not a jpeg").decode("ascii")}]
    officeframes.annotate_people(frames, counter)
    assert frames[0]["people"] is None


def test_opt_out_posts_null_and_never_loads_the_detector(monkeypatch):
    monkeypatch.setenv("OFFICE_PERSON_DETECT", "0")
    counter, loads = _counter(StubPersonDetector([[0.9]]))
    frames = [{"at": 1.0, "base64": _jpeg_b64()}]
    officeframes.annotate_people(frames, counter)
    assert frames[0]["people"] is None
    assert loads == []


def test_without_opencv_people_is_null(monkeypatch):
    monkeypatch.delenv("OFFICE_PERSON_DETECT", raising=False)
    monkeypatch.setitem(sys.modules, "cv2", None)
    counter, _ = _counter(StubPersonDetector([[0.9]]))
    frames = [{"at": 1.0, "base64": _jpeg_b64()}]
    officeframes.annotate_people(frames, counter)
    assert frames[0]["people"] is None


def test_frames_for_segment_carries_people_through():
    frames = [{"at": 5.0, "mime": "image/jpeg", "base64": "x", "people": None},
              {"at": 6.0, "mime": "image/jpeg", "base64": "y", "people": 3}]
    got = officeframes.frames_for_segment(frames, started_at=0.0, duration_s=10.0)
    assert [f["people"] for f in got] == [None, 3]


# ------------------------------------------------------------------ model path

def test_person_model_path_env_override_then_fetched_root(monkeypatch, tmp_path):
    monkeypatch.setenv("OFFICE_PERSON_MODEL_XML", str(tmp_path / "p.xml"))
    assert officeframes.person_model_path() == str(tmp_path / "p.xml")
    monkeypatch.delenv("OFFICE_PERSON_MODEL_XML")
    vehicle = tmp_path / "ov_models" / "vehicle-detection-0200" / "FP16" / "vehicle-detection-0200.xml"
    monkeypatch.setenv("VISION_OV_MODEL", str(vehicle))
    assert officeframes.person_model_path() == str(
        tmp_path / "ov_models" / "person-detection-0200" / "FP16" / "person-detection-0200.xml")
    monkeypatch.delenv("VISION_OV_MODEL")
    assert officeframes.person_model_path().replace("\\", "/").endswith(
        "camera-bridge/ov_models/person-detection-0200/FP16/person-detection-0200.xml")


def test_person_model_is_pinned_and_vehicle_stays_first():
    rels = [p.rel_path for p in PINNED]
    assert officeframes.PERSON_MODEL_REL in rels
    assert officeframes.PERSON_MODEL_REL.replace(".xml", ".bin") in rels
    # run_live reports the FIRST pinned .bin as the vehicle model's digest; fetch_models
    # prints PINNED[0] as "point the detector at". Both must stay the vehicle model.
    assert rels[0].startswith("vehicle-detection-0200/")
    assert next(r for r in rels if r.endswith(".bin")).startswith("vehicle-detection-0200/")


# ------------------------------------------------------------------ detector label

def _fake_openvino(monkeypatch, rows):
    class Compiled:
        def input(self, _i):
            return SimpleNamespace(shape=[1, 3, 256, 256])

        def __call__(self, _inputs):
            return {"out": np.asarray(rows, dtype=np.float32).reshape(1, 1, -1, 7)}

    class Core:
        available_devices = ["CPU"]

        def read_model(self, _xml):
            return object()

        def compile_model(self, _model, _device):
            return Compiled()

    monkeypatch.setitem(sys.modules, "openvino", types.SimpleNamespace(Core=Core))


def test_vehicle_detector_label_default_is_still_vehicle(monkeypatch, tmp_path):
    _fake_openvino(monkeypatch, [[0, 1, 0.9, 0.1, 0.1, 0.5, 0.5]])
    xml = tmp_path / "m.xml"
    xml.write_text("<net/>", encoding="ascii")
    det = OpenVinoVehicleDetector(str(xml))
    out = det.detect(np.zeros((100, 100, 3), dtype=np.uint8))
    assert [d.label for d in out] == ["vehicle"]
    assert det.can_confirm is True


def test_person_detector_labels_person_and_cannot_confirm_arrivals(monkeypatch, tmp_path):
    _fake_openvino(monkeypatch, [[0, 1, 0.9, 0.1, 0.1, 0.5, 0.5], [0, 1, 0.2, 0.1, 0.1, 0.5, 0.5]])
    xml = tmp_path / "p.xml"
    xml.write_text("<net/>", encoding="ascii")
    det = OpenVinoPersonDetector(str(xml))
    out = det.detect(np.zeros((100, 100, 3), dtype=np.uint8))
    assert [d.label for d in out] == ["person"]
    # A person box must never be able to confirm a VEHICLE arrival if it is ever wired
    # into a DetectorCouncil.
    assert det.can_confirm is False
