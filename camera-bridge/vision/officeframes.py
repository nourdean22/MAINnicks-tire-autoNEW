"""Office "watch": still frames sampled during a capture window (2026-10-02).

The office lane used to only LISTEN: a Eufy motion/person event woke a bounded audio capture, and
nothing looked at the picture. With OFFICE_VISUAL_ENABLED=1 a FrameSampler runs beside the audio
capture, pulling a still from the already-authenticated Eufy bridge (`/snapshot/<serial>`) every
`interval_s` seconds, up to `max_frames`. Each episode then carries the frames that fall inside
its own time span; the server sends them to a vision model and keeps ONLY the description
(apps/nickstire/server/services/officeVisual.ts). Frames are never written to disk here.

Failure is quiet by design: a frame that cannot be fetched or shrunk is skipped, and an episode
with no frames posts exactly as it did before this module existed. The audio path never waits on
the camera.
"""
from __future__ import annotations

import base64
import threading
import time
import urllib.request
from typing import Any, Callable, Optional

#: The server caps a frame at 400_000 base64 chars (~300 KB of JPEG) and the request at 2 MB.
MAX_FRAME_BYTES = 290_000


def snapshot_url(bridge_url: str, serial: str) -> str:
    """ws://127.0.0.1:3000/ws -> http://127.0.0.1:3000/snapshot/<serial>."""
    base = bridge_url.strip()
    if base.startswith("wss://"):
        base = "https://" + base[len("wss://"):]
    elif base.startswith("ws://"):
        base = "http://" + base[len("ws://"):]
    scheme, _, rest = base.partition("://")
    host = rest.split("/", 1)[0]
    return f"{scheme}://{host}/snapshot/{serial}"


def fetch_frame(url: str, timeout_s: float = 8.0) -> Optional[bytes]:
    try:
        with urllib.request.urlopen(url, timeout=timeout_s) as resp:  # noqa: S310 - loopback bridge
            if getattr(resp, "status", 200) != 200:
                return None
            data = resp.read(4_000_000)
            return data or None
    except Exception:  # noqa: BLE001 - a missed frame is skipped, never fatal
        return None


def downscale_jpeg(data: bytes, max_width: int = 640, quality: int = 70) -> Optional[bytes]:
    """Shrink to <= max_width wide JPEG. Without OpenCV, pass small frames through and drop big ones."""
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
    except Exception:  # noqa: BLE001
        return data if len(data) <= MAX_FRAME_BYTES else None
    try:
        img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            return None
        h, w = img.shape[:2]
        if w > max_width:
            img = cv2.resize(img, (max_width, max(1, round(h * max_width / w))), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
        if not ok:
            return None
        out = buf.tobytes()
        return out if len(out) <= MAX_FRAME_BYTES else None
    except Exception:  # noqa: BLE001
        return None


class FrameSampler:
    """Grab a still now, then every `interval_s`, until stopped or `max_frames` collected."""

    def __init__(
        self,
        url: str,
        *,
        interval_s: float = 30.0,
        max_frames: int = 6,
        fetch: Callable[[str], Optional[bytes]] = fetch_frame,
        shrink: Callable[[bytes], Optional[bytes]] = downscale_jpeg,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.url = url
        self.interval_s = max(1.0, float(interval_s))
        self.max_frames = max(1, int(max_frames))
        self._fetch = fetch
        self._shrink = shrink
        self._clock = clock
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self.frames: list[dict[str, Any]] = []
        self.misses = 0

    def grab_once(self) -> None:
        at = self._clock()
        raw = self._fetch(self.url)
        small = self._shrink(raw) if raw else None
        if not small:
            self.misses += 1
            return
        self.frames.append({"at": at, "mime": "image/jpeg", "base64": base64.b64encode(small).decode("ascii")})

    def _run(self) -> None:
        while not self._stop.is_set() and len(self.frames) < self.max_frames:
            self.grab_once()
            if self._stop.wait(self.interval_s):
                break

    def start(self) -> "FrameSampler":
        self._thread = threading.Thread(target=self._run, name="office-frames", daemon=True)
        self._thread.start()
        return self

    def stop(self, *, final_grab: bool = True) -> list[dict[str, Any]]:
        """Stop sampling; grab one closing frame so the end of the interaction is seen too."""
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=15)
        if final_grab and len(self.frames) < self.max_frames:
            self.grab_once()
        return list(self.frames)


def frames_for_segment(
    frames: list[dict[str, Any]],
    started_at: float,
    duration_s: float,
    *,
    pad_s: float = 10.0,
    limit: int = 4,
) -> list[dict[str, Any]]:
    """Frames inside the segment's own time span (padded); else the single nearest frame."""
    if not frames:
        return []
    lo, hi = started_at - pad_s, started_at + max(0.0, duration_s) + pad_s
    inside = [f for f in frames if lo <= float(f.get("at", 0.0)) <= hi]
    if not inside:
        mid = started_at + max(0.0, duration_s) / 2
        inside = [min(frames, key=lambda f: abs(float(f.get("at", 0.0)) - mid))]
    if len(inside) > limit:
        # Keep first, last and evenly spaced middles: the arc of the interaction, not a burst.
        step = (len(inside) - 1) / (limit - 1)
        inside = [inside[round(i * step)] for i in range(limit)]
    return [{"at": f["at"], "mime": f["mime"], "base64": f["base64"]} for f in inside]
