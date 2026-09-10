"""The locator must prove WHICH camera it found, not merely that it found something.

Every test here is written against the failure it prevents, because the failures this
module exists for are all silent: a wrong bind produces healthy frames, healthy heartbeats
and confident detections while attributing arrivals to the wrong side of the shop.
"""
from __future__ import annotations

import numpy as np
import pytest

from vision.scenelocator import (MAX_EDGE_TILT_DEG, MIN_INLIERS, MIN_SIDE_PX, SceneBinding,
                                 SceneNotLocated, _linear_is_sane, _quad_is_sane, advance,
                                 build_reference,
                                 canonicalise, load_atlas, locate, locate_all)


def _scene(seed: int, size=(320, 180)) -> np.ndarray:
    """A textured stand-in for a camera view: high-contrast structure ORB can hold on to.

    Uniform noise would be WRONG here, and the distinction matters. Noise gives ORB
    thousands of unstable, self-similar corners, which is exactly the degenerate input the
    ratio test throws away -- a test built on it would measure the matcher's behaviour on
    garbage. Real shop views have structure: rooflines, bay framing, poles, signage. So
    this draws blocks and lines, which is what those look like to a corner detector.
    """
    rng = np.random.default_rng(seed)
    width, height = size
    img = np.full((height, width, 3), 30, np.uint8)
    for _ in range(70):
        x, y = int(rng.integers(0, width - 24)), int(rng.integers(0, height - 24))
        w, h = int(rng.integers(8, 24)), int(rng.integers(8, 24))
        img[y:y + h, x:x + w] = int(rng.integers(70, 255))
    for _ in range(18):
        y = int(rng.integers(0, height))
        img[y:y + 2, :] = int(rng.integers(90, 240))
    return img


def _window(scene: np.ndarray, at, window=(1280, 720), pane=None) -> np.ndarray:
    """Paint `scene` into an app-window-sized frame at `at`, scaled to `pane`."""
    import cv2

    width, height = window
    frame = np.full((height, width, 3), 44, np.uint8)
    frame[::9, :] = 58                       # static chrome texture, like a sidebar
    pane = pane or (scene.shape[1], scene.shape[0])
    resized = cv2.resize(scene, pane, interpolation=cv2.INTER_LINEAR)
    x, y = at
    frame[y:y + pane[1], x:x + pane[0]] = resized
    return frame


SHOPSIGN = _scene(11)
OTHER_CAMERA = _scene(97)


def _box(located):
    xs = [p[0] for p in located.quad]
    ys = [p[1] for p in located.quad]
    return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)


def test_a_known_scene_is_found_anywhere_in_the_window_with_its_identity():
    ref = build_reference(SHOPSIGN, "shopsign", "day-clear")
    frame = _window(SHOPSIGN, at=(426, 255), pane=(677, 381))
    found = locate(frame, [ref])
    assert found.scene_id == "shopsign"
    x, y, w, h = _box(found)
    assert abs(x - 426) < 8 and abs(y - 255) < 8, f"quad at {x:.0f},{y:.0f}"
    assert abs(w - 677) < 12 and abs(h - 381) < 12, f"quad size {w:.0f}x{h:.0f}"


def test_MOVING_THE_PANE_changes_nothing_about_the_identity():
    """The whole point: 1-up, a corner of a 2x2, a resized float -- one problem, one answer.
    A crop constant cannot survive this; a homography does not notice it happened."""
    ref = build_reference(SHOPSIGN, "shopsign", "day-clear")
    for at, pane in (((0, 0), (1280, 720)), ((764, 65), (338, 190)), ((100, 400), (500, 281))):
        found = locate(_window(SHOPSIGN, at=at, pane=pane), [ref])
        assert found.scene_id == "shopsign"
        x, y, w, h = _box(found)
        assert abs(x - at[0]) < 10 and abs(y - at[1]) < 10, f"{at} -> {x:.0f},{y:.0f}"
        assert abs(w - pane[0]) < 16, f"{pane} -> {w:.0f}x{h:.0f}"


def test_a_window_WITHOUT_the_scene_raises_instead_of_pointing_somewhere():
    """The failure this prevents is the expensive one. Returning 'probably the usual place'
    when the app is showing a menu binds the lot polygon to a device list."""
    ref = build_reference(SHOPSIGN, "shopsign", "day-clear")
    frame = _window(OTHER_CAMERA, at=(426, 255), pane=(677, 381))
    with pytest.raises(SceneNotLocated, match="could be located"):
        locate(frame, [ref])


