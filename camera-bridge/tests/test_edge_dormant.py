"""Dormant standby (job 2026-10-26-lot-vision-v2): a cloud copy that only heartbeats.

The cloud copy of the sign producer runs as p3 and must not open the camera while the shop PC
(p1) holds the lease: whether the V380 cloud serves two sessions to one device is unknown, so a
standby that streamed could knock the primary off. It heartbeats until the shop's reply grants it
the lease, then counts; on losing the lease it exits for its supervisor to restart it dormant.
"""
from __future__ import annotations

import os
import sys
import threading
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import edge_main                                                       # noqa: E402


class _Shop:
    def __init__(self, grants):
        self.grants = list(grants)
        self.checks = 0

    def is_authoritative(self, camera, now=None):
        self.checks += 1
        return self.grants.pop(0) if self.grants else False


def _loop(grants, heartbeat_raises=False):
    beats = []

    def send_heartbeat(now=None):
        beats.append(now)
        if heartbeat_raises:
            raise RuntimeError("shop unreachable")
        return True

    def read():
        raise AssertionError("a dormant standby must not read the camera")

    return SimpleNamespace(
        camera="sign",
        heartbeat_seconds=30.0,
        send_heartbeat=send_heartbeat,
        source=SimpleNamespace(read=read),
        pipeline=SimpleNamespace(shop=_Shop(grants), metrics=SimpleNamespace(inc=lambda *a, **k: None)),
        beats=beats,
    )


class DormantStandbyTest(unittest.TestCase):
    def test_cloud_role_is_below_every_shop_host(self):
        # p4, not p3: the server accepts an EQUAL priority takeover, so a p3 cloud copy could
        # bounce a counting NattyNour p3 off the lease (Codex on #3307).
        self.assertEqual(edge_main._EDGE_ROLE_PREFIX["cloud"], "p4-cloud")
        self.assertEqual(len({p.split("-")[0] for p in edge_main._EDGE_ROLE_PREFIX.values()}), 4)

    def test_waits_with_heartbeats_only_until_granted(self):
        loop = _loop([False, False, True])
        sleeps = []
        granted = edge_main.wait_until_authoritative(loop, threading.Event(), sleep=sleeps.append, clock=lambda: 100.0)
        self.assertTrue(granted)
        self.assertEqual(len(loop.beats), 3)
        self.assertEqual(sleeps, [30.0, 30.0])

    def test_promotion_restarts_the_stall_clock(self):
        # A standby dormant for an hour must get the normal startup allowance on its first
        # read, not be judged stalled for the whole dormant period (Codex on #3307).
        loop = _loop([True])
        loop.started_at = 0.0
        edge_main.wait_until_authoritative(loop, threading.Event(), sleep=lambda s: None, clock=lambda: 3600.0)
        self.assertEqual(loop.started_at, 3600.0)

    def test_a_lapsed_lease_stops_the_standby_BEFORE_it_reads_a_frame(self):
        loop = _loop([False])
        steps = []
        loop.step = lambda: steps.append(1)
        self.assertFalse(edge_main.step_unless_lease_lost(loop, dormant=True))
        self.assertEqual(steps, [])

    def test_a_held_lease_steps_and_the_primary_never_checks(self):
        loop = _loop([True])
        steps = []
        loop.step = lambda: steps.append(1)
        self.assertTrue(edge_main.step_unless_lease_lost(loop, dormant=True))
        primary = _loop([False])
        primary.step = lambda: steps.append(2)
        self.assertTrue(edge_main.step_unless_lease_lost(primary, dormant=False))
        self.assertEqual(steps, [1, 2])
        self.assertEqual(primary.pipeline.shop.checks, 0)

    def test_stop_ends_the_wait_without_a_grant(self):
        loop = _loop([False] * 10)
        stop = threading.Event()
        granted = edge_main.wait_until_authoritative(loop, stop, sleep=lambda s: stop.set(), clock=lambda: 100.0)
        self.assertFalse(granted)
        self.assertEqual(len(loop.beats), 1)

    def test_a_failed_heartbeat_keeps_waiting(self):
        loop = _loop([False, True], heartbeat_raises=True)
        granted = edge_main.wait_until_authoritative(loop, threading.Event(), sleep=lambda s: None, clock=lambda: 100.0)
        self.assertTrue(granted)
        self.assertEqual(len(loop.beats), 2)

    def test_flag_defaults_off(self):
        self.assertFalse(edge_main.parse_args(["--source", "rtsp"]).dormant_until_authoritative)
        self.assertTrue(edge_main.parse_args(["--source", "rtsp", "--dormant-until-authoritative"]).dormant_until_authoritative)


if __name__ == "__main__":
    unittest.main()
