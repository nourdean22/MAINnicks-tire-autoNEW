#!/usr/bin/env python3
"""
Local Agent Health Server — runs on port 3600.
Returns agent status, last poll time, device counts, errors, uptime.
The statenour-os /api/health endpoint can ping this to verify agent is alive.
"""

import os
import json
import time
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from datetime import datetime

# Shared state — updated by the agent after each cycle
_state = {
    "status": "starting",
    "started_at": datetime.utcnow().isoformat() + "Z",
    "last_cycle_at": None,
    "cycle_count": 0,
    "last_cycle_duration_ms": 0,
    "platforms": {
        "tuya": {"devices": 0, "last_sync": None, "errors": 0, "status": "unknown"},
        "ring": {"devices": 0, "last_sync": None, "errors": 0, "status": "unknown"},
        "eufy": {"devices": 0, "last_sync": None, "errors": 0, "status": "unknown"},
        "v380": {"devices": 0, "last_sync": None, "errors": 0, "status": "unknown"},
    },
    "total_errors": 0,
    "consecutive_failures": 0,
}
_lock = threading.Lock()


def update_state(**kwargs):
    """Called by agent.py after each cycle to update health state."""
    with _lock:
        for k, v in kwargs.items():
            if k == "platforms" and isinstance(v, dict):
                for pk, pv in v.items():
                    if pk in _state["platforms"]:
                        _state["platforms"][pk].update(pv)
            else:
                _state[k] = v


def get_state():
    with _lock:
        return dict(_state)


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health" or self.path == "/":
            state = get_state()
            # Calculate uptime
            started = datetime.fromisoformat(state["started_at"].replace("Z", "+00:00"))
            uptime_s = int((datetime.utcnow() - started.replace(tzinfo=None)).total_seconds())
            state["uptime_seconds"] = uptime_s

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(state, indent=2).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # Suppress request logs


def start_health_server(port=3600):
    """Start health server in a background thread."""
    server = HTTPServer(("0.0.0.0", port), HealthHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server
