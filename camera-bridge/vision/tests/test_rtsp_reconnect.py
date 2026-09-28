"""Regression tests for self-healing RTSP capture."""
from __future__ import annotations

import threading
import time

import numpy as np

from vision.capture import CaptureMux, RtspSource
from vision.frame import Frame


def test_single_rtsp_mux_keeps_reconnecting_source_selected():
    image = np.full((4, 4, 3), 9, dtype=np.uint8)

    class RecoveringSource:
        self_managed_reconnect = True
        name = "rtsp"

        def __init__(self):
            self.calls = 0

        def read(self):
            self.calls += 1
            if self.calls <= 5:
                return None
            return Frame(
                seq=1,
                ts=1.0,
                source=self.name,
                image=image,
                meta={"window_verified": True},
            )

    source = RecoveringSource()
    mux = CaptureMux([source], max_consecutive_fail=3)

    for _ in range(5):
        assert mux.read() is None
        assert mux.index == 0

    frame = mux.read()
    assert frame is not None
    assert mux.index == 0
    assert mux.swaps == 0


def test_rtsp_reader_reopens_dead_capture_and_bumps_restores():
    good_image = np.full((4, 4, 3), 7, dtype=np.uint8)

    class DeadCap:
        def __init__(self):
            self.released = False

        def read(self):
            return False, None

        def release(self):
            self.released = True

    class GoodCap:
        def __init__(self):
            self.released = False

        def read(self):
            time.sleep(0.005)
            return True, good_image

        def release(self):
            self.released = True

    dead = DeadCap()
    good = GoodCap()
    source = RtspSource("rtsp://127.0.0.1/live")
    source._cap = dead
    source._reconnect_delay = 0.001
    source._open_capture = lambda: good
    source._reader = threading.Thread(target=source._reader_loop, daemon=True)
    source._reader.start()

    deadline = time.time() + 1.0
    while source.restores < 1 and time.time() < deadline:
        time.sleep(0.005)

    frame = None
    deadline = time.time() + 1.0
    while frame is None and time.time() < deadline:
        frame = source.read()
        if frame is None:
            time.sleep(0.005)

    source.close()

    assert dead.released is True
    assert source.restores == 1
    assert frame is not None
    assert int(frame.image[0, 0, 0]) == 7
    assert frame.meta["window_verified"] is True
