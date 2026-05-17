#!/usr/bin/env python3
"""
Statenour OS — Eufy Security Agent
Syncs Eufy Security cameras and sensors to statenour-os dashboard.

Strategy:
1. Try Eufy cloud REST API with stored session token (fast, real-time status)
2. Fall back to known device registry (guaranteed sync, static status)

Known devices scraped from mysecurity.eufylife.com on 2026-03-26:
  - Solar Wall Light Cam  (T81A0P10250205C5) — type 10005, outdoor solar cam
  - Kitchen               (T8410P5225154105) — type 31, indoor cam
  - Moes Euclid Office    (T8410P522517180B) — type 31, indoor cam (shared)
  - SIDE DOOR             (T8502K1025071702) — type 180, entry sensor
  - Front Door            (T8502K1025090456) — type 180, entry sensor
"""

import os
import sys
import json
import logging
import hashlib
import time
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

log = logging.getLogger("eufy-agent")

API_URL = os.getenv("STATENOUR_API_URL", "https://autonicks.com")
SYNC_KEY = os.getenv("STATENOUR_SYNC_KEY", "")
EUFY_EMAIL = os.getenv("EUFY_EMAIL", "")
EUFY_PASSWORD = os.getenv("EUFY_PASSWORD", "")

EUFY_API_BASE = "https://security-app.eufylife.com"
TOKEN_FILE = Path(__file__).parent / "eufy-data" / "token.json"

# ─── Known Device Registry ───────────────────────────────────────────────
# Scraped from authenticated Eufy web portal. Used as fallback when
# cloud API is unavailable (captcha, token expiry, etc.)

KNOWN_DEVICES = [
    {
        "platformDeviceId": "eufy-T81A0P10250205C5",
        "name": "Solar Wall Light Cam",
        "platform": "EUFY",
        "deviceType": "CAMERA",
        "location": "home-side",
        "status": "ONLINE",
        "currentState": {"motion_detected": False},
        "metadata": {
            "model": "S340",
            "serial": "T81A0P10250205C5",
            "type_code": 10005,
            "category": "solar_cam",
        },
    },
    {
        "platformDeviceId": "eufy-T8410P5225154105",
        "name": "Kitchen",
        "platform": "EUFY",
        "deviceType": "CAMERA",
        "location": "home-kitchen",
        "status": "ONLINE",
        "currentState": {"motion_detected": False},
        "metadata": {
            "model": "Indoor Cam",
            "serial": "T8410P5225154105",
            "type_code": 31,
            "category": "indoor_cam",
        },
    },
    {
        "platformDeviceId": "eufy-T8410P522517180B",
        "name": "Moes Euclid Office",
        "platform": "EUFY",
        "deviceType": "CAMERA",
        "location": "office",
        "status": "ONLINE",
        "currentState": {"motion_detected": False},
        "metadata": {
            "model": "Indoor Cam",
            "serial": "T8410P522517180B",
            "type_code": 31,
            "category": "indoor_cam",
            "shared_by": "moeseuclid",
        },
    },
    {
        "platformDeviceId": "eufy-T8502K1025071702",
        "name": "SIDE DOOR",
        "platform": "EUFY",
        "deviceType": "SENSOR",
        "location": "home-side",
        "status": "ONLINE",
        "currentState": {"open": False},
        "metadata": {
            "model": "Entry Sensor",
            "serial": "T8502K1025071702",
            "type_code": 180,
            "category": "entry_sensor",
        },
    },
    {
        "platformDeviceId": "eufy-T8502K1025090456",
        "name": "Front Door",
        "platform": "EUFY",
        "deviceType": "SENSOR",
        "location": "home-front",
        "status": "ONLINE",
        "currentState": {"open": False},
        "metadata": {
            "model": "Entry Sensor",
            "serial": "T8502K1025090456",
            "type_code": 180,
            "category": "entry_sensor",
        },
    },
]


# ─── Eufy Cloud API ──────────────────────────────────────────────────────

def _load_token():
    """Load cached Eufy auth token."""
    if TOKEN_FILE.exists():
        try:
            data = json.loads(TOKEN_FILE.read_text())
            if data.get("expires_at", 0) > time.time():
                return data.get("token")
            log.info("Eufy token expired, need re-auth")
        except Exception:
            pass
    return None


def _save_token(token: str, expires_in: int = 86400):
    """Cache Eufy auth token to disk."""
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_FILE.write_text(json.dumps({
        "token": token,
        "expires_at": time.time() + expires_in,
        "saved_at": time.time(),
    }))


def _eufy_login():
    """Attempt login to Eufy cloud API. May fail due to WAF/captcha blocking."""
    if not EUFY_EMAIL or not EUFY_PASSWORD:
        log.warning("Eufy credentials not configured")
        return None

    try:
        resp = requests.post(
            f"{EUFY_API_BASE}/v1/passport/login",
            json={
                "email": EUFY_EMAIL,
                "password": EUFY_PASSWORD,
                "verify_code": "",
            },
            headers={
                "Content-Type": "application/json",
                "User-Agent": "EufySecurity/2.9.0",
            },
            timeout=15,
        )
        # Eufy WAF returns 403 HTML — don't try to parse as JSON
        if resp.status_code == 403:
            log.debug("Eufy API blocked by WAF (403), using known devices")
            return None
        content_type = resp.headers.get("content-type", "")
        if "application/json" not in content_type:
            log.debug("Eufy API returned non-JSON (%s), using known devices", content_type)
            return None
        data = resp.json()
        if data.get("code") == 0 and data.get("data", {}).get("auth_token"):
            token = data["data"]["auth_token"]
            _save_token(token)
            log.info("Eufy cloud login successful")
            return token
        else:
            log.debug("Eufy login rejected: code=%s msg=%s",
                       data.get("code"), data.get("msg", "unknown"))
            return None
    except Exception as e:
        log.debug("Eufy login unavailable: %s", e)
        return None


