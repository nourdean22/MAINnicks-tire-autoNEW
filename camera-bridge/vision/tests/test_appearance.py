"""A bank of views, not a vector -- and evidence, never identity.

The asymmetry governing every threshold here: a FALSE MERGE writes two customers' visits
into one and is not recoverable from the data. A temporary SPLIT is visible and gets fixed
by the next observation. When in doubt, split.
"""
from __future__ import annotations

import numpy as np
import pytest

from vision.appearance import (MIN_CROP_PX, REDUNDANT_ABOVE, AppearanceBank, cosine,
                               crop_quality)


def _vec(*parts) -> np.ndarray:
    v = np.zeros(8, np.float32)
    for i, p in parts:
        v[i] = p
    return v


def _sharp(size=(120, 120)) -> np.ndarray:
    """A crop with real high-frequency structure, as an in-focus vehicle has."""
    rng = np.random.default_rng(4)
    img = np.zeros((size[0], size[1], 3), np.uint8)
    for _ in range(40):
        y, x = int(rng.integers(0, size[0] - 12)), int(rng.integers(0, size[1] - 12))
        img[y:y + 10, x:x + 10] = int(rng.integers(60, 255))
    return img


def _blurred(size=(120, 120)) -> np.ndarray:
    import cv2
    return cv2.GaussianBlur(_sharp(size), (21, 21), 0)


def test_cosine_is_clamped_and_handles_a_zero_vector():
    assert cosine(_vec((0, 1.0)), _vec((0, 1.0))) == pytest.approx(1.0)
    assert cosine(_vec((0, 1.0)), _vec((1, 1.0))) == pytest.approx(0.0)
    assert cosine(np.zeros(8), _vec((0, 1.0))) == 0.0, "a zero vector cannot be similar"
    assert -1.0 <= cosine(_vec((0, 1.0)), _vec((0, -1.0))) <= 1.0


def test_a_BLURRED_crop_scores_lower_than_a_SHARP_one_of_the_same_size():
    """A motion-blurred crop of a car mid-turn embeds just as confidently as a sharp one --
    into a description of a smear. Quality is how the bank avoids comparing everything
    afterwards against that smear."""
    assert crop_quality(_sharp()) > crop_quality(_blurred()) * 1.2


def test_a_TINY_crop_is_worth_nothing_regardless_of_sharpness():
    """Below a couple of dozen pixels there is not enough vehicle in the image for an
    embedding to describe anything but JPEG artefacts."""
    tiny = _sharp((MIN_CROP_PX - 1, MIN_CROP_PX - 1))
    assert crop_quality(tiny) == 0.0
    assert crop_quality(None) == 0.0
    assert crop_quality(np.zeros((0, 0, 3), np.uint8)) == 0.0


def test_an_EMPTY_bank_reports_NO_EVIDENCE_not_zero_similarity():
    """None means 'nothing to compare against'; 0.0 means 'measured, and they look nothing
    alike'. Collapsing them is how a system with no data starts reporting confident
    disagreement -- and a confident disagreement is what splits one customer into two."""
    bank = AppearanceBank()
    assert bank.similarity(_vec((0, 1.0))) is None
    bank.add(_vec((0, 1.0)), quality=0.8, at=1.0)
    assert bank.similarity(None) is None
    assert bank.similarity(_vec((0, 1.0))) == pytest.approx(1.0)


def test_a_view_with_NO_QUALITY_is_refused():
    bank = AppearanceBank()
    assert not bank.add(_vec((0, 1.0)), quality=0.0, at=1.0)
    assert not bank.add(None, quality=0.9, at=1.0)
    assert bank.views == [] and bank.rejected_quality == 2


def test_a_REDUNDANT_view_is_not_stored_twice():
    """A car sitting still produces the same embedding over and over. Storing each one gives
    a bank of N copies of one viewpoint -- precisely the bank that fails when the car
    reappears facing the other way."""
    bank = AppearanceBank(capacity=4)
    assert bank.add(_vec((0, 1.0)), quality=0.5, at=1.0)
    assert not bank.add(_vec((0, 1.0)), quality=0.4, at=2.0)
    assert len(bank.views) == 1 and bank.rejected_redundant == 1


def test_a_redundant_view_with_a_BETTER_CROP_replaces_the_one_it_matches():
    """The bank should hold the best view of each appearance, not the first that arrived."""
    bank = AppearanceBank(capacity=4)
    bank.add(_vec((0, 1.0)), quality=0.30, at=1.0)
    assert not bank.add(_vec((0, 1.0)), quality=0.90, at=2.0), "still redundant, still not new"
    assert len(bank.views) == 1
    assert bank.views[0].quality == pytest.approx(0.90), "the better crop must win"


