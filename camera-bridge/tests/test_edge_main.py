"""The durable edge runtime: pixels -> ONE tracker -> SQLite -> two projections.

These tests exist because the two halves of this sensor were built separately and the
seam between them is where the interesting defects live. Each one names the failure it
would catch, not the function it calls.
"""
from __future__ import annotations

import os
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import edge_main                                                       # noqa: E402
from edge_main import EdgeLoop, edge_heartbeat_body, source_generation  # noqa: E402
from edge_main import _locate_quality                                   # noqa: E402
from vision.run_live import RevalidateResult                            # noqa: E402
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
            self.assertEqual(mode, "SHADOW", "uncalibrated defaults to shadow, never production")
            self.assertEqual(base_mode, "SHADOW", "and the baseline it returns to is the same")
            self.assertEqual(data_class, "PRODUCTION")
        finally:
            pipeline.ledger.close()

    def test_a_commissioning_run_tags_its_rows_and_never_counts_as_production(self):
        args = _args(calibration=None, commissioning_run="C-20260910-001")
        pipeline, vision, source, cal, det, mode, data_class, base_mode = edge_main.build_edge(_cfg(), args)
        try:
            self.assertEqual(mode, "COMMISSIONING")
            self.assertEqual(data_class, "COMMISSIONING")
            self.assertEqual(pipeline.shop.data_class, "COMMISSIONING")
            self.assertEqual(pipeline.shop.commissioning_run_id, "C-20260910-001")
            # The BASELINE is derived from the calibration, never from the launch flag: a
            # producer started with --commissioning-run must still be able to LEAVE
            # commissioning when the run ends.
            self.assertEqual(base_mode, "SHADOW")
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
            first = make_pipeline(ledger=Ledger(edge_main.camera_ledger_path(path, "lot")))
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
        self.assertEqual(body["sourceGeneration"], "0.2.0")
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
        self.assertEqual(body["sourceGeneration"], "2.0.0")
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


    def test_standby_promotion_discards_standby_state_before_writes(self):
        class AuthorityRecorder(Recorder):
            def __call__(self, method, url, payload, headers, timeout):
                super().__call__(method, url, payload, headers, timeout)
                return 200, '{"authoritative": true, "authorityLeaseSeconds": 90}'

        pipeline = make_pipeline()
        transport = shop_enabled(pipeline, AuthorityRecorder())
        pipeline.shop.producer_instance_id = "p2-nicksmax-test"
        pipeline.shop._lease_managed = True
        vision = FakeVision(pipeline.tracker)
        reset_calls = []
        vision.reset_authority_epoch = lambda ts: reset_calls.append(ts) or {"tracks": 2, "visits": 1}
        loop = _loop(pipeline, vision, FakeSource())

        with self.assertLogs("edge", level="WARNING"):
            self.assertTrue(loop.send_heartbeat(1234.0))
        self.assertTrue(pipeline.shop.is_authoritative(loop.camera))
        self.assertEqual(reset_calls, [1234.0])
        self.assertEqual(len(transport.calls), 1)

    def test_failed_promotion_reset_stops_renewing_until_local_reset_recovers(self):
        class AuthorityRecorder(Recorder):
            def __call__(self, method, url, payload, headers, timeout):
                super().__call__(method, url, payload, headers, timeout)
                return 200, '{"authoritative": true, "authorityLeaseSeconds": 90}'

        pipeline = make_pipeline()
        transport = shop_enabled(pipeline, AuthorityRecorder())
        pipeline.shop.producer_instance_id = "p2-nicksmax-test"
        pipeline.shop._lease_managed = True
        vision = FakeVision(pipeline.tracker)
        vision.reset_authority_epoch = lambda _ts: (_ for _ in ()).throw(RuntimeError("boom"))
        loop = _loop(pipeline, vision, FakeSource())

        with self.assertLogs("edge", level="ERROR"):
            self.assertFalse(loop.send_heartbeat(1234.0))
        self.assertFalse(pipeline.shop.is_authoritative(loop.camera))
        self.assertTrue(loop.authority_recovery_blocked)
        self.assertEqual(len(transport.calls), 1)

        # Repeated local failure must NOT send another heartbeat and refresh the backend lease.
        with self.assertLogs("edge", level="ERROR"):
            self.assertFalse(loop.send_heartbeat(1264.0))
        self.assertEqual(len(transport.calls), 1)

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
        self.assertEqual(source_generation(FakeSource(index=0, restores=0)), "0.0.0")
        self.assertEqual(source_generation(FakeSource(index=0, restores=3)), "0.3.0",
                         "un-minimising the capture window is a discontinuity too")
        self.assertEqual(source_generation(FakeSource(index=1, restores=0)), "1.0.0")
        dead = FakeSource(index=4)
        dead.active = None
        self.assertEqual(source_generation(dead), "4.0.0")

    def test_a_LAYOUT_EPOCH_change_is_a_new_generation_too(self):
        """The reason the epoch joined this identity. A track at x=650 before a layout change
        and a detection at x=650 after it are not the same place, and joining them
        manufactures a portal crossing no car ever made.

        Folding the epoch in here means the EXISTING generation-break path -- which already
        degrades tracks and re-arms the pre-existing census -- handles a re-located scene
        with no second mechanism to keep in step."""
        src = FakeSource(index=0, restores=0)
        before = source_generation(src)
        src.active.layout_epoch = 2
        after = source_generation(src)
        self.assertNotEqual(before, after, "a layout change must break the path")
        self.assertEqual(after, "0.0.2")

    def test_a_source_with_NO_epoch_reads_as_zero_rather_than_raising(self):
        """Most sources have no concept of a layout epoch -- the mss lane, replay, fixtures.
        They must keep working and keep a stable generation."""
        plain = FakeSource(index=1, restores=1)
        if hasattr(plain.active, "layout_epoch"):
            del plain.active.layout_epoch
        self.assertEqual(source_generation(plain), "1.1.0")


# --------------------------------------------------------------------------- helpers
class _Clock:
    def __init__(self, t: float) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, dt: float) -> None:
        self.t += dt


def _RAW():
    from test_main import RAW

    return RAW


def _cfg(raw=None):
    import dataclasses

    from test_main import RAW
    from visitd.config import build_config

    return dataclasses.replace(build_config(raw or RAW, environ={}))


