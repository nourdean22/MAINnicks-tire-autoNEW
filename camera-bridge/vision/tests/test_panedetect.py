"""Pane detection must work for ANY layout and window size, not one measured constant."""
from __future__ import annotations

import numpy as np

from vision.panedetect import NATIVE_ASPECT, detect_live_region, describe


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
        for (x, y, pw, ph) in panes:
            base = np.full((ph, pw, 3), 120, dtype=np.uint8)
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