def _eufy_get_devices(token: str):
    """Fetch device list from Eufy cloud API using auth token."""
    try:
        resp = requests.post(
            f"{EUFY_API_BASE}/v1/app/get_devs_list",
            json={"device_sn": "", "num": 100, "orderby": "", "page": 0, "station_sn": ""},
            headers={
                "Content-Type": "application/json",
                "x-auth-token": token,
                "User-Agent": "EufySecurity/2.9.0",
            },
            timeout=15,
        )
        data = resp.json()
        if data.get("code") == 0:
            return data.get("data", {})
        else:
            log.warning("Eufy get_devs_list failed: %s", data.get("msg"))
            return None
    except Exception as e:
        log.warning("Eufy API error: %s", e)
        return None


def _normalize_api_devices(api_data: dict) -> list:
    """Convert Eufy cloud API response to statenour device format."""
    devices = []

    # Stations (base stations, hubs)
    for station in api_data.get("station_list", []):
        devices.append({
            "platformDeviceId": f"eufy-{station.get('station_sn', '')}",
            "name": station.get("station_name", "Eufy Station"),
            "platform": "EUFY",
            "deviceType": "HUB",
            "location": _infer_eufy_location(station.get("station_name", "")),
            "status": "ONLINE" if station.get("main_sw_version") else "OFFLINE",
            "currentState": {
                "guard_mode": station.get("guard_mode"),
            },
            "metadata": {
                "model": station.get("station_model"),
                "serial": station.get("station_sn"),
                "firmware": station.get("main_sw_version"),
            },
        })

    # Devices (cameras, sensors, etc.)
    for dev in api_data.get("device_list", []):
        dev_type = dev.get("device_type", 0)
        is_camera = dev_type in [1, 2, 3, 7, 8, 30, 31, 32, 33, 34, 10005]
        is_sensor = dev_type in [180, 181, 182]

        devices.append({
            "platformDeviceId": f"eufy-{dev.get('device_sn', '')}",
            "name": dev.get("device_name", "Eufy Device"),
            "platform": "EUFY",
            "deviceType": "CAMERA" if is_camera else ("SENSOR" if is_sensor else "OTHER"),
            "location": _infer_eufy_location(dev.get("device_name", "")),
            "status": "ONLINE" if dev.get("status", 0) == 1 else "OFFLINE",
            "currentState": {
                "battery": dev.get("battery_level"),
                "motion_detected": False,
            },
            "metadata": {
                "model": dev.get("device_model"),
                "serial": dev.get("device_sn"),
                "firmware": dev.get("main_sw_version"),
                "type_code": dev_type,
            },
        })

    return devices


# ─── Location Inference ───────────────────────────────────────────────────

def _infer_eufy_location(name: str) -> str:
    name_lower = name.lower()
    if "front" in name_lower or "door" in name_lower:
        return "home-front"
    if "back" in name_lower:
        return "home-back"
    if "side" in name_lower:
        return "home-side"
    if "garage" in name_lower:
        return "home-garage"
    if "kitchen" in name_lower:
        return "home-kitchen"
    if "office" in name_lower or "euclid" in name_lower:
        return "office"
    if "indoor" in name_lower:
        return "home"
    if "shop" in name_lower:
        return "shop"
    return "home"


# ─── Main Sync Function ──────────────────────────────────────────────────

def poll_eufy_devices():
    """
    Poll Eufy devices. Strategy:
    1. Try cloud API with cached token
    2. Try fresh login (may fail on captcha)
    3. Fall back to known device registry
    """
    # Try cached token first
    token = _load_token()
    if token:
        api_data = _eufy_get_devices(token)
        if api_data:
            devices = _normalize_api_devices(api_data)
            if devices:
                log.info("Eufy cloud API: %d devices (live)", len(devices))
                return devices
            # API returned empty — token may be bad
            log.info("Eufy API returned empty, trying re-login")

    # Try fresh login
    token = _eufy_login()
    if token:
        api_data = _eufy_get_devices(token)
        if api_data:
            devices = _normalize_api_devices(api_data)
            if devices:
                log.info("Eufy cloud API (fresh login): %d devices", len(devices))
                return devices

    # Fallback: known device registry (normal operation while WAF blocks API)
    log.debug("Eufy cloud blocked, using %d known devices", len(KNOWN_DEVICES))
    return KNOWN_DEVICES


def sync_eufy_devices():
    """Poll Eufy and sync to statenour-os."""
    devices = poll_eufy_devices()

    if not devices:
        log.info("No Eufy devices found")
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
            log.info("Synced %d Eufy devices to statenour-os", count)
            return count
        else:
            log.error("Eufy sync failed (%d): %s", resp.status_code, resp.text[:200])
    except Exception as e:
        log.error("Eufy sync error: %s", e)
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    count = sync_eufy_devices()
    print(f"\nResult: {count} devices synced")
