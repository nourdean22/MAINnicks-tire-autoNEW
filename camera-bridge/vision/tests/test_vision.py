"""
Tests for the vision operating layer.

The first four tests are the acceptance gates the live POC failed. They drive the
REAL shipped `visitd` VisitTracker, not a mock, so a regression in either layer fails
here.

Note on FrameHealth in the geometry tests: a synthetic parked car produces pixel-
identical frames, which the freeze detector correctly flags. That is right for a real
camera and wrong for a synthetic fixture, so the geometry tests disable freeze
detection and `test_framehealth_*` proves it separately on its own.
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from vision.capture import CaptureMux, CaptureSource, SyntheticSource  # noqa: E402
from vision.census import PreexistingCensus  # noqa: E402
from vision.detector import (  # noqa: E402
    DetectorCouncil, DetectorUnavailable, OpenVinoVehicleDetector, StubDetector,
)
from vision.baylatch import BayLatch, VisitTiming  # noqa: E402
from vision.evidence import EvidenceStore  # noqa: E402
from vision.fingerprint import PrivacyToken, VehicleFingerprint, compare  # noqa: E402
from vision.frame import Detection, Frame  # noqa: E402
from vision.framehealth import FrameHealth  # noqa: E402
from vision.geometry import EntryPortal, LotMap, Zone  # noqa: E402
from vision.pipeline import VisionPipeline  # noqa: E402
from vision.platelab import CANDIDATE, CONFIRMED, PlateLab, lookup_class  # noqa: E402
from vision.replaylab import FailureInjector, ReplayLab  # noqa: E402
from vision.scenelock import SceneLock  # noqa: E402
from vision.track import TrackGraph  # noqa: E402

W, H = 640, 360
LOT = [(200.0, 180.0), (640.0, 180.0), (640.0, 360.0), (200.0, 360.0)]
PORTAL = [(200.0, 180.0), (320.0, 180.0), (320.0, 360.0), (200.0, 360.0)]
CAR_W, CAR_H = 70, 60
CAR_TOP = 240  # bottom edge 300 -> ground y=300, inside the lot's y range


def car_box(x1: float) -> tuple[float, float, float, float]:
    return (x1, float(CAR_TOP), x1 + CAR_W, float(CAR_TOP + CAR_H))


def make_pipeline(council=None, detect_freeze: bool = False, bays=None, evidence=None,
                  startup_grace: float = 8.0) -> VisionPipeline:
    lot_map = LotMap().add("front_lot", LOT).add("bay_1", [(500.0, 180.0), (640.0, 180.0),
                                                           (640.0, 360.0), (500.0, 360.0)])
    portal = EntryPortal(Zone("front_lot", LOT), portal_zone=Zone("portal", PORTAL))
    # min_distinct=0 disables loop detection for the same reason freeze_run is disabled:
    # synthetic frames are pixel-identical where a real sensor would have noise.
    health = FrameHealth() if detect_freeze else FrameHealth(freeze_run=10 ** 6, min_distinct=0)
    return VisionPipeline(
        council=council or DetectorCouncil(primary=StubDetector([])),
        lot_map=lot_map, entry_portal=portal, camera="sign",
        bay_names=bays or [], evidence=evidence, frame_health=health,
        startup_grace=startup_grace,
    )


def frames(n: int, boxes_per_frame, shift=None, fps: float = 1.0) -> list[Frame]:
    src = SyntheticSource(boxes_per_frame, size=(W, H), fps=fps, shift_per_frame=shift)
    out = []
    for _ in range(n):
        f = src.read()
        if f is None:
            break
        out.append(f)
    return out


# --------------------------------------------------------------------- GATE 1
def test_preexisting_car_never_becomes_an_arrival():
    """The P0 the live POC exposed: a car parked before the detector started must not
    reach CONFIRMED_ARRIVAL by sitting still."""
    parked = car_box(400.0)
    n = 70
    boxes = [[parked] for _ in range(n)]
    pipe = make_pipeline()
    dets = [[Detection(parked, 0.9, "vehicle", "stub")] for _ in range(n)]
    for f, d in zip(frames(n, boxes), dets):
        pipe.step(f, detections=d)

    s = pipe.summary()
    assert s["preexisting"] >= 1, s
    assert s["arrivals"] == 0, s
    assert s["visitdStates"] == {}, f"a preexisting car reached visitd: {s}"


# --------------------------------------------------------------------- GATE 2
def test_real_arrival_crosses_the_portal_and_confirms():
    """A car that genuinely enters from outside must produce a real visit."""
    n_empty, n_move, n_park = 10, 7, 70
    seq_boxes, seq_dets = [], []
    for _ in range(n_empty):
        seq_boxes.append([])
        seq_dets.append([])
    x = 20.0
    for _ in range(n_move):
        b = car_box(x)
        seq_boxes.append([b])
        seq_dets.append([Detection(b, 0.9, "vehicle", "stub")])
        x += 30.0
    parked = car_box(x - 30.0)
    for _ in range(n_park):
        seq_boxes.append([parked])
        seq_dets.append([Detection(parked, 0.9, "vehicle", "stub")])

    pipe = make_pipeline()
    for f, d in zip(frames(len(seq_boxes), seq_boxes), seq_dets):
        pipe.step(f, detections=d)

    s = pipe.summary()
    assert s["arrivals"] == 1, s
    assert s["preexisting"] == 0, s
    states = s["visitdStates"]
    assert "ENTERED_ZONE" in states, states
    assert "CONFIRMED_ARRIVAL" in states, f"a real arrival never confirmed: {states}"


# --------------------------------------------------------------------- GATE 3
def test_camera_motion_creates_zero_visits():
    """A PTZ pan floods the frame with 'new' foreground. None of it may mint a car."""
    n = 30
    boxes = [[] for _ in range(n)]
    # The roll must GROW each frame: a constant offset moves the scene once and then
    # looks perfectly still, which is not what a pan does. 32px per frame exceeds the
    # 25-level pixel delta on the background sawtooth, so every pixel reads as changed.
    shift = [(0, 0)] * 10 + [(32 * (i - 9), 0) for i in range(10, n)]
    pipe = make_pipeline()
    # Inject detections that WOULD look like a crossing, to prove suppression wins.
    seq = []
    for i in range(n):
        if i < 10:
            seq.append([])
        else:
            seq.append([Detection(car_box(20.0 + 30 * (i - 10)), 0.9, "vehicle", "stub"),
                        Detection(car_box(300.0), 0.9, "vehicle", "stub")])
    for f, d in zip(frames(n, boxes, shift=shift), seq):
        pipe.step(f, detections=d)

    s = pipe.summary()
    assert s["suppressed_camera_motion"] >= 15, s
    assert s["arrivals"] == 0, s
    assert s["visitdStates"] == {}, f"camera motion produced visit events: {s}"


# --------------------------------------------------------------------- GATE 4
def test_motion_detector_alone_can_never_confirm_an_arrival():
    """MOG2-class motion is a compute trigger and a diagnostic, never a confirmation."""
    council = DetectorCouncil(primary=None,
                              motion_gate=StubDetector([[Detection(car_box(20.0), 0.5)]],
                                                       name="mog2", can_confirm=False))
    res = council.run(np.zeros((H, W, 3), dtype=np.uint8))
    assert res.can_confirm_arrival is False
    assert res.motion_only is True
    assert "motion/occupancy uncertain" in res.reason

    # And end to end: a perfect crossing path still yields no visit.
    n_empty, n_move = 10, 12
    script = [[] for _ in range(n_empty)]
    x = 20.0
    boxes = [[] for _ in range(n_empty)]
    for _ in range(n_move):
        b = car_box(x)
        script.append([Detection(b, 0.9)])
        boxes.append([b])
        x += 30.0
    pipe = make_pipeline(council=DetectorCouncil(
        primary=None, motion_gate=StubDetector(script, name="mog2", can_confirm=False)))
    for f in frames(len(boxes), boxes):
        pipe.step(f)  # no injected detections: the council path runs

    s = pipe.summary()
    assert s["arrivals"] == 0, s
    assert s["visitdStates"] == {}, s
    assert s["rejected_no_entry_evidence"] > 0, s


def test_a_non_confirming_detector_wired_as_PRIMARY_still_cannot_confirm():
    """The test that should have existed.

    `test_motion_detector_alone_can_never_confirm_an_arrival` passes the non-confirming
    detector as `motion_gate` with `primary=None`, so every assertion follows from the
    `primary is None` branch. It would still have passed with `can_confirm` deleted from
    the codebase -- and it did: `DetectorCouncil.run` never read the flag, so a
    `can_confirm=False` detector wired as PRIMARY was granted arrival authority and
    emitted a real visit. Invariant 4 was resting on the convention that MOG2 is wired as
    the gate. This pins the flag itself.
    """
    box = car_box(100.0)
    council = DetectorCouncil(
        primary=StubDetector([[Detection(box, 0.9)]], name="mog2-as-primary",
                             can_confirm=False),
    )
    res = council.run(np.zeros((H, W, 3), dtype=np.uint8))
    assert res.can_confirm_arrival is False, "a can_confirm=False primary must not confirm"
    assert res.motion_only is True
    assert "not permitted to confirm" in res.reason
    # Its observations still flow through: this is degradation, not blindness.
    assert len(res.detections) == 1

    # End to end: a perfect crossing path through a non-confirming PRIMARY yields no visit.
    n_empty, n_move = 10, 12
    script: list[list[Detection]] = [[] for _ in range(n_empty)]
    boxes: list[list[tuple]] = [[] for _ in range(n_empty)]
    x = 20.0
    for _ in range(n_move):
        b = car_box(x)
        script.append([Detection(b, 0.9)])
        boxes.append([b])
        x += 30.0
    pipe = make_pipeline(council=DetectorCouncil(
        primary=StubDetector(script, name="mog2-as-primary", can_confirm=False)))
    for f in frames(len(boxes), boxes):
        pipe.step(f)

    s = pipe.summary()
    assert s["arrivals"] == 0, s
    assert s["visitdStates"] == {}, s


def test_injected_detections_do_not_silently_grant_arrival_authority():
    """`step(detections=...)` bypasses the council, so the caller must declare whether
    those boxes came from something allowed to confirm."""
    n_empty, n_move = 10, 12
    boxes: list[list[tuple]] = [[] for _ in range(n_empty)]
    dets: list[list[Detection]] = [[] for _ in range(n_empty)]
    x = 20.0
    for _ in range(n_move):
        b = car_box(x)
        boxes.append([b])
        dets.append([Detection(b, 0.9)])
        x += 30.0

    pipe = make_pipeline()
    for f, d in zip(frames(len(boxes), boxes), dets):
        pipe.step(f, detections=d, detections_can_confirm=False)
    s = pipe.summary()
    assert s["arrivals"] == 0, s
    assert s["visitdStates"] == {}, s


def test_confirmable_does_not_latch_through_a_detector_outage():
    """A track seen once by a real detector must not keep arrival authority forever."""
    tg = TrackGraph(high_score=0.55)
    born, _ = tg.update([Detection(car_box(100.0), 0.9)], now=0.0, confirmable=True)
    tid = born[0].track_id
    assert tg.tracks[tid].confirmable is True
    tg.update([Detection(car_box(108.0), 0.9)], now=1.0, confirmable=False)
    assert tg.tracks[tid].confirmable is False, "authority must follow the CURRENT frame"
    tg.update([Detection(car_box(116.0), 0.9)], now=2.0, confirmable=True)
    assert tg.tracks[tid].confirmable is True


def test_a_frame_missing_window_verified_fails_CLOSED():
    """Absent evidence is not evidence. A capture source that forgets the key must not
    inherit arrival authority -- the check is `is not True`, not `is False`."""
    n_empty, n_move = 10, 12
    boxes: list[list[tuple]] = [[] for _ in range(n_empty)]
    dets: list[list[Detection]] = [[] for _ in range(n_empty)]
    x = 20.0
    for _ in range(n_move):
        b = car_box(x)
        boxes.append([b])
        dets.append([Detection(b, 0.9)])
        x += 30.0

    pipe = make_pipeline()
    for f, d in zip(frames(len(boxes), boxes), dets):
        f.meta.pop("window_verified", None)          # a source that simply never sets it
        pipe.step(f, detections=d)
    s = pipe.summary()
    assert s["suppressed_unverified"] == len(boxes), s
    assert s["arrivals"] == 0, s
    assert s["visitdStates"] == {}, s


# --------------------------------------------------------------------- GATE 5
def test_framehealth_flags_a_frozen_pane_and_passes_a_live_one():
    still = np.full((60, 60, 3), 100, dtype=np.uint8)
    fh = FrameHealth(freeze_run=8)
    for i in range(12):
        fh.update(float(i), still)
    st = fh.state(12.0)
    assert st.frozen is True
    assert st.ok is False
    assert st.dup_ratio > 0.8

    fh2 = FrameHealth(freeze_run=8)
    for i in range(12):
        # A bar sweeping 10px per frame across a 128px image. The change has to be
        # large enough to move the 8x8 dHash -- a few pixels at one edge would not,
        # and the detector calling that "frozen" is correct, not a bug.
        img = np.full((128, 128, 3), 100, dtype=np.uint8)
        img[:, i * 10: i * 10 + 40] = 240
        fh2.update(float(i), img)
    st2 = fh2.state(12.0)
    assert st2.frozen is False
    assert st2.ok is True


def test_framehealth_catches_a_short_cached_loop_that_freeze_detection_misses():
    """A 3-frame A/B/C loop never produces a run of identical CONSECUTIVE frames, so
    freeze detection alone passed it as live. That is a stalled player cycling a cache,
    not a scene."""
    frames_abc = []
    for k in range(3):
        img = np.full((128, 128, 3), 100, dtype=np.uint8)
        img[:, k * 30: k * 30 + 40] = 240
        frames_abc.append(img)

    fh = FrameHealth(freeze_run=8, min_distinct=4)
    for i in range(24):
        fh.update(float(i), frames_abc[i % 3])
    st = fh.state(24.0)
    assert st.frozen is False, "no consecutive duplicates -- freeze detection cannot see this"
    assert st.looping is True
    assert st.distinct == 3
    assert st.ok is False

    # A genuinely varying scene of the same length stays healthy.
    fh2 = FrameHealth(freeze_run=8, min_distinct=4)
    for i in range(24):
        img = np.full((128, 128, 3), 100, dtype=np.uint8)
        img[:, i * 5: i * 5 + 40] = 240
        fh2.update(float(i), img)
    st2 = fh2.state(24.0)
    assert st2.looping is False
    assert st2.ok is True


def test_pipeline_suppresses_a_frozen_capture_segment():
    n = 40
    boxes = [[car_box(20.0 + 8 * i)] for i in range(n)]
    fs = frames(n, boxes)
    fs = FailureInjector().freeze(fs, start=15, length=14)
    pipe = make_pipeline(detect_freeze=True)
    for f in fs:
        pipe.step(f, detections=[Detection(car_box(20.0), 0.9)])
    s = pipe.summary()
    assert s["suppressed_unhealthy"] > 0, s
    # The invariant is that a frozen capture cannot MINT ARRIVALS, not merely that
    # suppression was counted. Asserting only the counter would pass while visits leaked.
    assert s["arrivals"] == 0, s
    assert s["visitdStates"] == {}, s


def test_an_occluded_capture_frame_cannot_create_a_visit():
    """Regression: a screen-region grab of an occluded window returned a BROWSER
    screenshot, and the vehicle detector scored it as one whole-frame vehicle. A frame
    that is not verifiably the camera must not reach the state machine at all."""
    n_empty, n_move = 10, 8
    boxes = [[] for _ in range(n_empty)]
    dets: list[list[Detection]] = [[] for _ in range(n_empty)]
    x = 20.0
    for _ in range(n_move):
        b = car_box(x)
        boxes.append([b])
        dets.append([Detection(b, 0.9)])
        x += 30.0

    pipe = make_pipeline()
    for f, d in zip(frames(len(boxes), boxes), dets):
        f.meta["window_verified"] = False       # the window was covered the whole time
        pipe.step(f, detections=d)

    s = pipe.summary()
    assert s["suppressed_unverified"] == len(boxes), s
    assert s["arrivals"] == 0, s
    assert s["visitdStates"] == {}, s


# ------------------------------------------------- independent-review canaries

def test_a_pan_that_stops_at_a_NEW_pose_is_not_trusted():
    """Settling is not the same as being home.

    A PTZ pan that ends somewhere else is perfectly stationary, so waiting for motion to
    stop cannot establish that the view is the calibrated one. The lot, portal and bay
    polygons belong to the reference pose, so trusting a settled-but-unmatched view lets
    detections in a NEW view be read as crossings and bay occupancy.
    """
    home = frames(1, [[car_box(400.0)]])[0].image
    away = frames(1, [[car_box(400.0)]], shift=[(260, 90)])[0].image

    lock = SceneLock()
    lock.set_reference(home)

    # Sitting at home: matched, and trusted.
    for _ in range(4):
        st = lock.update(home)
    assert st.reference_set is True
    assert st.pose_ok is True
    assert st.pose_delta is not None and st.pose_delta <= lock.pose_tolerance

    # Pan away, then hold perfectly still at the new view.
    lock.update(away)
    for _ in range(8):
        st = lock.update(away)
    assert st.moving is False, "the camera really has stopped"
    assert st.pose_ok is False, "but the view is NOT the calibrated one"
    assert st.pose_delta > lock.pose_tolerance

    # Returning home restores trust.
    for _ in range(8):
        st = lock.update(home)
    assert st.pose_ok is True


def test_a_blind_interval_cannot_be_stitched_into_a_crossing():
    """Outside samples from BEFORE a blackout must not combine with inside samples from
    after it. Nobody observed that crossing."""
    # The reappearing car must MATCH the pre-blackout track, or a fresh track is born
    # inside with no history and the stitch is impossible for an unrelated reason --
    # which is how the first version of this test passed against the defect.
    # ground point = x1 + 35; the lot starts at x=200, so x1 <= 164 is outside.
    outside = [car_box(100.0), car_box(120.0), car_box(140.0), car_box(160.0)]
    inside = [car_box(180.0), car_box(185.0), car_box(190.0), car_box(195.0)]

    n_empty = 10
    boxes: list[list[tuple]] = [[] for _ in range(n_empty)]
    dets: list[list[Detection]] = [[] for _ in range(n_empty)]
    for b in outside:
        boxes.append([b]); dets.append([Detection(b, 0.9)])
    # 6 frames of whole-frame camera motion: the blind interval.
    blind = 6
    for _ in range(blind):
        boxes.append([]); dets.append([])
    for b in inside:
        boxes.append([b]); dets.append([Detection(b, 0.9)])

    shift = [(0, 0)] * (n_empty + len(outside))
    shift += [(32 * (i + 1), 0) for i in range(blind)]
    shift += [(32 * blind, 0)] * len(inside)

    pipe = make_pipeline()
    for f, d in zip(frames(len(boxes), boxes, shift=shift), dets):
        pipe.step(f, detections=d)

    s = pipe.summary()
    assert s["suppressed_camera_motion"] >= blind, s
    assert s["arrivals"] == 0, f"a blind interval was stitched into a crossing: {s}"
    assert s["visitdStates"] == {}, s


def test_a_motion_gated_skip_does_not_age_out_a_parked_car():
    """A stationary car stops producing MOG2 blobs. That is the gate saving compute, not
    the scene emptying, and it must not end the visit."""
    council = DetectorCouncil(
        primary=StubDetector([[Detection(car_box(400.0), 0.9)]] * 40, name="tiny"),
        motion_gate=StubDetector([[Detection(car_box(400.0), 0.5)]] + [[]] * 40,
                                 name="mog2", can_confirm=False),
    )
    pipe = make_pipeline(council=council)
    boxes = [[car_box(400.0)] for _ in range(30)]
    for f in frames(30, boxes):
        pipe.step(f)

    # The car is still tracked after 29 skipped frames -- it has not been aged out.
    assert len(pipe.tracks.tracks) == 1, pipe.summary()
    assert pipe.summary()["visitdStates"] == {}, "a preexisting car still creates no visit"


def test_visitd_is_told_the_zones_actually_observed():
    """A vehicle that drives back out of the lot while still visible must be reported as
    outside, or visitd never starts its departure grace and dwell accrues forever."""
    class RecordingTracker:
        def __init__(self) -> None:
            self.payloads: list[dict] = []

        def handle_event(self, ev):
            self.payloads.append(ev)
            return []

        def tick(self, _now):
            return []

        def open_visits(self):
            return []

    rec = RecordingTracker()
    lot_map = LotMap().add("front_lot", LOT)
    portal = EntryPortal(Zone("front_lot", LOT), portal_zone=Zone("portal", PORTAL))
    pipe = VisionPipeline(
        council=DetectorCouncil(primary=StubDetector([])), lot_map=lot_map,
        entry_portal=portal, camera="sign", tracker=rec,
        frame_health=FrameHealth(freeze_run=10 ** 6, min_distinct=0),
    )

    seq_boxes: list[list[tuple]] = [[] for _ in range(10)]
    seq_dets: list[list[Detection]] = [[] for _ in range(10)]
    x = 20.0
    for _ in range(8):                      # drive in
        b = car_box(x); seq_boxes.append([b]); seq_dets.append([Detection(b, 0.9)]); x += 30.0
    for _ in range(8):                      # drive back out, still visible
        x -= 30.0
        b = car_box(max(0.0, x)); seq_boxes.append([b]); seq_dets.append([Detection(b, 0.9)])

    for f, d in zip(frames(len(seq_boxes), seq_boxes), seq_dets):
        pipe.step(f, detections=d)

    zones_seen = [tuple(p["after"]["current_zones"]) for p in rec.payloads]
    assert ("front_lot",) in zones_seen, "inside the lot must report the lot"
    assert () in zones_seen, "back on the street must report NO zone, not the arrival zone"


# ---------------------------------------------------------------- geometry
def test_entry_portal_rejects_a_track_born_inside_the_property():
    portal = EntryPortal(Zone("lot", LOT), portal_zone=Zone("portal", PORTAL))
    inside_only = [(400.0, 300.0)] * 10
    v = portal.evaluate(inside_only)
    assert v["crossed"] is False
    assert "born inside" in v["reason"]


def test_entry_portal_accepts_an_outside_to_inside_crossing():
    portal = EntryPortal(Zone("lot", LOT), portal_zone=Zone("portal", PORTAL))
    path = [(50.0, 300.0), (90.0, 300.0), (150.0, 300.0), (230.0, 300.0), (260.0, 300.0)]
    v = portal.evaluate(path)
    assert v["crossed"] is True
    assert v["outside_hits"] >= 2


def test_zone_membership_uses_the_ground_point():
    d = Detection((200.0, 100.0, 300.0, 200.0), 0.9)
    assert d.ground_point == (250.0, 200.0)
    assert d.center == (250.0, 150.0)


# ---------------------------------------------------------------- census
def test_census_reconnect_reopens_the_blind_window():
    c = PreexistingCensus(startup_grace=5.0, reconnect_grace=4.0)
    assert c.classify_birth(1.0, 0.0) == "preexisting"
    assert c.classify_birth(9.0, 0.0) == "candidate"
    c.note_reconnect(10.0)
    assert c.classify_birth(12.0, 0.0) == "preexisting"
    assert c.classify_birth(20.0, 0.0) == "candidate"


# ---------------------------------------------------------------- tracker
def test_tracker_recovers_a_track_from_a_low_score_detection():
    tg = TrackGraph(high_score=0.55)
    born, _ = tg.update([Detection(car_box(100.0), 0.9)], now=0.0)
    assert len(born) == 1
    tid = born[0].track_id
    born2, _ = tg.update([Detection(car_box(108.0), 0.30)], now=1.0)
    assert born2 == [], "a low-score detection must not mint a new identity"
    assert list(tg.tracks) == [tid], tg.tracks
    assert tg.tracks[tid].hits == 2


def test_tracker_does_not_birth_from_a_lone_low_score_detection():
    tg = TrackGraph(high_score=0.55)
    born, _ = tg.update([Detection(car_box(100.0), 0.2)], now=0.0)
    assert born == []
    assert tg.tracks == {}


# ---------------------------------------------------------------- bay latch
def test_baylatch_holds_a_stationary_car_through_detector_misses():
    latch = BayLatch(["bay_1"], clear_frames_to_release=5)
    latch.enter("bay_1", track_id=7, now=0.0)
    for i in range(4):
        latch.observe("bay_1", occupied_now=False, now=float(i))
    assert latch.occupied_bays() == ["bay_1"], "a brief miss must not empty the bay"
    latch.observe("bay_1", occupied_now=False, now=5.0)
    assert latch.occupied_bays() == []


def test_visit_timing_keeps_unknowns_unknown():
    t = VisitTiming(arrived_at=100.0, bay_entered_at=160.0)
    assert t.wait_to_bay == 60.0
    assert t.bay_duration is None
    assert t.total_visit is None
    assert t.abandoned_before_bay is False


# ---------------------------------------------------------------- identity
def test_privacy_token_requires_a_key_and_is_stable():
    with pytest.raises(ValueError):
        PrivacyToken(key=b"")
    tok = PrivacyToken(key=b"shop-secret")
    a = tok.token("ABC 1234")
    assert a == tok.token("abc-1234"), "normalisation must be stable"
    assert a != tok.token("XYZ9999")
    assert len(a) == 16
    assert PrivacyToken(key=b"other-key").token("ABC1234") != a


def test_contradictory_high_confidence_plates_are_a_hard_stop():
    a = VehicleFingerprint(plate_exact="ABC1234", plate_confidence=0.95,
                           color="black", vehicle_type="car")
    b = VehicleFingerprint(plate_exact="XYZ9999", plate_confidence=0.95,
                           color="black", vehicle_type="car")
    ev = compare(a, b)
    assert ev.verdict == "CONTRADICTED"
    assert ev.contradictions and "disagree" in ev.contradictions[0]

    same = compare(a, VehicleFingerprint(plate_exact="abc 1234", plate_confidence=0.95))
    assert same.verdict == "SAME"


# ---------------------------------------------------------------- plates
def test_plate_consensus_confirms_only_on_agreement():
    lab = PlateLab(min_reads=3)
    for i in range(3):
        lab.add_candidate("ABC1234", 0.92, ts=float(i))
    out = lab.consensus()
    assert out["verdict"] == "CONFIRMED", out
    assert out["text"] == "ABC1234"

    tie = PlateLab(min_reads=2)
    tie.add_candidate("ABC1234", 0.9, 0.0)
    tie.add_candidate("XYZ9999", 0.9, 1.0)
    assert tie.consensus()["verdict"] == "AMBIGUOUS"

    empty = PlateLab(min_reads=2)
    assert empty.consensus()["verdict"] == "NONE"


def test_raw_disagreement_is_not_reported_as_unanimous_agreement():
    """ABC1234 and ABCI234 collapse to one canonical form, so canonical agreement reads
    1.00 -- while fingerprint.compare treats two differing high-confidence plates as a
    HARD STOP. Reporting CONFIRMED at 1.00 for input the identity layer calls
    contradictory is exactly the overstated confidence this module warns about."""
    lab = PlateLab(min_reads=3)
    for i, text in enumerate(["ABC1234", "ABCI234", "ABCI234"]):
        lab.add_candidate(text, 0.95, ts=float(i))
    out = lab.consensus()
    assert out["agreement"] == 1.0, "canonical grouping still sees one group"
    assert out["rawDistinct"] == 2
    assert out["rawAgreement"] < 1.0
    assert out["verdict"] == CANDIDATE, out
    assert "raw reads differ" in out["reason"]

    # Genuinely unanimous raw reads still confirm.
    clean = PlateLab(min_reads=3)
    for i in range(3):
        clean.add_candidate("ABC1234", 0.95, ts=float(i))
    assert clean.consensus()["verdict"] == CONFIRMED


def test_plate_lookup_separates_exact_from_confusable():
    known = ["ABC1234"]
    assert lookup_class("ABC1234", known)["class"] == "EXACT"
    assert lookup_class("ABCI234", known)["class"] == "CONFUSABLE_UNIQUE"
    assert lookup_class("ZZZ0000", known)["class"] == "NONE"
    # An exact hit always wins, even when a confusable twin is also on file.
    assert lookup_class("ABCI234", ["ABC1234", "ABCI234"])["class"] == "EXACT"
    # Two stored plates that collapse to the same canonical form, and a query that
    # matches neither exactly, is the genuinely ambiguous case: never auto-attach.
    assert lookup_class("A8C1234", ["ABC1234", "ABCI234"])["class"] == "AMBIGUOUS"


# ---------------------------------------------------------------- council
def test_council_escalates_an_ambiguous_box_to_the_adjudicator():
    box = car_box(100.0)
    council = DetectorCouncil(
        primary=StubDetector([[Detection(box, 0.50)]], name="tiny"),
        adjudicator=StubDetector([[Detection(box, 0.95)]], name="adjudicator"),
        low_conf=0.35, high_conf=0.70,
    )
    res = council.run(np.zeros((H, W, 3), dtype=np.uint8))
    assert res.escalated is True
    assert len(res.detections) == 1
    assert res.detections[0].score > 0.70
    assert "adjudicated" in res.detections[0].source


def test_council_skips_the_heavy_detector_when_nothing_moved():
    council = DetectorCouncil(primary=StubDetector([[Detection(car_box(1.0), 0.9)]]),
                              motion_gate=StubDetector([[]], name="mog2",
                                                       can_confirm=False))
    res = council.run(np.zeros((H, W, 3), dtype=np.uint8))
    assert res.skipped_no_motion is True
    assert res.detections == []


def test_council_still_runs_the_detector_on_an_entry_critical_frame():
    council = DetectorCouncil(primary=StubDetector([[Detection(car_box(1.0), 0.9)]]),
                              motion_gate=StubDetector([[]], name="mog2",
                                                       can_confirm=False))
    res = council.run(np.zeros((H, W, 3), dtype=np.uint8), entry_critical=True)
    assert res.skipped_no_motion is False
    assert len(res.detections) == 1


# ---------------------------------------------------------------- capture
def test_capture_mux_hot_swaps_to_the_next_source():
    class Dead(CaptureSource):
        name = "dead"

        def read(self):
            return None

    live = SyntheticSource([[car_box(10.0)]] * 3, size=(W, H))
    mux = CaptureMux([Dead(), live], max_consecutive_fail=1)
    f = mux.read()
    assert f is not None
    assert f.source == "synthetic"
    assert mux.swaps == 1


# ---------------------------------------------------------------- replay
def test_replay_is_deterministic():
    n = 30
    boxes = [[car_box(20.0 + 8 * i)] for i in range(n)]
    dets = [[Detection(car_box(20.0 + 8 * i), 0.9)] for i in range(n)]

    def run_once():
        pipe = make_pipeline()
        return ReplayLab(pipe).run(frames(n, boxes), dets).summary

    a, b = run_once(), run_once()
    assert a == b, (a, b)
    # Without this, [] == [] passes and the test proves nothing about replay at all.
    assert a["frames"] == n, a
    assert a["candidates"] > 0 or a["preexisting"] > 0, a


def test_evidence_packet_explains_an_arrival():
    store = EvidenceStore(enabled=False)
    n_empty, n_move = 10, 8
    boxes = [[] for _ in range(n_empty)]
    dets: list[list[Detection]] = [[] for _ in range(n_empty)]
    x = 20.0
    for _ in range(n_move):
        b = car_box(x)
        boxes.append([b])
        dets.append([Detection(b, 0.9)])
        x += 30.0
    pipe = make_pipeline(evidence=store)
    for f, d in zip(frames(len(boxes), boxes), dets):
        pipe.step(f, detections=d)

    packets = store.find("ARRIVAL_EVIDENCE")
    assert len(packets) == 1
    p = packets[0].to_dict()
    assert "portal" in p["rule"]
    assert any("outside_hits" in r for r in p["reasons"])
    assert p["box"] is not None


# ---------------------------------------------------------------- OpenVINO
@pytest.mark.skipif(not os.environ.get("VISION_OV_MODEL"),
                    reason="set VISION_OV_MODEL to an Intel IR .xml to run this")
def test_openvino_detector_loads_and_runs():
    model = os.environ["VISION_OV_MODEL"]
    try:
        det = OpenVinoVehicleDetector(model, device=os.environ.get("VISION_OV_DEVICE", "CPU"))
    except DetectorUnavailable as exc:
        pytest.skip(str(exc))
    out = det.detect(np.zeros((H, W, 3), dtype=np.uint8))
    assert isinstance(out, list)
    assert det.can_confirm is True
    assert det.last_latency_ms > 0
