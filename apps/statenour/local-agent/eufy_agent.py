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
import subprocess
import time
import uuid
from datetime import datetime, timezone
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

log = logging.getLogger("eufy-agent")

API_URL = os.getenv("STATENOUR_API_URL", "https://bdnick.info")
SYNC_KEY = os.getenv("STATENOUR_SYNC_KEY", "")
EUFY_EMAIL = os.getenv("EUFY_EMAIL", "")
EUFY_PASSWORD = os.getenv("EUFY_PASSWORD", "")
EUFY_BRIDGE_URL = os.getenv("EUFY_BRIDGE_URL", "").strip()
EUFY_OFFICE_CAMERA_SERIAL = os.getenv(
    "EUFY_OFFICE_CAMERA_SERIAL",
    "T8410P522517180B",
).strip()

# Optional cross-app operational heartbeat. Deliberately requires a SEPARATE Nick's
# ingest key instead of reusing STATENOUR_SYNC_KEY.
NICKS_CAMERA_HEARTBEAT_URL = os.getenv("NICKS_CAMERA_HEARTBEAT_URL", "").strip()
NICKS_CAMERA_INGEST_KEY = os.getenv("NICKS_CAMERA_INGEST_KEY", "").strip()
NICKS_OFFICE_CAMERA_ID = os.getenv("NICKS_OFFICE_CAMERA_ID", "office").strip() or "office"
EUFY_HOME_POSE_RECEIPT = os.getenv("EUFY_HOME_POSE_RECEIPT", "").strip()
EUFY_HOME_REFERENCE_SHA256 = os.getenv("EUFY_HOME_REFERENCE_SHA256", "").strip().lower()
EUFY_HOME_VERIFY_PYTHON = os.getenv("EUFY_HOME_VERIFY_PYTHON", "").strip()
EUFY_HOME_VERIFY_SCRIPT = os.getenv("EUFY_HOME_VERIFY_SCRIPT", "").strip()
EUFY_HOME_REFERENCE = os.getenv("EUFY_HOME_REFERENCE", "").strip()
EUFY_HOME_MEDIA_URL = os.getenv("EUFY_HOME_MEDIA_URL", "").strip()
try:
    EUFY_HOME_POSE_MAX_AGE_SECONDS = max(
        1.0,
        float(os.getenv("EUFY_HOME_POSE_MAX_AGE_SECONDS", "300")),
    )
except ValueError:
    EUFY_HOME_POSE_MAX_AGE_SECONDS = 300.0
try:
    EUFY_HOME_VERIFY_TIMEOUT_SECONDS = max(
        5.0,
        float(os.getenv("EUFY_HOME_VERIFY_TIMEOUT_SECONDS", "25")),
    )
except ValueError:
    EUFY_HOME_VERIFY_TIMEOUT_SECONDS = 25.0
try:
    EUFY_HOME_VERIFY_COOLDOWN_SECONDS = max(
        10.0,
        float(os.getenv("EUFY_HOME_VERIFY_COOLDOWN_SECONDS", "60")),
    )
except ValueError:
    EUFY_HOME_VERIFY_COOLDOWN_SECONDS = 60.0
_OFFICE_PRODUCER_INSTANCE_ID = uuid.uuid4().hex
_office_heartbeat_seq = 0
_last_home_verify_monotonic = 0.0

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


# ─── Bridge-backed device sync ───────────────────────────────────────────

def _normalize_bridge_devices(bridge_devices: list) -> list:
    """Convert current mega-yfue bridge device summaries to StateNour shape."""
    devices = []
    for dev in bridge_devices:
        if not isinstance(dev, dict) or dev.get("error"):
            continue
        serial = str(dev.get("sn") or "").strip()
        if not serial:
            continue

        capabilities = dev.get("capabilities") if isinstance(dev.get("capabilities"), list) else []
        state = dev.get("state") if isinstance(dev.get("state"), dict) else {}
        codec = str(dev.get("codec") or "").lower()
        is_camera = codec == "camera" or "camera" in capabilities or "video" in capabilities

        devices.append({
            "platformDeviceId": f"eufy-{serial}",
            "name": dev.get("name") or dev.get("modelName") or "Eufy Device",
            "platform": "EUFY",
            "deviceType": "CAMERA" if is_camera else "OTHER",
            "location": _infer_eufy_location(str(dev.get("name") or dev.get("modelName") or "")),
            "status": "ONLINE",
            "currentState": {
                **state,
                "streaming": bool(dev.get("streaming", False)),
            },
            "metadata": {
                "model": dev.get("model") or dev.get("modelName"),
                "modelName": dev.get("modelName"),
                "serial": serial,
                "capabilities": capabilities,
                "stream": dev.get("stream"),
                "controlPlane": "mega-yfue-bridge",
            },
        })
    return devices


