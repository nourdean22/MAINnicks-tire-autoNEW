#!/usr/bin/env python3
"""
Statenour OS — Eufy Security Agent
Syncs Eufy Security cameras and sensors to statenour-os dashboard.

Strategy:
1. Try Eufy cloud REST API with stored session token (fast, real-time status)
2. Fall back to known device registry (guaranteed sync, static status)

Known devices scraped from mysecurity.eufylife.com on 2026-03-26:
  - Solar Wall Light Cam  (T81A0P10250205C5) — type 10005, outdoor solar cam
  - NICKS EUCLID          (T8410P5225154105) — type 31, operational office indoor cam
  - Moes Euclid Office    (T8410P522517180B) — legacy shared camera; NOT production Office
  - SIDE DOOR             (T8502K1025071702) — type 180, entry sensor
  - Front Door            (T8502K1025090456) — type 180, entry sensor
"""

import os
import sys
import json
import logging
import hashlib
import subprocess
import threading
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
    "T8410P5225154105",
).strip()

# Optional cross-app operational heartbeat. Deliberately requires a SEPARATE Nick's
# ingest key instead of reusing STATENOUR_SYNC_KEY.
NICKS_CAMERA_HEARTBEAT_URL = os.getenv("NICKS_CAMERA_HEARTBEAT_URL", "").strip()
NICKS_CAMERA_INGEST_KEY = os.getenv("NICKS_CAMERA_INGEST_KEY", "").strip()
NICKS_OFFICE_CAMERA_ID = os.getenv("NICKS_OFFICE_CAMERA_ID", "office").strip() or "office"
NICKS_OFFICE_CAMERA_MODE = (
    os.getenv("NICKS_OFFICE_CAMERA_MODE", "PRODUCTION").strip().upper() or "PRODUCTION"
)
OFFICE_CONVERSATION_STATUS_PATH = os.getenv("OFFICE_CONVERSATION_STATUS_PATH", "").strip()
try:
    OFFICE_CONVERSATION_STATUS_MAX_AGE_SECONDS = max(
        30.0,
        float(os.getenv("OFFICE_CONVERSATION_STATUS_MAX_AGE_SECONDS", "120")),
    )
except ValueError:
    OFFICE_CONVERSATION_STATUS_MAX_AGE_SECONDS = 120.0
if NICKS_OFFICE_CAMERA_MODE not in {"PRODUCTION", "SHADOW", "COMMISSIONING"}:
    raise RuntimeError(
        "NICKS_OFFICE_CAMERA_MODE must be PRODUCTION, SHADOW, or COMMISSIONING"
    )
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

# Absolute-home promotion is approved only under THESE thresholds. The verifier writes
# its thresholds into the receipt and this consumer recomputes the verdict from measured
# values, so an alternate/manual invocation cannot loosen the gate and still be trusted.
try:
    EUFY_HOME_MAX_SHIFT_PX = max(
        0.1,
        float(os.getenv("EUFY_HOME_MAX_SHIFT_PX", "6.0")),
    )
except ValueError:
    EUFY_HOME_MAX_SHIFT_PX = 6.0
try:
    EUFY_HOME_MIN_CORRELATION_RESPONSE = min(
        1.0,
        max(0.01, float(os.getenv("EUFY_HOME_MIN_CORRELATION_RESPONSE", "0.20"))),
    )
except ValueError:
    EUFY_HOME_MIN_CORRELATION_RESPONSE = 0.20
try:
    EUFY_HOME_MAX_CHANGED_FRACTION = min(
        1.0,
        max(0.0, float(os.getenv("EUFY_HOME_MAX_CHANGED_FRACTION", "0.65"))),
    )
except ValueError:
    EUFY_HOME_MAX_CHANGED_FRACTION = 0.65

_OFFICE_PRODUCER_INSTANCE_ID = f"p2-nicksmax-{uuid.uuid4().hex}"
_office_heartbeat_seq = 0
_last_home_verify_monotonic = 0.0
_HOME_VERIFY_LOCK = threading.Lock()
_home_verify_thread: threading.Thread | None = None

# camera_runtime fields authored by THIS producer rather than the fixed camera-bridge
# producer. Kept as a literal tuple so the cross-app heartbeat contract can inspect the
# real producer without importing StateNour's optional smart-home dependencies.
INTERACTION_HEARTBEAT_FIELDS = (
    "authPlaneOk",
    "eventPlaneOk",
    "controlPlaneOk",
    "mediaPlaneOk",
    "ptzHomeOk",
    "lastEventProofAt",
    "lastControlProofAt",
    "lastMediaProofAt",
    "lastPtzNotifyAt",
    "conversationWorkerOk",
    "conversationWorkerState",
    "conversationWorkerHeartbeatAt",
    "conversationAudioSource",
    "conversationCaptureHost",
    "conversationSttEngine",
    "conversationQueueDepth",
    "conversationLastTrigger",
    "lastConversationEventAt",
    "lastConversationCaptureAt",
    "lastConversationSttAt",
    "lastConversationPostAt",
    "lastConversationSummaryAt",
    "lastConversationCoverage",
    "conversationFailuresToday",
    "conversationLastError",
    # 2026-10-07 - what the last hour of LISTENING looked like (officewake.py window counters,
    # nickstire migration 0143). Forwarded only when present, so an older worker receipt sends
    # nothing and the shop stores NULL ("not reported"), never a confident zero.
    "conversationListeningCoverage60m",
    "conversationCaptureSecondsLast60m",
    "conversationCapturesLast60m",
    "conversationCaptureFailuresLast60m",
    "conversationWakeTriggersLast60m",
    "conversationTranscribeBacklog",
)

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
        "name": "NICKS EUCLID",
        "platform": "EUFY",
        "deviceType": "CAMERA",
        "location": "office",
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


