#!/usr/bin/env python3
"""
Statenour OS — Local Tuya Device Agent
Polls Tuya Cloud API for device status, pushes to statenour-os /api/sync/nour-os
Runs as a background service on Nour's PC.
"""

import os
import sys
import time
import json
import hashlib
import hmac
import logging
import requests
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

# Load env
load_dotenv(Path(__file__).parent / ".env")

# Config
API_URL = os.getenv("STATENOUR_API_URL", "https://bdnick.info")
SYNC_KEY = os.getenv("STATENOUR_SYNC_KEY", "")
TUYA_ACCESS_ID = os.getenv("TUYA_ACCESS_ID", "")
TUYA_ACCESS_SECRET = os.getenv("TUYA_ACCESS_SECRET", "")
TUYA_ENDPOINT = os.getenv("TUYA_API_ENDPOINT", "https://openapi.tuyaus.com")
TUYA_USER_UID = os.getenv("TUYA_USER_UID", "")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "30"))

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(Path(__file__).parent / "agent.log", encoding="utf-8"),
    ],
)
log = logging.getLogger("tuya-agent")

# ---------- Tuya Cloud Auth ----------

_token_cache = {"access_token": None, "expire_time": 0}


def _sign(method: str, path: str, headers: dict, body: str = "") -> dict:
    """Generate Tuya API v2.0 HMAC-SHA256 signature."""
    t = str(int(time.time() * 1000))
    content_hash = hashlib.sha256(body.encode()).hexdigest()
    string_to_sign = "\n".join([method, content_hash, "", path])
    token = _token_cache["access_token"] or ""
    sign_str = TUYA_ACCESS_ID + token + t + string_to_sign
    signature = hmac.new(
        TUYA_ACCESS_SECRET.encode(), sign_str.encode(), hashlib.sha256
    ).hexdigest().upper()
    headers.update({
        "client_id": TUYA_ACCESS_ID,
        "sign": signature,
        "t": t,
        "sign_method": "HMAC-SHA256",
    })
    if token:
        headers["access_token"] = token
    return headers


def _get_token():
    """Get or refresh Tuya access token."""
    now = time.time()
    if _token_cache["access_token"] and now < _token_cache["expire_time"] - 60:
        return _token_cache["access_token"]

    # Clear stale token before signing — Tuya token endpoint must be called
    # WITHOUT an access_token in the signature, or it returns "sign invalid".
    _token_cache["access_token"] = None

    path = "/v1.0/token?grant_type=1"
    headers = {"Content-Type": "application/json"}
    headers = _sign("GET", path, headers)
    resp = requests.get(f"{TUYA_ENDPOINT}{path}", headers=headers, timeout=10)
    data = resp.json()
    if data.get("success"):
        _token_cache["access_token"] = data["result"]["access_token"]
        _token_cache["expire_time"] = now + data["result"]["expire_time"]
        log.info("Tuya token refreshed, expires in %ds", data["result"]["expire_time"])
        return _token_cache["access_token"]
    else:
        log.error("Token fetch failed: %s", data.get("msg"))
        return None


def tuya_get(path: str):
    """Make authenticated GET to Tuya Cloud API."""
    token = _get_token()
    if not token:
        return None
    headers = {"Content-Type": "application/json"}
    headers = _sign("GET", path, headers)
    resp = requests.get(f"{TUYA_ENDPOINT}{path}", headers=headers, timeout=10)
    data = resp.json()
    if data.get("success"):
        return data.get("result")
    log.warning("Tuya API error on %s: %s", path, data.get("msg"))
    return None


# ---------- Device Polling ----------

# Map Tuya category codes to our device types
CATEGORY_MAP = {
    "sp": "APPLIANCE",       # Smart plug
    "kg": "APPLIANCE",       # Switch
    "dj": "LIGHT",           # Light
    "cz": "APPLIANCE",       # Socket
    "wk": "THERMOSTAT",      # Thermostat
    "rs": "IR_REMOTE",       # IR remote
    "qt": "HEATER",          # Heater
    "mal": "LOCK",           # Lock
    "sp": "SPEAKER",         # Speaker
    "kj": "APPLIANCE",       # Air purifier
    "pc": "APPLIANCE",       # Power strip
    "zndb": "APPLIANCE",     # Smart meter
}


