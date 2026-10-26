"""The Railway copy's launcher (lot vision v2 phase 3).

Dormant means NO camera session: the relay is what logs in to the V380 cloud, so the launcher
starts the relay and the crop only after the edge reports it was elected (a marker file), and
stops everything when the edge exits so the container restarts dormant.
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cloud import run_cloud                                              # noqa: E402

ENV = {
    "V380_DEVICE_ID": "12345678",
    "V380_USERNAME": "admin",
    "V380_PASSWORD": "pw",
    "RELAY_BIN": "/opt/relay/V380Decoder",
    "MEDIAMTX_BIN": "/opt/mediamtx/mediamtx",
    "EDGE_CALIBRATION": __file__,  # any existing file
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
        self.assertEqual(args[args.index("--elected-file") + 1], "/tmp/elected")
        self.assertEqual(args[args.index("--ledger") + 1], "/tmp/x/visitd.sqlite")
        self.assertTrue(args[args.index("--config") + 1].endswith(os.path.join("cloud", "config.cloud.yaml")))
        self.assertEqual(args[args.index("--source") + 1], "rtsp")
        self.assertEqual(args[args.index("--camera") + 1], "sign")
        self.assertEqual(args[args.index("--calibration") + 1], ENV["EDGE_CALIBRATION"])

    def test_no_calibration_refuses_to_start(self):
        # Without it the edge runs in census mode and claims no arrivals: a silent zero.
        env = dict(ENV, EDGE_CALIBRATION="/nope/missing.json")
        with self.assertRaises(run_cloud.LauncherConfigError):
            run_cloud.edge_args(env, elected_file="/tmp/elected", ledger="/tmp/x/visitd.sqlite")


class _Proc:
    def __init__(self, name, log):
        self.name, self.log, self.code, self.killed = name, log, None, False

    def poll(self):
        return self.code

    def terminate(self):
        self.killed = True
        self.log.append(("stop", self.name))


class SuperviseTest(unittest.TestCase):
    def _run(self, script):
        """script(tick, procs, elected_path) mutates the fakes each tick."""
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

        code = run_cloud.supervise(start, elected_file=elected, sleep=sleep, max_ticks=50)
        return code, log

    def test_dormant_never_starts_the_relay_and_exits_with_the_edge(self):
        def script(n, procs, _e):
            if n == 3:
                procs["edge"].code = 4

        code, log = self._run(script)
        self.assertEqual(code, 4)
        self.assertNotIn(("start", "relay"), log)
        self.assertNotIn(("start", "crop"), log)
        self.assertIn(("stop", "mediamtx"), log)

    def test_election_starts_the_relay_and_crop_then_lease_loss_stops_all(self):
        def script(n, procs, elected):
            if n == 2:
                open(elected, "w").close()
            if n == 5:
                procs["edge"].code = 4

        code, log = self._run(script)
        self.assertEqual(code, 4)
        self.assertLess(log.index(("start", "edge")), log.index(("start", "relay")))
        self.assertIn(("start", "crop"), log)
        self.assertIn(("stop", "relay"), log)

    def test_a_dead_relay_takes_the_whole_copy_down_nonzero(self):
        def script(n, procs, elected):
            if n == 2:
                open(elected, "w").close()
            if n == 4:
                procs["relay"].code = 1

        code, log = self._run(script)
        self.assertNotEqual(code, 0)
        self.assertIn(("stop", "edge"), log)

    def test_a_clean_edge_exit_still_restarts_the_container(self):
        def script(n, procs, _e):
            if n == 2:
                procs["edge"].code = 0

        code, _log = self._run(script)
        self.assertNotEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
