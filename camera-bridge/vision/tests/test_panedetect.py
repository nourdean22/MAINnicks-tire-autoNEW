"""Pane detection must work for ANY layout and window size, not one measured constant."""
from __future__ import annotations

import numpy as np

import pytest

from vision.panedetect import (NATIVE_ASPECT, PAN_THRESHOLD_PX, ChannelNotFound,
                               assert_channel_usable, classify_motion, describe,
                               detect_live_region, resolve_channel,
                               split_into_channels)


def _window(size, panes, frames=12, seed=3):
    """Synthesise a camera app: static chrome everywhere, live video inside `panes`.

    Chrome is byte-identical between frames -- which is what real app furniture is -- and
    each pane carries faint per-frame variation, which is what real video always has even
    when the scene is motionless.
    """
    rng = np.random.default_rng(seed)
    w, h = size
    chrome = np.full((h, w, 3), 40, dtype=np.uint8)
    chrome[::7, :] = 55                      # some static texture, like a sidebar list
    out = []
    for _ in range(frames):
        img = chrome.copy()
        for idx, (x, y, pw, ph) in enumerate(panes):
            # EACH PANE A DIFFERENT BRIGHTNESS. Real camera views are different scenes, so
            # a boundary between two of them is a real discontinuity -- which is exactly
            # what the tiling scorer looks for. A first version of this helper gave every
            # pane the same base level, so the boundaries were invisible and the scorer had
            # nothing to choose between layouts; the split came back in the wrong order on
            # synthetic frames while being correct on the live window.
            base = np.full((ph, pw, 3), 70 + idx * 45, dtype=np.uint8)
            noise = rng.integers(-3, 4, (ph, pw, 3))
            img[y:y + ph, x:x + pw] = np.clip(base.astype(int) + noise, 0, 255).astype(np.uint8)
        out.append(img)
    return out


def test_a_single_16x9_pane_is_found_and_called_single():
    frames = _window((1280, 720), [(427, 255, 678, 381)])
    r = detect_live_region(frames)
    assert r is not None
    assert abs(r.x - 427) <= 2 and abs(r.y - 255) <= 2
    assert abs(r.w - 678) <= 4 and abs(r.h - 381) <= 4
    assert r.looks_like_one_camera, f"aspect {r.aspect:.2f} should read as one camera"


def test_it_follows_the_window_when_the_operator_RESIZES():
    """The whole point. A fraction measured at 1280x720 is wrong at any other size; the
    detector is told nothing and must simply find the video."""
    frames = _window((1920, 1080), [(640, 380, 1016, 572)])
    r = detect_live_region(frames)
    assert r is not None
    assert abs(r.x - 640) <= 2 and abs(r.y - 380) <= 2
    assert r.looks_like_one_camera
    fx0, fy0, fx1, fy1 = r.as_crop_frac(1920, 1080)
    assert 0.32 < fx0 < 0.35 and 0.34 < fy0 < 0.37


def test_a_FOUR_UP_grid_is_found_as_the_region_covering_all_four():
    """A 2x2 grid has real gutters, so the bounding box spans the whole grid -- and its
    aspect is NOT one camera, which is the finding the operator needs."""
    panes = [(100, 100, 320, 180), (440, 100, 320, 180),
             (100, 300, 320, 180), (440, 300, 320, 180)]
    r = detect_live_region(_window((1280, 720), panes))
    assert r is not None
    assert abs(r.x - 100) <= 2 and abs(r.y - 100) <= 2
    assert abs(r.w - 660) <= 6 and abs(r.h - 380) <= 6
    assert not r.looks_like_one_camera, "a 2x2 grid must NOT be treated as a single camera"


def test_STACKED_panes_with_no_gutter_are_flagged_not_silently_accepted():
    """The observed live case: a preview strip directly above the main pane, no static
    chrome between them, so no pixel signal can split them. Aspect is the tell -- 1.19
    against a native 1.78 -- and the answer is a loud flag, never a quiet wrong crop."""
    panes = [(426, 65, 677, 190), (426, 255, 677, 381)]
    r = detect_live_region(_window((1280, 720), panes))
    assert r is not None
    assert r.h > 500, "the two panes merge into one tall region, as they do live"
    assert not r.looks_like_one_camera
    assert "multi-or-clipped" in describe(r, 1280, 720)


def test_a_window_with_NO_video_returns_none_rather_than_a_box():
    frames = _window((1280, 720), [])          # chrome only, byte-identical throughout
    assert detect_live_region(frames) is None
    assert "pane=none" in describe(None, 1280, 720)


def test_too_few_frames_is_none_not_a_guess():
    assert detect_live_region(_window((640, 480), [(10, 10, 200, 112)], frames=2)) is None


def test_the_aspect_gate_is_calibrated_to_a_real_camera():
    frames = _window((1280, 720), [(200, 200, 640, 360)])   # exactly 16:9
    r = detect_live_region(frames)
    assert r is not None
    assert abs(r.aspect - NATIVE_ASPECT) / NATIVE_ASPECT < 0.05
    assert r.looks_like_one_camera