def _args(**over):
    defaults = dict(
        config="config.yaml", camera="lot", ledger=":memory:", source="window", hwnd=None,
        source_url_env="CAMERA_SOURCE_URL", window_title="V380", no_crop=True,
        calibration=None, model=None, device="AUTO",
        motion_gate=False, evidence=None, fps=4.0, seconds=0.0, mode=None,
        commissioning_run=None, heartbeat_seconds=30.0, drain_seconds=5.0,
        dry_run=True, log_level="WARNING", channel=None, persist_seconds=2.0,
        stall_exit_seconds=180.0, scene_atlas=None, scene=None,
        restart_rebind_seconds=20.0, restart_rebind_max_gap_seconds=120.0,
        adjudicator_model=None, adjudicator_device=None,
        hard_cases=None, hard_case_max_gb=2.0, hard_case_episodes="both", trajectories=None,
        service_review_seconds=30.0, shadow_ledger=None,
        relocate_seconds=120.0,
        challenger_model=None,
        replay=False,
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



class GenerationBreakTest(unittest.TestCase):
    """A track path must never span a capture generation (Codex P1 on #2255)."""

    def _vision_with_spies(self, pipeline):
        v = FakeVision(pipeline.tracker, steps=[{"emissions": []}] * 20)
        v.degraded = []
        v.reconnects = []
        # `now=None` on purpose, matching the generation-break caller: a capture failover
        # swaps which pixels arrive, it is not an interval in which nothing was observed.
        # The stub records what it was passed so that stays true rather than assumed.
        v.tracks = SimpleNamespace(mark_degraded=lambda now=None: v.degraded.append(now))
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
        self.assertEqual(
            vision.degraded, [None],
            "a generation break must NOT open a blind interval. It swaps which pixels "
            "arrive; it is not a stretch in which nothing was observed, and the cars in the "
            "new generation are overwhelmingly the same cars parked where they were. "
            "Charging them would strip parked protection on every window restore and "
            "re-create the birth churn `parked_after` exists to stop.")
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


class RestartReconcileTest(unittest.TestCase):
    """A producer restart invalidates vision identity, so its orphans must be ended.

    The other half of Codex's P1 on #2255. `seed_track_ids` stops a NEW car inheriting an
    old visit; this stops the old visit hanging around for 12 hours waiting for an `end`
    that no live track exists to send.
    """

    @staticmethod
    def _two_camera_pipeline():
        from test_main import RAW

        two = dict(RAW)
        two["cameras"] = {
            "lot": {"cloudDeviceId": "dev-lot", "arrivalZones": ["front_lot"]},
            "sign": {"cloudDeviceId": "dev-sign", "arrivalZones": ["front_lot"]},
        }
        return make_pipeline(raw=two)

    @staticmethod
    def _drive(pipeline, oid, camera, times):
        from test_main import EVENTS, raw
        from visitd.frigate_events import parse_message

        for kind, at in times:
            pipeline.tracker.handle_event(parse_message(
                EVENTS, raw(kind, oid, at, ["front_lot"], camera=camera), topic_prefix="frigate"))

    def _sighting(self, pipeline, oid):
        for visit in pipeline.tracker.open_visits():
            if oid in visit.sightings:
                return visit.sightings[oid]
        self.fail(f"no open visit holds sighting {oid!r}")

    def test_the_orphan_departs_AT_ITS_LAST_ACTIVITY_not_at_the_restart(self):
        """Ending it at `now` would bill the whole downtime to the customer. The car was
        last SEEN before the crash, and that is when its sighting has to close."""
        fd, path = tempfile.mkstemp(suffix=".sqlite")
        os.close(fd)
        try:
            first = make_pipeline(ledger=Ledger(edge_main.camera_ledger_path(path, "lot")))
            _real_emissions(first, camera="lot", persist=True)
            self.assertTrue(first.tracker.open_visits(), "precondition: a visit is open")
            first.ledger.close()

            pipeline, _vision, _source, *_ = edge_main.build_edge(
                _cfg(), _args(calibration=None, ledger=path))
            try:
                closed = [s for v in pipeline.tracker.open_visits()
                          for s in v.sightings.values() if s.end_time is not None]
                self.assertTrue(closed, "the restored sighting was force-ended on startup")
                for sighting in closed:
                    self.assertAlmostEqual(
                        sighting.end_time, 1012.0, places=3,
                        msg="closed at the last activity the DEAD process recorded")
                    self.assertLess(sighting.end_time, time.time() - 1000,
                                    "and emphatically not at the restart's wall clock")
            finally:
                pipeline.ledger.close()
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass

    def test_it_does_NOT_depart_a_sibling_producers_cars(self):
        """The ledger path is shared across the config, so two producers can be in one
        SQLite file. An unscoped force-end would depart cars another camera is still
        actively watching -- a restart of one producer silently emptying another's lot."""
        pipeline = self._two_camera_pipeline()
        self._drive(pipeline, "lot-1", "lot", (("new", 1000.0), ("update", 1012.0)))
        self._drive(pipeline, "sign-1", "sign", (("new", 1000.0), ("update", 1012.0)))

        pipeline.force_end_open_sightings("producer_restart", time.time(), "lot")

        self.assertIsNotNone(self._sighting(pipeline, "lot-1").end_time,
                             "the restarting producer's own sighting closed")
        self.assertIsNone(self._sighting(pipeline, "sign-1").end_time,
                          "the sibling producer's sighting is untouched")

    def test_the_scoped_anchor_does_not_borrow_a_SIBLINGS_clock(self):
        """The sibling has been running the whole time, so ITS last activity is ~now.
        Anchoring on it would stamp this camera's departure with a time the car was
        demonstrably not there -- exactly the inflated-visit bug being fixed."""
        pipeline = self._two_camera_pipeline()
        self._drive(pipeline, "lot-1", "lot", (("new", 1000.0), ("update", 1012.0)))
        self._drive(pipeline, "sign-1", "sign", (("new", 8000.0), ("update", 9000.0)))
        self.assertIsNone(pipeline.last_frame_time,
                          "precondition: no message went through the pipeline, so the "
                          "anchor branch is the one under test")

        pipeline.force_end_open_sightings("producer_restart", time.time(), "lot")

        self.assertAlmostEqual(self._sighting(pipeline, "lot-1").end_time, 1012.0, places=3)

    def test_an_unscoped_call_still_ends_everything(self):
        """Frigate owns every camera at once; its restart really does invalidate them all.
        The new parameter must not have narrowed the existing caller."""
        pipeline = self._two_camera_pipeline()
        self._drive(pipeline, "lot-1", "lot", (("new", 1000.0), ("update", 1012.0)))
        self._drive(pipeline, "sign-1", "sign", (("new", 1000.0), ("update", 1012.0)))

        pipeline.force_end_open_sightings("frigate_restart", time.time())

        self.assertIsNotNone(self._sighting(pipeline, "lot-1").end_time)
        self.assertIsNotNone(self._sighting(pipeline, "sign-1").end_time)

    def test_a_clean_start_is_a_no_op(self):
        pipeline = make_pipeline()
        self.assertEqual(edge_main.reconcile_restart(pipeline, "lot"), 0)

    def test_a_reconcile_failure_never_takes_the_producer_down(self):
        """Worst case the orphans expire on max age, which is where they were before this
        fix. Refusing to start is strictly worse than starting with a stale visit."""
        from types import SimpleNamespace as NS

        def boom(*_a, **_kw):
            raise RuntimeError("ledger unreadable")

        broken = NS(tracker=NS(open_visits=lambda: [NS(visit_id="v1")]),
                    force_end_open_sightings=boom)
        with self.assertLogs("edge", level="ERROR"):
            self.assertEqual(edge_main.reconcile_restart(broken, "lot"), 0)



class RestartContinuityTelemetryTest(unittest.TestCase):
    """What the operator reads after a deploy: which cars kept their visit, and how many
    restored visits departed. Asserted on the metric VALUES and the log text, because a
    counter nobody increments and a log line nobody emits look identical in a green suite."""

    def test_continuations_and_the_window_summary_reach_metrics_and_the_log(self):
        pipeline = make_pipeline()
        out = {"emissions": [], "suppressed": None,
               "restartContinuations": [{"trackId": 146, "visitId": "v-1", "objectId": "sign-120"}],
               "restartRebind": {"entries": 3, "continued": 1, "ended": 2,
                                 "continuedVisits": ["v-1"], "refused": {"moved": 1}, "at": 1000.0}}
        vision = FakeVision(pipeline.tracker, steps=[out])
        loop = _loop(pipeline, vision, FakeSource(frames=[FakeFrame(1000.0)]))
        with self.assertLogs("edge", level="INFO") as logs:
            loop.step()
        self.assertEqual(pipeline.metrics.get("edge_restart_continuations_total"), 1)
        self.assertEqual(pipeline.metrics.get("edge_restart_departures_total"), 2)
        text = "\n".join(logs.output)
        self.assertIn("track 146 continues visit v-1 (was sign-120)", text)
        self.assertIn("1 of 3 restored car(s) continued, 2 depart", text)

    def test_a_malformed_outcome_never_breaks_the_loop(self):
        pipeline = make_pipeline()
        out = {"emissions": [], "suppressed": None, "restartRebind": {"ended": "not-a-number"}}
        loop = _loop(pipeline, FakeVision(pipeline.tracker, steps=[out]),
                     FakeSource(frames=[FakeFrame(1000.0)]))
        with self.assertLogs("edge", level="ERROR"):
            loop.step()
        self.assertEqual(loop.frames, 1, "the frame was still processed")


class RestartClassificationWiringTest(unittest.TestCase):
    """The pin must be seeded by `build_edge`, before the loop runs.

    A COMMISSIONING visit still QUEUED when the edge restarts would otherwise be rewritten
    PRODUCTION: the scheduled launcher passes no run id, the fresh mirror comes up
    PRODUCTION, and the shop outbox coalesces by visitId, so the restored visit's terminal
    emission replaces the only undelivered COMMISSIONING payload there was. The server's
    immutable columns cannot defend a row that never reached MySQL, so the test drive is
    counted as a real customer permanently (Codex P1 on #2255, round 7).

    MEASURED, both ways: without the pin the queued row becomes ("PRODUCTION", None); with
    it, ("COMMISSIONING", "C-..."). The tick below is what makes that reachable -- see the
    comment at the assertion.
    """

    @staticmethod
    def _shop_cfg():
        """A config whose shop mirror is ENABLED, or `after_step` queues no shop row at all
        and this whole test passes for the wrong reason (it did: the first version survived
        deleting the fix)."""
        import dataclasses

        from test_main import RAW
        from visitd.config import build_config

        raw = dict(RAW)
        raw["backend"] = dict(raw.get("backend", {}))
        raw["backend"]["shopUrl"] = "https://nickstire.org/api/camera/visits"
        return dataclasses.replace(build_config(raw, environ={"CAMERA_INGEST_KEY": "k"}))

    def test_a_queued_COMMISSIONING_visit_survives_a_PRODUCTION_relaunch(self):
        fd, path = tempfile.mkstemp(suffix=".sqlite")
        os.close(fd)
        try:
            first = make_pipeline(ledger=Ledger(edge_main.camera_ledger_path(path, "lot")))
            shop_enabled(first)
            first.shop.data_class = "COMMISSIONING"
            first.shop.commissioning_run_id = "C-20260910-001"
            _real_emissions(first, camera="lot", persist=True)
            queued = first.ledger.shop_outbox_classifications()
            self.assertTrue(queued, "precondition: a classified row is queued and undelivered")
            self.assertTrue(all(c == "COMMISSIONING" for c, _ in queued.values()))
            first.ledger.close()

            # Relaunched by the scheduler: NO --commissioning-run, so the mirror is PRODUCTION.
            args = _args(calibration=None, ledger=path, commissioning_run=None)
            pipeline, vision, *_ = edge_main.build_edge(self._shop_cfg(), args)
            try:
                self.assertTrue(pipeline.shop.enabled,
                                "precondition: the mirror must be enabled or nothing is queued "
                                "and the assertion below cannot fail")
                self.assertEqual(pipeline.shop.data_class, "PRODUCTION",
                                 "precondition: the fresh producer really is in production mode")
                # PUSH PAST THE LEAVE GRACE. reconcile_restart leaves the visit DEPARTING,
                # which queues nothing; the coalescing overwrite happens on the TERMINAL
                # emission that follows. Asserting before this tick measured a moment the
                # bug had not reached yet -- the first version of this test survived
                # deleting the fix outright.
                #
                # CLOSE THE RESTART WINDOW FIRST. Since restart continuity, the restored
                # visit is HELD while the census looks for the car, and this test feeds no
                # frame to open (or close) the window. Closing it unmatched is what a real
                # producer reaches 20 s after its first frame when the car is gone.
                vision.close_restart_rebind(time.time())
                pipeline.tick(time.time() + 100_000)
                self.assertFalse(pipeline.tracker.open_visits(),
                                 "precondition: the visit reached a terminal state, which is "
                                 "the emission that rewrites the queued row")
                after = pipeline.ledger.shop_outbox_classifications()
                for visit_id, (data_class, run_id) in queued.items():
                    self.assertIn(visit_id, after, "the row is still queued after the restart")
                    self.assertEqual(after[visit_id], (data_class, run_id),
                                     "and reconcile_restart did NOT coalesce a PRODUCTION "
                                     "payload over it")
            finally:
                pipeline.ledger.close()
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass



class RtspEdgeWiringTest(unittest.TestCase):
    """The durable runtime must read the source URL from the named environment variable."""

    def test_build_edge_reads_the_named_environment_variable(self):
        from unittest.mock import patch

        fake_source = FakeSource(name="rtsp")
        with patch.dict(os.environ, {"NICK_TEST_CAMERA_URL": "rtsp://127.0.0.1:8554/live"}), \
             patch("vision.run_live.build_source", return_value=fake_source) as build:
            pipeline, _vision, source, *_ = edge_main.build_edge(
                _cfg(), _args(source="rtsp", source_url_env="NICK_TEST_CAMERA_URL"))
            try:
                self.assertIs(source, fake_source)
                self.assertEqual(
                    build.call_args.kwargs["source_url"],
                    "rtsp://127.0.0.1:8554/live",
                )
            finally:
                pipeline.ledger.close()


class DoctorScriptTest(unittest.TestCase):
    """The preflight must FAIL, not WARN, on anything that makes arrivals impossible.

    A WARN leaves `$fails` at zero and the doctor exits 0 -- a green light over a camera
    that can never confirm an arrival, which is the exact false-green it exists to
    prevent (Codex P1 on #2255). Witnessed on this machine: weights on disk, runtime
    absent, doctor exited 0.
    """

    def _doctor(self) -> str:
        here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(here, "scripts", "doctor-edge-runtime.ps1"), encoding="ascii") as fh:
            return fh.read()

    def test_a_missing_openvino_RUNTIME_is_a_FAIL(self):
        body = self._doctor()
        self.assertIn('Check "openvino" "FAIL"', body)
        self.assertNotIn('Check "openvino" "WARN"', body,
                         "a warning here exits 0 over a producer that cannot ever confirm an arrival")

    def test_every_arrival_blocking_dependency_is_a_FAIL(self):
        body = self._doctor()
        for name in ("windows_capture", "numpy + cv2", "openvino"):
            self.assertIn(f'Check "{name}" "FAIL"', body, f"{name} must be able to fail the preflight")

    def test_the_script_stays_pure_ASCII(self):
        """PowerShell 5.1 reads a BOM-less .ps1 as ANSI, so a stray em-dash becomes
        mojibake and the script dies on 'the string is missing the terminator'."""
        here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        for script in ("doctor-edge-runtime.ps1", "install-edge-runtime.ps1"):
            with open(os.path.join(here, "scripts", script), "rb") as fh:
                raw = fh.read()
            bad = [(i, b) for i, b in enumerate(raw) if b > 0x7F]
            self.assertEqual(bad, [], f"{script} has non-ASCII bytes at {bad[:3]}")


class TestFileHygieneTest(unittest.TestCase):
    """`unittest.main()` must be the LAST thing in the file.

    Python executes top to bottom, so a class defined after it is never defined when the
    file is run directly -- `python tests/test_edge_main.py` silently runs a subset while
    pytest (which imports the module) collects everything and looks green. This file has
    now grown a stranded block twice, both times by appending a new suite to the end.
    """

    def test_nothing_is_defined_after_unittest_main(self):
        with open(os.path.abspath(__file__), encoding="utf-8") as fh:
            body = fh.read()
        # Anchored to column 0, or the marker literal on THIS line matches itself.
        nl = chr(10)
        marker = nl + 'if __name__ == "__main__":'
        self.assertEqual(body.count(marker), 1, "exactly one top-level __main__ block")
        tail = body[body.index(marker):]
        self.assertNotIn(nl + "class ", tail, "a test class is stranded after unittest.main()")
        self.assertNotIn(nl + "def ", tail, "a helper is stranded after unittest.main()")


