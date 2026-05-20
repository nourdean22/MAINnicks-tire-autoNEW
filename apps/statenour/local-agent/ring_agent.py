#!/usr/bin/env python3
"""
Statenour OS — Ring Device Agent
Polls Ring API for doorbell/camera status, pushes to statenour-os.
Requires: pip install ring-doorbell
"""

import os
import sys
import json
import logging
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

log = logging.getLogger("ring-agent")

API_URL = os.getenv("STATENOUR_API_URL", "https://bdnick.info")
SYNC_KEY = os.getenv("STATENOUR_SYNC_KEY", "")
RING_EMAIL = os.getenv("RING_EMAIL", "")
RING_PASSWORD = os.getenv("RING_PASSWORD", "")
RING_TOKEN_FILE = Path(__file__).parent / ".ring_token"


def _get_ring_auth():
    """Authenticate with Ring API using ring_doorbell library."""
    try:
        from ring_doorbell import Ring, Auth
        from oauthlib.oauth2 import MissingTokenError
    except ImportError:
        log.error("ring_doorbell not installed. Run: pip install ring-doorbell")
        return None

    def token_updated(token):
        RING_TOKEN_FILE.write_text(json.dumps(token))

    auth = None
    if RING_TOKEN_FILE.exists():
        try:
            token_data = json.loads(RING_TOKEN_FILE.read_text())
            auth = Auth("StatenourOS/1.0", token_data, token_updated)
        except Exception:
            pass

    if not auth:
        if not RING_EMAIL or not RING_PASSWORD:
            log.error("RING_EMAIL and RING_PASSWORD required for first auth")
            return None
        auth = Auth("StatenourOS/1.0", None, token_updated)
        try:
            auth.fetch_token(RING_EMAIL, RING_PASSWORD)
        except MissingTokenError:
            # 2FA required — user needs to run interactive setup first
            log.error("Ring 2FA required. Run: python ring_setup.py")
            return None

    ring = Ring(auth)
    ring.update_data()
    return ring


def poll_ring_devices():
    """Fetch all Ring devices and return normalized list."""
    ring = _get_ring_auth()
    if not ring:
        return []

    devices = []
    ring_devices = ring.devices()

    # Doorbells
    for doorbell in ring_devices.doorbells:
        devices.append({
            "platformDeviceId": f"ring-{doorbell.id}",
            "name": doorbell.name,
            "platform": "RING",
            "deviceType": "CAMERA",
            "location": _infer_ring_location(doorbell.name),
            "status": "ONLINE",
            "currentState": {
                "battery": getattr(doorbell, "battery_life", None),
                "firmware": getattr(doorbell, "firmware", None),
                "volume": getattr(doorbell, "volume", None),
            },
            "metadata": {
                "model": getattr(doorbell, "model", None),
                "device_type": "doorbell",
            },
        })

    # Cameras (stickup cams, floodlights, etc.)
    for cam in ring_devices.stickup_cams:
        devices.append({
            "platformDeviceId": f"ring-{cam.id}",
            "name": cam.name,
            "platform": "RING",
            "deviceType": "CAMERA",
            "location": _infer_ring_location(cam.name),
            "status": "ONLINE",
            "currentState": {
                "battery": getattr(cam, "battery_life", None),
                "firmware": getattr(cam, "firmware", None),
                "siren": getattr(cam, "siren", None),
                "lights": getattr(cam, "lights", None),
            },
            "metadata": {
                "model": getattr(cam, "model", None),
                "device_type": "camera",
            },
        })

    # Chimes
    for chime in ring_devices.chimes:
        devices.append({
            "platformDeviceId": f"ring-{chime.id}",
            "name": chime.name,
            "platform": "RING",
            "deviceType": "SPEAKER",
            "location": _infer_ring_location(chime.name),
            "status": "ONLINE",
            "currentState": {
                "firmware": getattr(chime, "firmware", None),
                "volume": getattr(chime, "volume", None),
            },
            "metadata": {
                "model": getattr(chime, "model", None),
                "device_type": "chime",
            },
        })

    # Other devices (lights, sensors, etc.)
    for other in ring_devices.other:
        devices.append({
            "platformDeviceId": f"ring-{other.id}",
            "name": other.name,
            "platform": "RING",
            "deviceType": "SENSOR",
            "location": _infer_ring_location(other.name),
            "status": "ONLINE",
            "currentState": {},
            "metadata": {
                "model": getattr(other, "model", None),
                "device_type": "other",
            },
        })

    return devices


def _infer_ring_location(name: str) -> str:
    name_lower = name.lower()
    if "front" in name_lower:
        return "home-front"
    if "back" in name_lower or "garage" in name_lower:
        return "home-back"
    if "side" in name_lower:
        return "home-side"
    if "kitchen" in name_lower:
        return "home-kitchen"
    if "downstairs" in name_lower or "basement" in name_lower:
        return "home-downstairs"
    if "shop" in name_lower:
        return "shop"
    return "home"


def sync_ring_devices():
    """Poll Ring and sync to statenour-os."""
    devices = poll_ring_devices()
    if not devices:
        log.info("No Ring devices found")
        return 0

    url = f"{API_URL}/api/sync/nour-os"
    headers = {
        "Content-Type": "application/json",
        "x-sync-key": SYNC_KEY,
    }
    payload = {
        "module": "devices",
        "data": {"devices": devices},
    }
    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=15)
        if resp.status_code == 200:
            result = resp.json()
            count = result.get("data", {}).get("result", {}).get("synced", 0)
            log.info("Synced %d Ring devices", count)
            return count
        else:
            log.error("Ring sync failed (%d): %s", resp.status_code, resp.text[:200])
    except Exception as e:
        log.error("Ring sync error: %s", e)
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    sync_ring_devices()
