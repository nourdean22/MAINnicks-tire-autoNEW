"""Manual Resend domain/DNS inspection.

Requires RESEND_API_KEY in the local environment. No credential is stored in source.
"""
import json
import os

import requests

API_BASE = "https://api.resend.com"


def main() -> int:
    api_key = os.getenv("RESEND_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("RESEND_API_KEY is required")

    headers = {"Authorization": f"Bearer {api_key}"}
    response = requests.get(f"{API_BASE}/domains", headers=headers, timeout=20)
    response.raise_for_status()
    domains = response.json()

    print("=== DOMAINS ===")
    print(json.dumps(domains, indent=2))

    for domain in domains.get("data", []):
        domain_id = domain["id"]
        detail = requests.get(
            f"{API_BASE}/domains/{domain_id}",
            headers=headers,
            timeout=20,
        )
        detail.raise_for_status()
        print(f"\n=== DOMAIN: {domain.get('name', '')} ===")
        print(json.dumps(detail.json(), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
