#!/usr/bin/env python3
import sys
import unittest
from unittest.mock import patch

import agent


class AgentModeTests(unittest.TestCase):
    def setUp(self):
        agent._shutdown = False

    def test_eufy_only_once_runs_no_other_platforms(self):
        argv = ["agent.py", "--eufy-only", "--once", "--no-health"]
        with patch.object(sys, "argv", argv),              patch.object(agent, "run_tuya", return_value=0) as tuya,              patch.object(agent, "run_tuya_commands", return_value=0) as tuya_commands,              patch.object(agent, "run_ring", return_value=0) as ring,              patch.object(agent, "run_v380", return_value=0) as v380,              patch.object(agent, "run_eufy_commands", return_value=0) as eufy_commands,              patch.object(agent, "run_eufy_office_health", return_value=1) as eufy_health,              patch.object(agent, "run_eufy", return_value=6) as eufy,              patch.object(agent, "sync_metrics") as metrics:
            agent.main()

        tuya.assert_not_called()
        tuya_commands.assert_not_called()
        ring.assert_not_called()
        v380.assert_not_called()
        eufy_commands.assert_called_once()
        eufy_health.assert_called_once()
        eufy.assert_called_once()
        metrics.assert_called_once()

    def test_eufy_only_rejects_no_eufy(self):
        argv = ["agent.py", "--eufy-only", "--no-eufy", "--once"]
        with patch.object(sys, "argv", argv):
            with self.assertRaises(SystemExit) as ctx:
                agent.main()
        self.assertEqual(ctx.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