def poll_tuya_devices():
    """Fetch all devices from Tuya Cloud and return normalized list."""
    devices_raw = None

    # Primary: use UID-based endpoint (cloud project linked app account)
    if TUYA_USER_UID:
        devices_raw = tuya_get(f"/v1.0/users/{TUYA_USER_UID}/devices")

    # Fallback 1: IoT Core device list
    if not devices_raw:
        result = tuya_get("/v1.0/iot-03/devices?source_type=tuyaUser&source_id=" + TUYA_USER_UID)
        if result and isinstance(result, dict):
            devices_raw = result.get("list") or result.get("devices")
        elif isinstance(result, list):
            devices_raw = result

    if not devices_raw:
        log.warning("No devices returned from Tuya (tried multiple endpoints)")
        return []

    devices = []
    for d in devices_raw:
        dev_id = d.get("id", "")
        online = d.get("online", False)

        # Fetch device status (DPS values)
        status_data = tuya_get(f"/v1.0/devices/{dev_id}/status") or []
        current_state = {}
        for s in status_data:
            current_state[s.get("code", "")] = s.get("value")

        device = {
            "platformDeviceId": dev_id,
            "name": d.get("name", d.get("product_name", "Unknown")),
            "platform": "TUYA",
            "deviceType": CATEGORY_MAP.get(d.get("category", ""), "OTHER"),
            "location": _infer_location(d.get("name", "")),
            "status": "ONLINE" if online else "OFFLINE",
            "currentState": current_state if current_state else None,
            "metadata": {
                "category": d.get("category"),
                "product_id": d.get("product_id"),
                "product_name": d.get("product_name"),
                "model": d.get("model"),
                "ip": d.get("ip"),
                "local_key": d.get("local_key"),
                "uuid": d.get("uuid"),
            },
        }
        devices.append(device)

    return devices


def _infer_location(name: str) -> str:
    """Infer device location from its name."""
    name_lower = name.lower()
    if "shop" in name_lower:
        return "shop"
    if "basement" in name_lower:
        return "home-basement"
    if "bedroom" in name_lower or "room" in name_lower:
        return "home-bedroom"
    if "front" in name_lower:
        return "home-front"
    if "kitchen" in name_lower:
        return "home-kitchen"
    return "home"


# ---------- Sync to Statenour ----------

def sync_devices(devices: list):
    """Push device states to statenour-os API."""
    if not devices:
        return

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
            log.info("Synced %d devices to statenour-os", result.get("data", {}).get("result", {}).get("synced", 0))
        else:
            log.error("Sync failed (%d): %s", resp.status_code, resp.text[:200])
    except Exception as e:
        log.error("Sync request error: %s", e)


def push_events(device_id: str, events: list):
    """Push device events to statenour-os."""
    if not events:
        return
    # First need to look up the statenour device ID from platformDeviceId
    # For now, events are embedded in the sync payload via currentState changes
    pass


# ---------- Command Polling ----------

def poll_commands():
    """Check for pending commands from statenour-os dashboard."""
    url = f"{API_URL}/api/devices"
    headers = {"x-sync-key": SYNC_KEY}

    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code != 200:
            return []

        devices = resp.json().get("devices", [])
        pending = []
        for d in devices:
            if d.get("platform") != "TUYA":
                continue
            # Check for pending commands
            cmd_url = f"{API_URL}/api/devices/{d['id']}/command"
            cmd_resp = requests.get(cmd_url, headers=headers, timeout=10)
            if cmd_resp.status_code == 200:
                cmds = cmd_resp.json().get("commands", [])
                for c in cmds:
                    pending.append({
                        "device_id": d["id"],
                        "platform_id": d.get("platformDeviceId"),
                        "command": c["command"],
                        "params": c.get("params"),
                        "command_id": c["id"],
                    })
        return pending
    except Exception as e:
        log.error("Command poll error: %s", e)
        return []


