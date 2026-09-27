"""Manual Resend smoke test.

Requires RESEND_API_KEY in the local environment. No credential is stored in source.
Optional RESEND_TEST_TO overrides the destination address.
"""
import os
import requests

api_key = os.getenv("RESEND_API_KEY", "").strip()
recipient = os.getenv("RESEND_TEST_TO", "").strip()
if not api_key:
    raise SystemExit("RESEND_API_KEY is required")
if not recipient:
    raise SystemExit("RESEND_TEST_TO is required")

response = requests.post(
    "https://api.resend.com/emails",
    json={
        "from": "NOUR OS <onboarding@resend.dev>",
        "to": recipient,
        "subject": "NOUR OS - Notifications Live",
        "text": "Resend email integration smoke test.",
    },
    headers={"Authorization": f"Bearer {api_key}"},
    timeout=20,
)
print(response.status_code, response.text)
