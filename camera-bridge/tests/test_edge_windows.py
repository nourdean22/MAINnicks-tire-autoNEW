"""Rolling-window plausibility counters and ledger housekeeping on the edge loop.

Audit 2026-10-07, B2 and B3. On 2026-10-05 the SHOPSIGN lane counted 4 arrivals on a ~40-car
day while every dashboard stayed green: `lastInferenceAt` proved the detector was RUNNING and
nothing in the heartbeat said what it was SEEING. `detectionsLast10m` and
`portalCrossingsLast60m` are the missing half; the shop's plausibility canary reads them
beside frame health. And `Pipeline.housekeeping` -- ledger retention -- had been called by
visitd's LiveLoop since the ledger existed and never once by this loop, so the edge ledger on
NicksMax only ever grew.
"""
from __future__ import annotations

import os
import sys
import unittest
from types import SimpleNamespace

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import edge_main                                                       # noqa: E402
from test_edge_main import _Clock, _loop                               # noqa: E402
from test_main import make_pipeline                                    # noqa: E402
from visitd.main import PRUNE_INTERVAL_SECONDS                         # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROUTE = os.path.join(REPO, "..", "apps", "nickstire", "server", "routes", "cameraVisitsRoutes.ts")
MIGRATION = os.path.join(REPO, "..", "apps", "nickstire", "drizzle", "0143_camera_runtime_window_counters.sql")


def _council(by_detector, detections=0, latency=12.5):
    return SimpleNamespace(escalated=False, detections=[object()] * detections,
                           latency_ms=latency, by_detector=dict(by_detector))


class _Harness:
    """One frame per script entry: (frame ts, council or None, vision `arrivals` so far)."""

    def __init__(self, script, *, with_stats=True, **loop_kw):
        self.pipeline = make_pipeline()
        self.script = list(script)
        self.i = 0
        harness = self
        frames = [SimpleNamespace(ts=ts, image=np.zeros((8, 8, 3), np.uint8), seq=i,
                                  source="fake", meta={})
                  for i, (ts, _c, _a) in enumerate(self.script)]

        class _Src:
            def read(self):
                i = harness.i
                return frames[i] if i < len(frames) else None

        class _Vision:
            health = SimpleNamespace(state=lambda ts: None)
            tracks = SimpleNamespace(tracks={})
            tracker = SimpleNamespace(open_visits=lambda: [])

            def step(self, frame):
                _ts, council, arrivals = harness.script[harness.i]
                if with_stats:
                    self.stats.arrivals = arrivals
                out = {"emissions": []}
                if council is not None:
                    out["council"] = council
                harness.i += 1
                return out

        if with_stats:
            _Vision.stats = SimpleNamespace(arrivals=0)
        self.vision = _Vision()
        self.clock = _Clock(self.script[0][0] if self.script else 1000.0)
        self.loop = _loop(self.pipeline, self.vision, _Src(), clock=self.clock, **loop_kw)

    def run(self, n=None):
        todo = self.script[self.i:] if n is None else self.script[self.i:self.i + n]
        for ts, _c, _a in todo:
            self.clock.t = ts
            self.loop.step()
        return self.loop