def execute_command(cmd: dict):
    """Execute a command on a Tuya device via Cloud API."""
    platform_id = cmd.get("platform_id")
    command = cmd.get("command")
    params = cmd.get("params") or {}

    # Map statenour commands to Tuya DPS commands
    tuya_commands = []
    if command == "turn_on":
        tuya_commands = [{"code": "switch", "value": True}]
    elif command == "turn_off":
        tuya_commands = [{"code": "switch", "value": False}]
    elif command == "set_temp":
        tuya_commands = [{"code": "temp_set", "value": params.get("temperature", 20)}]
    elif command == "lock":
        tuya_commands = [{"code": "lock", "value": True}]
    elif command == "unlock":
        tuya_commands = [{"code": "lock", "value": False}]
    elif command == "raw":
        tuya_commands = params.get("commands", [])
    else:
        log.warning("Unknown command: %s", command)
        return False

    if not tuya_commands:
        return False

    # Send to Tuya Cloud
    path = f"/v1.0/devices/{platform_id}/commands"
    token = _get_token()
    if not token:
        return False

    body = json.dumps({"commands": tuya_commands})
    headers = {"Content-Type": "application/json"}
    headers = _sign("POST", path, headers, body)

    try:
        resp = requests.post(
            f"{TUYA_ENDPOINT}{path}", headers=headers, data=body, timeout=10
        )
        data = resp.json()
        if data.get("success"):
            log.info("Command executed: %s on %s", command, platform_id)
            return True
        else:
            log.error("Command failed: %s — %s", command, data.get("msg"))
            return False
    except Exception as e:
        log.error("Command execution error: %s", e)
        return False


def ack_command(device_id: str, command_id: str, success: bool, error: str = None):
    """Acknowledge command execution back to statenour-os."""
    url = f"{API_URL}/api/devices/{device_id}/command"
    headers = {
        "Content-Type": "application/json",
        "x-sync-key": SYNC_KEY,
    }
    payload = {
        "commandId": command_id,
        "status": "completed" if success else "failed",
    }
    if error:
        payload["error"] = error

    try:
        resp = requests.patch(url, json=payload, headers=headers, timeout=10)
        if resp.status_code == 200:
            log.info("Acked command %s: %s", command_id, "ok" if success else "fail")
    except Exception as e:
        log.error("Ack error: %s", e)


# ---------- Main Loop ----------

def main():
    """Main polling loop."""
    log.info("=" * 50)
    log.info("Statenour OS — Tuya Agent starting")
    log.info("API: %s", API_URL)
    log.info("Poll interval: %ds", POLL_INTERVAL)
    log.info("Tuya endpoint: %s", TUYA_ENDPOINT)
    log.info("=" * 50)

    if not SYNC_KEY:
        log.error("STATENOUR_SYNC_KEY not set!")
        sys.exit(1)
    if not TUYA_ACCESS_ID:
        log.error("TUYA_ACCESS_ID not set!")
        sys.exit(1)
    if not TUYA_USER_UID:
        log.warning("TUYA_USER_UID not set — device listing may fail")
    else:
        log.info("Tuya user UID: %s", TUYA_USER_UID)

    cycle = 0
    while True:
        cycle += 1
        try:
            log.info("--- Poll cycle %d ---", cycle)

            # 1. Poll Tuya devices
            devices = poll_tuya_devices()
            if devices:
                log.info("Fetched %d Tuya devices", len(devices))
                # 2. Sync to statenour-os
                sync_devices(devices)

            # 3. Check for pending commands (every 3rd cycle to reduce API calls)
            if cycle % 3 == 0:
                commands = poll_commands()
                if commands:
                    log.info("Found %d pending commands", len(commands))
                    for cmd in commands:
                        success = execute_command(cmd)
                        ack_command(
                            cmd["device_id"],
                            cmd["command_id"],
                            success,
                            None if success else "Execution failed",
                        )

        except KeyboardInterrupt:
            log.info("Shutting down...")
            break
        except Exception as e:
            log.error("Cycle error: %s", e, exc_info=True)

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
