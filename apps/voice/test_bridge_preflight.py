"""
Tests for the voice-bridge preflight.

These exist because the voice CI job ran ONLY `python -m py_compile agent.py`.
A syntax check cannot notice that the endpoint the agent POSTs to was deleted
from the other app — which is exactly what happened: `/api/agent` went away on
2026-06-02 and the bridge kept compiling cleanly for two months while every
call would have 404'd.

Run: python -m unittest discover -s apps/voice -p 'test_*.py'
No LiveKit / Deepgram / Cartesia dependencies required.
"""

import unittest

from bridge_preflight import (
    DELETED_BRIDGE_PATHS,
    STATENOUR_AGENT_URL_DEFAULT,
    preflight_bridge,
)

LIVE_ENDPOINT = "https://bdnick.info/api/ai/chat"
TOKEN_ENV = {"VOICE_BRIDGE_TOKEN": "not-a-real-token"}


class TestDeletedTarget(unittest.TestCase):
    def test_the_deleted_path_is_refused_even_when_fully_configured(self):
        """The whole point: a URL that looks correct but cannot work."""
        problems = preflight_bridge({**TOKEN_ENV, "STATENOUR_AGENT_URL": "https://bdnick.info/api/agent"})
        self.assertEqual(len(problems), 1, problems)
        self.assertIn("DELETED", problems[0])
        self.assertIn("33a035257", problems[0])

    def test_trailing_slash_does_not_smuggle_the_dead_path_through(self):
        problems = preflight_bridge({**TOKEN_ENV, "STATENOUR_AGENT_URL": "https://bdnick.info/api/agent/"})
        self.assertTrue(any("DELETED" in p for p in problems), problems)

    def test_the_local_dev_default_is_itself_the_dead_path(self):
        """
        The default is http://localhost:3001/api/agent, so an unset env var
        fails for TWO independent reasons. Both must be reported — telling the
        operator only "set the env var" would send them to configure a URL that
        is also wrong.
        """
        self.assertIn(
            "/api/agent",
            STATENOUR_AGENT_URL_DEFAULT,
            "if the default changes, this test's premise needs revisiting",
        )
        problems = preflight_bridge(TOKEN_ENV)
        self.assertEqual(len(problems), 2, problems)
        self.assertTrue(any("unset" in p for p in problems), problems)
        self.assertTrue(any("DELETED" in p for p in problems), problems)

    def test_a_live_endpoint_is_not_refused(self):
        """Guard against the check being so broad it blocks the fix."""
        self.assertEqual(preflight_bridge({**TOKEN_ENV, "STATENOUR_AGENT_URL": LIVE_ENDPOINT}), [])

    def test_every_listed_dead_path_is_actually_detected(self):
        for path in DELETED_BRIDGE_PATHS:
            with self.subTest(path=path):
                problems = preflight_bridge({**TOKEN_ENV, "STATENOUR_AGENT_URL": f"https://bdnick.info{path}"})
                self.assertTrue(any("DELETED" in p for p in problems), (path, problems))


class TestAuth(unittest.TestCase):
    def test_no_auth_is_refused(self):
        problems = preflight_bridge({"STATENOUR_AGENT_URL": LIVE_ENDPOINT})
        self.assertEqual(len(problems), 1, problems)
        self.assertIn("401", problems[0])

    def test_either_credential_satisfies_it(self):
        self.assertEqual(preflight_bridge({"STATENOUR_AGENT_URL": LIVE_ENDPOINT, "VOICE_BRIDGE_TOKEN": "t"}), [])
        self.assertEqual(preflight_bridge({"STATENOUR_AGENT_URL": LIVE_ENDPOINT, "STATENOUR_OWNER_COOKIE": "c"}), [])

    def test_whitespace_only_credentials_count_as_absent(self):
        """Railway injects empty strings for unset vars in some configurations."""
        problems = preflight_bridge(
            {"STATENOUR_AGENT_URL": LIVE_ENDPOINT, "VOICE_BRIDGE_TOKEN": "   ", "STATENOUR_OWNER_COOKIE": ""}
        )
        self.assertTrue(any("401" in p for p in problems), problems)

    def test_whitespace_only_url_falls_back_to_the_default_and_is_refused(self):
        problems = preflight_bridge({**TOKEN_ENV, "STATENOUR_AGENT_URL": "  "})
        self.assertTrue(any("unset" in p for p in problems), problems)


class TestOutputShape(unittest.TestCase):
    def test_problems_are_operator_readable_not_codes(self):
        for p in preflight_bridge({}):
            self.assertGreater(len(p), 40, f"too terse to act on: {p!r}")

    def test_no_credential_values_are_echoed(self):
        secret = "super-secret-token-value"
        rendered = " ".join(preflight_bridge({"VOICE_BRIDGE_TOKEN": secret}))
        self.assertNotIn(secret, rendered)


if __name__ == "__main__":
    unittest.main()
