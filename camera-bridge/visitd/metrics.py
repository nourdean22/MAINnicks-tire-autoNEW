"""In-process counters/gauges plus a tiny loopback Prometheus text endpoint.

The registry is the one piece of shared mutable state in visitd. Everything
else receives it explicitly.
"""
from __future__ import annotations

import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Dict, Optional, Tuple

log = logging.getLogger("visitd.metrics")

LabelKey = Tuple[Tuple[str, str], ...]


class MetricsRegistry:
    """Thread-safe counters and gauges rendered in Prometheus text format."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counters: Dict[str, Dict[LabelKey, float]] = {}
        self._gauges: Dict[str, Dict[LabelKey, float]] = {}

    @staticmethod
    def _key(labels: Optional[Dict[str, str]]) -> LabelKey:
        """Normalize a labels dict into a hashable sorted tuple."""
        return tuple(sorted((labels or {}).items()))

    def inc(self, name: str, amount: float = 1.0, labels: Optional[Dict[str, str]] = None) -> None:
        """Increment a counter."""
        with self._lock:
            series = self._counters.setdefault(name, {})
            key = self._key(labels)
            series[key] = series.get(key, 0.0) + amount

    def set(self, name: str, value: float, labels: Optional[Dict[str, str]] = None) -> None:
        """Set a gauge."""
        with self._lock:
            self._gauges.setdefault(name, {})[self._key(labels)] = float(value)

    def get(self, name: str, labels: Optional[Dict[str, str]] = None) -> float:
        """Read a counter or gauge value (0 when unset)."""
        key = self._key(labels)
        with self._lock:
            if name in self._counters:
                return self._counters[name].get(key, 0.0)
            return self._gauges.get(name, {}).get(key, 0.0)

    def snapshot(self) -> Dict[str, float]:
        """Flat dict for the heartbeat payload: name{labels} -> value."""
        out: Dict[str, float] = {}
        with self._lock:
            for table in (self._counters, self._gauges):
                for name, series in table.items():
                    for key, value in series.items():
                        out[_series_name(name, key)] = value
        return out

    def render(self) -> str:
        """Prometheus text exposition."""
        lines = []
        with self._lock:
            for name in sorted(self._counters):
                lines.append(f"# TYPE {name} counter")
                for key, value in sorted(self._counters[name].items()):
                    lines.append(f"{_series_name(name, key)} {_fmt(value)}")
            for name in sorted(self._gauges):
                lines.append(f"# TYPE {name} gauge")
                for key, value in sorted(self._gauges[name].items()):
                    lines.append(f"{_series_name(name, key)} {_fmt(value)}")
        return "\n".join(lines) + "\n"


def _series_name(name: str, key: LabelKey) -> str:
    """Render name plus {label="value",...} when labels exist."""
    if not key:
        return name
    inner = ",".join(f'{k}="{v}"' for k, v in key)
    return f"{name}{{{inner}}}"


def _fmt(value: float) -> str:
    """Render integers without a trailing .0."""
    return str(int(value)) if float(value).is_integer() else repr(value)


REGISTRY = MetricsRegistry()


class _Handler(BaseHTTPRequestHandler):
    """Serves /metrics from the module registry; everything else is 404."""

    registry: MetricsRegistry = REGISTRY

    def do_GET(self) -> None:  # noqa: N802 - http.server API
        """Handle GET."""
        if self.path.split("?")[0] != "/metrics":
            self.send_response(404)
            self.end_headers()
            return
        body = self.registry.render().encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: object) -> None:
        """Route http.server chatter through logging at DEBUG."""
        log.debug("metrics-http " + fmt, *args)


class MetricsServer:
    """Background HTTP server bound to the loopback interface only."""

    def __init__(self, host: str = "127.0.0.1", port: int = 9090, registry: MetricsRegistry = REGISTRY) -> None:
        handler = type("BoundHandler", (_Handler,), {"registry": registry})
        self._server = ThreadingHTTPServer((host, port), handler)
        self._server.daemon_threads = True
        self._thread = threading.Thread(target=self._server.serve_forever, name="visitd-metrics", daemon=True)
        self.address = self._server.server_address

    def start(self) -> None:
        """Start serving in a daemon thread."""
        self._thread.start()
        log.info("metrics listening host=%s port=%s", self.address[0], self.address[1])

    def stop(self) -> None:
        """Stop serving and release the socket."""
        self._server.shutdown()
        self._server.server_close()