class DetectionsWindowTest(unittest.TestCase):

    def test_counts_what_the_detector_saw_and_ignores_gated_frames(self):
        h = _Harness([
            (1000.0, _council({"mog2": 1, "primary": 2}, detections=2), 0),
            (1001.0, _council({"primary": 1}, detections=1), 0),
            (1002.0, _council({"mog2": 0}, detections=5), 0),     # gate only: not an inference
            (1003.0, None, 0),                                    # no council at all
        ])
        loop = h.run()
        self.assertEqual(loop.detections_last_10m, 3,
                         "a motion-gated frame's boxes were counted as detections")

    def test_forgets_detections_older_than_ten_minutes(self):
        h = _Harness([
            (1000.0, _council({"primary": 1}, detections=4), 0),
            (1001.0, _council({"primary": 1}, detections=4), 0),
            (1700.0, _council({"primary": 1}, detections=0), 0),  # 700 s later, empty lot
        ])
        h.run(2)
        self.assertEqual(h.loop.detections_last_10m, 8)
        h.run()
        self.assertEqual(h.loop.detections_last_10m, 0,
                         "detections from 700 s ago are still inside a 600 s window")

    def test_is_NONE_until_the_detector_has_run_never_zero(self):
        """A loop that has not inferred has not looked. The shop stores NULL as 'not reported'
        and 0 as 'looked and saw nothing', and the canary that reads this draws DEGRADED_VISION
        from the second one -- a confident zero from a producer that never ran would page
        someone to a camera whose detector simply has not started yet."""
        h = _Harness([(1000.0, _council({"mog2": 0}), 0), (1001.0, None, 0)])
        loop = h.run()
        self.assertIsNone(loop.detections_last_10m)
        self.assertNotEqual(loop.detections_last_10m, 0)

    def test_a_zero_after_an_inference_is_a_real_zero(self):
        h = _Harness([(1000.0, _council({"primary": 1}, detections=0), 0)])
        self.assertEqual(h.run().detections_last_10m, 0)


class PortalCrossingsWindowTest(unittest.TestCase):

    def test_counts_the_vision_arrivals_delta_and_forgets_after_an_hour(self):
        h = _Harness([
            (1000.0, None, 0),
            (1001.0, None, 0),
            (1002.0, None, 1),
            (1003.0, None, 1),
            (1004.0, None, 3),
            (4700.0, None, 3),   # 61+ minutes later, nothing new
        ])
        h.run(5)
        self.assertEqual(h.loop.portal_crossings_last_60m, 3)
        h.run()
        self.assertEqual(h.loop.portal_crossings_last_60m, 0)

    def test_a_restart_does_not_count_the_existing_total_as_a_burst(self):
        """The vision layer's `arrivals` is a process-lifetime total. The first frame sets the
        baseline; only ADVANCES are crossings."""
        h = _Harness([(1000.0, None, 7), (1001.0, None, 7), (1002.0, None, 8)])
        self.assertEqual(h.run().portal_crossings_last_60m, 1)

    def test_is_NONE_when_the_vision_layer_keeps_no_stats(self):
        h = _Harness([(1000.0, None, 0), (1001.0, None, 0)], with_stats=False)
        self.assertIsNone(h.run().portal_crossings_last_60m)


class WindowsReachTheShopTest(unittest.TestCase):
    """assert-the-consumer, across the app boundary: a field the shop drops on arrival looks
    exactly like one that works, from the producer's side."""

    def _body(self, loop):
        return edge_main.edge_heartbeat_body(
            camera="sign", seq=1, now=1001.0, mode="PRODUCTION",
            source=SimpleNamespace(), vision=loop.vision, ledger=loop.pipeline.ledger,
            health_state=None, scene_state=None, calibration_version=None,
            detector_name="fake", model_sha256=None, last_healthy_frame_at=None,
            detections_last_10m=loop.detections_last_10m,
            portal_crossings_last_60m=loop.portal_crossings_last_60m)

    def test_the_heartbeat_carries_both_as_integers(self):
        h = _Harness([(1000.0, _council({"primary": 1}, detections=2), 0), (1001.0, None, 2)])
        body = self._body(h.run())
        self.assertEqual(body["detectionsLast10m"], 2)
        self.assertEqual(body["portalCrossingsLast60m"], 2)

    def test_the_heartbeat_sends_NULL_not_zero_before_any_measurement(self):
        h = _Harness([(1000.0, None, 0)], with_stats=False)
        body = self._body(h.run())
        self.assertIn("detectionsLast10m", body)
        self.assertIsNone(body["detectionsLast10m"])
        self.assertIsNone(body["portalCrossingsLast60m"])

    def test_the_shop_route_parses_AND_stores_both_and_the_migration_exists(self):
        if not os.path.exists(ROUTE):
            self.skipTest("nickstire is not checked out beside camera-bridge")
        with open(ROUTE, encoding="utf-8") as fh:
            src = fh.read()
        for field in ("detectionsLast10m", "portalCrossingsLast60m"):
            self.assertIn(f"{field}:", src, f"the shop route has no {field} field to receive")
            self.assertIn(f'"{field}"', src,
                          f"{field} is declared but not in the route's column list, so it is parsed "
                          f"and then dropped before the write")
        self.assertTrue(os.path.exists(MIGRATION), "drizzle/0143 is missing: a column the code names and no DDL creates")
        with open(MIGRATION, encoding="utf-8") as fh:
            ddl = fh.read()
        for field in ("detectionsLast10m", "portalCrossingsLast60m"):
            self.assertIn(field, ddl)


