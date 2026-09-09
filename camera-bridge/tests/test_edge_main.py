"""The durable edge runtime: pixels -> ONE tracker -> SQLite -> two projections.

These tests exist because the two halves of this sensor were built separately and the
seam between them is where the interesting defects live. Each one names the failure it
would catch, not the function it calls.
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import edge_main                                                       # noqa: E402
from edge_main import EdgeLoop, edge_heartbeat_body, source_generation  # noqa: E402
from test_main import make_pipeline                                     # noqa: E402
from visitd.ledger import Ledger                                        # noqa: E402


class FakeFrame:
    def __init__(self, ts: float) -> None:
        self.ts = ts
        self.seq = 0
        self.image = None
        self.size = (678, 381)


class FakeSource:
    """A CaptureMux stand-in: `active` with a name and a restore count, plus `index`."""

    def __init__(self, frames=None, boom=None, name="v380-wgc", restores=0, index=0):
        self._frames = list(frames or [])
        self._boom = boom
        self.index = index
        self.active = SimpleNamespace(name=name, restores=restores)
        self.reads = 0

    def read(self):
        self.reads += 1
        if self._boom:
            raise self._boom
        return self._frames.pop(0) if self._frames else None


class FakeVision:
    """Stands in for VisionPipeline: returns scripted step() output and holds the tracker."""

    def __init__(self, tracker, steps=None, boom=None):
        self.tracker = tracker
        self._steps = list(steps or [])
        self._boom = boom
        self.health = SimpleNamespace(state=lambda _now: SimpleNamespace(fps=4.0, ok=True))
        self.calls = 0

    def step(self, _frame):
        self.calls += 1
        if self._boom:
            raise self._boom
        if self._steps:
            return self._steps.pop(0)
        return {"emissions": [], "suppressed": None}


class Recorder:
    """Transport stand-in, matching the one in test_shop_mirror."""

    def __init__(self, status=200, boom=None):
        self.status = status
        self.boom = boom
        self.calls = []

    def __call__(self, method, url, payload, headers, timeout):
        self.calls.append({"method": method, "url": url, "payload": payload, "headers": headers})
        if self.boom:
            raise self.boom
        return self.status, "ok"


def shop_enabled(pipeline, transport=None):
    pipeline.shop.url = "https://nickstire.org/api/camera/visits"
    pipeline.shop._key = "k"
    pipeline.shop.transport = transport or Recorder()
    return pipeline.shop.transport


class OneAuthorityTest(unittest.TestCase):
    """The structural claim the whole module exists to make."""

    def test_the_vision_pipeline_drives_VISITDS_OWN_tracker(self):
        """Two trackers would mean two answers to 'is this car still here', and the one
        the ledger persists would not be the one the pixels update."""
        args = _args(calibration=None)
        cfg = _cfg()
        pipeline, vision, source, cal, detector, mode, data_class, base_mode = edge_main.build_edge(cfg, args)
        try:
            self.assertIs(vision.tracker, pipeline.tracker,
                          "the vision pipeline must NOT own a second VisitTracker")
            self.assertIsNone(cal, "no calibration file -> census mode")
            self.assertEqual(mode, "shadow", "uncalibrated defaults to shadow, never production")
            self.assertEqual(base_mode, "shadow", "and the baseline it returns to is the same")
            self.assertEqual(data_class, "PRODUCTION")
        finally:
            pipeline.ledger.close()

    def test_a_commissioning_run_tags_its_rows_and_never_counts_as_production(self):
        args = _args(calibration=None, commissioning_run="C-20260910-001")
        pipeline, vision, source, cal, det, mode, data_class, base_mode = edge_main.build_edge(_cfg(), args)
        try:
            self.assertEqual(mode, "commissioning")
            self.assertEqual(data_class, "COMMISSIONING")
            self.assertEqual(pipeline.shop.data_class, "COMMISSIONING")
            self.assertEqual(pipeline.shop.commissioning_run_id, "C-20260910-001")
            # The BASELINE is derived from the calibration, never from the launch flag: a
            # producer started with --commissioning-run must still be able to LEAVE
            # commissioning when the run ends.
            self.assertEqual(base_mode, "shadow")
        finally:
            pipeline.ledger.close()

    def test_an_unconfigured_camera_name_is_REFUSED_not_silently_accepted(self):
        """The shop's expected-camera registry keys on this name. A typo would post under
        an unregistered producer forever, and the registered camera would read
        NEVER_INGESTED while a producer was running perfectly."""
        from visitd.config import ConfigError

        with self.assertRaises(ConfigError) as ctx:
            edge_main.build_edge(_cfg(), _args(camera="sgin"))
        self.assertIn("sgin", str(ctx.exception))


class EmissionsReachTheLedgerTest(unittest.TestCase):
    """The positive control: wiring that never runs looks identical to wiring that works."""

    def test_every_emission_lands_in_BOTH_outboxes_in_one_pass(self):
        pipeline = make_pipeline()
        shop_enabled(pipeline)
        emissions = _real_emissions(pipeline, camera="lot")
        self.assertTrue(emissions, "precondition: the tracker produced something to persist")
        self.assertEqual(pipeline.ledger.outbox_depth(), 0, "precondition: NOTHING is persisted yet")
        self.assertEqual(pipeline.ledger.shop_outbox_depth(), 0)

        vision = FakeVision(pipeline.tracker, steps=[{"emissions": emissions}])
        loop = _loop(pipeline, vision, FakeSource(frames=[FakeFrame(1000.0)]))
        loop.step()

        # These can now ONLY be satisfied by the loop, which is the whole point.
        self.assertGreaterEqual(pipeline.ledger.outbox_depth(), 1, "StateNour outbox got the event")
        self.assertGreaterEqual(pipeline.ledger.shop_outbox_depth(), 1, "shop projection got the row")

    def test_a_frame_that_produced_NOTHING_enqueues_nothing(self):
        """Quiet frames persist tracker STATE but must never enqueue an outbox row --
        otherwise the shop would receive a delivery per frame for a car that did nothing."""
        pipeline = make_pipeline()
        shop_enabled(pipeline)
        vision = FakeVision(pipeline.tracker, steps=[{"emissions": []}])
        _loop(pipeline, vision, FakeSource(frames=[FakeFrame(1000.0)]), persist_seconds=0.0).step()
        self.assertEqual(pipeline.ledger.outbox_depth(), 0)
        self.assertEqual(pipeline.ledger.shop_outbox_depth(), 0)

    def test_TRACKER_STATE_reaches_SQLITE_on_quiet_frames_too(self):
        """Codex P1 on #2255. `VisionPipeline.step()` mutates the SHARED tracker on ordinary
        frames even when it emits nothing -- `last_activity`, sighting bounds, zone intervals
        -- and those drive the departure grace. Persisting only on transitions meant a crash
        between them restored stale timers, which can delay a departure, split a visit, or
        close one early."""
        pipeline = make_pipeline()
        commits = []
        real = pipeline.after_step
        pipeline.after_step = lambda ems: commits.append(list(ems)) or real(ems)

        clock = _Clock(1000.0)
        vision = FakeVision(pipeline.tracker, steps=[{"emissions": []}] * 10)
        loop = _loop(pipeline, vision, FakeSource(), clock=clock, persist_seconds=2.0)
        for _ in range(10):
            clock.advance(0.25)                     # 4 fps, 2.5 s of quiet frames
            loop.source._frames.append(FakeFrame(clock()))
            loop.step()

        self.assertTrue(commits, "quiet frames must still reach the persistence boundary")
        self.assertTrue(all(c == [] for c in commits), "and carry NO emissions")
        # Timed, not per-frame: 10 frames across 2.5 s at a 2 s interval is far fewer than 10.
        self.assertLess(len(commits), 5, f"persistence should be throttled, saw {len(commits)} commits")
        self.assertEqual(loop.quiet_commits, len(commits))

    def test_persist_seconds_zero_commits_EVERY_processed_frame(self):
        pipeline = make_pipeline()
        commits = []
        pipeline.after_step = lambda ems: commits.append(list(ems))
        clock = _Clock(1000.0)
        loop = _loop(pipeline, FakeVision(pipeline.tracker), FakeSource(), clock=clock, persist_seconds=0.0)
        for _ in range(4):
            clock.advance(0.25)
            loop.source._frames.append(FakeFrame(clock()))
            loop.step()
        self.assertEqual(len(commits), 4)

    def test_a_frame_that_never_ARRIVED_does_not_commit(self):
        """The persist timer must not fire on a read that returned nothing: there is no new
        tracker state to save, and committing would only churn the ledger while the camera
        is down."""
        pipeline = make_pipeline()
        commits = []
        pipeline.after_step = lambda ems: commits.append(list(ems))
        clock = _Clock(1000.0)
        loop = _loop(pipeline, FakeVision(pipeline.tracker), FakeSource(), clock=clock, persist_seconds=0.0)
        for _ in range(5):
            clock.advance(1.0)
            loop.step()                              # source is empty -> read() returns None
        self.assertEqual(commits, [])

    def test_the_loop_does_NOT_tick_the_tracker_itself(self):
        """`VisionPipeline.step()` already calls `tracker.tick(now)` and folds those
        emissions into its output. A second tick here would advance every visit timer
        twice per frame and depart cars early -- a bug that would look like flaky
        departures, not like double-counting."""
        pipeline = make_pipeline()
        ticks = []
        pipeline.tracker.tick = lambda now: ticks.append(now) or []
        vision = FakeVision(pipeline.tracker, steps=[{"emissions": []}])
        loop = _loop(pipeline, vision, FakeSource(frames=[FakeFrame(1000.0), FakeFrame(1000.3)]))
        loop.step()
        loop.step()
        self.assertEqual(ticks, [], "the edge loop owns the heartbeat and the drain, NOT the tick")


class ResilienceTest(unittest.TestCase):
    def test_a_capture_that_RAISES_does_not_kill_the_producer(self):
        """A transient capture fault is a bad minute, not a bad day -- and the timers must
        still run, so the shop learns the source is in trouble rather than going silent."""
        pipeline = make_pipeline()
        transport = shop_enabled(pipeline)
        vision = FakeVision(pipeline.tracker)
        loop = _loop(pipeline, vision, FakeSource(boom=OSError("device lost")))

        loop.step()
        loop.step()
        self.assertEqual(loop.read_failures, 2)
        self.assertEqual(vision.calls, 0, "no frame means no vision step")
        self.assertTrue(transport.calls, "but the heartbeat still went out")

    def test_a_vision_step_that_RAISES_is_contained(self):
        pipeline = make_pipeline()
        shop_enabled(pipeline)
        vision = FakeVision(pipeline.tracker, boom=RuntimeError("detector exploded"))
        loop = _loop(pipeline, vision, FakeSource(frames=[FakeFrame(1000.0)]))
        out = loop.step()
        self.assertEqual(out["suppressed"], "vision error")
        self.assertEqual(loop.frames, 1)

    def test_a_LEDGER_failure_is_NOT_swallowed(self):
        """The opposite rule to everything above. `after_step` holds the step's rows for
        the next pass when the commit fails; swallowing the raise here would drop them."""
        pipeline = make_pipeline()
        shop_enabled(pipeline)

        def boom(_emissions):
            raise RuntimeError("disk I/O error")

        pipeline.after_step = boom
        vision = FakeVision(pipeline.tracker, steps=[{"emissions": [object()]}])
        with self.assertRaises(RuntimeError):
            _loop(pipeline, vision, FakeSource(frames=[FakeFrame(1000.0)])).step()

    def test_a_heartbeat_failure_never_stops_the_loop(self):
        pipeline = make_pipeline()
        shop_enabled(pipeline, transport=Recorder(boom=OSError("wan down")))
        vision = FakeVision(pipeline.tracker)
        loop = _loop(pipeline, vision, FakeSource(frames=[FakeFrame(1000.0)]))
        loop.step()                       # no exception escapes
        self.assertEqual(loop.frames, 1)


class RestartRecoveryTest(unittest.TestCase):
    def test_open_visits_are_restored_INTO_THE_TRACKER_THE_VISION_PIPELINE_DRIVES(self):
        """Durability only pays off if the restored state lands where the pixels will
        update it. Restoring into a tracker the vision pipeline does not hold would
        resurrect cars nothing could ever depart."""
        fd, path = tempfile.mkstemp(suffix=".sqlite")
        os.close(fd)
        try:
            first = make_pipeline(ledger=Ledger(path))
            _real_emissions(first, camera="lot", persist=True)
            open_ids = {v.visit_id for v in first.tracker.open_visits()}
            self.assertTrue(open_ids, "precondition: a visit is open when the process dies")
            first.ledger.close()

            args = _args(calibration=None, ledger=path)
            pipeline, vision, source, *_ = edge_main.build_edge(_cfg(), args)
            try:
                restored = {v.visit_id for v in pipeline.tracker.open_visits()}
                self.assertTrue(open_ids <= restored, "the visit survived the restart")
                self.assertIs(vision.tracker, pipeline.tracker,
                              "and it is in the tracker the vision pipeline will update")
            finally:
                pipeline.ledger.close()
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass


class HeartbeatTest(unittest.TestCase):
    def test_it_carries_BOTH_halves_of_what_the_producer_knows(self):
        """`run_live` could report only the vision half (no ledger); `visitd` only the
        delivery half (never sees a pixel). A heartbeat with one half is why the shop's
        lattice had `cloud: unknown` or `frames: unknown` forever."""
        pipeline = make_pipeline()
        pipeline.ledger.commit_step([], [], [("v1", 1, "u", {"visitId": "v1"})])
        vision = FakeVision(pipeline.tracker)
        body = edge_heartbeat_body(
            camera="lot", seq=7, now=1_800_000_000.0, mode="SHADOW",
            source=FakeSource(restores=2), vision=vision, ledger=pipeline.ledger,
            health_state=SimpleNamespace(fps=3.9, ok=True),
            scene_state=SimpleNamespace(pose_ok=True, pose_delta=0.02, reference_set=True),
            calibration_version="sha256:abc123", detector_name="council", model_sha256="d" * 64,
            last_healthy_frame_at=1_799_999_999.0,
        )
        # the vision half
        self.assertEqual(body["sourceType"], "wgc")
        self.assertEqual(body["sourceGeneration"], "0.2")
        self.assertEqual((body["captureFps"], body["frameOk"]), (3.9, True))
        self.assertEqual((body["poseOk"], body["calibrationVersion"]), (True, "sha256:abc123"))
        self.assertEqual(body["lastHealthyFrameAt"], "2027-01-15T07:59:59+00:00")
        self.assertEqual(body["restores"], 2)
        # the delivery half
        self.assertEqual(body["outboxDepth"], 1)
        self.assertIsNotNone(body["oldestOutboxAgeSeconds"])
        self.assertEqual(body["deadLetterDepth"], 0)
        self.assertEqual(body["openVisits"], 0)

    def test_unknown_stays_None_so_the_lattice_never_calls_it_healthy(self):
        """The lattice treats None as 'unknown' and refuses to call a camera healthy on a
        dimension nobody measured. A zero here would read as a measured zero."""
        pipeline = make_pipeline()
        body = edge_heartbeat_body(
            camera="lot", seq=1, now=1_800_000_000.0, mode="SHADOW",
            source=FakeSource(), vision=FakeVision(pipeline.tracker), ledger=pipeline.ledger,
            health_state=None, scene_state=None, calibration_version=None,
            detector_name=None, model_sha256=None, last_healthy_frame_at=None,
        )
        self.assertIsNone(body["captureFps"])
        self.assertIsNone(body["frameOk"])
        self.assertIsNone(body["poseOk"])
        self.assertIsNone(body["lastHealthyFrameAt"], "an unobserved time is not now")
        self.assertIsNone(body["calibrationVersion"], "census mode -> the shop says CALIBRATION_INVALID")
        pipeline.ledger.close()

    def test_pose_is_UNKNOWN_until_a_reference_exists(self):
        """Reporting the raw `pose_ok` before a reference is adopted claims a match
        against nothing -- and the shop would render a green pose facet on a camera
        that has never been checked."""
        pipeline = make_pipeline()
        kw = dict(camera="lot", seq=1, now=1.0, mode="SHADOW", source=FakeSource(),
                  vision=FakeVision(pipeline.tracker), ledger=pipeline.ledger,
                  health_state=None, calibration_version=None, detector_name=None,
                  model_sha256=None, last_healthy_frame_at=None)
        unset = edge_heartbeat_body(scene_state=SimpleNamespace(pose_ok=True, pose_delta=None, reference_set=False), **kw)
        self.assertIsNone(unset["poseOk"])
        setref = edge_heartbeat_body(scene_state=SimpleNamespace(pose_ok=False, pose_delta=9.0, reference_set=True), **kw)
        self.assertIs(setref["poseOk"], False)
        pipeline.ledger.close()

    def test_a_disconnected_source_reports_disconnected_not_silence(self):
        pipeline = make_pipeline()
        dead = FakeSource(index=2)
        dead.active = None
        body = edge_heartbeat_body(
            camera="lot", seq=1, now=1.0, mode="SHADOW", source=dead,
            vision=FakeVision(pipeline.tracker), ledger=pipeline.ledger,
            health_state=None, scene_state=None, calibration_version=None,
            detector_name=None, model_sha256=None, last_healthy_frame_at=None,
        )
        self.assertIs(body["sourceConnected"], False)
        self.assertIsNone(body["sourceType"])
        self.assertEqual(body["sourceGeneration"], "2.0")
        pipeline.ledger.close()

    def test_the_sequence_is_monotonic_within_one_instance(self):
        """The cloud's idempotency key is (producerInstanceId, heartbeatSeq); a sequence
        that repeated would let the cloud refuse a live heartbeat as a stale replay."""
        pipeline = make_pipeline()
        shop_enabled(pipeline)
        loop = _loop(pipeline, FakeVision(pipeline.tracker), FakeSource())
        loop.send_heartbeat(1.0)
        loop.send_heartbeat(2.0)
        loop.send_heartbeat(3.0)
        seqs = [c["payload"]["heartbeatSeq"] for c in pipeline.shop.transport.calls]
        self.assertEqual(seqs, [1, 2, 3])
        self.assertEqual({c["payload"]["producerInstanceId"] for c in pipeline.shop.transport.calls},
                         {edge_main.PRODUCER_INSTANCE_ID})


class TimersTest(unittest.TestCase):
    def test_the_heartbeat_and_drain_fire_on_THEIR_OWN_schedules_not_per_frame(self):
        """At 4 fps, a per-frame heartbeat would be 4 POSTs a second."""
        pipeline = make_pipeline()
        transport = shop_enabled(pipeline)
        clock = _Clock(1000.0)
        loop = _loop(pipeline, FakeVision(pipeline.tracker), FakeSource(), clock=clock,
                     heartbeat_seconds=30.0, drain_seconds=5.0)

        loop.step()                      # t=1000: the first heartbeat is due immediately
        self.assertEqual(len(transport.calls), 1)
        for _ in range(10):              # ten more frames inside the window
            clock.advance(0.25)
            loop.step()
        self.assertEqual(len(transport.calls), 1, "still ONE heartbeat, not eleven")

        clock.advance(31.0)
        loop.step()
        self.assertEqual(len(transport.calls), 2)

    def test_shutdown_FLUSHES_rather_than_dropping_what_is_held(self):
        pipeline = make_pipeline()
        shop_enabled(pipeline)
        _real_emissions(pipeline, camera="lot", persist=True)
        depth_before = pipeline.ledger.shop_outbox_depth()
        self.assertGreaterEqual(depth_before, 1)

        loop = _loop(pipeline, FakeVision(pipeline.tracker), FakeSource())
        loop.shutdown()
        self.assertEqual(pipeline.ledger.shop_outbox_depth(), 0,
                         "the queued projection was delivered on the way out")


class WatchdogTest(unittest.TestCase):
    """The layer BELOW the self-heal: when the source has stopped entirely."""

    def test_a_FROZEN_but_DELIVERING_camera_is_not_a_stall(self):
        """The distinction that makes the watchdog safe. A frozen or looping camera still
        delivers frames; the pipeline already calls that DEGRADED_VISION and suppresses
        detections. Restarting on it would be a restart loop against a dirty lens."""
        pipeline = make_pipeline()
        shop_enabled(pipeline)
        clock = _Clock(1000.0)
        loop = _loop(pipeline, FakeVision(pipeline.tracker), FakeSource(), clock=clock, stall_exit_seconds=60.0)
        for _ in range(200):
            clock.advance(1.0)
            loop.source._frames.append(FakeFrame(clock()))   # the SAME picture, but arriving
            loop.step()
        self.assertIsNone(loop.stalled, "frames are arriving; that is a vision problem, not a process one")

    def test_a_source_that_stops_DELIVERING_is_a_stall(self):
        pipeline = make_pipeline()
        shop_enabled(pipeline)
        clock = _Clock(1000.0)
        src = FakeSource(frames=[FakeFrame(1000.0)])
        loop = _loop(pipeline, FakeVision(pipeline.tracker), src, clock=clock, stall_exit_seconds=60.0)
        loop.step()                       # one real frame
        self.assertIsNone(loop.stalled)
        clock.advance(61.0)
        loop.step()                       # source is empty now
        self.assertIsNotNone(loop.stalled)
        self.assertIn("stopped delivering", loop.stalled)
        self.assertIn("1 frame", loop.stalled)

    def test_a_producer_that_NEVER_captured_anything_is_caught_too(self):
        """Waiting for a `last_frame_at` that will never arrive would hang forever on the
        one failure a restart is most likely to fix."""
        pipeline = make_pipeline()
        shop_enabled(pipeline)
        clock = _Clock(1000.0)
        loop = _loop(pipeline, FakeVision(pipeline.tracker), FakeSource(), clock=clock, stall_exit_seconds=60.0)
        loop.step()
        self.assertIsNone(loop.stalled)
        clock.advance(61.0)
        loop.step()
        self.assertIn("was EVER captured", loop.stalled or "")

    def test_the_watchdog_can_be_turned_OFF(self):
        pipeline = make_pipeline()
        clock = _Clock(1000.0)
        loop = _loop(pipeline, FakeVision(pipeline.tracker), FakeSource(), clock=clock, stall_exit_seconds=0.0)
        clock.advance(100_000.0)
        loop.step()
        self.assertIsNone(loop.stalled)

    def test_the_first_stall_reason_is_KEPT_not_overwritten_each_pass(self):
        """The reason names how long the source had been quiet WHEN IT TRIPPED. Recomputing
        it every pass would make the log say a bigger number each time and hide when it
        actually started."""
        pipeline = make_pipeline()
        clock = _Clock(1000.0)
        loop = _loop(pipeline, FakeVision(pipeline.tracker), FakeSource(), clock=clock, stall_exit_seconds=60.0)
        clock.advance(61.0)
        loop.step()
        first = loop.stalled
        clock.advance(600.0)
        loop.step()
        self.assertEqual(loop.stalled, first)


class SourceGenerationTest(unittest.TestCase):
    def test_a_restore_or_a_failover_is_a_NEW_generation(self):
        """A track path must never cross a generation: an outside point from one lane
        plus an inside point from another is a fabricated portal crossing."""
        self.assertEqual(source_generation(FakeSource(index=0, restores=0)), "0.0")
        self.assertEqual(source_generation(FakeSource(index=0, restores=3)), "0.3",
                         "un-minimising the capture window is a discontinuity too")
        self.assertEqual(source_generation(FakeSource(index=1, restores=0)), "1.0")
        dead = FakeSource(index=4)
        dead.active = None
        self.assertEqual(source_generation(dead), "4.0")


# --------------------------------------------------------------------------- helpers
class _Clock:
    def __init__(self, t: float) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, dt: float) -> None:
        self.t += dt


def _cfg(raw=None):
    import dataclasses

    from test_main import RAW
    from visitd.config import build_config

    return dataclasses.replace(build_config(raw or RAW, environ={}))


def _args(**over):
    defaults = dict(
        config="config.yaml", camera="lot", ledger=":memory:", source="window", hwnd=None,
        window_title="V380", no_crop=True, calibration=None, model=None, device="AUTO",
        motion_gate=False, evidence=None, fps=4.0, seconds=0.0, mode=None,
        commissioning_run=None, heartbeat_seconds=30.0, drain_seconds=5.0,
        dry_run=True, log_level="WARNING",
    )
    defaults.update(over)
    return SimpleNamespace(**defaults)


def _loop(pipeline, vision, source, clock=None, **kw):
    opts = dict(camera="lot", mode="SHADOW", calibration_version=None, detector_name="fake",
                stall_exit_seconds=0.0)   # OFF by default in tests; the watchdog suite opts in
    opts.update(kw)
    return EdgeLoop(pipeline, vision, source, clock=clock or _Clock(1000.0), **opts)


def _real_emissions(pipeline, camera: str, persist: bool = False):
    """Drive the REAL tracker so the emissions and visit ids are the genuine article.

    `persist=False` by default, and that default is load-bearing. This used to call
    `pipeline.process_message`, which internally calls `after_step` -- so a test that then
    asserted "the outbox has rows" was measuring rows THIS HELPER wrote, not rows the edge
    loop wrote. Stubbing `after_step` out of the loop entirely left that assertion green.
    Going through `tracker.handle_event` produces emissions with no persistence, so the
    ledger assertions afterwards can only be satisfied by the code under test.
    """
    from test_main import EVENTS, raw
    from visitd.frigate_events import parse_message

    out = []
    for kind, at in (("new", 1000.0), ("update", 1012.0)):
        message = parse_message(EVENTS, raw(kind, "o1", at, ["front_lot"]), topic_prefix="frigate")
        out += list(pipeline.tracker.handle_event(message))
    if persist:
        pipeline.after_step(out)
    return out


if __name__ == "__main__":
    unittest.main()


class GenerationBreakTest(unittest.TestCase):
    """A track path must never span a capture generation (Codex P1 on #2255)."""

    def _vision_with_spies(self, pipeline):
        v = FakeVision(pipeline.tracker, steps=[{"emissions": []}] * 20)
        v.degraded = []
        v.reconnects = []
        v.tracks = SimpleNamespace(mark_degraded=lambda: v.degraded.append(True))
        v.census = SimpleNamespace(note_reconnect=lambda ts: v.reconnects.append(ts))
        return v

    def test_a_LANE_FAILOVER_degrades_tracks_and_re_arms_the_census(self):
        """`CaptureMux` moves to the next lane after repeated failed reads. An OUTSIDE
        sample from one lane plus an INSIDE sample from another reads as a portal crossing
        nobody observed -- the exact failure this system exists to prevent."""
        pipeline = make_pipeline()
        src = FakeSource(index=0)
        vision = self._vision_with_spies(pipeline)
        loop = _loop(pipeline, vision, src, persist_seconds=0.0)

        src._frames.append(FakeFrame(1000.0)); loop.step()
        self.assertEqual(vision.degraded, [], "no change yet")

        src.index = 1                                  # failover
        src._frames.append(FakeFrame(1001.0)); loop.step()
        self.assertEqual(len(vision.degraded), 1, "tracks degraded on the new generation")
        self.assertEqual(vision.reconnects, [1001.0], "census re-armed at the new frame's time")
        self.assertEqual(loop.generation_breaks, 1)

    def test_an_UN_MINIMISE_is_a_generation_change_too(self):
        """A restore is a discontinuity in what the pixels mean, not merely a hiccup."""
        pipeline = make_pipeline()
        src = FakeSource(restores=0)
        vision = self._vision_with_spies(pipeline)
        loop = _loop(pipeline, vision, src, persist_seconds=0.0)
        src._frames.append(FakeFrame(1000.0)); loop.step()
        src.active.restores = 1
        src._frames.append(FakeFrame(1001.0)); loop.step()
        self.assertEqual(loop.generation_breaks, 1)
        self.assertEqual(len(vision.degraded), 1)

    def test_a_STEADY_source_never_breaks_paths(self):
        """The break discards path history, so firing it spuriously would destroy the
        evidence a legitimate crossing is built from."""
        pipeline = make_pipeline()
        src = FakeSource()
        vision = self._vision_with_spies(pipeline)
        loop = _loop(pipeline, vision, src, persist_seconds=0.0)
        for i in range(10):
            src._frames.append(FakeFrame(1000.0 + i))
            loop.step()
        self.assertEqual(loop.generation_breaks, 0)
        self.assertEqual(vision.degraded, [])


class RestartIdentityTest(unittest.TestCase):
    """A restart must not let a new car inherit an old visit (Codex P1 on #2255)."""

    def test_track_ids_start_ABOVE_every_restored_sighting(self):
        """`_emit` derives a sighting id as `{camera}-{track_id}` and a fresh TrackGraph
        restarts at 1, so after a restart the FIRST car seen would be handed the same id as
        a restored sighting -- and visitd looks sightings up by that id, so a completely
        different vehicle would inherit that visit's arrival time, bay and data class."""
        from types import SimpleNamespace as NS

        tracker = NS(open_visits=lambda: [
            NS(sightings={"sign-3": object(), "sign-11": object()}),
            NS(sightings={"sign-7": object(), "other-99": object()}),
        ])
        vision = NS(tracks=NS(_next_id=1))
        highest = edge_main.seed_track_ids(vision, tracker, "sign")
        self.assertEqual(highest, 11, "the highest id for THIS camera, ignoring other cameras")
        self.assertEqual(vision.tracks._next_id, 12)

    def test_a_clean_start_leaves_the_counter_alone(self):
        from types import SimpleNamespace as NS

        vision = NS(tracks=NS(_next_id=1))
        self.assertEqual(edge_main.seed_track_ids(vision, NS(open_visits=lambda: []), "sign"), 0)
        self.assertEqual(vision.tracks._next_id, 1)

    def test_an_unreadable_tracker_never_takes_the_producer_down(self):
        from types import SimpleNamespace as NS

        def boom():
            raise RuntimeError("ledger unreadable")

        vision = NS(tracks=NS(_next_id=1))
        with self.assertLogs("edge", level="ERROR"):
            self.assertEqual(edge_main.seed_track_ids(vision, NS(open_visits=boom), "sign"), 0)
        self.assertEqual(vision.tracks._next_id, 1)

    def test_non_numeric_sighting_ids_are_ignored_rather_than_crashing(self):
        from types import SimpleNamespace as NS

        tracker = NS(open_visits=lambda: [NS(sightings={"sign-abc": 1, "sign-": 1, "sign-4": 1})])
        vision = NS(tracks=NS(_next_id=1))
        self.assertEqual(edge_main.seed_track_ids(vision, tracker, "sign"), 4)
        self.assertEqual(vision.tracks._next_id, 5)
