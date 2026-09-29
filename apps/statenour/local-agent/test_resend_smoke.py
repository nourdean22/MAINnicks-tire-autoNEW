#!/usr/bin/env python3
import os
import unittest
from unittest.mock import Mock, patch

import resend_smoke


class ResendSmokeTests(unittest.TestCase):
    def test_missing_api_key_fails_before_network(self):
        post = Mock()
        with self.assertRaisesRegex(ValueError, "RESEND_API_KEY"):
            resend_smoke.send_smoke_email("", "ops@example.com", post=post)
        post.assert_not_called()

    def test_missing_recipient_fails_before_network(self):
        post = Mock()
        with self.assertRaisesRegex(ValueError, "RESEND_TEST_TO"):
            resend_smoke.send_smoke_email("re_test_fixture_only", "", post=post)
        post.assert_not_called()

    def test_success_path_uses_environment_supplied_secret_and_recipient(self):
        response = Mock(status_code=200, text='{"id":"fixture"}')
        post = Mock(return_value=response)

        result = resend_smoke.send_smoke_email(
            "  re_test_fixture_only  ",
            "  ops@example.com  ",
            post=post,
        )

        self.assertIs(result, response)
        post.assert_called_once()
        args, kwargs = post.call_args
        self.assertEqual(args[0], resend_smoke.RESEND_EMAIL_URL)
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer re_test_fixture_only")
        self.assertEqual(kwargs["json"]["to"], "ops@example.com")
        self.assertEqual(kwargs["timeout"], 20)

    def test_main_requires_both_environment_values(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(SystemExit, "RESEND_API_KEY"):
                resend_smoke.main()

        with patch.dict(os.environ, {"RESEND_API_KEY": "re_test_fixture_only"}, clear=True):
            with self.assertRaisesRegex(SystemExit, "RESEND_TEST_TO"):
                resend_smoke.main()


if __name__ == "__main__":
    unittest.main()