def _poll_bridge_devices() -> list | None:
    """
    Prefer the single authenticated bridge session when configured.

    IMPORTANT: do not fall through to direct Eufy cloud login when a bridge URL
    exists. Eufy allows effectively one active account session; an independent
    login here can kick the PTZ/event bridge into re-auth.
    """
    if not EUFY_BRIDGE_URL:
        return None
    try:
        from eufy_bridge import list_devices
        devices = _normalize_bridge_devices(list_devices())
        if devices:
            log.info("Eufy bridge: %d devices (live)", len(devices))
            return devices
        raise RuntimeError("Eufy bridge returned no usable devices")
    except Exception as exc:
        # Fail closed. Returning the static registry here would cause the
        # sync route to stamp lastSeenAt=now and make an unreachable camera
        # look freshly observed. Static discovery is only a legacy fallback
        # when NO bridge has been configured.
        log.error("Eufy bridge unavailable: %s", exc)
        raise


# ─── Nick's operational heartbeat ────────────────────────────────────────

def _next_office_heartbeat_seq() -> int:
    global _office_heartbeat_seq
    _office_heartbeat_seq += 1
    return _office_heartbeat_seq


def _parse_utc_timestamp(value) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def load_home_pose_receipt(
    *,
    last_ptz_notify_at: str | None,
    now: datetime | None = None,
) -> bool | None:
    """Return a fresh visual home verdict, or None when no current proof exists.

    The receipt is produced by camera-bridge's SceneLock-based verifier. It is accepted
    only for the configured office serial, within the TTL, and AFTER the latest ptzNotify.
    That last comparison is load-bearing: an old home=true image must become irrelevant
    the instant the camera physically moves again.
    """
    if not EUFY_HOME_POSE_RECEIPT:
        return None
    path = Path(EUFY_HOME_POSE_RECEIPT)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    if str(payload.get("serial") or "").strip() != EUFY_OFFICE_CAMERA_SERIAL:
        return None
    if str(payload.get("verifierVersion") or "") != "office-home-pose-v1":
        return None
    # Home truth is meaningful only relative to the exact approved reference image.
    # Empty config intentionally disables promotion rather than trusting any local file.
    reference_hash = str(payload.get("referenceSha256") or "").strip().lower()
    if (
        len(EUFY_HOME_REFERENCE_SHA256) != 64
        or reference_hash != EUFY_HOME_REFERENCE_SHA256
    ):
        return None
    verdict = payload.get("isHome")
    if not isinstance(verdict, bool):
        return None

    verified = _parse_utc_timestamp(payload.get("verifiedAt"))
    if verified is None:
        return None
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    current = current.astimezone(timezone.utc)
    age = (current - verified).total_seconds()
    if age < -5.0 or age > EUFY_HOME_POSE_MAX_AGE_SECONDS:
        return None

    notified = _parse_utc_timestamp(last_ptz_notify_at)
    if notified is not None and verified < notified:
        return None
    return verdict


