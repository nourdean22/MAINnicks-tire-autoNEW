"""The Railway copy's launcher (lot vision v2 phase 3).

Dormant means NO camera session: the relay is what logs in to the V380 cloud, so the launcher
starts the relay and the crop only after the edge reports it was elected (a marker file). A lost
lease returns the copy to dormant IN-PROCESS: Railway caps On-Failure restarts, so an ordinary
handback must never count as a crash (Codex on #3313).
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cloud import run_cloud                                              # noqa: E402

_DIR = tempfile.mkdtemp()
GOOD_CAL = os.path.join(_DIR, "good.json")
NO_PORTAL_CAL = os.path.join(_DIR, "no-portal.json")
INSIDE_PORTAL_CAL = os.path.join(_DIR, "inside-portal.json")
LOT = [[173, 143], [618, 143], [638, 186], [638, 359], [101, 359], [137, 323], [173, 287]]
with open(GOOD_CAL, "w") as fh:
    json.dump({"lot": LOT, "portal": [[29, 280], [209, 273], [180, 359], [29, 359]]}, fh)
with open(NO_PORTAL_CAL, "w") as fh:
    json.dump({"lot": LOT}, fh)
with open(INSIDE_PORTAL_CAL, "w") as fh:
    json.dump({"lot": LOT, "portal": [[300, 200], [400, 200], [400, 300], [300, 300]]}, fh)

ENV = {
    "V380_DEVICE_ID": "12345678",
    "V380_USERNAME": "admin",
    "V380_PASSWORD": "pw",
    "CAMERA_INGEST_KEY": "k",
    "RELAY_BIN": "/opt/relay/V380Decoder",
    "MEDIAMTX_BIN": "/opt/mediamtx/mediamtx",
    "EDGE_CALIBRATION": GOOD_CAL,
}


class CommandTest(unittest.TestCase):
    def test_crop_is_the_production_middle_lens_command(self):
        args = run_cloud.crop_args("ffmpeg")
        self.assertEqual(args[args.index("-i") + 1], "rtsp://127.0.0.1:8554/live")
        self.assertIn("crop=1920:1080:0:1080,scale=640:360,fps=4,setpts=N/(4*TB)", args)
        self.assertEqual(args[-1], "rtsp://127.0.0.1:8555/sign")
        self.assertEqual(args[args.index("-timeout") + 1], "5000000")

    def test_relay_uses_cloud_mode_on_8554(self):
        args = run_cloud.relay_args(ENV)
        self.assertEqual(args[0], "/opt/relay/V380Decoder")
        self.assertEqual(args[args.index("--source") + 1], "cloud")
        self.assertEqual(args[args.index("--rtsp-port") + 1], "8554")
        self.assertEqual(args[args.index("--id") + 1], "12345678")

    def test_missing_camera_credentials_refuse_to_start(self):
        for key in ("V380_DEVICE_ID", "V380_USERNAME", "V380_PASSWORD"):
            env = dict(ENV)
            env.pop(key)
            with self.assertRaises(run_cloud.LauncherConfigError):
                run_cloud.relay_args(env)

    def test_mediamtx_serves_the_crop_on_8555_not_the_relay_port(self):
        cfg = run_cloud.mediamtx_config()
        self.assertIn("rtspAddress: :8555", cfg)
        self.assertNotIn(":8554", cfg)

    def test_edge_is_the_dormant_sign_producer(self):
        args = run_cloud.edge_args(ENV, elected_file="/tmp/elected", ledger="/tmp/x/visitd.sqlite")
        self.assertIn("--dormant-until-authoritative", args)
        self.assertEqual(args[args.index("--source") + 1], "rtsp")
        self.assertEqual(args[args.index("--camera") + 1], "sign")
        self.assertEqual(args[args.index("--calibration") + 1], GOOD_CAL)
        self.assertEqual(args[args.index("--elected-file") + 1], "/tmp/elected")
        self.assertEqual(args[args.index("--ledger") + 1], "/tmp/x/visitd.sqlite")
        self.assertTrue(args[args.index("--config") + 1].endswith(os.path.join("cloud", "config.cloud.yaml")))

    def test_calibration_that_cannot_count_refuses_to_start(self):
        # Missing, no portal (census only) or a portal that never crosses the lot: all claim 0 arrivals.
        for path in ("/nope/missing.json", NO_PORTAL_CAL, INSIDE_PORTAL_CAL):
            with self.assertRaises(run_cloud.LauncherConfigError, msg=path):
                run_cloud.edge_args(dict(ENV, EDGE_CALIBRATION=path), elected_file="/e", ledger="/l")

    def test_no_shop_ingest_key_refuses_to_start(self):
        # Without it the shop never hears the heartbeat, so the copy could never be elected.
        env = dict(ENV)
        env.pop("CAMERA_INGEST_KEY")
        with self.assertRaises(run_cloud.LauncherConfigError):
            run_cloud.edge_args(env, elected_file="/e", ledger="/l")

    def test_the_ledger_lives_on_the_volume_not_in_a_per_launch_temp_dir(self):
        self.assertEqual(run_cloud.ledger_path({}), os.path.join("/data", "lot-vision", "visitd.sqlite"))
        self.assertEqual(run_cloud.ledger_path({"LEDGER_DIR": "/v"}), os.path.join("/v", "visitd.sqlite"))


class _Proc:
    def __init__(self, name, log):
        self.name, self.log, self.code = name, log, None

    def poll(self):
        return self.code

    def terminate(self):
        self.log.append(("stop", self.name))
        if self.code is None:
            self.code = -15


class SuperviseTest(unittest.TestCase):
    def _run(self, script, max_ticks=40):
        log, procs = [], {}
        elected = os.path.join(tempfile.mkdtemp(), "elected")

        def start(name):
            log.append(("start", name))
            procs[name] = _Proc(name, log)
            return procs[name]

        ticks = {"n": 0}

        def sleep(_s):
            ticks["n"] += 1
            script(ticks["n"], procs, elected)

        code = run_cloud.supervise(start, elected_file=elected, sleep=sleep, max_ticks=max_ticks)
        return code, log, elected

    def test_dormant_never_starts_the_relay(self):
        code, log, _ = self._run(lambda n, p, e: None)
        self.assertNotIn(("start", "relay"), log)
        self.assertNotIn(("start", "crop"), log)

    def test_election_starts_the_relay_and_crop(self):
        def script(n, procs, elected):
            if n == 2:
                open(elected, "w").close()

        _code, log, _ = self._run(script)
        self.assertLess(log.index(("start", "edge")), log.index(("start", "relay")))
        self.assertIn(("start", "crop"), log)

    def test_lease_loss_goes_dormant_in_process_without_exiting(self):
        def script(n, procs, elected):
            if n == 2:
                open(elected, "w").close()
            if n == 5:
                procs["edge"].code = 4

        code, log, elected = self._run(script, max_ticks=12)
        self.assertEqual(code, 3)                      # only the tick budget ended this run
        self.assertIn(("stop", "relay"), log)
        self.assertEqual(log.count(("start", "edge")), 2)
        self.assertFalse(os.path.exists(elected))

    def test_a_crop_with_no_frames_yet_is_retried_without_touching_the_relay(self):
        # Camera asleep or relay warming up: FFmpeg's RTSP timeout ends the crop (Codex on #3313).
        def script(n, procs, elected):
            if n == 2:
                open(elected, "w").close()
            if n == 4:
                procs["crop"].code = 1

        _code, log, _ = self._run(script, max_ticks=4 + run_cloud.CROP_RETRY_TICKS + 2)
        self.assertEqual(log.count(("start", "crop")), 2)
        self.assertEqual(log.count(("start", "relay")), 1)
        # The only relay stop is the end-of-run cleanup, after the crop was restarted.
        last_crop_start = len(log) - 1 - log[::-1].index(("start", "crop"))
        self.assertGreater(log.index(("stop", "relay")), last_crop_start)

    def test_a_dead_relay_is_retried_after_a_backoff_not_by_a_container_restart(self):
        def script(n, procs, elected):
            if n == 2:
                open(elected, "w").close()
            if n == 4:
                procs["relay"].code = 1

        code, log, _ = self._run(script, max_ticks=4 + run_cloud.RELAY_RETRY_TICKS + 2)
        self.assertEqual(log.count(("start", "relay")), 2)
        self.assertEqual(log.count(("start", "edge")), 1)
        self.assertEqual(code, 3)

    def test_an_unexpected_edge_exit_or_dead_mediamtx_ends_the_copy_nonzero(self):
        for name, code_in in (("edge", 0), ("edge", 1), ("mediamtx", 1)):
            def script(n, procs, _e, name=name, code_in=code_in):
                if n == 2:
                    procs[name].code = code_in

            code, log, _ = self._run(script)
            self.assertNotEqual(code, 0, (name, code_in))
            self.assertLess(len([x for x in log if x[0] == "start"]), 5)


class RelayLoginBackoffTest(unittest.TestCase):
    """A relay that keeps dying fast is a refused V380 login (or a camera asleep), and retrying it
    every minute is ~60 logins an hour against the account. NicksMax learned to hold to once per
    30 minutes after a refusal (nicksmax-camera-supervisor.ps1); the front-desk PC hit the same 1002
    on its first morning (2026-10-27)."""

    def _starts(self, die_after: int, max_ticks: int):
        log, procs, born = [], {}, {}
        elected = os.path.join(tempfile.mkdtemp(), "elected")
        ticks = {"n": 0}

        def start(name):
            log.append((ticks["n"], name))
            procs[name] = _Proc(name, [])
            born[name] = ticks["n"]
            return procs[name]

        def sleep(_s):
            ticks["n"] += 1
            relay = procs.get("relay")
            if relay is not None and relay.code is None and ticks["n"] - born["relay"] >= die_after:
                relay.code = 1

        run_cloud.supervise(start, elected_file=elected, sleep=sleep, max_ticks=max_ticks, primary=True, run_edge=False)
        return [t for t, name in log if name == "relay"]

    def test_three_fast_failures_hold_the_next_login_for_30_minutes(self):
        starts = self._starts(die_after=5, max_ticks=3 * (5 + run_cloud.RELAY_RETRY_TICKS) + run_cloud.RELAY_LOGIN_HOLD_TICKS + 60)
        gaps = [b - a for a, b in zip(starts, starts[1:])]
        self.assertGreaterEqual(len(gaps), 3, starts)
        self.assertLess(gaps[0], 120)                                       # first retries stay quick
        self.assertLess(gaps[1], 120)
        self.assertGreaterEqual(gaps[2], run_cloud.RELAY_LOGIN_HOLD_TICKS)  # then once per 30 min
        self.assertEqual(run_cloud.RELAY_LOGIN_HOLD_TICKS, 30 * 60)

    def test_a_relay_that_ran_for_a_while_is_not_a_refused_login(self):
        # A stream that dropped after 10 minutes (camera battery, wifi) retries in a minute every time.
        starts = self._starts(die_after=600, max_ticks=4 * (600 + run_cloud.RELAY_RETRY_TICKS) + 10)
        gaps = [b - a for a, b in zip(starts, starts[1:])]
        self.assertGreaterEqual(len(gaps), 3, starts)
        self.assertTrue(all(g < 600 + 2 * run_cloud.RELAY_RETRY_TICKS for g in gaps), gaps)


class EdgeStallDuringRelayHoldTest(unittest.TestCase):
    """While the relay is refused or held, no frame reaches MediaMTX, so the edge's own stall exit
    (default 180 s) fires. If that ended the launcher, the task restart would reset the fast-exit
    counter and the hold would never last: ~30-45 V380 logins an hour, the NicksMax incident again."""

    STALL = 180

    def _run(self, primary: bool, max_ticks: int):
        log, procs, born, ticks = [], {}, {}, {"n": 0}
        elected = os.path.join(tempfile.mkdtemp(), "elected")

        def start(name):
            log.append((ticks["n"], name))
            procs[name] = _Proc(name, [])
            born[name] = ticks["n"]
            return procs[name]

        def sleep(_s):
            ticks["n"] += 1
            if not primary and ticks["n"] >= 1 and "edge" in procs and not os.path.exists(elected):
                open(elected, "w").close()                       # the Railway copy is (re-)elected
            relay = procs.get("relay")
            if relay is not None and relay.code is None and ticks["n"] - born["relay"] >= 5:
                relay.code = 1                                   # login refused, every time
            edge = procs.get("edge")
            if edge is not None and edge.code is None and ticks["n"] - born["edge"] >= self.STALL:
                edge.code = 3                                    # never saw a frame: stall exit

        code = run_cloud.supervise(start, elected_file=elected, sleep=sleep, max_ticks=max_ticks,
                                   primary=primary, run_edge=True)
        return code, ticks["n"], [t for t, name in log if name == "relay"]

    def test_edge_stall_while_relay_is_down_does_not_end_the_run_or_reset_the_hold(self):
        horizon = 3 * (5 + run_cloud.RELAY_RETRY_TICKS) + run_cloud.RELAY_LOGIN_HOLD_TICKS + 60
        for primary in (True, False):          # front-desk PC, and the Railway copy once elected
            with self.subTest(primary=primary):
                _code, ticks, relays = self._run(primary=primary, max_ticks=horizon)
                self.assertGreater(ticks, horizon - 5, "the launcher ended early on the edge stall exit")
                gaps = [b - a for a, b in zip(relays, relays[1:])]
                self.assertGreaterEqual(gaps[2], run_cloud.RELAY_LOGIN_HOLD_TICKS, relays)


    def test_only_the_stall_exit_is_forgiven_while_the_relay_waits(self):
        # Codex P2 on #3342: a config failure (2) or any other exit stays fatal during the hold.
        log, procs, ticks = [], {}, {"n": 0}
        elected = os.path.join(tempfile.mkdtemp(), "elected")

        def start(name):
            procs[name] = _Proc(name, [])
            return procs[name]

        def sleep(_s):
            ticks["n"] += 1
            if ticks["n"] == 3:
                procs["relay"].code = 1
            if ticks["n"] == 10:
                procs["edge"].code = 2

        code = run_cloud.supervise(start, elected_file=elected, sleep=sleep, max_ticks=500, primary=True, run_edge=True)
        self.assertEqual((code, ticks["n"]), (2, 10))

    def test_a_standby_must_win_its_election_again_before_the_held_relay_logs_in(self):
        # Codex P1 on #3342: a primary may have taken the lease while the standby's edge restarted.
        procs, born, relays, ticks = {}, {}, [], {"n": 0}
        elected = os.path.join(tempfile.mkdtemp(), "elected")
        reelected_at = 4000                      # well past the 30-minute hold

        def start(name):
            if name == "relay":
                relays.append(ticks["n"])
            procs[name] = _Proc(name, [])
            born[name] = ticks["n"]
            return procs[name]

        def sleep(_s):
            ticks["n"] += 1
            n = ticks["n"]
            if n == 1 or n == reelected_at:
                open(elected, "w").close()
            relay = procs.get("relay")
            if relay is not None and relay.code is None and n - born["relay"] >= 5:
                relay.code = 1
            edge = procs.get("edge")
            if edge is not None and edge.code is None and n - born["edge"] >= self.STALL:
                edge.code = 3

        run_cloud.supervise(start, elected_file=elected, sleep=sleep, max_ticks=reelected_at + 20, primary=False, run_edge=True)
        self.assertFalse([t for t in relays if run_cloud.RELAY_LOGIN_HOLD_TICKS < t < reelected_at], relays)
        self.assertTrue([t for t in relays if t >= reelected_at], relays)

class PrimaryTest(unittest.TestCase):
    """The front-desk PC (p1) runs the same launcher with --primary: it IS the camera's main
    session, so the relay and crop start at once and the edge is never dormant (phase 4)."""

    def _run_primary(self, script, max_ticks=40, run_edge=True):
        log, procs = [], {}
        elected = os.path.join(tempfile.mkdtemp(), "elected")

        def start(name):
            log.append(("start", name))
            procs[name] = _Proc(name, log)
            return procs[name]

        ticks = {"n": 0}

        def sleep(_s):
            ticks["n"] += 1
            script(ticks["n"], procs, elected)

        code = run_cloud.supervise(start, elected_file=elected, sleep=sleep, max_ticks=max_ticks,
                                   primary=True, run_edge=run_edge)
        return code, log

    def test_primary_starts_relay_and_crop_without_an_election(self):
        _code, log = self._run_primary(lambda n, p, e: None, max_ticks=3)
        starts = [x[1] for x in log if x[0] == "start"]
        self.assertEqual(sorted(starts), ["crop", "edge", "mediamtx", "relay"])

    def test_primary_edge_is_not_dormant(self):
        args = run_cloud.edge_args(ENV, elected_file="/e", ledger="/l", primary=True)
        self.assertNotIn("--dormant-until-authoritative", args)
        self.assertNotIn("--elected-file", args)
        self.assertEqual(args[args.index("--calibration") + 1], GOOD_CAL)

    def test_primary_without_calibration_streams_only_and_never_starts_the_edge(self):
        # Install day: the relay and crop must run so a still can be taken for the calibration,
        # while no producer claims anything (census mode would report 0 arrivals).
        _code, log = self._run_primary(lambda n, p, e: None, max_ticks=3, run_edge=False)
        self.assertNotIn(("start", "edge"), log)
        self.assertIn(("start", "relay"), log)
        self.assertIn(("start", "crop"), log)

    def test_primary_build_commands_omits_the_edge_without_calibration(self):
        env = dict(ENV)
        env.pop("EDGE_CALIBRATION")
        cmds = run_cloud.build_commands(env, primary=True, elected_file="/e", mtx_cfg="/m")
        self.assertEqual(sorted(cmds), ["crop", "mediamtx", "relay"])
        cmds = run_cloud.build_commands(ENV, primary=True, elected_file="/e", mtx_cfg="/m")
        self.assertIn("edge", cmds)

    def test_cloud_copy_still_refuses_without_calibration(self):
        env = dict(ENV)
        env.pop("EDGE_CALIBRATION")
        with self.assertRaises(run_cloud.LauncherConfigError):
            run_cloud.build_commands(env, primary=False, elected_file="/e", mtx_cfg="/m")

    def test_primary_bad_calibration_still_refuses(self):
        with self.assertRaises(run_cloud.LauncherConfigError):
            run_cloud.build_commands(dict(ENV, EDGE_CALIBRATION=NO_PORTAL_CAL), primary=True,
                                     elected_file="/e", mtx_cfg="/m")

    def test_primary_any_edge_exit_ends_the_run_for_the_task_restart(self):
        for code_in in (3, 4):
            def script(n, procs, _e, code_in=code_in):
                if n == 2:
                    procs["edge"].code = code_in

            code, log = self._run_primary(script)
            self.assertEqual(code, code_in)
            self.assertEqual(log.count(("start", "edge")), 1)

    def test_primary_dead_relay_is_retried_in_place(self):
        def script(n, procs, _e):
            if n == 2:
                procs["relay"].code = 1

        code, log = self._run_primary(script, max_ticks=2 + run_cloud.RELAY_RETRY_TICKS + 2)
        self.assertEqual(log.count(("start", "relay")), 2)
        self.assertEqual(code, 3)


if __name__ == "__main__":
    unittest.main()