def test_the_RIGHT_camera_wins_when_several_are_known():
    """Panes reordered in the app is the motivating case: both scenes are on screen and
    both are live, so nothing about liveness distinguishes them. Appearance does."""
    refs = [build_reference(OTHER_CAMERA, "bay-cam", "day"),
            build_reference(SHOPSIGN, "shopsign", "day-clear")]
    found = locate(_window(SHOPSIGN, at=(426, 65), pane=(338, 190)), refs)
    assert found.scene_id == "shopsign"
    found = locate(_window(OTHER_CAMERA, at=(426, 65), pane=(338, 190)), refs)
    assert found.scene_id == "bay-cam"


def test_TWO_SCENES_THAT_LOOK_ALIKE_are_REFUSED_not_guessed_between():
    """Two views of the same forecourt can genuinely look alike. A near-tie must refuse:
    binding calibrated geometry to the wrong one of two similar cameras is unrecoverable,
    and unlike a miss it never announces itself."""
    twin = SHOPSIGN.copy()
    twin[0:6, 0:6] = 0                        # a trivially different, near-identical view
    refs = [build_reference(SHOPSIGN, "shopsign", "day"),
            build_reference(twin, "shopsign-twin", "day")]
    with pytest.raises(SceneNotLocated, match="could not be told apart"):
        locate(_window(SHOPSIGN, at=(300, 200), pane=(500, 281)), refs)


def test_a_reference_with_NO_STRUCTURE_is_refused_at_build_time():
    """A blank wall matches everything or nothing, unpredictably. Cheaper to refuse now."""
    with pytest.raises(SceneNotLocated, match="too few"):
        build_reference(np.full((180, 320, 3), 120, np.uint8), "blank")


def test_canonicalise_returns_the_pane_to_the_coordinates_the_calibration_was_drawn_in():
    """This is what makes geometry layout-blind: after the warp, a lot polygon means the
    same ground whether the pane was fullscreen or a corner tile."""
    ref = build_reference(SHOPSIGN, "shopsign", "day-clear")
    frame = _window(SHOPSIGN, at=(764, 65), pane=(338, 190))
    found = locate(frame, [ref])
    back = canonicalise(frame, found, (SHOPSIGN.shape[1], SHOPSIGN.shape[0]))
    assert back.shape[:2] == SHOPSIGN.shape[:2]
    # Compare structure, not exact pixels: the pane was downscaled to 338x190 and back, so
    # a per-pixel equality would be testing the resampler, not the geometry.
    a = back.astype(np.float32).mean(axis=2)
    b = SHOPSIGN.astype(np.float32).mean(axis=2)
    corr = float(np.corrcoef(a.ravel(), b.ravel())[0, 1])
    assert corr > 0.85, f"canonical view does not line up with the reference (r={corr:.2f})"


def test_a_SKEWED_quad_is_rejected_because_an_app_scales_a_pane_it_does_not_project_it():
    import cv2

    ref = build_reference(SHOPSIGN, "shopsign", "day-clear")
    height, width = SHOPSIGN.shape[:2]
    src = np.float32([[0, 0], [width, 0], [width, height], [0, height]])
    dst = np.float32([[420, 250], [1090, 190], [1100, 630], [430, 610]])   # a real skew
    warped = cv2.warpPerspective(SHOPSIGN, cv2.getPerspectiveTransform(src, dst), (1280, 720))
    frame = np.full((720, 1280, 3), 44, np.uint8)
    frame[::9, :] = 58
    np.copyto(frame, warped, where=(warped > 0))
    with pytest.raises(SceneNotLocated):
        locate(frame, [ref], require_axis_aligned=True)
    # ... and the SAME frame is accepted when the caller says projection is expected, which
    # proves the rejection came from the axis-aligned rule and not from a failure to match.
    assert locate(frame, [ref], require_axis_aligned=False).scene_id == "shopsign"


def test_the_epoch_is_HELD_across_estimation_jitter():
    """An epoch that ticked every frame would terminate every track continuously, and a
    system that never keeps a track cannot detect an arrival at all."""
    ref = build_reference(SHOPSIGN, "shopsign", "day-clear")
    first = locate(_window(SHOPSIGN, at=(426, 255), pane=(677, 381)), [ref])
    binding, changed = advance(None, first)
    assert changed and binding.epoch == 1
    again = locate(_window(SHOPSIGN, at=(426, 255), pane=(677, 381)), [ref])
    binding2, changed2 = advance(binding, again)
    assert not changed2 and binding2.epoch == 1