class LedgerIsolationTest(unittest.TestCase):
    """One ledger file per camera process (Codex P1 on #2255, round 8).

    `ledger_path` is a property of the CONFIG, because visitd proper runs every camera in
    ONE process off one Frigate feed. The edge inverts that -- one process per camera --
    so a shared file is not interleaving, it is mutual overwrite: `Pipeline.__init__`
    restores EVERY open visit in the ledger and `after_step` serialises the whole tracker
    back out, so each process periodically replaces the other camera's fresh state with a
    stale copy, and its timers age and close the other camera's sightings.
    """

    def test_two_cameras_get_two_FILES(self):
        a = edge_main.camera_ledger_path("data/edge.sqlite", "sign")
        b = edge_main.camera_ledger_path("data/edge.sqlite", "lot")
        self.assertNotEqual(a, b, "a shared file is mutual overwrite, not interleaving")
        self.assertEqual(a, "data/edge-sign.sqlite")
        self.assertEqual(b, "data/edge-lot.sqlite")

    def test_an_in_memory_ledger_is_untouched(self):
        """Already private to the process; renaming it would only break every test."""
        self.assertEqual(edge_main.camera_ledger_path(":memory:", "sign"), ":memory:")

    def test_an_extensionless_path_still_separates(self):
        self.assertEqual(edge_main.camera_ledger_path("/var/lib/edge", "sign"), "/var/lib/edge-sign")

    def test_a_DOTTED_DIRECTORY_does_not_fool_the_split(self):
        """`rpartition('.')` would otherwise treat `/opt/v2.1/edge` as extension `1/edge`
        and produce `/opt/v2-sign.1/edge` -- a path in a directory that does not exist."""
        self.assertEqual(edge_main.camera_ledger_path("/opt/v2.1/edge", "sign"),
                         "/opt/v2.1/edge-sign")

    def test_an_EXPLICIT_ledger_flag_is_scoped_too(self):
        """Isolation must not be losable by passing the path a different way -- the
        installer writes one wrapper per camera and could easily pass --ledger."""
        # An ABSOLUTE temp path: a relative one resolves against the cwd, so the test
        # passed under `pytest camera-bridge` and failed under `pytest` from the repo root.
        import shutil

        tmp = tempfile.mkdtemp()
        try:
            args = _args(calibration=None, ledger=os.path.join(tmp, "custom.sqlite"), camera="lot")
            pipeline, *_ = edge_main.build_edge(_cfg(), args)
            try:
                self.assertTrue(pipeline.ledger.path.endswith("custom-lot.sqlite"),
                                f"got {pipeline.ledger.path!r}")
            finally:
                pipeline.ledger.close()
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_ONE_cameras_visits_cannot_be_restored_by_ANOTHERS_process(self):
        """The end-to-end claim: what camera A persisted must be invisible to camera B."""
        fd, path = tempfile.mkstemp(suffix=".sqlite")
        os.close(fd)
        made = []
        try:
            a = make_pipeline(ledger=Ledger(edge_main.camera_ledger_path(path, "lot")))
            _real_emissions(a, camera="lot", persist=True)
            self.assertTrue(a.tracker.open_visits(), "precondition: camera lot has an open visit")
            a.ledger.close()

            two = dict(_RAW())
            two["cameras"] = {
                "lot": {"cloudDeviceId": "dev-lot", "arrivalZones": ["front_lot"]},
                "sign": {"cloudDeviceId": "dev-sign", "arrivalZones": ["front_lot"]},
            }
            b, *_ = edge_main.build_edge(_cfg(two), _args(calibration=None, ledger=path, camera="sign"))
            made.append(b)
            self.assertEqual(b.tracker.open_visits(), [],
                             "the sign process must not restore -- let alone age and close -- "
                             "the lot process's visits")
        finally:
            for p in made:
                p.ledger.close()
            for suffix in ("-lot", "-sign"):
                base, _, ext = path.rpartition(".")
                try:
                    os.unlink(f"{base}{suffix}.{ext}")
                except OSError:
                    pass
            try:
                os.unlink(path)
            except OSError:
                pass


class ArgsFixtureDriftTest(unittest.TestCase):
    """`_args()` is a hand-written copy of the real parser's defaults, and a copy drifts.

    It had ALREADY drifted by two keys (`persist_seconds`, `stall_exit_seconds`) before
    this test existed -- harmlessly, because nothing in `build_edge` read them. The next
    flag added was read, and five unrelated tests went red with an `AttributeError` from
    inside `build_edge` that named none of this. A fixture that omits a real flag does not
    fail where the omission is; it fails somewhere confusing and much later.
    """

    def test_the_fixture_carries_EVERY_flag_the_real_parser_defines(self):
        real = vars(edge_main.parse_args([]))
        missing = sorted(set(real) - set(vars(_args())))
        self.assertEqual(
            missing, [],
            f"edge_main.parse_args defines {missing} and _args() does not. Add them with the "
            "parser's own defaults, or a test calling build_edge() will fail on an "
            "AttributeError that names nothing useful."
        )

    def test_the_fixture_invents_no_flag_the_parser_does_not_have(self):
        """The other direction matters too: a fixture-only key lets a test exercise a flag
        that does not exist on the command line, which proves nothing about the product."""
        real = vars(edge_main.parse_args([]))
        invented = sorted(set(vars(_args())) - set(real))
        self.assertEqual(invented, [], f"_args() invents {invented}, which no CLI flag sets")


class ReacquisitionTest(unittest.TestCase):
    """When the tracker loses a car and re-acquires it as a new id, the visit layer can open
    a SECOND visit for a vehicle that never left -- so the shop's arrival count, the one
    number anyone actually reads, goes up by one. Both visits look perfectly well-formed,
    which is why nothing catches it downstream.

    These fire on GEOMETRY AND TIME only. Appearance would sharpen them and
    `AppearanceBank` is written and tested for exactly this, but no re-id model is fetchable
    at the path this repo pins, so wiring the embedder today would add a branch that never
    executes on the only box that matters. The context carries `appearance: None` so the
    field exists and is honestly empty.
    """

    class _Spy:
        def __init__(self):
            self.fired = []
            self.stats = SimpleNamespace(describe=lambda: "spy", healthy=True)

        def observe(self, ts, image):
            pass

        def trigger(self, reason, at, context=None):
            self.fired.append((reason, dict(context or {})))
            return True

        def flush_ready(self, now):
            return []

        def flush_all(self, now):
            return []

    def _t(self, tid, x, y, *, still=0.0, hits=5, misses=12, born=990.0, score=0.71):
        return SimpleNamespace(track_id=tid, box=(x - 20, y - 40, x + 20, y),
                               ground_point=(float(x), float(y)),
                               hits=hits, misses=misses, born_ts=born, score=score,
                               evidence="arrival", degraded=False,
                               stationary_for=lambda _n, s=still: s)

    def _drive(self, steps, live_by_step=None):
        """`steps` is a list of (ts, born, died). Returns the spy."""
        spy = self._Spy()
        pipeline = make_pipeline()
        state = {"i": 0}
        live_by_step = live_by_step or [{} for _ in steps]

        class _Src:
            def read(self):
                i = state["i"]
                if i >= len(steps):
                    return None
                ts = steps[i][0]
                return SimpleNamespace(ts=ts, image=np.zeros((8, 8, 3), np.uint8),
                                       seq=i, source="fake", meta={})

        class _Vision:
            health = SimpleNamespace(state=lambda ts: None)
            tracks = SimpleNamespace(tracks={})

            def step(self, frame):
                i = state["i"]
                _ts, born, died = steps[i]
                _Vision.tracks.tracks = dict(live_by_step[i])
                state["i"] += 1
                return {"emissions": [], "born": list(born), "died": list(died)}

        loop = _loop(pipeline, _Vision(), _Src(), hard_cases=spy)
        for _ in steps:
            loop.step()
        return spy

    def test_a_death_and_a_nearby_birth_is_a_REACQUISITION(self):
        spy = self._drive([
            (1000.0, [], [self._t(1, 300, 300)]),
            (1002.0, [self._t(2, 310, 305)], []),
        ])
        reasons = [r for r, _ in spy.fired]
        self.assertIn("TRACK_REACQUIRED", reasons)
        ctx = dict(spy.fired[reasons.index("TRACK_REACQUIRED")][1])
        self.assertEqual((ctx["diedTrack"], ctx["bornTrack"]), (1, 2))
        self.assertAlmostEqual(ctx["gapSeconds"], 2.0, places=1)
        self.assertLess(ctx["distancePx"], 20)
        self.assertIsNone(ctx["appearance"], "the field must exist and be honestly empty")

    def test_a_birth_FAR_from_the_death_is_not_a_reacquisition(self):
        """Two customers arriving at opposite ends of the frontage are two customers. A
        radius that swallowed the whole lot would relabel every ordinary arrival."""
        spy = self._drive([
            (1000.0, [], [self._t(1, 100, 300)]),
            (1002.0, [self._t(2, 700, 300)], []),
        ])
        self.assertNotIn("TRACK_REACQUIRED", [r for r, _ in spy.fired])

    def test_a_birth_LONG_after_the_death_is_not_a_reacquisition(self):
        """Same spot, minutes later, is the next customer parking where the last one did --
        which at a shop with two bays is most of them."""
        spy = self._drive([
            (1000.0, [], [self._t(1, 300, 300)]),
            (1000.0 + 60.0, [self._t(2, 302, 301)], []),
        ])
        self.assertNotIn("TRACK_REACQUIRED", [r for r, _ in spy.fired])

    def test_a_birth_ON_TOP_of_a_LIVE_track_is_a_SPLIT(self):
        """The other direction: one vehicle became two. No death explains this birth, and it
        landed on a car that is still being tracked."""
        live = self._t(7, 400, 250)
        spy = self._drive(
            [(1000.0, [self._t(9, 405, 252)], [])],
            live_by_step=[{7: live}])
        reasons = [r for r, _ in spy.fired]
        self.assertIn("TRACK_SPLIT", reasons)
        ctx = dict(spy.fired[reasons.index("TRACK_SPLIT")][1])
        self.assertEqual((ctx["bornTrack"], ctx["overlapsTrack"]), (9, 7))

    def test_the_DEAD_track_s_vitals_are_recorded(self):
        """Geometry says WHERE and WHEN; it cannot say WHY the track died, and the fix
        depends on which. `max_misses` is 12 at 4 fps, so a moving track must go THREE
        SECONDS undetected to be pruned -- every one of these is a sustained detection
        failure, not a one-frame blip. And `parked_after` is 25s, so a vehicle that has just
        stopped is protected only after 25 seconds of stillness while 3 seconds of dropout
        can kill it. `stationarySeconds` on the dead track is what separates a car lost
        inside that window from one lost while genuinely moving -- and pointing a threshold
        change at the wrong one of those is how a tracker gets worse.
        """
        spy = self._drive([
            (1000.0, [], [self._t(1, 300, 300, still=6.0, hits=41, misses=12, born=900.0)]),
            (1002.0, [self._t(2, 305, 302, still=0.0, hits=1, misses=0, born=1002.0)], []),
        ])
        ctx = dict(next(c for r, c in spy.fired if r == "TRACK_REACQUIRED"))
        self.assertEqual(ctx["died"]["misses"], 12, "the dead track's misses were not recorded")
        self.assertEqual(ctx["died"]["hits"], 41)
        self.assertEqual(ctx["died"]["stationarySeconds"], 6.0)
        self.assertEqual(ctx["died"]["ageSeconds"], 100.0)
        self.assertEqual(ctx["born"]["hits"], 1, "the newborn's vitals were not recorded")

    def test_a_SPLIT_records_both_tracks_vitals(self):
        live = self._t(7, 400, 250, hits=30)
        spy = self._drive([(1000.0, [self._t(9, 405, 252, hits=1)], [])],
                          live_by_step=[{7: live}])
        ctx = dict(next(c for r, c in spy.fired if r == "TRACK_SPLIT"))
        self.assertEqual(ctx["born"]["hits"], 1)
        self.assertEqual(ctx["overlaps"]["hits"], 30)

    def test_a_track_MISSING_attributes_records_nulls_and_never_raises(self):
        """This runs on the hard-case path, which must never cost a frame. A Track that
        grows or loses an attribute is a refactor, not an outage, and it must not take the
        corpus down with it -- nor silently record a plausible zero for something it could
        not read."""
        bare = SimpleNamespace(track_id=1, box=(0, 0, 1, 1), ground_point=(300.0, 300.0))
        spy = self._drive([
            (1000.0, [], [bare]),
            (1001.0, [self._t(2, 301, 300)], []),
        ])
        ctx = dict(next(c for r, c in spy.fired if r == "TRACK_REACQUIRED"))
        self.assertIsNone(ctx["died"]["hits"])
        self.assertIsNone(ctx["died"]["ageSeconds"])
        self.assertIsNone(ctx["died"]["stationarySeconds"],
                          "an unreadable value was recorded as a number")

    def test_an_attribute_that_RAISES_ON_ACCESS_records_null_not_zero(self):
        """A MISSING attribute and one that THROWS take different paths: `getattr` with a
        default handles the first without ever entering the except branch, so a test that
        only covers a bare object leaves the second measuring nothing -- a mutation making
        the handler return 0 survived exactly that gap.

        Zero is the wrong answer twice over: `hits: 0` reads as a track the detector never
        confirmed, and `misses: 0` as one that was never dropped. Both are claims about the
        vehicle, invented from a failure to read a field.
        """
        class _Angry:
            track_id = 1
            box = (0, 0, 1, 1)
            ground_point = (300.0, 300.0)
            born_ts = 990.0
            evidence = "arrival"
            degraded = False

            @property
            def hits(self):
                raise RuntimeError("hits exploded")

            @property
            def misses(self):
                raise RuntimeError("misses exploded")

            score = 0.6

            def stationary_for(self, _now):
                return 2.0

        spy = self._drive([
            (1000.0, [], [_Angry()]),
            (1001.0, [self._t(2, 301, 300)], []),
        ])
        ctx = dict(next(c for r, c in spy.fired if r == "TRACK_REACQUIRED"))
        self.assertIsNone(ctx["died"]["hits"], "a field that raised was recorded as a number")
        self.assertIsNone(ctx["died"]["misses"])
        self.assertEqual(ctx["died"]["stationarySeconds"], 2.0,
                         "the readable fields were lost along with the unreadable ones")

    def test_a_track_whose_ACCESSOR_RAISES_is_still_survivable(self):
        def _boom(_n):
            raise RuntimeError("stationary_for exploded")

        angry = SimpleNamespace(track_id=1, box=(0, 0, 1, 1), ground_point=(300.0, 300.0),
                                hits=3, misses=12, born_ts=990.0, score=0.5,
                                evidence="candidate", degraded=False, stationary_for=_boom)
        spy = self._drive([
            (1000.0, [], [angry]),
            (1001.0, [self._t(2, 301, 300)], []),
        ])
        ctx = dict(next(c for r, c in spy.fired if r == "TRACK_REACQUIRED"))
        self.assertEqual(ctx["died"]["hits"], 3, "the readable fields were lost too")
        self.assertIsNone(ctx["died"]["stationarySeconds"])

    def test_an_ORDINARY_arrival_fires_nothing(self):
        """THE control. A pair of triggers that fired on every birth would bury the real
        re-acquisitions under one clip per car, and the corpus would be worthless while
        looking busy."""
        spy = self._drive([(1000.0, [self._t(1, 300, 300)], [])])
        self.assertEqual(spy.fired, [])

    def test_a_reacquisition_is_reported_ONCE_not_once_per_dead_track(self):
        """Several cars left earlier. The birth matches one of them, and reporting it
        against each would multiply one moment into a pile of clips."""
        spy = self._drive([
            (1000.0, [], [self._t(1, 300, 300), self._t(2, 305, 302), self._t(3, 310, 304)]),
            (1001.0, [self._t(4, 306, 303)], []),
        ])
        self.assertEqual([r for r, _ in spy.fired].count("TRACK_REACQUIRED"), 1)

    def test_it_is_a_reacquisition_OR_a_split_never_both(self):
        """A birth explained by a death is not also an unexplained overlap. Firing both
        would double-count one event and make the corpus's own counts unreadable."""
        live = self._t(7, 300, 300)
        spy = self._drive([
            (1000.0, [], [self._t(1, 300, 300)]),
            (1001.0, [self._t(2, 302, 301)], []),
        ], live_by_step=[{}, {7: live}])
        reasons = [r for r, _ in spy.fired]
        self.assertIn("TRACK_REACQUIRED", reasons)
        self.assertNotIn("TRACK_SPLIT", reasons)

    def test_NO_recorder_configured_costs_nothing_and_raises_nothing(self):
        pipeline = make_pipeline()

        class _Src:
            def read(self):
                return SimpleNamespace(ts=1000.0, image=np.zeros((8, 8, 3), np.uint8),
                                       seq=0, source="fake", meta={})

        class _Vision:
            health = SimpleNamespace(state=lambda ts: None)
            tracks = SimpleNamespace(tracks={})

            def step(self, frame):
                return {"emissions": [], "born": [self._t(1, 1, 1)] if False else [], "died": []}

        loop = _loop(pipeline, _Vision(), _Src())
        loop.step()                      # must not raise
        self.assertIsNone(loop.hard_cases)

    def test_the_death_window_is_BOUNDED_so_it_cannot_grow_into_a_history(self):
        spy = self._drive([(1000.0 + i, [], [self._t(i, 10 * i, 300)]) for i in range(200)])
        self.assertEqual(spy.fired, [])


