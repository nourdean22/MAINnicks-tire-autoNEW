#!/usr/bin/env python3
"""
Ring 2FA Setup — Run this ONCE interactively to get auth token.
After setup, the token is cached and ring_agent.py uses it automatically.

Usage: python ring_setup.py
"""

import os
import json
from pathlib import Path
from dotenv import load_dotenv
from ring_doorbell import Auth

load_dotenv(Path(__file__).parent / ".env")

TOKEN_FILE = Path(__file__).parent / ".ring_token"


def token_updated(token):
    TOKEN_FILE.write_text(json.dumps(token))
    print(f"Token saved to {TOKEN_FILE}")


def main():
    # Auto-load from .env if available
    email = os.getenv("RING_EMAIL", "").strip()
    password = os.getenv("RING_PASSWORD", "").strip()

    if not email:
        email = input("Ring email: ").strip()
    else:
        print(f"Using email from .env: {email}")

    if not password:
        password = input("Ring password: ").strip()
    else:
        print("Using password from .env")

    auth = Auth("StatenourOS/1.0", None, token_updated)
    try:
        auth.fetch_token(email, password)
        print("Auth successful (no 2FA needed).")
    except Exception as e:
        print(f"2FA required ({e})")
        # 2FA required
        code = input("Enter 2FA code from Ring app/SMS: ").strip()
        auth.fetch_token(email, password, code)
        print("Auth successful with 2FA!")

    print(f"Token cached at: {TOKEN_FILE}")
    print("ring_agent.py will now use this token automatically.")


if __name__ == "__main__":
    main()
