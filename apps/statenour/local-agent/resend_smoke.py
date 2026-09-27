"""Resend smoke-test helper.

No credentials or recipients are embedded in source. Manual callers supply both
through environment variables; unit tests inject a fake HTTP transport.
"""
from __future__ import annotations

import os
from typing import Any, Callable

import requests

RESEND_EMAIL_URL = "https://api.resend.com/emails"


def send_smoke_email(
    api_key: str,
    recipient: str,
    *,
    post: Callable[..., Any] = requests.post,
):
    key = api_key.strip()
    to = recipient.strip()
    if not key:
        raise ValueError("RESEND_API_KEY is required")
    if not to:
        raise ValueError("RESEND_TEST_TO is required")

    return post(
        RESEND_EMAIL_URL,
        json={
            "from": "NOUR OS <onboarding@resend.dev>",
            "to": to,
            "subject": "NOUR OS - Notifications Live",
            "text": "Resend email integration smoke test.",
        },
        headers={"Authorization": f"Bearer {key}"},
        timeout=20,
    )


def main() -> int:
    api_key = os.getenv("RESEND_API_KEY", "")
    recipient = os.getenv("RESEND_TEST_TO", "")
    try:
        response = send_smoke_email(api_key, recipient)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc

    print(response.status_code, response.text)
    if not 200 <= int(response.status_code) < 300:
        raise SystemExit(1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