def test_the_THREE_IN_ONE_device_splits_into_its_three_channels():
    """SHOPSIGN is one device with three lenses: two fixed (left/right approaches) and a
    PTZ. The app draws them with NO static gutter, so the live region is one tall box and
    no pixel signal can separate them -- but every channel is 16:9, and that can.

    Geometry taken from the live window: two 338x190 on top, one 677x381 below.
    """
    panes = [(426, 65, 338, 190), (764, 65, 338, 190), (426, 255, 677, 381)]
    frames = _window((1280, 720), panes)
    r = detect_live_region(frames)
    assert r is not None and not r.looks_like_one_camera
    chans = split_into_channels(r, frames[-1])
    assert len(chans) == 3, f"a 3-in-1 must split into three, got {len(chans)}"
    for x, y, w, h in chans:
        assert abs((w / h) - NATIVE_ASPECT) / NATIVE_ASPECT < 0.1
    tops = sorted(c for c in chans if c[1] < 200)
    assert len(tops) == 2, "the two small lenses sit on the top row"
    assert max(c[3] for c in chans) > 300, "the large pane is the third channel"


def test_it_does_not_invent_MORE_channels_than_the_layout_has():
    """Scoring boundaries by SUM rewards a layout simply for having more of them: on the
    live window that returned ELEVEN channels for a three-channel device. The score is a
    mean per boundary, and ties go to the simpler layout."""
    panes = [(426, 65, 338, 190), (764, 65, 338, 190), (426, 255, 677, 381)]
    frames = _window((1280, 720), panes)
    r = detect_live_region(frames)
    assert len(split_into_channels(r, frames[-1])) <= 4


def test_a_single_pane_region_is_returned_whole_not_subdivided():
    frames = _window((1280, 720), [(427, 255, 678, 381)])
    r = detect_live_region(frames)
    assert split_into_channels(r, frames[-1]) == [(r.x, r.y, r.w, r.h)]


def _panning(size=(320, 180), frames=10, step=6):
    """A view whose WHOLE FRAME slides -- what a PTZ pan looks like."""
    rng = np.random.default_rng(5)
    w, h = size
    scene = rng.integers(0, 255, (h, w * 3, 3), dtype=np.uint8)
    return [scene[:, i * step:i * step + w].copy() for i in range(frames)]


def _still(size=(320, 180), frames=10):
    """A fixed camera on a scene where only a small object moves -- a car crossing."""
    rng = np.random.default_rng(6)
    w, h = size
    base = rng.integers(0, 255, (h, w, 3), dtype=np.uint8)
    out = []
    for i in range(frames):
        img = base.copy()
        img[h // 2:h // 2 + 20, 10 + i * 8:30 + i * 8] = 255      # a moving object
        out.append(img)
    return out


def test_a_PAN_is_detected_as_ptz():
    verdict, shift = classify_motion(_panning())
    assert verdict == "ptz", f"a sliding frame must read as PTZ (shift {shift:.2f}px)"
    assert shift > PAN_THRESHOLD_PX


def test_a_CAR_crossing_a_FIXED_frame_is_not_mistaken_for_a_pan():
    """The discrimination that matters. A difference image cannot tell these apart; whole
    frame displacement can, and a fixed camera watching traffic must stay FIXED or its
    calibration would be thrown away every time a vehicle drove past."""
    verdict, shift = classify_motion(_still())
    assert verdict == "fixed", f"local motion must not read as a pan (shift {shift:.2f}px)"
    assert shift < PAN_THRESHOLD_PX


def test_too_few_frames_is_unknown_never_a_guess():
    verdict, _ = classify_motion(_panning(frames=2))
    assert verdict == "unknown", "guessing FIXED on a PTZ is the failure this prevents"


# --- Channel policy: a PTZ must never carry calibrated arrival geometry ------------------

SHOPSIGN_PANES = [(426, 65, 338, 190), (764, 65, 338, 190), (426, 255, 677, 381)]


def test_a_FIXED_channel_may_carry_calibration():
    assert_channel_usable(0, "fixed", calibrated=True)      # must not raise


def test_a_PTZ_channel_is_REFUSED_calibration():
    """The failure this prevents is SILENT: a pan re-aims the lens, every polygon then
    describes ground the camera left behind, and frames, heartbeats and detections all
    stay healthy while every arrival is scored against geometry that no longer exists."""
    with pytest.raises(ChannelNotFound, match="channel 2"):
        assert_channel_usable(2, "ptz", calibrated=True)


def test_UNKNOWN_motion_is_refused_too_because_unproven_is_not_fixed():
    with pytest.raises(ChannelNotFound):
        assert_channel_usable(1, "unknown", calibrated=True)


def test_census_mode_needs_no_geometry_so_a_PTZ_is_fine():
    assert_channel_usable(2, "ptz", calibrated=False)       # must not raise


def test_resolve_channel_returns_the_rectangle_AND_the_motion_class():
    frames = _window((1280, 720), SHOPSIGN_PANES)
    (x, y, w, h), kind, shift = resolve_channel(frames, 0)
    assert (w / h) == pytest.approx(NATIVE_ASPECT, rel=0.1)
    assert y < 200, "channel 0 is the top-left lens"
    assert kind == "fixed" and shift < PAN_THRESHOLD_PX


def test_resolve_channel_REFUSES_an_out_of_range_index_instead_of_clamping():
    """Clamping would point the producer at a DIFFERENT lens than the operator asked for,
    and nothing downstream could tell -- so it raises."""
    frames = _window((1280, 720), SHOPSIGN_PANES)
    with pytest.raises(ChannelNotFound, match="holds 3"):
        resolve_channel(frames, 9)


def test_resolve_channel_REFUSES_a_dead_window_instead_of_returning_a_box():
    dead = [np.zeros((360, 640, 3), np.uint8) for _ in range(8)]
    with pytest.raises(ChannelNotFound, match="no live video"):
        resolve_channel(dead, 0)