def test_the_epoch_ADVANCES_when_the_pane_actually_moves():
    """A track at x=650 before a layout change and a detection at x=650 after it are not
    the same place. Stitching them manufactures a portal crossing no car ever made."""
    ref = build_reference(SHOPSIGN, "shopsign", "day-clear")
    a = locate(_window(SHOPSIGN, at=(426, 255), pane=(677, 381)), [ref])
    binding, _ = advance(None, a)
    b = locate(_window(SHOPSIGN, at=(100, 100), pane=(677, 381)), [ref])
    moved, changed = advance(binding, b)
    assert changed and moved.epoch == 2


def test_a_binding_to_a_DIFFERENT_scene_always_advances_the_epoch():
    same_quad = ((0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0))
    binding = SceneBinding(scene_id="shopsign", epoch=7, quad=same_quad, homography_id="h:x")

    class _Fake:                                  # the quad is identical; only identity moved
        scene_id, quad, homography_id = "bay-cam", same_quad, "h:x"

    assert not binding.same_place_as(_Fake())
    _, changed = advance(binding, _Fake())
    assert changed


def test_locate_with_no_references_refuses_rather_than_returning_nothing_useful():
    with pytest.raises(SceneNotLocated, match="no references"):
        locate(_window(SHOPSIGN, at=(0, 0)), [])


# --- The three invariants a mutation run proved were untested ---------------------------


def _partial_twin(scene: np.ndarray, keep: float = 0.4) -> np.ndarray:
    """A scene sharing SOME structure with `scene`: enough to match, not enough to win.

    This is the case the ordering rule exists for and the one a single-distractor test
    cannot reach. Two totally different scenes do not both clear the bar, so only one
    candidate is ever scored and the sort is dead code -- a mutation replacing the sort
    with `pass` survived every test until this fixture existed.
    """
    out = _scene(404).copy()
    edge = int(scene.shape[0] * keep)
    out[:edge] = scene[:edge]
    return out


def test_the_BEST_SUPPORTED_scene_wins_even_when_a_weaker_one_is_listed_FIRST():
    full = build_reference(SHOPSIGN, "shopsign", "day")
    partial = build_reference(_partial_twin(SHOPSIGN), "half-match", "day")
    frame = _window(SHOPSIGN, at=(300, 200), pane=(600, 337))
    found = locate(frame, [partial, full])          # the weaker candidate is listed first
    assert found.scene_id == "shopsign", (
        f"listed-first won: {found.scene_id} with {found.inliers} inliers")
    assert found.runner_up == "half-match", "the distractor must actually have competed"
    assert found.margin > 1.0


def test_a_pane_too_SMALL_to_support_a_fit_is_refused_rather_than_fitted():
    """MIN_INLIERS is the floor under everything else: ratio, reprojection and quad sanity
    can all be satisfied by a handful of points that happen to agree."""
    ref = build_reference(SHOPSIGN, "shopsign", "day")
    with pytest.raises(SceneNotLocated):
        locate(_window(SHOPSIGN, at=(40, 40), pane=(34, 19)), [ref])


def test_a_BOW_TIE_quad_is_rejected_as_self_intersecting():
    """A self-intersecting quad is the classic signature of a homography fitted to
    mismatches. It cannot be a rectangle seen by any camera, so it cannot be a pane."""
    # Corners crossed AND asymmetric: a symmetric bow-tie has a shoelace area of exactly
    # zero, so it trips the area rule first and never reaches the convexity rule at all.
    bowtie = np.float32([[100, 100], [400, 140], [140, 300], [460, 260]])
    reason = _quad_is_sane(bowtie.reshape(-1, 1, 2), (720, 1280), True)
    assert reason and "self-intersecting" in reason, reason


def test_a_plain_rectangle_is_NOT_rejected_by_any_of_those_rules():
    """The positive control. Without it, a degeneracy check that rejected EVERYTHING would
    make all three tests above pass while the locator could never locate anything."""
    ok = np.float32([[426, 255], [1103, 255], [1103, 636], [426, 636]])
    assert _quad_is_sane(ok.reshape(-1, 1, 2), (720, 1280), True) is None


def test_a_SLIVER_and_an_OVERSIZED_quad_are_both_rejected():
    # 590x2 -- an AREA of 1180, comfortably over the area floor. This is the shape that
    # proved the area rule alone was not a sliver check.
    sliver = np.float32([[10, 10], [600, 10], [600, 12], [10, 12]])
    assert "sliver" in (_quad_is_sane(sliver.reshape(-1, 1, 2), (720, 1280), True) or "")
    huge = np.float32([[0, 0], [3000, 0], [3000, 2000], [0, 2000]])
    assert "larger than the window" in (_quad_is_sane(huge.reshape(-1, 1, 2), (720, 1280), True) or "")


# --- locate_all: a multi-lens window holds several scenes, not one ----------------------


