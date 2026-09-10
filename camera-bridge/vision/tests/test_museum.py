"""The Failure Museum has to be able to say five different things, and mean them.

A regression suite over recorded failures is only worth having if its verdicts are
distinguishable. Collapsing "unblessed" or "stale" into PASS makes it grow quieter as it
grows larger -- the exact failure mode of every muted test suite -- and collapsing them into
FAIL trains everyone to ignore it the first time they touch a calibration.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from types import SimpleNamespace

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from vision import episode as ep                                       # noqa: E402
from vision import museum                                              # noqa: E402


def _write_episode(directory, frames=6, meta=None):
    """A real MCAP episode on disk, with per-frame provenance."""
    import cv2

    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, "episode.mcap")
    w = ep.EpisodeWriter(path)
    rng = np.random.default_rng(4)
    for i in range(frames):
        img = (rng.random((32, 32, 3)) * 255).astype(np.uint8)
        jpeg = cv2.imencode(".jpg", img)[1].tobytes()
        w.add_image(1000.0 + i, jpeg)
        if meta is not None:
            w.add_frame_meta(1000.0 + i, meta)
    w.close({"reason": "TEST", "at": 1000.0})
    return path


class _Pipe:
    """A pipeline that reports what it was actually handed."""

    def __init__(self, emissions_on=(), suppress=None):
        self.seen_meta = []
        self._emissions_on = set(emissions_on)
        self._suppress = suppress

    def step(self, frame):
        self.seen_meta.append(dict(frame.meta or {}))
        out = {"emissions": []}
        if self._suppress:
            out["suppressed"] = self._suppress
        if frame.seq in self._emissions_on:
            out["emissions"] = [SimpleNamespace(visit_id=f"v{frame.seq}", state="ARRIVED")]
        return out


@unittest.skipUnless(ep.AVAILABLE, "mcap not importable")
class ReplayTest(unittest.TestCase):

    def test_the_frame_META_is_replayed_and_never_invented(self):
        """THE provenance guard. The pipeline refuses to let a frame with `window_verified`
        unset start, advance or end a visit, because a screen capture silently returns
        whatever window overlaps the target. A replay that stamped every frame verified
        would launder exactly the frames that check exists to catch -- and the recorder
        buffers on EVERY tick, so an episode genuinely can contain unverified ones."""
        d = tempfile.mkdtemp()
        _write_episode(d, frames=4, meta={"window_verified": True, "sceneId": "shop-left"})
        pipe = _Pipe()
        museum.replay(os.path.join(d, "episode.mcap"), lambda: pipe)
        self.assertEqual(len(pipe.seen_meta), 4)
        for m in pipe.seen_meta:
            self.assertIs(m.get("window_verified"), True)
            self.assertEqual(m.get("sceneId"), "shop-left")

    def test_an_episode_with_NO_recorded_meta_replays_with_none(self):
        """Honest rather than helpful. Pixels whose provenance was never recorded replay
        with no provenance, every frame is suppressed, and the golden says so -- which reads
        as a corpus that needs re-collecting rather than as a passing test."""
        d = tempfile.mkdtemp()
        _write_episode(d, frames=3, meta=None)
        pipe = _Pipe()
        museum.replay(os.path.join(d, "episode.mcap"), lambda: pipe)
        self.assertEqual([m for m in pipe.seen_meta], [{}, {}, {}])

    def test_the_outcome_compares_SEQUENCES_and_not_visit_ids(self):
        """Visit ids are assigned in arrival order and shift whenever anything upstream
        changes. Comparing them makes every replay differ, and a suite that always fails is
        a suite that gets muted."""
        d = tempfile.mkdtemp()
        _write_episode(d, frames=4, meta={"window_verified": True})
        out = museum.replay(os.path.join(d, "episode.mcap"),
                            lambda: _Pipe(emissions_on=(1, 2)))
        self.assertNotIn("v1", json.dumps(out.compared))
        self.assertEqual(out["visits"], 2)
        self.assertEqual(out["stateSequences"], ["ARRIVED", "ARRIVED"])

    def test_a_suppression_REASON_is_kept_but_its_numbers_are_not(self):
        """Several suppression messages carry measured values that differ every run
        ("change=0.31"). Comparing the whole string makes every replay a failure."""
        d = tempfile.mkdtemp()
        _write_episode(d, frames=3, meta={"window_verified": True})
        out = museum.replay(os.path.join(d, "episode.mcap"),
                            lambda: _Pipe(suppress="camera motion / untrusted pose (change=0.31)"))
        self.assertEqual(list(out["suppressedCounts"]), ["camera motion / untrusted pose"])

    def test_an_episode_with_no_frames_is_BROKEN_not_empty(self):
        d = tempfile.mkdtemp()
        with open(os.path.join(d, "episode.mcap"), "wb") as fh:
            fh.write(b"not an mcap")
        self.assertIsNone(museum.replay(os.path.join(d, "episode.mcap"), lambda: _Pipe()))


@unittest.skipUnless(ep.AVAILABLE, "mcap not importable")
class VerdictTest(unittest.TestCase):

    def _corpus(self, frames=4):
        root = tempfile.mkdtemp()
        d = os.path.join(root, "20260101T000000-TEST")
        _write_episode(d, frames=frames, meta={"window_verified": True})
        return root, d

    def test_an_unblessed_episode_is_UNBLESSED_and_never_a_pass(self):
        """A museum that silently skipped what it had no answer for would grow quieter as
        it grew larger."""
        root, _d = self._corpus()
        report = museum.run(root, lambda: _Pipe(), calibration="c", detector="d")
        self.assertEqual(report["tally"], {"UNBLESSED": 1})
        self.assertTrue(report["ok"], "unblessed is work for a person, not a failure")

    def test_blessing_then_replaying_unchanged_is_a_PASS(self):
        root, _d = self._corpus()
        museum.run(root, lambda: _Pipe(), calibration="c", detector="d", do_bless=True)
        report = museum.run(root, lambda: _Pipe(), calibration="c", detector="d")
        self.assertEqual(report["tally"], {"PASS": 1})
        self.assertTrue(report["ok"])

    def test_a_CHANGED_conclusion_is_a_REGRESSION_and_names_what_moved(self):
        root, _d = self._corpus()
        museum.run(root, lambda: _Pipe(), calibration="c", detector="d", do_bless=True)
        report = museum.run(root, lambda: _Pipe(emissions_on=(1,)),
                            calibration="c", detector="d")
        self.assertEqual(report["tally"], {"REGRESSION": 1})
        self.assertFalse(report["ok"])
        changed = report["results"][0]["changed"]
        self.assertIn("visits", changed)
        self.assertEqual((changed["visits"]["golden"], changed["visits"]["now"]), (0, 1))

    def test_a_DIFFERENT_configuration_is_STALE_and_not_a_regression(self):
        """A golden blessed under one calibration says nothing about another: change the lot
        polygon and the same pixels legitimately produce different visits. Calling that a
        regression trains everyone to ignore the suite the first time they touch geometry."""
        root, _d = self._corpus()
        museum.run(root, lambda: _Pipe(), calibration="c1", detector="d", do_bless=True)
        report = museum.run(root, lambda: _Pipe(emissions_on=(1,)),
                            calibration="c2", detector="d")
        self.assertEqual(report["tally"], {"STALE": 1})
        self.assertTrue(report["ok"], "stale is work for a person, not a failure")
        self.assertEqual(report["results"][0]["blessedUnder"]["calibration"], "c1")

    def test_a_DIFFERENT_DETECTOR_is_stale_too(self):
        root, _d = self._corpus()
        museum.run(root, lambda: _Pipe(), calibration="c", detector="d1", do_bless=True)
        report = museum.run(root, lambda: _Pipe(), calibration="c", detector="d2")
        self.assertEqual(report["tally"], {"STALE": 1})

    def test_an_EMPTY_corpus_is_not_ok(self):
        """A museum with nothing in it proves nothing, and a run over it must not read as
        "everything is fine". The CLI exits 2."""
        report = museum.run(tempfile.mkdtemp(), lambda: _Pipe())
        self.assertEqual(report["results"], [])

    def test_a_BROKEN_fixture_fails_the_run(self):
        """Unlike unblessed and stale, an unreadable episode IS a failure: the corpus is
        losing evidence, and a run that shrugged would let it rot silently."""
        root = tempfile.mkdtemp()
        d = os.path.join(root, "20260101T000000-BROKEN")
        os.makedirs(d)
        with open(os.path.join(d, "episode.mcap"), "wb") as fh:
            fh.write(b"junk")
        report = museum.run(root, lambda: _Pipe(), calibration="c", detector="d")
        self.assertEqual(report["tally"], {"BROKEN": 1})
        self.assertFalse(report["ok"])

    def test_blessing_STAMPS_what_it_was_blessed_under(self):
        """A golden with no configuration recorded cannot be told apart from one blessed
        under the configuration you happen to be running, which is how a stale fixture
        becomes a silent false pass."""
        root, d = self._corpus()
        museum.run(root, lambda: _Pipe(), calibration="sha256:abc", detector="Council",
                   do_bless=True)
        with open(os.path.join(d, museum.GOLDEN_NAME), encoding="utf-8") as fh:
            golden = json.load(fh)
        self.assertEqual(golden["blessedUnder"],
                         {"calibration": "sha256:abc", "detector": "Council"})


if __name__ == "__main__":
    unittest.main()
