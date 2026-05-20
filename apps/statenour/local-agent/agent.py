#!/usr/bin/env python3
"""
Statenour OS — Unified Smart Home Agent (v2)
Orchestrates Tuya, Ring, Eufy, and V380 polling.
Includes: health server, metrics sync, retry logic, log rotation, graceful shutdown.

Usage:
  python agent.py              # Run all enabled agents
  python agent.py --tuya-only  # Tuya only
  python agent.py --once       # Single poll cycle then exit
"""

import os
import sys
import time
import json
import signal
import logging
import argparse
import requests
from pathlib import Path
from datetime import datetime
from logging.handlers import RotatingFileHandler
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "30"))
RING_POLL_MULTIPLIER = 4
EUFY_POLL_MULTIPLIER = 4
V380_POLL_MULTIPLIER = 2
SYNC_URL = os.getenv("SYNC_URL", "https://bdnick.info/api/sync/nour-os")
SYNC_KEY = os.getenv("STATENOUR_SYNC_KEY", "")
HEALTH_PORT = int(os.getenv("HEALTH_PORT", "3600"))

# ── Logging with rotation ──
LOG_DIR = Path(__file__).parent
log_handler_console = logging.StreamHandler(sys.stdout)
_log_handlers = [log_handler_console]

for _log_name in ("agent.log", "agent-run.log", "agent-fallback.log"):
    try:
        _fh = RotatingFileHandler(
            LOG_DIR / _log_name,
            maxBytes=10 * 1024 * 1024,
            backupCount=7,
            encoding="utf-8",
        )
        _log_handlers.append(_fh)
        break
    except PermissionError:
        pass  # try next name or fall back to console-only

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=_log_handlers,
)
log = logging.getLogger("statenour-agent")

# ── Graceful shutdown ──
_shutdown = False

def _handle_signal(signum, frame):
    global _shutdown
    log.info("Received signal %d — finishing current cycle...", signum)
    _shutdown = True

signal.signal(signal.SIGINT, _handle_signal)
signal.signal(signal.SIGTERM, _handle_signal)


# ── Retry helper ──
def with_retry(fn, name, max_retries=1, delay=5):
    """Run fn with retry. Returns (success, result)."""
    for attempt in range(max_retries + 1):
        try:
            result = fn()
            return True, result
        except Exception as e:
            if attempt < max_retries:
                log.warning("%s failed (attempt %d/%d): %s — retrying in %ds",
                            name, attempt + 1, max_retries + 1, e, delay)
                time.sleep(delay)
            else:
                log.error("%s failed after %d attempts: %s", name, max_retries + 1, e)
                return False, None


# ── Platform runners ──
def run_tuya():
    from tuya_agent import poll_tuya_devices, sync_devices
    devices = poll_tuya_devices()
    if devices:
        sync_devices(devices)
        log.info("Tuya: %d devices synced", len(devices))
    return len(devices) if devices else 0

def run_tuya_commands():
    from tuya_agent import poll_commands, execute_command, ack_command
    commands = poll_commands()
    if commands:
        log.info("Processing %d commands", len(commands))
        for cmd in commands:
            success = execute_command(cmd)
            ack_command(cmd["device_id"], cmd["command_id"], success)
    return len(commands) if commands else 0

def run_ring():
    from ring_agent import sync_ring_devices
    count = sync_ring_devices()
    log.info("Ring: %d devices synced", count)
    return count

def run_eufy():
    from eufy_agent import sync_eufy_devices
    count = sync_eufy_devices()
    log.info("Eufy: %d devices synced", count)
    return count

def run_v380():
    from v380_agent import sync_v380_devices
    count = sync_v380_devices()
    log.info("V380: %d cameras synced", count)
    return count


# ── Metrics sync ──
def sync_metrics(cycle_count, platform_results, cycle_duration_ms, errors):
    """POST system metrics to statenour-os."""
    try:
        metrics = [
            {"name": "agent_cycle_count", "value": cycle_count, "unit": "count"},
            {"name": "agent_tuya_devices", "value": platform_results.get("tuya", 0), "unit": "count"},
            {"name": "agent_ring_devices", "value": platform_results.get("ring", 0), "unit": "count"},
            {"name": "agent_eufy_devices", "value": platform_results.get("eufy", 0), "unit": "count"},
            {"name": "agent_v380_cameras", "value": platform_results.get("v380", 0), "unit": "count"},
            {"name": "agent_poll_duration_ms", "value": cycle_duration_ms, "unit": "ms"},
            {"name": "agent_errors", "value": errors, "unit": "count"},
        ]
        resp = requests.post(
            SYNC_URL,
            json={"module": "system-metrics", "data": {"metrics": metrics}},
            headers={
                "x-sync-key": SYNC_KEY,
                "Content-Type": "application/json",
            },
            timeout=10,
        )
        if resp.status_code == 200:
            log.debug("Metrics synced: %d metrics", len(metrics))
        else:
            log.warning("Metrics sync returned %d: %s", resp.status_code, resp.text[:200])
    except Exception as e:
        log.warning("Metrics sync failed: %s", e)