class HousekeepingWiringTest(unittest.TestCase):
    """`Pipeline.housekeeping` prunes terminal visits past retention and dead letters past 7 d.
    visitd's LiveLoop has called it every pass since the ledger existed; this loop never did."""

    def _loop_with(self, pipeline, drain_seconds=5.0):
        clock = _Clock(1000.0)
        vision = SimpleNamespace(health=SimpleNamespace(state=lambda ts: None),
                                 tracks=SimpleNamespace(tracks={}),
                                 tracker=SimpleNamespace(open_visits=lambda: []),
                                 step=lambda frame: {"emissions": []})
        source = SimpleNamespace(read=lambda: None)
        return _loop(pipeline, vision, source, clock=clock, drain_seconds=drain_seconds), clock

    def test_the_drain_tick_calls_housekeeping_with_the_wall_clock_for_both_arguments(self):
        pipeline = make_pipeline()
        calls = []
        pipeline.housekeeping = lambda wall, epoch: calls.append((wall, epoch)) or 0  # type: ignore[method-assign]
        loop, clock = self._loop_with(pipeline)
        loop._run_timers()                       # t=1000: drain not due yet (next_drain = 1005)
        self.assertEqual(calls, [])
        clock.advance(5.0)
        loop._run_timers()
        self.assertEqual(calls, [(1005.0, 1005.0)],
                         "housekeeping did not ride the drain tick, or got a replay epoch instead of wall time")

    def test_the_real_pipeline_arms_its_hourly_prune_from_the_edge_loop(self):
        pipeline = make_pipeline()
        loop, clock = self._loop_with(pipeline)
        clock.advance(5.0)
        loop._run_timers()
        self.assertEqual(pipeline.next_prune_at, 1005.0 + PRUNE_INTERVAL_SECONDS,
                         "the real housekeeping did not run on the drain tick")

    def test_a_housekeeping_error_is_counted_never_raised(self):
        pipeline = make_pipeline()

        def boom(_wall, _epoch):
            raise RuntimeError("ledger locked")

        pipeline.housekeeping = boom  # type: ignore[method-assign]
        before = pipeline.metrics.snapshot().get("edge_housekeeping_errors_total", 0)
        loop, clock = self._loop_with(pipeline)
        clock.advance(5.0)
        loop._run_timers()                       # must not raise
        after = pipeline.metrics.snapshot().get("edge_housekeeping_errors_total", 0)
        self.assertEqual(after, before + 1)

    def test_a_pipeline_without_housekeeping_is_left_alone(self):
        pipeline = make_pipeline()
        bare = SimpleNamespace(
            metrics=pipeline.metrics, shop=pipeline.shop, ledger=pipeline.ledger,
            drain_shop=lambda: None, after_step=lambda emissions: None,
        )
        loop, clock = self._loop_with(bare)
        clock.advance(5.0)
        loop._run_timers()                       # no AttributeError


if __name__ == "__main__":
    unittest.main()