def maybe_verify_home_pose(runtime_health: dict) -> bool | None:
    """Run the heavy visual verifier only when absolute home is currently unknown.

    The StateNour agent stays dependency-light: image capture/OpenCV run in the configured
    camera-bridge Python process. A non-zero verifier infrastructure exit never mutates
    health; a valid home/away receipt is re-read through the same serial/hash/time gates.
    """
    global _last_home_verify_monotonic

    current = load_home_pose_receipt(
        last_ptz_notify_at=runtime_health.get("lastPtzNotifyAt"),
    )
    if current is not None:
        return current
    if runtime_health.get("ptzHomeOk") is not None:
        return runtime_health.get("ptzHomeOk")
    if not runtime_health.get("lastPtzNotifyAt"):
        return None
    if runtime_health.get("mediaPlaneOk") is False:
        return None

    required = (
        EUFY_HOME_VERIFY_PYTHON,
        EUFY_HOME_VERIFY_SCRIPT,
        EUFY_HOME_REFERENCE,
        EUFY_HOME_MEDIA_URL,
        EUFY_HOME_POSE_RECEIPT,
        EUFY_HOME_REFERENCE_SHA256,
    )
    if not all(required):
        return None

    now_mono = time.monotonic()
    if (
        _last_home_verify_monotonic > 0
        and now_mono - _last_home_verify_monotonic < EUFY_HOME_VERIFY_COOLDOWN_SECONDS
    ):
        return None
    _last_home_verify_monotonic = now_mono

    args = [
        EUFY_HOME_VERIFY_PYTHON,
        EUFY_HOME_VERIFY_SCRIPT,
        "--serial",
        EUFY_OFFICE_CAMERA_SERIAL,
        "--reference",
        EUFY_HOME_REFERENCE,
        "--rtsp-url",
        EUFY_HOME_MEDIA_URL,
        "--receipt",
        EUFY_HOME_POSE_RECEIPT,
    ]
    try:
        proc = subprocess.run(
            args,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=EUFY_HOME_VERIFY_TIMEOUT_SECONDS,
            text=True,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        log.warning("office home-pose verifier unavailable: %s", exc)
        return None

    if proc.returncode not in (0, 1):
        detail = (proc.stderr or "").strip()
        if len(detail) > 240:
            detail = detail[-240:]
        log.warning(
            "office home-pose verifier could not decide (exit=%s)%s",
            proc.returncode,
            f": {detail}" if detail else "",
        )
        return None

    return load_home_pose_receipt(
        last_ptz_notify_at=runtime_health.get("lastPtzNotifyAt"),
    )


def build_office_camera_heartbeat(
    *,
    auth_ok: bool,
    runtime_health: dict,
    seq: int,
    observed_at: datetime | None = None,
) -> dict:
    """
    Compile one Nick's camera-runtime heartbeat.

    Missing transport values stay omitted/null. False stays false. The Nick's health
    lattice decides whether the interaction camera is degraded or merely unverified.
    """
    at = observed_at or datetime.now(timezone.utc)
    payload = {
        "camera": NICKS_OFFICE_CAMERA_ID,
        "producerInstanceId": _OFFICE_PRODUCER_INSTANCE_ID,
        "producerVersion": "statenour.eufy_agent",
        "heartbeatSeq": seq,
        "observedAtEdge": at.isoformat(),
        "mode": "SHADOW",
        "sourceType": "eufy_sdk_bridge",
        "sourceGeneration": EUFY_OFFICE_CAMERA_SERIAL,
        "sourceConnected": auth_ok,
        "detectorName": "eufy-semantic-events",
        "authPlaneOk": auth_ok,
    }

    for key in (
        "eventPlaneOk",
        "controlPlaneOk",
        "mediaPlaneOk",
        "ptzHomeOk",
        "lastEventProofAt",
        "lastControlProofAt",
        "lastMediaProofAt",
        "lastPtzNotifyAt",
    ):
        value = runtime_health.get(key)
        if value is not None:
            payload[key] = value
    return payload


def sync_office_camera_heartbeat() -> int:
    """
    Send one role-aware office camera heartbeat to Nick's.

    This is intentionally independent of the slower full Eufy device sync so Nick's
    30/60/120-second health SLO sees the local agent every cycle. It is inert until BOTH
    URL and key are configured, and a failed Nick's write never changes Eufy device state.
    """
    if not NICKS_CAMERA_HEARTBEAT_URL or not NICKS_CAMERA_INGEST_KEY:
        return 0

    from eufy_bridge import bridge_ready, probe_office_media_health, runtime_health_snapshot

    auth_ok, _reason = bridge_ready()
    if auth_ok:
        # Bounded/throttled real media open. A 5xx/P2P timeout is negative evidence;
        # a real H264 byte read is positive proof. The probe self-throttles.
        probe_office_media_health()
    runtime = runtime_health_snapshot(auth_ok=auth_ok)
    visual_home = maybe_verify_home_pose(runtime)
    if visual_home is not None:
        runtime["ptzHomeOk"] = visual_home
    payload = build_office_camera_heartbeat(
        auth_ok=auth_ok,
        runtime_health=runtime,
        seq=_next_office_heartbeat_seq(),
    )
    resp = requests.post(
        NICKS_CAMERA_HEARTBEAT_URL,
        json=payload,
        headers={
            "x-sync-key": NICKS_CAMERA_INGEST_KEY,
            "Content-Type": "application/json",
        },
        timeout=10,
    )
    if resp.status_code >= 400:
        raise RuntimeError(
            f"Nick's office camera heartbeat failed ({resp.status_code}): {resp.text[:200]}"
        )
    log.debug("Nick's office camera heartbeat accepted: %s", resp.text[:120])
    return 1


# ─── Main Sync Function ──────────────────────────────────────────────────

def poll_eufy_devices():
    """
    Poll Eufy devices. Strategy:
    1. Try cloud API with cached token
    2. Try fresh login (may fail on captcha)
    3. Fall back to known device registry
    """
    # If the bridge is configured it is the ONLY authenticated Eufy session.
    # Empty bridge result means temporary failure: use the static registry, not
    # a second cloud login that could invalidate the bridge session.
    bridge_devices = _poll_bridge_devices()
    if bridge_devices is not None:
        return bridge_devices

    # Legacy path for installations that have no bridge configured.
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
