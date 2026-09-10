"""Episodes: the file has to be readable by someone who was not here when it was written.

Every test names the thing it stops being silently wrong. The format outlives the code, so
a defect here is discovered months later by a person holding a file and no explanation.
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from vision import episode as ep                                   # noqa: E402
from vision.episode import EpisodeWriter, verify, KNOWN, WIRED      # noqa: E402
from vision.hardcase import HardCaseRecorder                        # noqa: E402


def _jpeg(seed=0):
    import cv2

    rng = np.random.default_rng(seed)
    img = (rng.random((64, 64, 3)) * 255).astype(np.uint8)
    return cv2.imencode(".jpg", img)[1].tobytes()


def _episode(n=12, path=None):
    path = path or os.path.join(tempfile.mkdtemp(), "e.mcap")
    w = EpisodeWriter(path, frame_id="shop-left")
    for i in range(n):
        w.add_image(1000.0 + i * 0.25, _jpeg(i))
    w.note("/hardcase/trigger", 1001.0, {"reason": "POSE_OFF_HOME", "context": {"px": 41.2}})
    w.close({"reason": "POSE_OFF_HOME", "at": 1001.0})
    return path, w


@unittest.skipUnless(ep.AVAILABLE, "mcap not importable")
class EpisodeWriterTest(unittest.TestCase):

    def test_an_episode_reads_back_every_message_it_was_given(self):
        path, w = _episode(n=12)
        seen = verify(path)
        self.assertEqual(seen["topics"]["/camera/image"], 12)
        self.assertEqual(seen["topics"]["/hardcase/trigger"], 1)
        self.assertTrue(seen["complete"])
        self.assertEqual(w.stats.images, 12)

    def test_an_UNKNOWN_topic_is_a_counted_drop_and_never_an_exception(self):
        """A typo must not create a channel nobody will ever look for, and must not take
        down a producer either. Both failure modes are silent in opposite directions."""
        path = os.path.join(tempfile.mkdtemp(), "e.mcap")
        w = EpisodeWriter(path)
        self.assertFalse(w.note("/trackz", 1000.0, {"x": 1}))
        self.assertEqual(w.stats.dropped, 1)
        self.assertIn("/trackz", w.stats.last_error)
        w.close()
        self.assertNotIn("/trackz", (verify(path) or {"topics": {}})["topics"])

    def test_the_meta_record_says_which_channels_were_NOT_recorded(self):
        """The whole point of the census. Without it, an episode with no `/tracks` is
        indistinguishable from an incident in which the tracker produced nothing -- and the
        file will be read long after anyone remembers which build wrote it."""
        path, _ = _episode(n=3)
        from mcap.reader import make_reader
        import json

        meta = None
        with open(path, "rb") as fh:
            for _s, channel, msg in make_reader(fh).iter_messages():
                if channel.topic == "/episode/meta":
                    meta = json.loads(msg.data)
        self.assertIsNotNone(meta, "no /episode/meta record was written")
        self.assertIn("/tracks", meta["channelsKnown"])
        self.assertNotIn("/tracks", meta["channelsWired"])
        self.assertNotIn("/tracks", meta["channelsPresent"])
        self.assertIn("/camera/image", meta["channelsPresent"])

    def test_WIRED_is_a_subset_of_KNOWN_so_the_census_cannot_contradict_itself(self):
        self.assertEqual(sorted(set(WIRED) - set(KNOWN)), [],
                         "a channel is declared wired but is not a known topic")

    def test_a_writer_that_cannot_OPEN_its_path_stays_closed_instead_of_raising(self):
        # A DIRECTORY where the episode file should be. open(..., "wb") cannot win here,
        # and the producer must survive it -- on the shop box this is a leftover from a
        # previous layout, not a hypothetical.
        d = tempfile.mkdtemp()
        blocked = os.path.join(d, "episode.mcap")
        os.makedirs(blocked)
        w = EpisodeWriter(blocked)
        self.assertFalse(w.open)
        self.assertFalse(w.add_image(1.0, b"x"))
        self.assertFalse(w.note("/tracks", 1.0, {"a": 1}))
        self.assertIsNone(w.close())
        self.assertGreaterEqual(w.stats.dropped, 1)


@unittest.skipUnless(ep.AVAILABLE, "mcap not importable")
class TruncatedEpisodeTest(unittest.TestCase):
    """A producer that is killed mid-write leaves a file with no summary section.

    The default MCAP reader recovers NOTHING from one -- measured 0/30 at every cut depth --
    so a perfectly recoverable episode reads as total corruption unless `verify` falls back
    to the streaming reader. These tests are that fallback's canary.
    """

    def _truncate(self, path, frac):
        raw = open(path, "rb").read()
        cut = os.path.join(os.path.dirname(path), f"cut-{int(frac * 100)}.mcap")
        with open(cut, "wb") as fh:
            fh.write(raw[:int(len(raw) * frac)])
        return cut

    def test_a_truncated_episode_reports_what_SURVIVED_rather_than_nothing(self):
        """The bug this catches was written by hand and shipped for exactly one commit:
        counting inside the try discarded every recovered record along with the exception
        that ended the stream, so a 70%-cut file reported None instead of 36 frames."""
        path, _ = _episode(n=60)
        seen = verify(self._truncate(path, 0.7))
        self.assertIsNotNone(seen, "a recoverable episode reported as unreadable")
        self.assertGreater(seen["messages"], 0)

    def test_a_truncated_episode_is_marked_INCOMPLETE(self):
        """`complete` is what gates deleting the frames an episode replaces. If truncation
        could report complete, a killed producer would take the originals with it."""
        path, _ = _episode(n=60)
        seen = verify(self._truncate(path, 0.7))
        self.assertFalse(seen["complete"])

    def test_a_WHOLE_episode_is_marked_complete(self):
        """The positive control. Without it, a `verify` that returned complete=False for
        everything would pass the test above and quietly disable `replace` forever."""
        path, _ = _episode(n=60)
        self.assertTrue(verify(path)["complete"])

    def test_garbage_is_None_rather_than_an_exception_or_a_confident_zero(self):
        p = os.path.join(tempfile.mkdtemp(), "junk.mcap")
        with open(p, "wb") as fh:
            fh.write(b"this is not an mcap file at all")
        self.assertIsNone(verify(p))


class RecorderEpisodeWiringTest(unittest.TestCase):
    """An episode format with no producer is a file nobody ever has."""

    def _clip(self, mode, frames=16):
        d = tempfile.mkdtemp(prefix=f"hc-{mode}-")
        r = HardCaseRecorder(directory=d, before_seconds=2.0, after_seconds=1.0,
                             episodes=mode)
        rng = np.random.default_rng(7)
        for i in range(frames):
            r.observe(1000.0 + i * 0.25, (rng.random((64, 64, 3)) * 255).astype(np.uint8))
        r.trigger("POSE_OFF_HOME", 1000.5, {"shift_px": 41.2})
        clips = r.flush_all(1100.0)
        return r, clips[0]

    def _counts(self, clip):
        jpgs = [f for f in os.listdir(clip) if f.endswith(".jpg")]
        return len(jpgs), os.path.exists(os.path.join(clip, "episode.mcap"))

    @unittest.skipUnless(ep.AVAILABLE, "mcap not importable")
    def test_BOTH_keeps_the_frames_and_adds_an_episode(self):
        r, clip = self._clip("both")
        jpgs, has_mcap = self._counts(clip)
        self.assertGreater(jpgs, 0)
        self.assertTrue(has_mcap)
        self.assertEqual(r.stats.episodes_written, 1)
        self.assertEqual(r.stats.episodes_failed, 0)

    @unittest.skipUnless(ep.AVAILABLE, "mcap not importable")
    def test_REPLACE_drops_the_frames_only_after_the_episode_read_back(self):
        r, clip = self._clip("replace")
        jpgs, has_mcap = self._counts(clip)
        self.assertEqual(jpgs, 0)
        self.assertTrue(has_mcap)
        seen = verify(os.path.join(clip, "episode.mcap"))
        self.assertEqual(seen["topics"]["/camera/image"], r.stats.frames_written)

    @unittest.skipUnless(ep.AVAILABLE, "mcap not importable")
    def test_REPLACE_KEEPS_the_frames_when_the_episode_does_not_verify(self):
        """THE safety property. `close()` not raising is not the same claim as "the frames
        can be got out again", and only the second one may ever justify a delete. A clip
        with both copies wastes disk; a clip with neither is a lost sample."""
        import vision.episode as mod

        real = mod.verify
        mod.verify = lambda _p: None            # the episode will not read back
        try:
            r, clip = self._clip("replace")
        finally:
            mod.verify = real
        jpgs, has_mcap = self._counts(clip)
        self.assertGreater(jpgs, 0, "frames were deleted on an unverified episode")
        self.assertTrue(has_mcap)
        self.assertEqual(r.stats.episodes_failed, 1)
        self.assertEqual(r.stats.episodes_written, 0)

    @unittest.skipUnless(ep.AVAILABLE, "mcap not importable")
    def test_REPLACE_keeps_the_frames_when_the_episode_is_TRUNCATED(self):
        """A killed producer leaves a readable-but-incomplete episode. `verify` reports what
        survived, which is useful -- and is NOT permission to delete the originals it only
        partly contains. Mutating the `complete` check away left every other test green.
        """
        import vision.episode as mod

        real = mod.verify
        mod.verify = lambda _p: {"topics": {"/camera/image": 16}, "messages": 16,
                                 "complete": False}
        try:
            r, clip = self._clip("replace")
        finally:
            mod.verify = real
        jpgs, _ = self._counts(clip)
        self.assertGreater(jpgs, 0, "frames were deleted on a truncated episode")
        self.assertEqual(r.stats.episodes_failed, 1)

    @unittest.skipUnless(ep.AVAILABLE, "mcap not importable")
    def test_REPLACE_keeps_the_frames_when_the_episode_is_SHORT_a_few_images(self):
        """The subtlest loss: a complete, well-formed episode that is simply missing frames.
        Nothing about the file looks wrong -- it opens, it has a summary, it reads clean --
        and deleting the JPEGs against it silently discards the frames it lacks. Only the
        count catches it, and mutating the count check away left every other test green.
        """
        import vision.episode as mod

        real = mod.verify
        mod.verify = lambda _p: {"topics": {"/camera/image": 3}, "messages": 5,
                                 "complete": True}
        try:
            r, clip = self._clip("replace")
        finally:
            mod.verify = real
        jpgs, _ = self._counts(clip)
        self.assertGreater(jpgs, 0, "frames were deleted against a short episode")
        self.assertEqual(r.stats.episodes_failed, 1)
        self.assertIn("did not read back", r.stats.last_error)

    @unittest.skipUnless(ep.AVAILABLE, "mcap not importable")
    def test_an_episode_failure_does_NOT_make_the_recorder_unhealthy(self):
        """`healthy` means "every clip I tried to write landed". Losing the replayable view
        is a degradation of a convenience; folding it into the clip's own health would page
        an operator about a file format while the evidence is safely on disk."""
        import vision.episode as mod

        real = mod.verify
        mod.verify = lambda _p: None
        try:
            r, _clip = self._clip("both")
        finally:
            mod.verify = real
        self.assertEqual(r.stats.episodes_failed, 1)
        self.assertTrue(r.stats.healthy)
        self.assertEqual(r.stats.dropped_write_error, 0)

    def test_OFF_writes_no_episode_and_changes_nothing_else(self):
        r, clip = self._clip("off")
        jpgs, has_mcap = self._counts(clip)
        self.assertGreater(jpgs, 0)
        self.assertFalse(has_mcap)
        self.assertEqual(r.stats.episodes_written + r.stats.episodes_failed, 0)

    def test_a_box_WITHOUT_mcap_still_records_hard_cases(self):
        """The producer runs on a shop PC. A missing optional library must cost the replay
        view and nothing else -- never the evidence, and never the process."""
        import vision.episode as mod

        real = mod.AVAILABLE
        mod.AVAILABLE = False
        try:
            r, clip = self._clip("both")
        finally:
            mod.AVAILABLE = real
        jpgs, has_mcap = self._counts(clip)
        self.assertGreater(jpgs, 0)
        self.assertFalse(has_mcap)
        self.assertTrue(r.stats.healthy)
        self.assertEqual(r.stats.clips_written, 1)


if __name__ == "__main__":
    unittest.main()