def _finite_float(payload: dict, key: str) -> float | None:
    try:
        value = float(payload.get(key))
    except (TypeError, ValueError):
        return None
    return value if value == value and value not in (float("inf"), float("-inf")) else None


def load_home_pose_receipt(
    *,
    last_ptz_notify_at: str | None,
    now: datetime | None = None,
) -> bool | None:
    """Return a CURRENT-PROCESS visual home verdict, or None when proof is incomplete.

    A persisted receipt can outlive the agent process. Therefore it is NEVER accepted
    until this process has observed a ptzNotify. The receipt's evidenceAt is the capture
    time, not verification completion, and must be at/after the newest motor receipt.

    The consumer also pins the approved verifier thresholds and recomputes the boolean
    from the measured shift/correlation/change values. Trust does not flow from a receipt's
    self-asserted isHome bit.
    """
    if not last_ptz_notify_at:
        # Process restart resets bridge runtime. Without a motor receipt observed by THIS
        # process we cannot know whether the camera moved while the agent was down.
        return None
    notified = _parse_utc_timestamp(last_ptz_notify_at)
    if notified is None or not EUFY_HOME_POSE_RECEIPT:
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
    if str(payload.get("verifierVersion") or "") != "office-home-pose-v2":
        return None

    reference_hash = str(payload.get("referenceSha256") or "").strip().lower()
    if (
        len(EUFY_HOME_REFERENCE_SHA256) != 64
        or reference_hash != EUFY_HOME_REFERENCE_SHA256
    ):
        return None

    evidence = _parse_utc_timestamp(payload.get("evidenceAt"))
    verified = _parse_utc_timestamp(payload.get("verifiedAt"))
    if evidence is None or verified is None or verified < evidence:
        return None

    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    current = current.astimezone(timezone.utc)
    age = (current - evidence).total_seconds()
    if age < -5.0 or age > EUFY_HOME_POSE_MAX_AGE_SECONDS:
        return None
    if evidence < notified:
        return None

    pose_shift = _finite_float(payload, "poseShiftPx")
    correlation = _finite_float(payload, "correlationResponse")
    changed = _finite_float(payload, "changedFraction")
    receipt_max_shift = _finite_float(payload, "maxShiftPx")
    receipt_min_corr = _finite_float(payload, "minCorrelationResponse")
    receipt_max_changed = _finite_float(payload, "maxChangedFraction")
    if None in (
        pose_shift,
        correlation,
        changed,
        receipt_max_shift,
        receipt_min_corr,
        receipt_max_changed,
    ):
        return None

    # Thresholds are part of the approved reference contract, not caller-controlled policy.
    if abs(receipt_max_shift - EUFY_HOME_MAX_SHIFT_PX) > 1e-6:
        return None
    if abs(receipt_min_corr - EUFY_HOME_MIN_CORRELATION_RESPONSE) > 1e-6:
        return None
    if abs(receipt_max_changed - EUFY_HOME_MAX_CHANGED_FRACTION) > 1e-6:
        return None

    computed_home = bool(
        pose_shift <= EUFY_HOME_MAX_SHIFT_PX
        and correlation >= EUFY_HOME_MIN_CORRELATION_RESPONSE
        and changed <= EUFY_HOME_MAX_CHANGED_FRACTION
    )
    declared = payload.get("isHome")
    if not isinstance(declared, bool) or declared != computed_home:
        return None
    return computed_home

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
        "--rtsp-env",
        "EUFY_HOME_MEDIA_URL",
        "--receipt",
        EUFY_HOME_POSE_RECEIPT,
        "--max-shift-px",
        str(EUFY_HOME_MAX_SHIFT_PX),
        "--min-correlation-response",
        str(EUFY_HOME_MIN_CORRELATION_RESPONSE),
        "--max-changed-fraction",
        str(EUFY_HOME_MAX_CHANGED_FRACTION),
    ]
    child_env = {
        key: value
        for key, value in os.environ.items()
        if key.upper() in {
            "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP",
            "LOCALAPPDATA", "APPDATA", "USERPROFILE",
        }
    }
    child_env["EUFY_HOME_MEDIA_URL"] = EUFY_HOME_MEDIA_URL

    try:
        proc = subprocess.run(
            args,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=EUFY_HOME_VERIFY_TIMEOUT_SECONDS,
            text=True,
            env=child_env,
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

    # Re-read bridge runtime AFTER the verifier returns. A new ptzNotify may have
    # arrived while capture/registration was running; accepting against the pre-run
    # snapshot would let pre-move pixels overwrite that invalidation.
    try:
        from eufy_bridge import runtime_health_snapshot
        fresh = runtime_health_snapshot()
    except Exception:
        fresh = {}
    return load_home_pose_receipt(
        last_ptz_notify_at=fresh.get("lastPtzNotifyAt"),
    )


def schedule_home_pose_verification(runtime_health: dict) -> bool:
    """Launch at most one visual verifier in the background; heartbeat never waits for it."""
    global _home_verify_thread
    if not runtime_health.get("lastPtzNotifyAt"):
        return False
    if runtime_health.get("ptzHomeOk") is not None:
        return False
    if runtime_health.get("mediaPlaneOk") is False:
        return False

    with _HOME_VERIFY_LOCK:
        if _home_verify_thread is not None and _home_verify_thread.is_alive():
            return False

        snapshot = dict(runtime_health)

        def _worker() -> None:
            try:
                maybe_verify_home_pose(snapshot)
            except Exception as exc:  # noqa: BLE001 - background worker must not kill agent
                log.warning("office home-pose verifier worker failed: %s", exc)

        _home_verify_thread = threading.Thread(
            target=_worker,
            name="eufy-home-pose-verifier",
            daemon=True,
        )
        _home_verify_thread.start()
        return True


def load_office_conversation_runtime(*, now: float | None = None) -> dict:
    """Read the OfficeWake current-state receipt without creating another cloud producer.

    Empty path means the conversation worker is not commissioned on this host yet, so legacy
    agents omit these facets. Once a path is configured, missing/unreadable/stale is negative
    evidence and must be reported as such rather than disappearing from Admin.
    """
    if not OFFICE_CONVERSATION_STATUS_PATH:
        return {}

    path = Path(OFFICE_CONVERSATION_STATUS_PATH)
    current = float(time.time() if now is None else now)
    if not path.exists():
        return {
            "conversationWorkerOk": False,
            "conversationWorkerState": "MISSING",
            "conversationLastError": "conversation worker status receipt is missing",
        }

    try:
        stat = path.stat()
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError("status receipt is not a JSON object")
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return {
            "conversationWorkerOk": False,
            "conversationWorkerState": "ERROR",
            "conversationLastError": f"conversation status unreadable: {exc}"[:500],
        }

    allowed = {
        "conversationWorkerOk",
        "conversationWorkerState",
        "conversationWorkerHeartbeatAt",
        "conversationAudioSource",
        "conversationCaptureHost",
        "conversationSttEngine",
        "conversationQueueDepth",
        "conversationLastTrigger",
        "lastConversationEventAt",
        "lastConversationCaptureAt",
        "lastConversationSttAt",
        "lastConversationPostAt",
        "lastConversationSummaryAt",
        "lastConversationCoverage",
        "conversationFailuresToday",
        "conversationLastError",
        "conversationListeningCoverage60m",
        "conversationCaptureSecondsLast60m",
        "conversationCapturesLast60m",
        "conversationCaptureFailuresLast60m",
        "conversationWakeTriggersLast60m",
        "conversationTranscribeBacklog",
    }
    out = {key: raw[key] for key in allowed if key in raw and raw[key] is not None}
    age = max(0.0, current - float(stat.st_mtime))
    if age > OFFICE_CONVERSATION_STATUS_MAX_AGE_SECONDS:
        out["conversationWorkerOk"] = False
        out["conversationWorkerState"] = "STALE"
        out["conversationLastError"] = (
            f"conversation worker status stale for {age:.0f}s "
            f"(limit {OFFICE_CONVERSATION_STATUS_MAX_AGE_SECONDS:.0f}s)"
        )[:500]
    return out


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
        "mode": NICKS_OFFICE_CAMERA_MODE,
        "sourceType": "eufy_sdk_bridge",
        "sourceGeneration": EUFY_OFFICE_CAMERA_SERIAL,
        "sourceConnected": auth_ok,
        "detectorName": "eufy-semantic-events",
    }

    interaction_values = {"authPlaneOk": auth_ok, **runtime_health}
    for key in INTERACTION_HEARTBEAT_FIELDS:
        value = interaction_values.get(key)
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
    # OfficeWake never writes camera_runtime directly. Fold its atomic local receipt into this
    # already-authoritative Office heartbeat so one producer instance owns the whole card.
    runtime.update(load_office_conversation_runtime())

    # Heartbeat publishes immediately from current proof. The potentially 25s visual
    # verifier runs separately and can only affect a later heartbeat through its receipt.
    visual_home = load_home_pose_receipt(
        last_ptz_notify_at=runtime.get("lastPtzNotifyAt"),
    )
    if visual_home is not None:
        runtime["ptzHomeOk"] = visual_home
    schedule_home_pose_verification(runtime)

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