class WiredTriggersHaveCallersTest(unittest.TestCase):
    """`TRIGGERS_WIRED` is a CLAIM that something fires each name, and the claim has been
    wrong before: `SOURCE_FAILOVER` was listed there one commit before it had a caller, and
    the only gate at the time checked that the name was in the vocabulary -- which it was.
    A trigger nobody fires means that class of hard case never appears, and read back later
    an absent class looks like a shop that never had one rather than like nothing watching.

    This asserts the CALL SITE exists, which is exactly the fact `TRIGGERS_WIRED` asserts.
    Behavioural coverage is separate and lives beside each trigger's own tests.
    """

    def test_every_WIRED_trigger_has_a_real_call_site(self):
        import re
        from vision.hardcase import TRIGGERS_WIRED

        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        sources = []
        for sub in ("edge_main.py", os.path.join("vision", "run_live.py"),
                    os.path.join("vision", "pipeline.py")):
            path = os.path.join(root, sub)
            if os.path.exists(path):
                with open(path, encoding="utf-8") as fh:
                    sources.append(fh.read())
        blob = "\n".join(sources)
        self.assertTrue(blob, "no producer sources were read; this gate is checking nothing")
        missing = sorted(t for t in TRIGGERS_WIRED
                         if not re.search(r'trigger\(\s*"%s"' % re.escape(t), blob))
        self.assertEqual(
            missing, [],
            f"{missing} are declared WIRED and nothing calls them. Wire each one or remove "
            f"it from TRIGGERS_WIRED -- a declared trigger with no producer promises a class "
            f"of hard case the corpus will never contain.")

    def test_every_trigger_with_a_CALL_SITE_is_declared_wired(self):
        """THE OTHER DIRECTION, which was missing and which fails SILENTLY.

        `HardCaseRecorder.trigger` counts an unrecognised name as `dropped_unknown_trigger`
        and writes nothing. So a producer that fires a trigger absent from `TRIGGERS_WIRED`
        records no clip at all -- the corpus never gains that class, the recorder reports
        itself healthy because no WRITE failed, and the directory reads like a shop that
        never had one.

        Measured: deleting `PREEXISTING_DISAGREEMENT` from `TRIGGERS_WIRED` while leaving its
        caller in `edge_main` left all 132 tests green. This is the mirror of the defect the
        test above was written for, and it is the worse half -- a declared trigger with no
        caller is at least a promise somebody can check, while an undeclared caller is a
        producer quietly dropping evidence it believes it is collecting.
        """
        import re
        from vision.hardcase import TRIGGERS, TRIGGERS_WIRED

        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        sources = []
        for sub in ("edge_main.py", os.path.join("vision", "run_live.py"),
                    os.path.join("vision", "pipeline.py")):
            path = os.path.join(root, sub)
            if os.path.exists(path):
                with open(path, encoding="utf-8") as fh:
                    sources.append(fh.read())
        blob = "\n".join(sources)
        called = set(re.findall(r'trigger\(\s*"([A-Z_]+)"', blob))
        self.assertTrue(called, "no call sites were found; this gate is checking nothing")

        undeclared = sorted(called - set(TRIGGERS_WIRED))
        self.assertEqual(
            undeclared, [],
            f"{undeclared} are fired by the producer and are NOT in TRIGGERS_WIRED, so the "
            f"recorder counts them as dropped_unknown_trigger and writes nothing. Declare "
            f"each one -- the producer believes it is collecting this evidence.")

        unknown = sorted(called - set(TRIGGERS))
        self.assertEqual(
            unknown, [],
            f"{unknown} are fired by the producer and are not even in the TRIGGERS "
            f"vocabulary, which is a typo the recorder will swallow forever.")

    def test_the_reverse_gate_would_NOTICE_an_undeclared_caller(self):
        """The canary for the canary. A regex that matched nothing would report every caller
        as declared, which is the failure mode this pair exists to prevent."""
        import re
        from vision.hardcase import TRIGGERS_WIRED

        blob = 'self.hard_cases.trigger("NOT_A_REAL_TRIGGER", now, {})'
        called = set(re.findall(r'trigger\(\s*"([A-Z_]+)"', blob))
        self.assertEqual(called, {"NOT_A_REAL_TRIGGER"}, "the regex reads nothing")
        self.assertEqual(sorted(called - set(TRIGGERS_WIRED)), ["NOT_A_REAL_TRIGGER"])

    def test_the_gate_would_NOTICE_a_falsely_declared_trigger(self):
        """The canary. Without it a broken regex would report every trigger as wired."""
        import re

        blob = 'self.hard_cases.trigger("LAYOUT_CHANGE", now, {})'
        self.assertTrue(re.search(r'trigger\(\s*"LAYOUT_CHANGE"', blob))
        self.assertIsNone(re.search(r'trigger\(\s*"MODEL_OOD"', blob))