def main():
    parser = argparse.ArgumentParser(description="Statenour Smart Home Agent v2")
    parser.add_argument("--tuya-only", action="store_true")
    parser.add_argument("--once", action="store_true", help="Single cycle then exit")
    parser.add_argument("--no-ring", action="store_true")
    parser.add_argument("--no-eufy", action="store_true")
    parser.add_argument("--no-v380", action="store_true")
    parser.add_argument("--no-health", action="store_true", help="Skip health server")
    args = parser.parse_args()

    # Start health server
    health_update = lambda **kw: None  # no-op default
    if not args.no_health and not args.once:
        try:
            from health_server import start_health_server, update_state
            start_health_server(HEALTH_PORT)
            health_update = update_state
            log.info("Health server running on port %d", HEALTH_PORT)
        except Exception as e:
            log.warning("Health server failed to start: %s", e)

    log.info("=" * 50)
    log.info("STATENOUR OS — Smart Home Agent v2")
    log.info("Poll interval: %ds | Health: port %d", POLL_INTERVAL, HEALTH_PORT)
    log.info("Tuya: ENABLED | Ring: %s | Eufy: %s | V380: %s",
             "DISABLED" if args.tuya_only or args.no_ring else "ENABLED",
             "DISABLED" if args.tuya_only or args.no_eufy else "ENABLED",
             "DISABLED" if args.tuya_only or args.no_v380 else "ENABLED")
    log.info("=" * 50)

    health_update(status="running")
    cycle = 0

    while not _shutdown:
        cycle += 1
        cycle_start = time.time()
        log.info("--- Cycle %d ---", cycle)
        errors = 0
        platform_results = {}

        # Tuya every cycle
        ok, count = with_retry(run_tuya, "Tuya")
        platform_results["tuya"] = count or 0
        if not ok:
            errors += 1
        health_update(platforms={"tuya": {
            "devices": count or 0,
            "last_sync": datetime.utcnow().isoformat() + "Z" if ok else None,
            "status": "ok" if ok else "error",
        }})

        # Commands every 3rd cycle
        if cycle % 3 == 0:
            with_retry(run_tuya_commands, "Tuya Commands")

        # Ring
        if not args.tuya_only and not args.no_ring and (cycle % RING_POLL_MULTIPLIER == 0 or args.once):
            ok, count = with_retry(run_ring, "Ring")
            platform_results["ring"] = count or 0
            if not ok:
                errors += 1
            health_update(platforms={"ring": {
                "devices": count or 0,
                "last_sync": datetime.utcnow().isoformat() + "Z" if ok else None,
                "status": "ok" if ok else "error",
            }})

        # Eufy
        if not args.tuya_only and not args.no_eufy and (cycle % EUFY_POLL_MULTIPLIER == 0 or args.once):
            ok, count = with_retry(run_eufy, "Eufy")
            platform_results["eufy"] = count or 0
            if not ok:
                errors += 1
            health_update(platforms={"eufy": {
                "devices": count or 0,
                "last_sync": datetime.utcnow().isoformat() + "Z" if ok else None,
                "status": "ok" if ok else "error",
            }})

        # V380
        if not args.tuya_only and not args.no_v380 and (cycle % V380_POLL_MULTIPLIER == 0 or args.once):
            ok, count = with_retry(run_v380, "V380")
            platform_results["v380"] = count or 0
            if not ok:
                errors += 1
            health_update(platforms={"v380": {
                "devices": count or 0,
                "last_sync": datetime.utcnow().isoformat() + "Z" if ok else None,
                "status": "ok" if ok else "error",
            }})

        cycle_duration_ms = int((time.time() - cycle_start) * 1000)

        # Update health state
        health_update(
            last_cycle_at=datetime.utcnow().isoformat() + "Z",
            cycle_count=cycle,
            last_cycle_duration_ms=cycle_duration_ms,
            total_errors=errors,
        )

        # Sync metrics to statenour-os every 5th cycle
        if cycle % 5 == 0 or args.once:
            sync_metrics(cycle, platform_results, cycle_duration_ms, errors)

        log.info("Cycle %d complete in %dms (%d errors)", cycle, cycle_duration_ms, errors)

        if args.once:
            log.info("Single cycle complete. Exiting.")
            break

        time.sleep(POLL_INTERVAL)

    if _shutdown:
        log.info("Graceful shutdown complete. Ran %d cycles.", cycle)
        health_update(status="stopped")

    log.info("Agent stopped.")


if __name__ == "__main__":
    main()