def _multi_window(panes):
    """An app window showing several different cameras at once, as a 3-in-1 device does."""
    import cv2
    frame = np.full((720, 1280, 3), 44, np.uint8)
    frame[::9, :] = 58
    for scene, (x, y, w, h) in panes:
        frame[y:y + h, x:x + w] = cv2.resize(scene, (w, h))
    return frame


def test_locate_all_finds_EVERY_known_camera_in_a_multi_pane_window():
    """`locate` returns the strongest scene, which on a real 3-in-1 window silently discards
    the two small lenses covering the left and right approaches. This is the function a
    multi-lens device actually needs."""
    third = _scene(555)
    refs = [build_reference(SHOPSIGN, "left", "day"),
            build_reference(OTHER_CAMERA, "right", "day"),
            build_reference(third, "ptz", "day")]
    frame = _multi_window([(SHOPSIGN, (426, 65, 338, 190)),
                           (OTHER_CAMERA, (764, 65, 338, 190)),
                           (third, (426, 255, 677, 381))])
    found = locate_all(frame, refs)
    assert {f.scene_id for f in found} == {"left", "right", "ptz"}, [f.scene_id for f in found]
    by_id = {f.scene_id: f for f in found}
    x = min(p[0] for p in by_id["right"].quad)
    assert abs(x - 764) < 10, f"the right lens was placed at x={x:.0f}"


def test_locate_all_reports_a_SCENE_ONLY_ONCE_because_a_camera_is_in_one_place():
    """The two variants must match in DIFFERENT, non-overlapping panes, or this proves
    nothing: with both variants locking onto the same rectangle the overlap rule already
    rejects the second, and a mutation deleting the scene_id rule survives untouched.

    The real case is ordinary -- the app can show one camera in two panes, and each of that
    camera's stored variants may lock onto a different one. Reporting it twice would put two
    lot polygons on one camera and let a car "cross" between its own two images."""
    refs = [build_reference(SHOPSIGN, "left", "day"),
            build_reference(OTHER_CAMERA, "left", "night")]
    frame = _multi_window([(SHOPSIGN, (60, 65, 338, 190)),
                           (OTHER_CAMERA, (764, 400, 338, 190))])
    found = locate_all(frame, refs)
    assert [f.scene_id for f in found] == ["left"], [(f.scene_id, f.variant) for f in found]


def test_locate_all_refuses_to_explain_the_SAME_PIXELS_as_two_cameras():
    """Two different cameras cannot occupy one rectangle. An overlapping second match is the
    same pane explained twice, which would put two lot polygons on one patch of ground."""
    near_twin = SHOPSIGN.copy()
    near_twin[0:4, 0:4] = 0
    refs = [build_reference(SHOPSIGN, "left", "day"),
            build_reference(near_twin, "impostor", "day")]
    found = locate_all(_multi_window([(SHOPSIGN, (300, 200, 500, 281))]), refs)
    assert len(found) == 1, [(f.scene_id, f.quad[0]) for f in found]


def test_locate_all_is_EMPTY_rather_than_raising_when_nothing_is_recognised():
    """One unreadable pane in a four-up must not blind the producer to the other three, so
    this reports by omission where `locate` raises."""
    refs = [build_reference(SHOPSIGN, "left", "day")]
    assert locate_all(_multi_window([(OTHER_CAMERA, (426, 255, 677, 381))]), refs) == []
    assert locate_all(_multi_window([(SHOPSIGN, (0, 0, 640, 360))]), []) == []


# --- The atlas: several appearances of one camera, all mapping to one canonical frame ----


def _write_atlas(tmp_path, entries):
    import cv2
    for name, image in entries:
        cv2.imwrite(str(tmp_path / name), image)
    return str(tmp_path)


def test_the_atlas_loads_scene_and_variant_from_the_FILENAME(tmp_path):
    d = _write_atlas(tmp_path, [("shopsign-left__day-clear.png", SHOPSIGN),
                                ("shopsign-left__night.png", _scene(31)),
                                ("bay-cam__day.png", OTHER_CAMERA)])
    refs = load_atlas(d)
    assert {(r.scene_id, r.variant) for r in refs} == {
        ("shopsign-left", "day-clear"), ("shopsign-left", "night"), ("bay-cam", "day")}