class InferenceFreshnessTest(unittest.TestCase):
    """`lastInferenceAt` and `inferenceP95Ms` had a column, a Zod field and an ADMIN CARD
    since migration 0120, and the producer had never sent either -- so the camera detail
    card rendered them blank forever while `CouncilResult.latency_ms` was measured on every
    frame and discarded. A reader with no writer, which is the same defect as a writer with
    no reader seen from the other side.

    What the pair has to buy is one distinction: a producer that has STOPPED INFERRING
    versus one that is merely watching an empty lot. Before, both were silence.
    """

    def _council(self, by_detector, latency=12.5):
        return SimpleNamespace(escalated=False, detections=[], latency_ms=latency,
                               by_detector=dict(by_detector))

    def _loop_with(self, councils):
        """Drive one frame per council. `None` means the vision layer returned no council."""
        pipeline = make_pipeline()
        frames = [SimpleNamespace(ts=1000.0 + i, image=np.zeros((8, 8, 3), np.uint8),
                                  seq=i, source="fake", meta={})
                  for i in range(len(councils))]
        state = {"i": 0}

        class _Src:
            def read(self):
                i = state["i"]
                return frames[i] if i < len(frames) else None

        class _Vision:
            health = SimpleNamespace(state=lambda ts: None)
            tracks = SimpleNamespace(tracks={})
            # `edge_heartbeat_body` reads open visits off the vision layer's tracker.
            tracker = SimpleNamespace(open_visits=lambda: [])

            def step(self, frame):
                out = {"emissions": []}
                c = councils[state["i"]]
                if c is not None:
                    out["council"] = c
                state["i"] += 1
                return out

        loop = _loop(pipeline, _Vision(), _Src())
        for _ in councils:
            loop.step()
        return loop

    def test_a_frame_the_DETECTOR_judged_marks_an_inference(self):
        loop = self._loop_with([self._council({"mog2": 1, "primary": 2})])
        self.assertEqual(loop.last_inference_at, 1000.0)
        self.assertIsNotNone(loop.inference_p95_ms)

    def test_a_MOTION_GATED_frame_does_NOT_mark_an_inference(self):
        """THE semantic. A gated frame is a decision not to infer. Counting it would make a
        producer whose detector had died look healthy for as long as the lot stayed still --
        which is most of the day, at a tyre shop, and exactly when nobody is watching."""
        loop = self._loop_with([self._council({"mog2": 0})])
        self.assertIsNone(loop.last_inference_at,
                          "the motion gate was counted as a detector inference")
        self.assertIsNone(loop.inference_p95_ms)

    def test_a_gated_frame_does_not_ERASE_an_earlier_inference(self):
        """The other direction: going quiet must not look like never having run."""
        loop = self._loop_with([self._council({"mog2": 1, "primary": 3}),
                                self._council({"mog2": 0}),
                                self._council({"mog2": 0})])
        self.assertEqual(loop.last_inference_at, 1000.0)

    def test_p95_is_NONE_before_any_inference_never_zero(self):
        """A zero renders on the admin card as an impossibly fast detector. "We have not
        measured this" and "this took no time" are different claims, and only one is ever
        true."""
        loop = self._loop_with([self._council({"mog2": 0})])
        self.assertIsNone(loop.inference_p95_ms)
        self.assertNotEqual(loop.inference_p95_ms, 0.0)

    def test_p95_tracks_the_SLOW_TAIL_not_the_average(self):
        """Nineteen fast frames and one 500ms stall. The MEAN of that sample is 34.5, so an
        assertion has to sit above the mean to discriminate -- the first version of this test
        asserted `> 19.0`, which a mean passes comfortably, and a mutation replacing p95 with
        a mean survived it.

        The value is NEAREST-RANK, from `vision.stats.p95`: index `int(0.95 * (n - 1))` of
        the sorted sample, which on twenty samples is the 19th value, 19.0. It is not the
        maximum -- an earlier `int(n * 0.95)` here picked index 19 and returned the 500ms
        outlier, disagreeing with `benchmark_openvino.py` about what p95 meant for the same
        measurements (Codex P2 on #2275).
        """
        from vision.stats import p95 as shared_p95

        latencies = [float(x) for x in range(1, 20)] + [500.0]
        loop = self._loop_with([self._council({"primary": 1}, latency=x) for x in latencies])
        mean = sum(latencies) / len(latencies)
        self.assertEqual(loop.inference_p95_ms, shared_p95(latencies))
        self.assertEqual(loop.inference_p95_ms, 19.0)
        self.assertNotEqual(loop.inference_p95_ms, max(latencies),
                            "p95 returned the maximum, which is a max and not a p95")
        self.assertGreater(loop.inference_p95_ms, mean * 0.5)

    def test_the_SHARED_p95_holds_its_contract(self):
        """A previous version of this grepped `benchmark_openvino.py` for the string "p95(",
        which is a presence assertion -- the shape this repo bans, written by me two hours
        after deleting one for the same reason. What actually prevents the two definitions
        from diverging is that there is only one function; the import is the guarantee, not
        a test that reads source.

        So this asserts the contract that one function owes.
        """
        from vision.stats import p95

        self.assertIsNone(p95([]), "empty must be None, never 0.0")
        self.assertEqual(p95([7.0]), 7.0)
        # NEAREST RANK: always a value that was measured, never an interpolation.
        for n in (3, 20, 100, 137):
            sample = [float(i) for i in range(n)]
            self.assertIn(p95(sample), sample)
            self.assertEqual(p95(sample), float(int(0.95 * (n - 1))))
        self.assertEqual(p95([5.0, 1.0, 3.0]), p95([1.0, 3.0, 5.0]),
                         "the input order changed the answer, so it is not sorting")

    def test_a_council_with_NO_by_detector_does_not_raise(self):
        loop = self._loop_with([SimpleNamespace(escalated=False, detections=[])])
        self.assertIsNone(loop.last_inference_at)

    def test_a_frame_with_no_council_at_all_is_fine(self):
        loop = self._loop_with([None, None])
        self.assertIsNone(loop.last_inference_at)

    def test_the_HEARTBEAT_carries_both_and_the_shop_ACCEPTS_them(self):
        """assert-the-consumer, across the app boundary. The producer can render these
        perfectly and still be shipping them into a schema that strips them on arrival --
        which is how they came to be null in the first place, from the other direction.

        The route is read as TEXT: importing nickstire's TypeScript from a Python test is
        not possible, and the field list is the contract either way.
        """
        loop = self._loop_with([self._council({"mog2": 1, "primary": 2}, latency=33.0)])
        body = edge_main.edge_heartbeat_body(
            camera="sign", seq=1, now=1001.0, mode="PRODUCTION",
            source=SimpleNamespace(), vision=loop.vision, ledger=loop.pipeline.ledger,
            health_state=None, scene_state=None, calibration_version=None,
            detector_name="fake", model_sha256=None, last_healthy_frame_at=None,
            last_inference_at=loop.last_inference_at,
            inference_p95_ms=loop.inference_p95_ms)
        self.assertIsNotNone(body["lastInferenceAt"])
        self.assertTrue(str(body["lastInferenceAt"]).startswith("19"),
                        f"not an ISO timestamp: {body['lastInferenceAt']!r}")
        self.assertAlmostEqual(body["inferenceP95Ms"], 33.0, places=1)

        route = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                             "..", "apps", "nickstire", "server", "routes",
                             "cameraVisitsRoutes.ts")
        if os.path.exists(route):
            with open(route, encoding="utf-8") as fh:
                src = fh.read()
            for field in ("lastInferenceAt", "inferenceP95Ms"):
                self.assertIn(f"{field}:", src,
                              f"the shop route has no {field} field to receive")
                self.assertIn(f'"{field}"', src,
                              f"{field} is declared but not in the route's column list, so "
                              f"it is parsed and then dropped before the write")

    def test_the_heartbeat_OMITS_nothing_and_sends_NULL_when_it_has_not_inferred(self):
        """Null, not absent, and not zero. The shop's column is nullable and its card
        distinguishes null from a number; sending 0.0 would draw a detector that answers
        instantly on a producer that has not answered at all."""
        loop = self._loop_with([self._council({"mog2": 0})])
        body = edge_main.edge_heartbeat_body(
            camera="sign", seq=1, now=1001.0, mode="PRODUCTION",
            source=SimpleNamespace(), vision=loop.vision, ledger=loop.pipeline.ledger,
            health_state=None, scene_state=None, calibration_version=None,
            detector_name="fake", model_sha256=None, last_healthy_frame_at=None,
            last_inference_at=loop.last_inference_at,
            inference_p95_ms=loop.inference_p95_ms)
        self.assertIn("lastInferenceAt", body)
        self.assertIsNone(body["lastInferenceAt"])
        self.assertIsNone(body["inferenceP95Ms"])


class PoseOffHomeCauseTest(unittest.TestCase):
    """`may_create_visits` is `(not moving) and pose_ok`, so it goes false for TWO unrelated
    reasons: the camera is panning right now, or the view no longer matches its reference.

    The clip used to record only `changeFrac` -- the input to the SECOND one. Measured over
    32 clips from a real shift, 14 carried `changeFrac <= 0.005`, essentially no change at
    all. Read back, those say "the pose gate suppressed frames while the pose was perfect",
    which is not what happened and sends an investigation at the wrong half.
    """

    class _Spy:
        def __init__(self):
            self.fired = []
            self.stats = SimpleNamespace(describe=lambda: "spy", healthy=True)

        def observe(self, ts, image, meta=None):
            pass

        def trigger(self, reason, at, context=None):
            self.fired.append((reason, dict(context or {})))
            return True

        def flush_ready(self, now):
            return []

        def flush_all(self, now):
            return []

    def _fire(self, **scene_kw):
        scene = SimpleNamespace(may_create_visits=False, moving=False, pose_ok=True,
                                change_frac=0.0, pose_delta=None, inlier_ratio=None,
                                reference_set=True)
        for k, v in scene_kw.items():
            setattr(scene, k, v)
        spy = self._Spy()
        pipeline = make_pipeline()
        frame = SimpleNamespace(ts=1000.0, image=np.zeros((8, 8, 3), np.uint8), seq=0,
                                source="fake", meta={})

        class _Src:
            def read(self):
                return frame

        class _Vision:
            health = SimpleNamespace(state=lambda ts: None)
            tracks = SimpleNamespace(tracks={})

            def step(self, f):
                return {"emissions": [], "scene": scene}

        loop = _loop(pipeline, _Vision(), _Src(), hard_cases=spy)
        loop.step()
        hits = [c for r, c in spy.fired if r == "POSE_OFF_HOME"]
        return hits[0] if hits else None

    def test_a_PANNING_camera_is_recorded_as_moving_not_as_a_pose_problem(self):
        ctx = self._fire(moving=True, pose_ok=True, change_frac=0.001)
        self.assertEqual(ctx["cause"], "moving")
        self.assertIs(ctx["moving"], True)
        self.assertIs(ctx["poseOk"], True)
        # The old context would have shown ONLY this, and it reads as a healthy pose.
        self.assertEqual(ctx["changeFrac"], 0.001)

    def test_a_DRIFTED_view_is_recorded_as_a_pose_problem(self):
        ctx = self._fire(moving=False, pose_ok=False, change_frac=0.42)
        self.assertEqual(ctx["cause"], "pose")

    def test_BOTH_at_once_is_its_own_cause_and_not_collapsed(self):
        """A panning camera whose view has ALSO drifted is the worst of the three, and
        folding it into either single cause hides exactly that case."""
        ctx = self._fire(moving=True, pose_ok=False, change_frac=0.55)
        self.assertEqual(ctx["cause"], "both")

    def test_a_gate_false_for_NEITHER_reason_says_so_rather_than_guessing(self):
        """If `may_create_visits` ever goes false while both inputs look fine, the clip must
        say "neither" rather than name a cause it cannot support -- that is the signal that
        the property has grown a third input this context does not know about."""
        ctx = self._fire(moving=False, pose_ok=True)
        self.assertEqual(ctx["cause"], "neither")

    def test_an_UNMEASURED_pose_delta_stays_None_and_never_becomes_zero(self):
        """Zero reads as a PERFECT match to the reference -- the opposite of "there is no
        reference to compare against"."""
        ctx = self._fire(moving=True, pose_delta=None, inlier_ratio=None)
        self.assertIsNone(ctx["poseDelta"])
        self.assertIsNone(ctx["inlierRatio"])

    def test_a_measured_pose_delta_is_reported(self):
        ctx = self._fire(moving=False, pose_ok=False, pose_delta=3.14159, inlier_ratio=0.6666)
        self.assertEqual(ctx["poseDelta"], 3.142)
        self.assertEqual(ctx["inlierRatio"], 0.667)

    def test_a_HEALTHY_gate_fires_nothing(self):
        """The control. A trigger that fired whenever a scene existed would bury every real
        pose event under one clip per frame."""
        self.assertIsNone(self._fire(may_create_visits=True, moving=False, pose_ok=True))


class TrajectoryWiringTest(unittest.TestCase):
    """A store with no points and a store nobody is feeding look identical on disk.

    This class exists because the first wiring of `_note_trajectory` read the track graph
    off `self.pipeline` -- the VISITD pipeline, which carries metrics and the shop lane --
    instead of `self.vision`, which is where the graph actually lives. It raised on every
    frame, was swallowed (correctly: commissioning data must never take the lot down), and
    the producer ran perfectly for 128 frames while recording nothing. The only evidence was
    a counter that named no cause.
    """

    class _Store:
        def __init__(self, boom=False):
            self.rows = []
            self.boom = boom

        def observe(self, now, tracks, *, scene, generation):
            if self.boom:
                raise RuntimeError("store exploded")
            self.rows.append((now, [t.track_id for t in tracks], scene, generation))
            return len(tracks)

    def _vision_with_tracks(self, *track_ids):
        graph = SimpleNamespace(tracks={
            i: SimpleNamespace(track_id=i, box=(10.0, 10.0, 60.0, 80.0),
                               ground_point=(35.0, 80.0),
                               stationary_for=lambda _n: 0.0)
            for i in track_ids})

        class _Vision:
            health = SimpleNamespace(state=lambda ts: None)
            tracks = graph

            def __init__(self, out):
                self._out = out

            def step(self, frame):
                return self._out

        return _Vision

    def _drive(self, out, store, track_ids=(1, 2)):
        pipeline = make_pipeline()
        frame = SimpleNamespace(ts=1000.0, image=np.zeros((8, 8, 3), np.uint8), seq=0,
                                source="fake", meta={})

        class _Src:
            def read(self):
                return frame

        loop = _loop(pipeline, self._vision_with_tracks(*track_ids)(out), _Src(),
                     trajectories=store)
        loop.step()
        return loop

    def test_every_live_track_is_RECORDED_on_a_normal_frame(self):
        store = self._Store()
        self._drive({"emissions": []}, store)
        self.assertEqual(len(store.rows), 1, "the hook never reached the store")
        _now, ids, _scene, _gen = store.rows[0]
        self.assertEqual(sorted(ids), [1, 2])

    def test_points_are_filed_under_the_FRAME_S_OWN_sceneId(self):
        """The bug that shipped: the hook read `source.binding.scene_id`, which does not
        exist, so every point was filed under "default" -- 7,228 of them from 69 tracks over
        four hours of real traffic, all in one bucket.

        Pooling is not a cosmetic loss. A two-lens device is two different pixel spaces, and
        a commissioner fitting one polygon across both produces a confident, meaningless
        answer from data that looks abundant. `WgcWindowSource.set_canonical` stamps the id
        into every frame's meta, which is the only place it is authoritative.
        """
        store = self._Store()
        pipeline = make_pipeline()
        frame = SimpleNamespace(ts=1000.0, image=np.zeros((8, 8, 3), np.uint8), seq=0,
                                source="fake", meta={"sceneId": "shop-right",
                                                     "window_verified": True})

        class _Src:
            def read(self):
                return frame

        loop = _loop(pipeline, self._vision_with_tracks(1)({"emissions": []}), _Src(),
                     trajectories=store)
        loop.step()
        self.assertEqual(len(store.rows), 1)
        self.assertEqual(store.rows[0][2], "shop-right",
                         "the point was not filed under the frame's own scene")

    def test_a_frame_with_NO_sceneId_is_marked_unattributed_not_defaulted(self):
        """"default" reads like a scene. "unattributed" reads like the absence it is, and
        the commissioner's refusal can then name it as something that needs fixing rather
        than as a scene the operator forgot to record."""
        store = self._Store()
        pipeline = make_pipeline()
        frame = SimpleNamespace(ts=1000.0, image=np.zeros((8, 8, 3), np.uint8), seq=0,
                                source="fake", meta={})

        class _Src:
            def read(self):
                return frame

        loop = _loop(pipeline, self._vision_with_tracks(1)({"emissions": []}), _Src(),
                     trajectories=store)
        loop.step()
        self.assertEqual(store.rows[0][2], "unattributed")

    def test_a_SUPPRESSED_frame_records_nothing(self):
        """A frame the pipeline refused for pose or motion reasons is exactly one whose
        geometry is untrusted. A point taken from it poisons the map it feeds, and once it
        is a row in a table nothing can tell it from a good one."""
        store = self._Store()
        self._drive({"emissions": [], "suppressed": "camera motion / untrusted pose"}, store)
        self.assertEqual(store.rows, [])

    def test_it_reads_the_track_graph_off_the_VISION_layer(self):
        """The regression this class is named for. A vision layer with tracks and a visitd
        pipeline WITHOUT them must still record -- which is only true if the hook looks in
        the right place. `make_pipeline()` has no `.tracks`, so reading from it raises."""
        pipeline = make_pipeline()
        self.assertFalse(hasattr(pipeline, "tracks"),
                         "the visitd pipeline grew a `tracks` attribute, and this test can "
                         "no longer tell the two objects apart -- rewrite it")
        store = self._Store()
        self._drive({"emissions": []}, store)
        self.assertEqual(len(store.rows), 1)

    def test_a_STORE_THAT_EXPLODES_does_not_take_the_producer_down(self):
        store = self._Store(boom=True)
        loop = self._drive({"emissions": []}, store)     # must not raise
        self.assertIsNotNone(loop)

    def test_a_failing_store_is_COUNTED_and_NAMED_exactly_once(self):
        """Counted, so it is visible. Named, so it is actionable. Once, so a per-frame
        failure at 4 fps does not bury the log it is supposed to be found in."""
        store = self._Store(boom=True)
        pipeline = make_pipeline()
        frame = SimpleNamespace(ts=1000.0, image=np.zeros((8, 8, 3), np.uint8), seq=0,
                                source="fake", meta={})

        class _Src:
            def read(self):
                return frame

        loop = _loop(pipeline, self._vision_with_tracks(1)({"emissions": []}), _Src(),
                     trajectories=store)
        with self.assertLogs("edge", level="WARNING") as caught:
            for _ in range(5):
                loop.step()
        hits = [m for m in caught.output if "trajectory recording is failing" in m]
        self.assertEqual(len(hits), 1, f"expected exactly one warning, got {len(hits)}")
        self.assertIn("store exploded", hits[0])
        self.assertGreaterEqual(pipeline.metrics.get("edge_trajectory_errors_total"), 5)

    def test_NO_store_configured_changes_nothing(self):
        loop = self._drive({"emissions": []}, None)
        self.assertIsNone(loop.trajectories)


