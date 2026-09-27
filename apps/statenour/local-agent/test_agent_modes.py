#!/usr/bin/env python3
import sys
import unittest
from unittest.mock import patch

import agent


class AgentModeTests(unittest.TestCase):
    def setUp(self):
        agent._shutdown = False

    def test_eufy_only_five_cycles_runs_no_other_platforms(self):
        """
        Cross every meaningful cadence boundary without waiting in real time.

        Cycle 3 is where Tuya commands would normally run, cycle 4 is the slower
        Eufy inventory poll, and cycle 5 is metrics. This makes the isolation
        assertion capable of catching a future accidental Tuya-command call that
        a --once test could never observe.
        """
        argv = ["agent.py", "--eufy-only", "--no-health"]
        sleeps = 0

        def stop_after_five_cycles(_seconds):
            nonlocal sleeps
            sleeps += 1
            if sleeps >= 5:
                agent._shutdown = True

        with (
            patch.object(sys, "argv", argv),
            patch.object(agent.time, "sleep", side_effect=stop_after_five_cycles),
            patch.object(agent, "start_eufy_events") as event_listener,
            patch.object(agent, "run_tuya", return_value=0) as tuya,
            patch.object(agent, "run_tuya_commands", return_value=0) as tuya_commands,
            patch.object(agent, "run_ring", return_value=0) as ring,
            patch.object(agent, "run_v380", return_value=0) as v380,
            patch.object(agent, "run_eufy_commands", return_value=0) as eufy_commands,
            patch.object(agent, "run_eufy_office_health", return_value=1) as eufy_health,
            patch.object(agent, "run_eufy", return_value=6) as eufy,
            patch.object(agent, "sync_metrics") as metrics,
        ):
            agent.main()

        event_listener.assert_called_once()
        tuya.assert_not_called()
        tuya_commands.assert_not_called()
        ring.assert_not_called()
        v380.assert_not_called()

        self.assertEqual(eufy_commands.call_count, 5)
        self.assertEqual(eufy_health.call_count, 5)
        eufy.assert_called_once()  # slower inventory poll on cycle 4
        metrics.assert_called_once()  # cycle 5

    def test_eufy_only_rejects_no_eufy(self):
        argv = ["agent.py", "--eufy-only", "--no-eufy", "--once"]
        with patch.object(sys, "argv", argv):
            with self.assertRaises(SystemExit) as ctx:
                agent.main()
        self.assertEqual(ctx.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