def test_TWO_VARIANTS_of_one_camera_both_answer_with_the_SAME_scene_id(tmp_path):
    """One reference image eventually betrays you: noon and dusk do not share enough
    gradient structure for one descriptor set. Variants are how the same camera stays
    findable across the day -- and which one matched must never change the geometry."""
    night = _scene(31)
    d = _write_atlas(tmp_path, [("shopsign-left__day.png", SHOPSIGN),
                                ("shopsign-left__night.png", night)])
    refs = load_atlas(d)
    assert locate(_window(SHOPSIGN, at=(300, 200), pane=(500, 281)), refs).scene_id == "shopsign-left"
    assert locate(_window(night, at=(300, 200), pane=(500, 281)), refs).scene_id == "shopsign-left"


def test_an_EMPTY_atlas_directory_is_refused_where_the_problem_actually_IS(tmp_path):
    """Returning an empty list would surface later as a confusing 'no references supplied'
    from `locate`, pointing at the wrong place entirely."""
    with pytest.raises(SceneNotLocated, match="no reference images"):
        load_atlas(str(tmp_path))
    with pytest.raises(SceneNotLocated, match="does not exist"):
        load_atlas(str(tmp_path / "nope"))


def test_a_MASK_of_the_wrong_size_is_refused_rather_than_masking_the_wrong_pixels(tmp_path):
    import cv2
    d = _write_atlas(tmp_path, [("shopsign-left__day.png", SHOPSIGN)])
    cv2.imwrite(str(tmp_path / "shopsign-left__day.mask.png"), np.full((50, 50), 255, np.uint8))
    with pytest.raises(SceneNotLocated, match="different size"):
        load_atlas(d)


def test_a_MASK_restricts_features_to_the_landmarks_it_marks(tmp_path):
    """Features found on a parked car locate the CAR, and the car leaves. Masking is how the
    atlas learns the bones of the building instead of today's arrangement of vehicles."""
    import cv2
    d = _write_atlas(tmp_path, [("shopsign-left__day.png", SHOPSIGN)])
    mask = np.zeros(SHOPSIGN.shape[:2], np.uint8)
    mask[:90, :] = 255                       # only the top half counts as landmark
    cv2.imwrite(str(tmp_path / "shopsign-left__day.mask.png"), mask)
    masked = load_atlas(d)[0]
    unmasked = build_reference(SHOPSIGN, "shopsign-left", "day")
    assert len(masked.keypoints) < len(unmasked.keypoints), (
        f"the mask changed nothing: {len(masked.keypoints)} vs {len(unmasked.keypoints)}")
    assert all(kp.pt[1] < 95 for kp in masked.keypoints), "a feature escaped the mask"


def test_a_MIRRORED_homography_is_rejected_because_no_pane_is_shown_flipped(tmp_path):
    """A negative determinant means the fit folded the scene over. It is a fit that failed,
    not a camera that mirrors -- and the quad it projects can look perfectly reasonable."""
    import cv2
    ref = build_reference(SHOPSIGN, "shopsign", "day")
    frame = _window(np.ascontiguousarray(SHOPSIGN[:, ::-1]), at=(300, 200), pane=(500, 281))
    with pytest.raises(SceneNotLocated):
        locate(frame, [ref])


def test_a_SINGULAR_or_FLATTENED_homography_is_rejected():
    """Measured separation: a genuine axis-aligned pane match conditions at 1.01, the
    degenerate fit from a mirrored frame at 204.68."""
    assert _linear_is_sane(np.eye(3)) is None
    assert _linear_is_sane(np.diag([2.5, 2.5, 1.0])) is None, "uniform scale is a real pane"
    flat = np.array([[2.5, 0, 0], [0, 0.05, 0], [0, 0, 1.0]])       # condition 50
    assert "flattened" in (_linear_is_sane(flat) or "")
    singular = np.array([[1.0, 2.0, 0], [0.5, 1.0, 0], [0, 0, 1.0]])  # rank-deficient 2x2
    assert "singular" in (_linear_is_sane(singular) or "")
    assert "not finite" in (_linear_is_sane(np.full((3, 3), np.nan)) or "")


def test_the_matcher_actually_CONSULTS_the_linear_sanity_rule(monkeypatch):
    """A wiring assertion, and it is here because a mutation proved it was needed: deleting
    the call site from `_match_one` turned no test red. The rule is defence in depth -- the
    inlier floor rejects today's degenerate frames first -- so no realistic frame reaches
    it, and without this the call could be dropped silently and the depth would be gone."""
    from vision import scenelocator

    ref = build_reference(SHOPSIGN, "shopsign", "day")
    frame = _window(SHOPSIGN, at=(300, 200), pane=(500, 281))
    assert locate(frame, [ref]).scene_id == "shopsign"          # positive control first
    monkeypatch.setattr(scenelocator, "_linear_is_sane", lambda H: "refused by the probe")
    with pytest.raises(SceneNotLocated, match="could be located"):
        locate(frame, [ref])