class HardCaseWiringTest(unittest.TestCase):
    """The recorder is only worth having if the producer actually FIRES it.

    Every trigger below is derived from a signal that genuinely exists in `EdgeLoop.step`'s
    own outputs. A trigger with no real producer would leave that class absent from the
    corpus forever, and read back later an absent class looks like a shop that never had one
    rather than like nothing that was ever watching.
    """

    class _Spy:
        def __init__(self, fail=False):
            self.observed, self.fired, self.flushed = [], [], 0
            self.observed_meta = []
            self._fail = fail
            self.stats = SimpleNamespace(
                clips_written=3, frames_written=90, bytes_written=1234,
                dropped_cooldown=1, dropped_write_error=0, evicted_clips=0,
                healthy=True, last_error=None)

        def observe(self, ts, image, meta=None):
            if self._fail:
                raise RuntimeError("observe exploded")
            self.observed.append(ts)
            self.observed_meta.append(dict(meta or {}))

        def trigger(self, reason, at, context=None):
            if self._fail:
                raise RuntimeError("trigger exploded")
            self.fired.append((reason, context or {}))
            return True

        def flush_ready(self, now):
            if self._fail:
                raise RuntimeError("flush exploded")
            self.flushed += 1
            return []

        def flush_all(self, now):
            return []

    def _drive(self, out, meta=None, spy=None, passes=1):
        """Run EdgeLoop.step with a stubbed vision layer returning `out`."""
        spy = spy or self._Spy()
        pipeline = make_pipeline()
        frames = [SimpleNamespace(
            ts=1000.0 + i, image=np.zeros((8, 8, 3), np.uint8), seq=i,
            source="fake", meta=dict(meta or {})) for i in range(max(passes, 1))]

        class _Src:
            def __init__(self):
                self.i = 0

            def read(self):
                f = frames[min(self.i, len(frames) - 1)]
                self.i += 1
                return f

        class _Vision:
            health = SimpleNamespace(state=lambda ts: None)

            def step(self, frame):
                return dict(out)

        loop = _loop(pipeline, _Vision(), _Src(), hard_cases=spy)
        for _ in range(passes):
            loop.step()
        return spy, loop

    def test_every_frame_reaches_the_rolling_window(self):
        spy, _ = self._drive({"emissions": []}, passes=3)
        self.assertEqual(len(spy.observed), 3)

    def test_a_LAYOUT_EPOCH_change_fires_LAYOUT_CHANGE(self):
        """`WgcWindowSource.set_canonical` stamps the epoch into the frame, so this is a real
        signal the moment a scene is relocated -- and the boundary at which geometry stops
        being comparable across frames."""
        spy = self._Spy()
        pipeline = make_pipeline()
        metas = [{"layoutEpoch": 1, "sceneId": "shop-left"},
                 {"layoutEpoch": 1, "sceneId": "shop-left"},
                 {"layoutEpoch": 2, "sceneId": "shop-left"}]
        frames = [SimpleNamespace(ts=1000.0 + i, image=np.zeros((8, 8, 3), np.uint8),
                                        seq=i, source="fake", meta=m)
                  for i, m in enumerate(metas)]

        class _Src:
            def __init__(self):
                self.i = 0

            def read(self):
                f = frames[self.i]
                self.i += 1
                return f

        class _Vision:
            health = SimpleNamespace(state=lambda ts: None)

            def step(self, frame):
                return {"emissions": []}

        loop = _loop(pipeline, _Vision(), _Src(), hard_cases=spy)
        for _ in metas:
            loop.step()
        reasons = [r for r, _ in spy.fired]
        self.assertEqual(reasons.count("LAYOUT_CHANGE"), 1,
                         f"exactly one epoch change happened, fired {reasons}")
        ctx = dict(spy.fired[reasons.index("LAYOUT_CHANGE")][1])
        self.assertEqual((ctx["from"], ctx["to"]), (1, 2))

    def test_the_FIRST_frame_does_not_fire_a_layout_change(self):
        """There is nothing to have changed FROM. Firing here would put a spurious clip at
        the start of every single producer start-up and drown the real ones."""
        spy, _ = self._drive({"emissions": []}, meta={"layoutEpoch": 7})
        self.assertNotIn("LAYOUT_CHANGE", [r for r, _ in spy.fired])

    def test_an_UNTRUSTED_POSE_fires_POSE_OFF_HOME(self):
        scene = SimpleNamespace(may_create_visits=False, change_frac=0.42)
        spy, _ = self._drive({"emissions": [], "scene": scene})
        self.assertIn("POSE_OFF_HOME", [r for r, _ in spy.fired])

    def test_a_TRUSTED_pose_fires_nothing(self):
        """The positive control: without it a trigger that fired unconditionally would pass
        the test above while filling the disk with ordinary frames."""
        scene = SimpleNamespace(may_create_visits=True, change_frac=0.01)
        spy, _ = self._drive({"emissions": [], "scene": scene})
        self.assertEqual(spy.fired, [])

    def test_DISAGREEMENT_needs_the_two_detectors_to_actually_DISAGREE(self):
        """Escalation alone is not disagreement. The council escalates on ambiguity and the
        adjudicator usually just confirms; a clip is worth saving when the two return
        DIFFERENT counts, which is the case a human can adjudicate from the footage."""
        agree = SimpleNamespace(escalated=True, detections=[],
                                      by_detector={"primary": 2, "adj": 2})
        spy, _ = self._drive({"emissions": [], "council": agree})
        self.assertEqual(spy.fired, [], "agreement is not a hard case")

        differ = SimpleNamespace(escalated=True, detections=[],
                                       by_detector={"primary": 1, "adj": 3})
        spy2, _ = self._drive({"emissions": [], "council": differ})
        self.assertIn("DETECTOR_DISAGREEMENT", [r for r, _ in spy2.fired])

    def test_a_WEAK_detection_behind_a_STATE_CHANGE_fires_PORTAL_LOW_CONFIDENCE(self):
        """The expensive kind of uncertainty: the frame that creates or denies a visit.

        The emissions are the REAL tracker's, not stand-ins -- a bare sentinel would never
        reach the persistence layer this loop actually runs, so the test would be exercising
        a shape production never produces."""
        emissions = _real_emissions(make_pipeline(), camera="lot")
        weak = SimpleNamespace(escalated=False,
                               detections=[SimpleNamespace(score=0.44)],
                               by_detector={"primary": 1})
        spy, _ = self._drive({"emissions": emissions, "council": weak})
        self.assertIn("PORTAL_LOW_CONFIDENCE", [r for r, _ in spy.fired])

        strong = SimpleNamespace(escalated=False,
                                 detections=[SimpleNamespace(score=0.93)],
                                 by_detector={"primary": 1})
        spy2, _ = self._drive({"emissions": emissions, "council": strong})
        self.assertEqual(spy2.fired, [], "a confident decision is not a hard case")

    def test_a_weak_detection_with_NO_state_change_is_not_a_portal_case(self):
        """A quiet lot full of low-confidence noise is not worth a clip each. The trigger is
        the CHANGE, not the confidence on its own."""
        weak = SimpleNamespace(escalated=False,
                                     detections=[SimpleNamespace(score=0.44)],
                                     by_detector={"primary": 1})
        spy, _ = self._drive({"emissions": [], "council": weak})
        self.assertEqual(spy.fired, [])

    def test_a_RECORDER_THAT_EXPLODES_does_not_take_the_producer_down(self):
        """The corpus is an upgrade, never a dependency of watching the lot.

        The scene is UNTRUSTED on purpose, so a trigger is actually attempted and the
        exception is raised inside the derivation rather than only inside `observe`. Driving
        this with a quiet frame fired nothing, so the derivation's own guard went untested --
        a mutation that let exceptions escape it survived until this fixture said otherwise."""
        spy = self._Spy(fail=True)
        scene = SimpleNamespace(may_create_visits=False, change_frac=0.9)
        _, loop = self._drive({"emissions": [], "scene": scene}, spy=spy)
        self.assertIsNotNone(loop, "the step must have completed despite the recorder raising")
        self.assertEqual(spy.fired, [], "the spy raised, so nothing can have been recorded")

    def test_the_corpus_health_has_a_REAL_consumer_and_the_heartbeat_is_not_it(self):
        """The heartbeat once carried a `hardCases` facet. It had NO RECEIVER -- the ingest
        schema in `cameraVisitsRoutes.ts` has no such field, so Zod stripped it and the value
        reached nothing. Shipping a writer with no reader is the orphan defect this repo keeps
        removing, and finding it in my own 'make a broken recorder visible' change is exactly
        why the rule exists.

        Corpus health has two consumers that are real and were verified live: the producer's
        own shutdown log line, and the doctor's `hard-case corpus` check. This asserts the
        facet is GONE rather than silently discarded."""
        pipeline = make_pipeline()
        body = edge_main.edge_heartbeat_body(
            camera="lot", seq=1, now=1000.0, mode="SHADOW", source=FakeSource(),
            vision=FakeVision(pipeline.tracker), ledger=pipeline.ledger,
            health_state=None, scene_state=None, calibration_version=None,
            detector_name=None, model_sha256=None, last_healthy_frame_at=None)
        self.assertNotIn("hardCases", body)
        # And every key that IS sent must be one the receiver accepts.
        self.assertIn("sourceGeneration", body)