def test_DISTINCT_views_are_all_kept_up_to_capacity():
    bank = AppearanceBank(capacity=3)
    assert bank.add(_vec((0, 1.0)), 0.5, 1.0)
    assert bank.add(_vec((1, 1.0)), 0.5, 2.0)
    assert bank.add(_vec((2, 1.0)), 0.5, 3.0)
    assert len(bank.views) == 3


def test_a_FULL_bank_evicts_the_most_REDUNDANT_resident_not_the_oldest():
    """Age says nothing about what a bank covers. Evicting by age throws away the earliest
    viewpoint, which after a full circuit of the lot is often the only front view stored."""
    bank = AppearanceBank(capacity=3)
    bank.add(_vec((0, 1.0)), 0.5, 1.0)                       # oldest, and unique
    bank.add(_vec((1, 1.0)), 0.5, 2.0)
    # Close to view 2, but deliberately BELOW the redundancy threshold so it is actually
    # stored. At 0.995 it would be rejected outright as a duplicate and the bank would only
    # hold two views, which tests nothing about eviction.
    near = _vec((1, 0.95), (2, 0.312))
    assert cosine(near, _vec((1, 1.0))) < REDUNDANT_ABOVE
    assert bank.add(near, 0.5, 3.0)
    assert len(bank.views) == 3
    bank.add(_vec((3, 1.0)), 0.9, 4.0)                       # a genuinely new direction
    kept = [v.embedding for v in bank.views]
    assert any(cosine(k, _vec((0, 1.0))) > 0.99 for k in kept), (
        "the OLDEST view was unique and must have survived")
    assert any(cosine(k, _vec((3, 1.0))) > 0.99 for k in kept), "the new view was not stored"
    assert len(bank.views) == 3


def test_similarity_reports_the_BEST_matching_view_not_the_latest():
    """The whole point of a bank. A car reappearing rear-first should be compared against the
    rear view it left behind, not against whichever embedding happened to be stored last."""
    bank = AppearanceBank(capacity=4)
    bank.add(_vec((0, 1.0)), 0.5, 1.0)      # 'front'
    bank.add(_vec((1, 1.0)), 0.5, 2.0)      # 'rear'
    assert bank.similarity(_vec((1, 1.0))) == pytest.approx(1.0)
    assert bank.similarity(_vec((0, 1.0))) == pytest.approx(1.0)


def test_the_bank_NEVER_grows_past_capacity_under_sustained_input():
    """A per-track structure that grows is a memory leak with a nice name, and a busy lot
    holds many tracks at once."""
    bank = AppearanceBank(capacity=5)
    rng = np.random.default_rng(0)
    for i in range(400):
        bank.add(rng.normal(size=8).astype(np.float32), quality=0.5, at=float(i))
    assert len(bank.views) <= 5
    assert bank.considered == 400, "every offer must be counted, kept or not"


def test_embeddings_are_L2_NORMALISED_on_the_way_in():
    """Cosine is scale-free, but storing unnormalised vectors makes every later comparison
    depend on crop brightness through the embedding's magnitude."""
    bank = AppearanceBank()
    bank.add(np.array([3.0, 4.0, 0, 0, 0, 0, 0, 0], np.float32), 0.5, 1.0)
    assert float(np.linalg.norm(bank.views[0].embedding)) == pytest.approx(1.0, abs=1e-5)


def test_best_returns_the_highest_quality_view_and_describe_never_raises():
    bank = AppearanceBank()
    assert bank.best() is None
    assert "views=0" in bank.describe()
    bank.add(_vec((0, 1.0)), 0.3, 1.0)
    bank.add(_vec((1, 1.0)), 0.8, 2.0)
    assert bank.best().quality == pytest.approx(0.8)
    assert "best_quality=0.80" in bank.describe()


def test_the_redundancy_threshold_is_high_enough_to_keep_genuinely_different_views():
    """If REDUNDANT_ABOVE were loose, two real viewpoints of one car would collapse into one
    stored view and the bank would stop being a bank."""
    assert REDUNDANT_ABOVE >= 0.95
    bank = AppearanceBank(capacity=4)
    bank.add(_vec((0, 1.0)), 0.5, 1.0)
    similar_but_distinct = _vec((0, 0.94), (1, 0.34))
    assert cosine(similar_but_distinct, _vec((0, 1.0))) < REDUNDANT_ABOVE
    assert bank.add(similar_but_distinct, 0.5, 2.0), "a genuinely different view must be kept"
