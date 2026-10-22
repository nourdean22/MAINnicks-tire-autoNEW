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


def test_failed_reopens_are_counted_stamped_and_cleared_by_a_frame():
    """The edge's stall exit reads these (counter prep 2026-10-21): it keeps a producer alive
    while its own reader is still reopening, and only then."""
    good_image = np.full((4, 4, 3), 5, dtype=np.uint8)

    class DeadCap:
        def read(self):
            return False, None

        def release(self):
            pass

    class GoodCap(DeadCap):
        def read(self):
            time.sleep(0.005)
            return True, good_image

    source = RtspSource("rtsp://127.0.0.1/live")
    assert (source.reopen_failures, source.last_reopen_attempt_at) == (0, None)
    opens = {"n": 0}

    def flaky_open():
        opens["n"] += 1
        if opens["n"] <= 3:
            raise ConnectionError("RTSP did not open")
        return GoodCap()

    source._cap = DeadCap()
    source._reconnect_delay = 0.001
    source._open_capture = flaky_open
    seen = []
    source._reader = threading.Thread(target=source._reader_loop, daemon=True)
    source._reader.start()
    deadline = time.time() + 2.0
    while source.restores < 1 and time.time() < deadline:
        seen.append(source.reopen_failures)
        time.sleep(0.0005)
    source.close()

    assert source.restores == 1
    assert max(seen) >= 1, "the failed reopens were visible while they were happening"
    assert source.reopen_failures == 0, "a reopen that produced a frame clears the count"
    assert source.last_reopen_attempt_at is not None


def test_a_failed_synchronous_open_counts_too():
    """When the reader thread is gone, read() reopens on the caller's thread; those failures
    must count, or the edge would wait forever on a counter nothing increments."""
    source = RtspSource("rtsp://127.0.0.1/live")

    def refuse():
        raise ConnectionError("RTSP did not open")

    source._open_capture = refuse
    for expected in (1, 2):
        try:
            source.read()
        except ConnectionError:
            pass
        assert source.reopen_failures == expected
    assert source.last_reopen_attempt_at is not None