class SceneLockAnchorTest(unittest.TestCase):
    """`SceneLock` has always asked for a known-good pose and never been given one.

    Left to auto-adopt, it anchors on whichever frame settles first, which detects drift from
    WHERE THE PROCESS STARTED. That is genuinely useful and it is blind to the case that
    matters most: a camera already off-aim at start-up. There the wrong view becomes "home",
    every later frame agrees with it, and visits are minted forever against lot, portal and
    bay polygons belonging to a view the camera no longer has -- silently wrong, no symptom.

    The atlas can now supply a frame that appearance-matched a calibrated reference, which
    upgrades the gate from "has it moved since boot" to "is it where the polygons were drawn".
    """

    def _build(self, source):
        two = dict(_RAW())
        return edge_main.build_edge(_cfg(two), _args(calibration=None, camera="lot"))

    def test_a_source_carrying_a_CALIBRATED_REFERENCE_anchors_the_scene_lock(self):
        anchor = np.full((90, 160, 3), 90, np.uint8)
        anchor[20:60, 30:120] = 200

        class _Src:
            calibrated_reference = anchor

            def read(self):
                return None

        # `build_edge` imports `build_source` INSIDE the function, so the name lives on
        # `vision.run_live` and not on `edge_main`. Patching the wrong module would silently
        # leave the real capture path in place and the test would be measuring nothing.
        import vision.run_live as rl
        original = rl.build_source
        rl.build_source = lambda *a, **k: _Src()
        try:
            _, vision, *_ = self._build(_Src())
        finally:
            rl.build_source = original
        # The DISCRIMINATING assertion is that a reference exists BEFORE any frame has been
        # processed. Asserting `reference_set` after an update proves nothing, because
        # auto-adoption sets it too -- a mutation removing the anchoring entirely passed that
        # version of this test.
        self.assertIsNotNone(getattr(vision.scene, "_ref", None),
                             "the calibrated pose was never handed to the scene lock")
        self.assertTrue(vision.scene.update(anchor).reference_set)

    def test_WITHOUT_one_the_lock_still_auto_adopts_exactly_as_before(self):
        """The positive control. A change that anchored unconditionally -- or that broke the
        fallback -- would leave every producer without an atlas unable to establish a pose at
        all, which is worse than the gap being closed."""
        class _Src:
            def read(self):
                return None

        # `build_edge` imports `build_source` INSIDE the function, so the name lives on
        # `vision.run_live` and not on `edge_main`. Patching the wrong module would silently
        # leave the real capture path in place and the test would be measuring nothing.
        import vision.run_live as rl
        original = rl.build_source
        rl.build_source = lambda *a, **k: _Src()
        try:
            _, vision, *_ = self._build(_Src())
        finally:
            rl.build_source = original
        self.assertIsNone(getattr(vision.scene, "_ref", None),
                          "nothing supplied a reference, so none should be set yet")
        frame = np.full((90, 160, 3), 70, np.uint8)
        vision.scene.update(frame)
        vision.scene.update(frame)
        self.assertIsNotNone(vision.scene._ref, "auto-adoption must still work")

    def test_an_UNUSABLE_reference_does_not_stop_the_producer_starting(self):
        """Anchoring is an upgrade to the pose gate, not a precondition for watching the lot.
        A reference the lock cannot digest must degrade to auto-adoption, loudly."""
        class _Src:
            calibrated_reference = "not an image at all"

            def read(self):
                return None

        # `build_edge` imports `build_source` INSIDE the function, so the name lives on
        # `vision.run_live` and not on `edge_main`. Patching the wrong module would silently
        # leave the real capture path in place and the test would be measuring nothing.
        import vision.run_live as rl
        original = rl.build_source
        rl.build_source = lambda *a, **k: _Src()
        try:
            built = self._build(_Src())
        finally:
            rl.build_source = original
        self.assertIsNotNone(built, "a bad reference must not prevent start-up")


class ShadowWiringTest(unittest.TestCase):
    """A challenger that records nothing is worth nothing, and one that can vote is worse."""

    class _Spy:
        def __init__(self):
            self.noted = []
            self.stats = SimpleNamespace(describe=lambda: "spy", healthy=True)

        def note(self, subject, champion, challenger, *, at, context=None):
            self.noted.append((subject, champion, challenger, dict(context or {})))
            return True

    class _Chal:
        name = "challenger-v2"

        def __init__(self, n):
            self._n = n

        def detect(self, image):
            return [object()] * self._n

    def _drive(self, council, spy=None, challenger_count=3):
        spy = spy or self._Spy()
        pipeline = make_pipeline()
        frame = SimpleNamespace(ts=1000.0, image=np.zeros((8, 8, 3), np.uint8), seq=0,
                                source="fake", meta={})

        class _Src:
            def read(self):
                return frame

        class _Vision:
            health = SimpleNamespace(state=lambda ts: None)

            def step(self, f):
                return {"emissions": [], "council": council}

        loop = _loop(pipeline, _Vision(), _Src(), shadow=spy,
                     challenger=self._Chal(challenger_count))
        loop.step()
        return spy

    def test_an_ESCALATED_frame_records_CHAMPION_vs_CHALLENGER(self):
        """The challenger is run HERE, out of band, on the frame the council just judged --
        it is not read out of `by_detector`. That distinction is the whole point: a model
        listed in `by_detector` is inside the council, and `_fuse` lets it promote ambiguous
        boxes and add its own, so its disagreements are not a counterfactual at all."""
        council = SimpleNamespace(escalated=True, detections=[],
                                  by_detector={"primary": 1, "adj": 3})
        spy = self._drive(council, challenger_count=5)
        self.assertEqual(len(spy.noted), 1)
        subject, champion, challenger, ctx = spy.noted[0]
        self.assertEqual((subject, champion), ("VEHICLE_COUNT", 1))
        self.assertEqual(challenger, 5, "the challenger's OWN count, not the adjudicator's")
        self.assertEqual(ctx["champion"], "primary")
        self.assertEqual(ctx["challenger"], "challenger-v2")

    def test_NO_challenger_configured_records_nothing(self):
        """A ledger with no challenger must stay empty rather than quietly recording the
        adjudicator, which votes."""
        council = SimpleNamespace(escalated=True, detections=[],
                                  by_detector={"primary": 1, "adj": 3})
        spy = self._Spy()
        pipeline = make_pipeline()
        frame = SimpleNamespace(ts=1000.0, image=np.zeros((8, 8, 3), np.uint8), seq=0,
                                source="fake", meta={})

        class _Src:
            def read(self):
                return frame

        class _Vision:
            health = SimpleNamespace(state=lambda ts: None)

            def step(self, f):
                return {"emissions": [], "council": council}

        loop = _loop(pipeline, _Vision(), _Src(), shadow=spy)      # no challenger
        loop.step()
        self.assertEqual(spy.noted, [])

    def test_a_frame_that_never_ESCALATED_records_nothing(self):
        """Escalation is what produces a second opinion. Without one there is no
        counterfactual to write, and writing the primary against itself would fill the
        ledger with rows that agree by construction.

        TWO detectors are listed on purpose. With only one, the detector-count guard returns
        first and shadows this one entirely -- a mutation deleting the escalation check
        survived against a single-detector fixture."""
        council = SimpleNamespace(escalated=False, detections=[],
                                  by_detector={"primary": 2, "adj": 5})
        self.assertEqual(self._drive(council).noted, [],
                         "an unescalated frame has no second opinion to record")

    def test_the_MOTION_GATE_is_never_taken_as_the_CHAMPION(self):
        """`by_detector` carries the motion gate too. Recording background subtraction as the
        champion count would compare a vehicle detector against blob detection -- permanent
        disagreement, and a rate that means nothing."""
        council = SimpleNamespace(escalated=True, detections=[],
                                  by_detector={"mog2": 9, "primary": 2})
        spy = self._drive(council, challenger_count=4)
        self.assertEqual(len(spy.noted), 1)
        _, champion, challenger, ctx = spy.noted[0]
        self.assertEqual((champion, challenger), (2, 4), "mog2's 9 must not be the champion")
        self.assertEqual(ctx["champion"], "primary")

    def test_a_SHADOW_THAT_EXPLODES_does_not_take_the_producer_down(self):
        class _Boom:
            stats = SimpleNamespace(describe=lambda: "boom", healthy=False)

            def note(self, *a, **k):
                raise RuntimeError("ledger exploded")

        council = SimpleNamespace(escalated=True, detections=[],
                                  by_detector={"primary": 1, "adj": 3})
        pipeline = make_pipeline()
        frame = SimpleNamespace(ts=1000.0, image=np.zeros((8, 8, 3), np.uint8), seq=0,
                                source="fake", meta={})

        class _Src:
            def read(self):
                return frame

        class _Vision:
            health = SimpleNamespace(state=lambda ts: None)

            def step(self, f):
                return {"emissions": [], "council": council}

        loop = _loop(pipeline, _Vision(), _Src(), shadow=_Boom())
        loop.step()          # must not raise
        self.assertIsNotNone(loop)

    def test_NO_shadow_configured_changes_nothing(self):
        council = SimpleNamespace(escalated=True, detections=[],
                                  by_detector={"primary": 1, "adj": 3})
        pipeline = make_pipeline()
        frame = SimpleNamespace(ts=1000.0, image=np.zeros((8, 8, 3), np.uint8), seq=0,
                                source="fake", meta={})

        class _Src:
            def read(self):
                return frame

        class _Vision:
            health = SimpleNamespace(state=lambda ts: None)

            def step(self, f):
                return {"emissions": [], "council": council}

        loop = _loop(pipeline, _Vision(), _Src())
        loop.step()
        self.assertIsNone(loop.shadow)


class SceneRevalidationTest(unittest.TestCase):
    """A startup fix is only true at startup.

    The operator resizes the window, reorders panes or goes fullscreen mid-shift. A binding
    installed once at boot then warps every later frame through stale geometry while still
    claiming the old sceneId and epoch -- detections evaluated against ground the pane no
    longer covers, with nothing anywhere reporting a problem.
    """

    def _loop_with(self, source, **kw):
        pipeline = make_pipeline()

        class _Vision:
            health = SimpleNamespace(state=lambda ts: None)

            def step(self, frame):
                return {"emissions": []}

        return _loop(pipeline, _Vision(), source, **kw)

    def test_the_revalidator_is_CALLED_on_its_timer(self):
        calls = []

        class _Src:
            def read(self):
                return None

            def revalidate(self):
                calls.append(1)
                return False

        loop = self._loop_with(_Src(), relocate_seconds=10.0, clock=_Clock(1000.0))
        loop.step()
        self.assertEqual(calls, [], "not due yet")
        loop.clock = _Clock(1100.0)
        loop.step()
        self.assertEqual(len(calls), 1, "the revalidation timer never fired")

    def test_relocate_seconds_ZERO_disables_it_entirely(self):
        """Producers with no atlas have nothing to revalidate, and a timer firing into a
        missing hook every two minutes is noise that trains an operator to ignore the log."""
        calls = []

        class _Src:
            def read(self):
                return None

            def revalidate(self):
                calls.append(1)
                return False

        loop = self._loop_with(_Src(), relocate_seconds=0.0, clock=_Clock(1000.0))
        loop.clock = _Clock(99999.0)
        loop.step()
        self.assertEqual(calls, [])

    def test_a_source_with_NO_revalidate_hook_is_fine(self):
        """`--channel` and the plain crop path have no atlas and no hook. They must not
        raise every time the timer comes round."""
        class _Src:
            def read(self):
                return None

        loop = self._loop_with(_Src(), relocate_seconds=10.0, clock=_Clock(1000.0))
        loop.clock = _Clock(1100.0)
        loop.step()          # must not raise

    def test_a_REVALIDATOR_THAT_RAISES_does_not_take_the_producer_down(self):
        """Losing the scene for one sample is usually a truck filling the pane. Tearing down
        a producer mid-shift over it would be far worse than keeping a binding the pose gate
        is independently watching."""
        class _Src:
            def read(self):
                return None

            def revalidate(self):
                raise RuntimeError("locator exploded")

        loop = self._loop_with(_Src(), relocate_seconds=10.0, clock=_Clock(1000.0))
        loop.clock = _Clock(1100.0)
        loop.step()          # must not raise
        self.assertIsNotNone(loop)

    def test_a_RE_LOCATION_records_a_LAYOUT_CHANGE_hard_case(self):
        class _Spy:
            def __init__(self):
                self.fired = []
                self.stats = SimpleNamespace(describe=lambda: "spy", healthy=True)

            def observe(self, ts, image):
                pass

            def trigger(self, reason, at, context=None):
                self.fired.append(reason)
                return True

            def flush_ready(self, now):
                return []

            def flush_all(self, now):
                return []

        class _Src:
            def read(self):
                return None

            def revalidate(self):
                return True          # the layout moved

        spy = _Spy()
        loop = self._loop_with(_Src(), relocate_seconds=10.0, clock=_Clock(1000.0),
                               hard_cases=spy)
        loop.clock = _Clock(1100.0)
        loop.step()
        self.assertIn("LAYOUT_CHANGE", spy.fired)

    def test_NO_hard_case_is_recorded_when_the_layout_did_NOT_move(self):
        """The positive control. A trigger that fired on every revalidation would bury the
        real layout changes under one clip every two minutes, forever."""
        class _Spy:
            def __init__(self):
                self.fired = []
                self.stats = SimpleNamespace(describe=lambda: "spy", healthy=True)

            def observe(self, ts, image):
                pass

            def trigger(self, reason, at, context=None):
                self.fired.append(reason)
                return True

            def flush_ready(self, now):
                return []

            def flush_all(self, now):
                return []

        class _Src:
            def read(self):
                return None

            def revalidate(self):
                return False         # nothing moved

        spy = _Spy()
        loop = self._loop_with(_Src(), relocate_seconds=10.0, clock=_Clock(1000.0),
                               hard_cases=spy)
        loop.clock = _Clock(1100.0)
        loop.step()
        self.assertEqual(spy.fired, [])


