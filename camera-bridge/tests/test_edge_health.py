"""The pose-stall check, and proof it can say no.

A health check that only ever returns HEALTHY is indistinguishable from a health check
that works, which is how the shop PC went twelve minutes uncounted with `chain OK` in the
log. So every test that asserts green here has a sibling that breaks the instrument and
asserts red, and the restart-loop case has its own -- that one is not a hypothetical, it
is what a naive tail-grep would have done to this machine every three minutes.
"""
from __future__ import annotations

import datetime as _dt
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from edge_health import (HEALTHY, STALLED, UNKNOWN,  # noqa: E402
                         POSE_OFF_HOME, RUN_START, pose_stalled)

NOW = _dt.datetime(2026, 9, 16, 18, 2, 0)


def _line(minute: int, body: str) -> str:
    return "2026-09-16 %02d:%02d:00,123 INFO edge %s" % (17 if minute < 60 else 18,
                                                         minute % 60, body)


def _pose(minute: int) -> str:
    return _line(minute, r"hard case saved data\hard-cases\2026-%s" % POSE_OFF_HOME)


def _banner(when: str) -> str:
    return " \n%s Wed 09/16/2026 %s ==== " % (RUN_START, when)


class PoseStallTest(unittest.TestCase):

    def test_a_run_complaining_every_minute_is_STALLED(self):
        """The real 2026-09-16 shape: process up, task Running, view live, lot uncounted."""
        log = "\n".join([_banner("17:57:09"), _pose(57), _pose(58), _pose(59)])
        verdict, reason = pose_stalled(log, NOW)
        self.assertEqual(verdict, STALLED, reason)
        self.assertIn("maximised", reason)

    def test_a_QUIET_but_healthy_run_is_not_stalled(self):
        """THE false-positive guard. An empty lot at 3am writes no track points and no
        hard cases. Staleness of the ledger would read identically to a broken view --
        which is exactly why this check keys off the producer's own complaint instead."""
        log = "\n".join([_banner("17:57:09"),
                         _line(58, "trajectories -> data\\trajectories.sqlite"),
                         _line(59, "edge start version=2.1.2 mode=PRODUCTION")])
        verdict, _ = pose_stalled(log, NOW)
        self.assertEqual(verdict, HEALTHY)

    def test_complaints_from_a_PREVIOUS_run_do_not_condemn_the_current_one(self):
        """THE restart-loop canary.

        After a repair the broken run's complaints are still in the file. A check that
        greps the tail restarts the freshly-healthy producer, and does it again three
        minutes later, for ever. Scoping to the last banner is the whole fix.
        """
        log = "\n".join([_banner("17:50:00"), _pose(51), _pose(52), _pose(53), _pose(54),
                         _banner("18:01:30"), _line(1, "edge start version=2.1.2")])
        verdict, reason = pose_stalled(log, NOW)
        self.assertEqual(verdict, HEALTHY, reason)

    def test_a_run_with_too_FEW_complaints_is_given_the_benefit_of_the_doubt(self):
        """One blip during a repaint must not yank a producer that is coming up."""
        log = "\n".join([_banner("17:58:00"), _pose(59)])
        self.assertEqual(pose_stalled(log, NOW)[0], HEALTHY)

    def test_complaints_OLDER_than_the_window_do_not_count(self):
        """A run that misbehaved an hour ago and settled is not broken now."""
        old = ["2026-09-16 16:%02d:00,000 INFO edge hard case %s" % (m, POSE_OFF_HOME)
               for m in (40, 41, 42, 43)]
        log = "\n".join([_banner("16:39:00")] + old)
        self.assertEqual(pose_stalled(log, NOW)[0], HEALTHY)

    def test_a_log_with_NO_run_banner_returns_UNKNOWN_not_healthy(self):
        """A check that cannot tell which run it is reading must not get a vote -- and
        must not silently report green either, which is the shape that started all this."""
        log = "\n".join([_pose(57), _pose(58), _pose(59)])
        verdict, reason = pose_stalled(log, NOW)
        self.assertEqual(verdict, UNKNOWN, reason)

    def test_an_EMPTY_log_returns_UNKNOWN(self):
        self.assertEqual(pose_stalled("", NOW)[0], UNKNOWN)

    def test_an_UNPARSEABLE_timestamp_is_not_counted_as_recent(self):
        """Lines without a leading stamp (tracebacks, banners, wrapper echoes) carry the
        marker text in some crash dumps. Counting them would fire on a stack trace."""
        log = "\n".join([_banner("17:57:09")] + ["  raise HardCase(%s)" % POSE_OFF_HOME] * 5)
        self.assertEqual(pose_stalled(log, NOW)[0], HEALTHY)

    def test_the_threshold_is_actually_LOAD_BEARING(self):
        """Positive control on the knob itself: the same log must flip verdict when the
        threshold moves. Without this, a check hard-wired to HEALTHY passes every test
        above that expects green."""
        log = "\n".join([_banner("17:57:09"), _pose(58), _pose(59)])
        self.assertEqual(pose_stalled(log, NOW, threshold=4)[0], HEALTHY)
        self.assertEqual(pose_stalled(log, NOW, threshold=2)[0], STALLED)

    def test_the_WINDOW_is_actually_load_bearing(self):
        """The other knob. Same log, same threshold, only the window changes."""
        log = "\n".join([_banner("17:50:00"), _pose(51), _pose(52), _pose(53)])
        self.assertEqual(pose_stalled(log, NOW, window_seconds=120)[0], HEALTHY)
        self.assertEqual(pose_stalled(log, NOW, window_seconds=3600)[0], STALLED)


class RealLogShapeTest(unittest.TestCase):
    """The strings this module keys off are the producer's, not ours.

    `POSE_OFF_HOME` and the run banner are written by `edge_main.py` and by the wrapper
    the installer generates. Rename either and every test above still passes while the
    check silently matches nothing on the real machine -- the orphaned-subject shape.
    """

    REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    def test_the_hard_case_reason_is_one_the_producer_can_actually_emit(self):
        with open(os.path.join(self.REPO, "edge_main.py"), encoding="utf-8") as fh:
            source = fh.read()
        self.assertIn(
            POSE_OFF_HOME, source,
            "edge_main.py never emits %s any more, so this check matches nothing on the "
            "real log while every unit test above still passes." % POSE_OFF_HOME)

    def test_the_run_banner_is_the_one_the_installer_writes(self):
        installer = os.path.join(self.REPO, "scripts", "install-edge-runtime.ps1")
        with open(installer, encoding="utf-8") as fh:
            text = fh.read()
        self.assertIn(
            "edge start", text,
            "the generated wrapper no longer writes an 'edge start' banner, so runs "
            "cannot be delimited and the check will return UNKNOWN for ever.")


if __name__ == "__main__":
    unittest.main()
