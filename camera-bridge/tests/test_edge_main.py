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
        window_title="V380", no_crop=True, calibration=None, model=None, device="AUTO",
        motion_gate=False, evidence=None, fps=4.0, seconds=0.0, mode=None,
        commissioning_run=None, heartbeat_seconds=30.0, drain_seconds=5.0,
        dry_run=True, log_level="WARNING", channel=None, persist_seconds=2.0,
        stall_exit_seconds=180.0, scene_atlas=None, scene=None,
        adjudicator_model=None, adjudicator_device=None,
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
            pipeline, *_ = edge_main.build_edge(self._shop_cfg(), args)
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


if __name__ == "__main__":
    unittest.main()