class TrackDeathLedgerWiringTest(unittest.TestCase):
    """A ledger nobody feeds and a shop with no track deaths look identical on disk.

    This is the same shape that let `_note_trajectory` record nothing for 128 frames while
    the producer looked perfectly healthy, and the same shape the shadow-ledger comment in
    `EdgeLoop.step` records. `_note_deaths` is a WRITER, so it needs a test that proves the
    call site exists -- an unwired one would leave the re-acquisition rate with a numerator
    and no denominator, which is precisely the state this whole change is undoing.
    """

    class _Store:
        def __init__(self):
            self.deaths = []
            self.marks = []

        def observe(self, now, tracks, *, scene, generation):
            return 0

        def note_deaths(self, now, dead, *, scene, generation):
            self.deaths.append((now, [t.track_id for t in dead], scene, generation))
            return len(self.deaths)

        def mark_reacquired(self, scene, track_id, death_ts, tolerance=0.5):
            self.marks.append((scene, track_id, death_ts))
            return True

    def _dead(self, track_id):
        return SimpleNamespace(track_id=track_id, box=(10.0, 10.0, 60.0, 80.0),
                               ground_point=(35.0, 80.0), born_ts=990.0, score=0.8,
                               hits=5, misses=13, evidence="candidate", degraded=False,
                               retired_allowed=12, stationary_for=lambda _n: 1.0)

    def _drive(self, out, store, meta=None):
        pipeline = make_pipeline()
        frame = SimpleNamespace(ts=1000.0, image=np.zeros((8, 8, 3), np.uint8), seq=0,
                                source="fake", meta=meta if meta is not None else {})

        class _Vision:
            health = SimpleNamespace(state=lambda ts: None)
            tracks = SimpleNamespace(tracks={})

            def __init__(self, o):
                self._o = o

            def step(self, _frame):
                return self._o

        class _Src:
            def read(self):
                return frame

        loop = _loop(pipeline, _Vision(out), _Src(), trajectories=store)
        loop.step()
        return loop

    def test_a_retired_track_REACHES_the_ledger(self):
        store = self._Store()
        self._drive({"emissions": [], "died": [self._dead(7)], "born": []}, store)
        self.assertEqual(len(store.deaths), 1, "the hook never reached the store")
        _now, ids, _scene, _gen = store.deaths[0]
        self.assertEqual(ids, [7])

    def test_a_frame_with_no_deaths_writes_NOTHING(self):
        """Not an empty row, not a zero: nothing. A ledger that logged every quiet frame
        would bury the events it exists to hold."""
        store = self._Store()
        self._drive({"emissions": [], "died": [], "born": []}, store)
        self.assertEqual(store.deaths, [])

    def test_deaths_are_filed_under_the_FRAME_S_OWN_sceneId(self):
        """Same attribution rule as the trajectory points, and it must be the SAME rule:
        `mark_reacquired` looks the row back up by scene, so a writer and a reader that
        disagree here produce a ledger whose re-acquisition rate is silently always zero."""
        store = self._Store()
        self._drive({"emissions": [], "died": [self._dead(3)], "born": []}, store,
                    meta={"sceneId": "shop-left"})
        self.assertEqual(store.deaths[0][2], "shop-left")

    def test_a_ledger_that_EXPLODES_does_not_take_the_producer_down(self):
        class _Boom(TrackDeathLedgerWiringTest._Store):
            def note_deaths(self, *a, **k):
                raise RuntimeError("ledger exploded")

        pipeline = make_pipeline()
        with self.assertLogs("edge", level="WARNING") as caught:
            self._drive({"emissions": [], "died": [self._dead(1)], "born": []}, _Boom())
        self.assertTrue([m for m in caught.output if "death ledger is failing" in m],
                        "a swallowed exception that names no cause is half a decision")

    def test_the_ledger_is_OPTIONAL(self):
        """A producer started without `--trajectories` must run exactly as before."""
        pipeline = make_pipeline()
        frame = SimpleNamespace(ts=1000.0, image=np.zeros((8, 8, 3), np.uint8), seq=0,
                                source="fake", meta={})

        class _Vision:
            health = SimpleNamespace(state=lambda ts: None)
            tracks = SimpleNamespace(tracks={})

            def step(self, _f):
                return {"emissions": [], "died": [], "born": []}

        class _Src:
            def read(self):
                return frame

        loop = _loop(pipeline, _Vision(), _Src(), trajectories=None)
        loop.step()
        self.assertIsNone(loop.trajectories)


class LocateQualityTest(unittest.TestCase):
    """A revalidation pass that FOUND NOTHING used to be indistinguishable from one that
    confirmed an unchanged layout: both returned False, both printed a line, and the only
    counter in the loop (`edge_relocate_errors_total`) counts EXCEPTIONS, which a clean
    `SceneNotLocated` is not. So a locator failing every pass for an hour looked exactly like
    a window nobody had touched, while the producer went on warping every frame through a
    binding it had stopped being able to confirm.

    And when a pass DID re-bind, the match's quality figures went to a print statement and
    nowhere else -- so the `LAYOUT_CHANGE` clip recorded that geometry had been re-bound
    without any evidence about whether the new binding was good.
    """

    class _Spy:
        def __init__(self):
            self.fired = []

        def trigger(self, name, ts, ctx):
            self.fired.append((name, ctx))

        def flush_all(self, now):
            return []

    def _loop_with(self, source, **kw):
        pipeline = make_pipeline()

        class _Vision:
            health = SimpleNamespace(state=lambda ts: None)

            def step(self, frame):
                return {"emissions": []}

        return _loop(pipeline, _Vision(), source, **kw)

    def _src(self, result):
        class _Src:
            def read(self):
                return None

            def revalidate(self):
                return result

        return _Src()

    def _fire(self, result, **kw):
        spy = self._Spy()
        loop = self._loop_with(self._src(result), relocate_seconds=10.0,
                               clock=_Clock(1000.0), hard_cases=spy, **kw)
        loop.clock = _Clock(1100.0)
        loop.step()
        return loop, spy

    @staticmethod
    def _located(**over):
        base = dict(scene_id="shop-left", variant="fullscreen", inliers=140,
                    inlier_ratio=0.72, reprojection_error=1.1, runner_up=None,
                    margin=float("inf"), homography_id="h:abc123")
        base.update(over)
        return SimpleNamespace(**base)

    # ---------------------------------------------------------------- failures are visible
    def test_a_pass_that_found_NOTHING_is_counted_and_named(self):
        result = RevalidateResult(False, failure="SceneNotLocated: no scene reached the floor")
        with self.assertLogs("edge", level="WARNING") as caught:
            loop, _spy = self._fire(result)
        self.assertEqual(loop.relocate_failures, 1)
        self.assertGreaterEqual(loop.pipeline.metrics.get("edge_relocate_unconfirmed_total"), 1)
        self.assertTrue([m for m in caught.output if "not confirming the binding" in m],
                        "a counter that names no cause is half a decision")

    def test_an_UNCHANGED_but_CONFIRMED_pass_is_not_a_failure(self):
        """THE CANARY. If this counted, the metric would read as a fault many times an hour
        and an operator would learn to ignore it -- which is worse than not having it."""
        loop, _spy = self._fire(RevalidateResult(False, located=self._located()))
        self.assertEqual(loop.relocate_failures, 0)
        self.assertEqual(loop.pipeline.metrics.get("edge_relocate_unconfirmed_total"), 0)

    def test_a_plain_BOOL_from_an_older_source_still_works(self):
        """`revalidate()` returning a bare bool must keep working: the result type is truthy
        on change precisely so every existing caller and stub is unaffected."""
        loop, spy = self._fire(False)
        self.assertEqual(loop.relocate_failures, 0)
        self.assertEqual(loop.relocations, 0)
        loop2, spy2 = self._fire(True)
        self.assertEqual(loop2.relocations, 1)
        self.assertEqual([n for n, _c in spy2.fired], ["LAYOUT_CHANGE"])

    # ------------------------------------------------------------- the clip carries figures
    def test_a_LAYOUT_CHANGE_clip_carries_the_locate_figures(self):
        result = RevalidateResult(True, located=self._located(inliers=96, inlier_ratio=0.64))
        _loop_, spy = self._fire(result)
        fired = dict(spy.fired)
        self.assertIn("LAYOUT_CHANGE", fired)
        locate = fired["LAYOUT_CHANGE"]["locate"]
        self.assertEqual(locate["inliers"], 96)
        self.assertEqual(locate["inlierRatio"], 0.64)
        self.assertEqual(locate["sceneId"], "shop-left")
        self.assertEqual(locate["homographyId"], "h:abc123")

    # ------------------------------------------------------------------- the thinness band
    def test_a_THIN_match_is_recorded(self):
        from vision import scenelocator as sl

        result = RevalidateResult(False, located=self._located(inliers=sl.MIN_INLIERS + 1))
        _loop_, spy = self._fire(result)
        names = [n for n, _c in spy.fired]
        self.assertIn("SCENE_LOCATOR_LOW_CONFIDENCE", names)
        ctx = dict(spy.fired)["SCENE_LOCATOR_LOW_CONFIDENCE"]
        self.assertIn("inliers", ctx["why"])

    def test_a_COMFORTABLE_match_is_not(self):
        """The canary. A band that fired on every match would be a rename of 'a locate
        happened', and it would fill the corpus with the healthy case."""
        _loop_, spy = self._fire(RevalidateResult(False, located=self._located()))
        self.assertEqual([n for n, _c in spy.fired], [])

    def test_NO_RUNNER_UP_is_not_a_near_tie(self):
        """`margin` is `inf` when no other scene was a candidate at all, which is the
        strongest possible result. Reading it as a thin margin would invert the meaning."""
        result = RevalidateResult(False, located=self._located(margin=float("inf"),
                                                              runner_up=None))
        _loop_, spy = self._fire(result)
        self.assertEqual([n for n, _c in spy.fired], [])

    def test_a_NARROW_margin_over_a_real_runner_up_IS_recorded(self):
        from vision import scenelocator as sl

        result = RevalidateResult(False, located=self._located(
            margin=sl.AMBIGUITY_MARGIN + 0.01, runner_up="shop-right"))
        _loop_, spy = self._fire(result)
        ctx = dict(spy.fired).get("SCENE_LOCATOR_LOW_CONFIDENCE")
        self.assertIsNotNone(ctx, "a near-tie between two scenes is the expensive case")
        self.assertIn("shop-right", ctx["why"])

    def test_quality_of_NOTHING_is_None_and_never_a_dict_of_zeros(self):
        """An unmeasured match and a match that scored zero are different claims, and only
        one of them can be true."""
        self.assertIsNone(_locate_quality(None))


if __name__ == "__main__":
    unittest.main()
