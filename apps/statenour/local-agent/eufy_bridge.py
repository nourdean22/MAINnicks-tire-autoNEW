#!/usr/bin/env python3
"""
StateNour local client for the current mega-yfue Eufy SDK bridge.

The bridge owns the single Eufy login/session. This module deliberately does NOT
log in to Eufy itself when the bridge is configured: duplicate clients can kick
each other's session and turn a working camera into a 2FA/captcha loop.

Responsibilities:
- read capability-gated device state from the bridge
- execute queued StateNour Eufy controls (PTZ today)
- forward semantic motion/person/PTZ events to StateNour's vision-event ledger

PTZ truth rule: bridge device.action is fire-and-forget. A successful command
means the P2P frame left for the camera, not that the motor finished. Completion
evidence arrives later as an unsolicited ptzNotify event and is stored separately.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

import requests
import websockets
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")

log = logging.getLogger("eufy-bridge")

API_URL = os.getenv("STATENOUR_API_URL", "https://bdnick.info").rstrip("/")
SYNC_KEY = os.getenv("STATENOUR_SYNC_KEY", "")
BRIDGE_URL = os.getenv("EUFY_BRIDGE_URL", "").strip()
CONTROL_ENABLED = os.getenv("EUFY_CONTROL_ENABLED", "0") == "1"
EVENTS_ENABLED = os.getenv("EUFY_EVENTS_ENABLED", "1") == "1"
OFFICE_CAMERA_SERIAL = os.getenv(
    "EUFY_OFFICE_CAMERA_SERIAL",
    "T8410P522517180B",
).strip()
_EVENT_FILTER_RAW = os.getenv("EUFY_EVENT_DEVICE_SNS")
_EVENT_FILTER = {
    value.strip()
    for value in (
        _EVENT_FILTER_RAW
        if _EVENT_FILTER_RAW is not None
        else OFFICE_CAMERA_SERIAL
    ).split(",")
    if value.strip()
}

PTZ_DIRECTIONS = frozenset({"left", "right", "up", "down"})
FORWARDED_EVENTS = frozenset({
    "motion",
    "personDetected",
    "vehicleDetected",
    "soundDetected",
    "ptzNotify",
    "streamState",
})


class EufyBridgeError(RuntimeError):
    """Bridge is unavailable, unauthenticated, or rejected a capability action."""


async def _request_async(payload: dict[str, Any], timeout_s: float = 10.0) -> dict[str, Any]:
    if not BRIDGE_URL:
        raise EufyBridgeError("EUFY_BRIDGE_URL is not configured")

    request_id = str(payload.get("id") or uuid.uuid4().hex)
    frame = {**payload, "id": request_id}

    try:
        async with websockets.connect(
            BRIDGE_URL,
            open_timeout=timeout_s,
            close_timeout=2,
            ping_interval=None,
            max_size=2 * 1024 * 1024,
        ) as ws:
            await ws.send(json.dumps(frame))
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=timeout_s)
                reply = json.loads(raw)
                # hello/auth/ready/events are unsolicited and intentionally have no id.
                if str(reply.get("id", "")) != request_id:
                    continue
                if not reply.get("ok"):
                    raise EufyBridgeError(str(reply.get("error") or "bridge command failed"))
                return reply
    except EufyBridgeError:
        raise
    except Exception as exc:
        raise EufyBridgeError(
            f"bridge unavailable: {type(exc).__name__}: {exc}"
        ) from exc


def request(payload: dict[str, Any], timeout_s: float = 10.0) -> dict[str, Any]:
    """Synchronous boundary for the existing synchronous local-agent loop."""
    return asyncio.run(_request_async(payload, timeout_s=timeout_s))


def auth_status() -> str:
    if not BRIDGE_URL:
        return "unconfigured"
    reply = request({"cmd": "auth.status"})
    auth = reply.get("auth") or {}
    return str(auth.get("state") or "unknown")


def bridge_ready() -> tuple[bool, str]:
    if not BRIDGE_URL:
        return False, "EUFY_BRIDGE_URL not configured"
    try:
        state = auth_status()
    except EufyBridgeError as exc:
        return False, str(exc)
    return state == "ok", f"auth={state}"


def list_devices() -> list[dict[str, Any]]:
    reply = request({"cmd": "devices.list"})
    devices = reply.get("devices")
    if not isinstance(devices, list):
        raise EufyBridgeError("devices.list returned no device list")
    return [d for d in devices if isinstance(d, dict)]


def device_state(serial: str) -> dict[str, Any]:
    reply = request({"cmd": "device.state", "sn": serial})
    device = reply.get("device")
    if not isinstance(device, dict):
        raise EufyBridgeError("device.state returned no device")
    return device


def serial_from_platform_id(platform_device_id: str) -> str:
    raw = platform_device_id.strip()
    return raw[5:] if raw.lower().startswith("eufy-") else raw


def _require_ptz(serial: str) -> dict[str, Any]:
    device = device_state(serial)
    capabilities = device.get("capabilities")
    if not isinstance(capabilities, list) or "ptz" not in capabilities:
        model = device.get("model") or "unknown"
        raise EufyBridgeError(
            f"device {serial} ({model}) does not report PTZ capability"
        )
    return device


def _ptz_action(serial: str, action: str, args: list[Any] | None = None) -> dict[str, Any]:
    _require_ptz(serial)
    payload: dict[str, Any] = {
        "cmd": "device.action",
        "sn": serial,
        "action": action,
    }
    if args:
        payload["args"] = args
    return request(payload)


def execute_command(command: dict[str, Any]) -> dict[str, Any]:
    """
    Execute one StateNour DeviceCommand through the bridge.

    Supported command vocabulary:
      ptz + {direction:left|right|up|down}
      ptz_rotate + same params
      ptz_left / ptz_right / ptz_up / ptz_down
      ptz_preset + {id:<positive integer>}
    """
    name = str(command.get("command") or "").strip().lower()
    params = command.get("params") or {}
    if not isinstance(params, dict):
        raise EufyBridgeError("command params must be an object")

    device = command.get("device") or {}
    if not isinstance(device, dict):
        raise EufyBridgeError("command is missing device metadata")
    serial = serial_from_platform_id(str(device.get("platformDeviceId") or ""))
    if not serial:
        raise EufyBridgeError("command device is missing platformDeviceId")

    if name.startswith("ptz_") and name.removeprefix("ptz_") in PTZ_DIRECTIONS:
        direction = name.removeprefix("ptz_")
        reply = _ptz_action(serial, direction)
        return {
            "ptzCommand": "sent",
            "direction": direction,
            "verified": False,
            "bridgeResult": reply.get("result"),
        }

    if name in {"ptz", "ptz_rotate"}:
        direction = str(params.get("direction") or "").strip().lower()
        if direction not in PTZ_DIRECTIONS:
            raise EufyBridgeError(
                f"invalid PTZ direction {direction!r}; expected one of {sorted(PTZ_DIRECTIONS)}"
            )
        reply = _ptz_action(serial, direction)
        return {
            "ptzCommand": "sent",
            "direction": direction,
            "verified": False,
            "bridgeResult": reply.get("result"),
        }

    if name == "ptz_preset":
        try:
            preset_id = int(params.get("id"))
        except (TypeError, ValueError) as exc:
            raise EufyBridgeError("ptz_preset requires integer params.id") from exc
        if preset_id < 0:
            raise EufyBridgeError("ptz_preset params.id must be non-negative")
        reply = _ptz_action(serial, "preset.goto", [preset_id])
        return {
            "ptzCommand": "sent",
            "presetId": preset_id,
            "verified": False,
            "bridgeResult": reply.get("result"),
        }

    raise EufyBridgeError(f"unsupported Eufy command {name!r}")


def control_ready() -> tuple[bool, str]:
    if not CONTROL_ENABLED:
        return False, "EUFY_CONTROL_ENABLED is not 1"
    if not SYNC_KEY:
        return False, "STATENOUR_SYNC_KEY not configured"
    return bridge_ready()


def poll_commands(limit: int = 10) -> list[dict[str, Any]]:
    """
    Claim EUFY commands ONLY when execution is actually available.

    /api/devices/queue marks claimed rows sent. Calling it while the bridge is down
    would strand work, so readiness is checked before the GET.
    """
    ready, reason = control_ready()
    if not ready:
        log.debug("Eufy control queue not claimed: %s", reason)
        return []

    try:
        resp = requests.get(
            f"{API_URL}/api/devices/queue",
            params={"platform": "EUFY", "limit": max(1, min(20, limit))},
            headers={"x-sync-key": SYNC_KEY},
            timeout=10,
        )
        resp.raise_for_status()
        body = resp.json()
        commands = body.get("commands") or []
        return [c for c in commands if isinstance(c, dict)]
    except Exception as exc:
        raise EufyBridgeError(f"command queue fetch failed: {exc}") from exc


def ack_command(
    command_id: str,
    *,
    success: bool,
    result_state: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    if not SYNC_KEY:
        raise EufyBridgeError("STATENOUR_SYNC_KEY not configured")
    payload: dict[str, Any] = {"status": "acked" if success else "failed"}
    if result_state is not None:
        payload["resultState"] = result_state
    if error:
        payload["error"] = error[:500]

    resp = requests.patch(
        f"{API_URL}/api/devices/command/{command_id}",
        json=payload,
        headers={"x-sync-key": SYNC_KEY, "Content-Type": "application/json"},
        timeout=10,
    )
    if resp.status_code >= 400:
        raise EufyBridgeError(
            f"command ack failed ({resp.status_code}): {resp.text[:200]}"
        )


def process_pending_commands() -> int:
    commands = poll_commands()
    for command in commands:
        command_id = str(command.get("id") or "")
        if not command_id:
            log.error("Eufy queue returned command without id: %r", command)
            continue
        try:
            result = execute_command(command)
            ack_command(command_id, success=True, result_state=result)
            log.info("Eufy command %s acked: %s", command_id, command.get("command"))
        except Exception as exc:
            message = str(exc)
            try:
                ack_command(command_id, success=False, error=message)
            except Exception as ack_exc:
                log.error("Eufy command %s failed AND ack failed: %s", command_id, ack_exc)
            else:
                log.error("Eufy command %s failed: %s", command_id, message)
    return len(commands)


def _should_forward_event(event: dict[str, Any]) -> bool:
    name = str(event.get("event") or "")
    if name not in FORWARDED_EVENTS:
        return False
    serial = str(event.get("deviceSn") or "")
    return not _EVENT_FILTER or serial in _EVENT_FILTER


def _forward_event(event: dict[str, Any]) -> None:
    if not SYNC_KEY:
        raise EufyBridgeError("STATENOUR_SYNC_KEY not configured")
    serial = str(event.get("deviceSn") or event.get("stationSn") or "eufy")
    payload = {
        "module": "vision",
        "data": {
            "events": [{
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "event": f"eufy.{event.get('event')}",
                "camera": serial,
                "data": event,
            }]
        },
    }
    resp = requests.post(
        f"{API_URL}/api/sync/nour-os",
        json=payload,
        headers={"x-sync-key": SYNC_KEY, "Content-Type": "application/json"},
        timeout=10,
    )
    if resp.status_code >= 400:
        raise EufyBridgeError(
            f"vision-event sync failed ({resp.status_code}): {resp.text[:200]}"
        )


async def _listen_once() -> None:
    if not BRIDGE_URL:
        raise EufyBridgeError("EUFY_BRIDGE_URL is not configured")
    async with websockets.connect(
        BRIDGE_URL,
        open_timeout=10,
        close_timeout=2,
        ping_interval=20,
        ping_timeout=20,
        max_size=2 * 1024 * 1024,
    ) as ws:
        log.info("Eufy event stream connected")
        async for raw in ws:
            event = json.loads(raw)
            if not isinstance(event, dict) or not _should_forward_event(event):
                continue
            try:
                await asyncio.to_thread(_forward_event, event)
                log.info(
                    "Eufy event: %s device=%s",
                    event.get("event"),
                    event.get("deviceSn") or "?",
                )
            except Exception as exc:
                # Do not kill the local event stream because the cloud sync had a bad minute.
                log.warning("Eufy event forward failed: %s", exc)


def run_event_listener_forever() -> None:
    if not EVENTS_ENABLED or not BRIDGE_URL:
        return
    delay = 2.0
    while True:
        try:
            asyncio.run(_listen_once())
            delay = 2.0
        except Exception as exc:
            log.warning("Eufy event stream disconnected: %s; retrying in %.0fs", exc, delay)
            time.sleep(delay)
            delay = min(60.0, delay * 2)


def start_event_thread() -> threading.Thread | None:
    if not EVENTS_ENABLED or not BRIDGE_URL:
        return None
    thread = threading.Thread(
        target=run_event_listener_forever,
        name="eufy-events",
        daemon=True,
    )
    thread.start()
    return thread
