"""Canaries for the native RTSP capture seam."""
from __future__ import annotations

from unittest.mock import patch

import numpy as np
import pytest

from vision.capture import RtspSource
from vision.panedetect import ChannelNotFound
from vision.run_live import build_source
from vision.scenelocator import SceneNotLocated


class _FakeRtsp:
    def __init__(self, url: str, name: str = "rtsp") -> None:
        self.url = url
        self.name = name


def test_build_source_constructs_one_native_rtsp_lane():
    with patch("vision.run_live.RtspSource", _FakeRtsp):
        source = build_source(
            "rtsp", None, "unused", False,
            source_url="rtsp://127.0.0.1:8554/live",
        )
    assert len(source.sources) == 1
    assert source.active.url == "rtsp://127.0.0.1:8554/live"
    assert source.active.name == "rtsp"


def test_rtsp_without_a_url_refuses_instead_of_falling_back_to_a_window():
    with pytest.raises(ValueError, match="source-url-env"):
        build_source("rtsp", None, "V380", False)


def test_rtsp_refuses_wgc_only_aiming_flags():
    with pytest.raises(ChannelNotFound, match="already names one stream"):
        build_source(
            "rtsp", None, "V380", False, channel=1,
            source_url="rtsp://127.0.0.1/live",
        )
    with pytest.raises(SceneNotLocated, match="no atlas binding"):
        build_source(
            "rtsp", None, "V380", False, scene_atlas="atlas",
            source_url="rtsp://127.0.0.1/live",
        )


def test_native_rtsp_frames_are_window_verified():
    image = np.zeros((8, 8, 3), dtype=np.uint8)

    class _Cap:
        def read(self):
            return True, image

        def release(self):
            pass

    source = RtspSource("rtsp://127.0.0.1/live")
    source._cap = _Cap()
    frame = source.read()
    assert frame is not None
    assert frame.meta["window_verified"] is True
