"""officeframes: still frames for office "watch" (2026-10-02)."""
import base64
import sys

from vision import officeframes
from vision.officeframes import FrameSampler, frames_for_segment, snapshot_url


def test_snapshot_url_from_bridge_ws_url():
    assert snapshot_url("ws://127.0.0.1:3000/ws", "T84") == "http://127.0.0.1:3000/snapshot/T84"
    assert snapshot_url("wss://bridge.local:8443/ws", "X") == "https://bridge.local:8443/snapshot/X"
    assert snapshot_url("http://127.0.0.1:3000", "X") == "http://127.0.0.1:3000/snapshot/X"


def test_sampler_collects_frames_and_counts_misses():
    t = iter([100.0, 130.0, 160.0])
    results = iter([b"jpeg-1", None, b"jpeg-3"])
    s = FrameSampler("u", fetch=lambda _u: next(results), shrink=lambda b: b, clock=lambda: next(t))
    s.grab_once()
    s.grab_once()
    s.grab_once()
    assert [f["at"] for f in s.frames] == [100.0, 160.0]
    assert s.misses == 1
    assert base64.b64decode(s.frames[0]["base64"]) == b"jpeg-1"
    assert s.frames[0]["mime"] == "image/jpeg"


def test_sampler_thread_stops_and_takes_a_closing_frame():
    s = FrameSampler("u", interval_s=60, max_frames=6, fetch=lambda _u: b"x" * 10, shrink=lambda b: b)
    s.start()
    frames = s.stop()
    # one at start + one closing frame; the 60s interval never elapsed
    assert len(frames) == 2


def test_sampler_respects_max_frames_even_with_closing_grab():
    s = FrameSampler("u", max_frames=1, fetch=lambda _u: b"x", shrink=lambda b: b)
    s.grab_once()
    assert len(s.stop()) == 1


def test_frames_for_segment_picks_frames_inside_its_span():
    frames = [{"at": float(t), "mime": "image/jpeg", "base64": str(t)} for t in (0, 30, 60, 90, 120)]
    got = frames_for_segment(frames, started_at=50.0, duration_s=20.0, pad_s=10.0)
    assert [f["at"] for f in got] == [60.0]


def test_frames_for_segment_falls_back_to_nearest_and_thins_to_limit():
    frames = [{"at": float(t), "mime": "image/jpeg", "base64": str(t)} for t in range(0, 100, 10)]
    nearest = frames_for_segment(frames, started_at=500.0, duration_s=10.0)
    assert [f["at"] for f in nearest] == [90.0]
    thinned = frames_for_segment(frames, started_at=0.0, duration_s=90.0, pad_s=0.0, limit=4)
    assert [f["at"] for f in thinned] == [0.0, 30.0, 60.0, 90.0]
    assert frames_for_segment([], 0.0, 10.0) == []


def test_downscale_without_opencv_passes_small_frames_and_drops_big_ones(monkeypatch):
    monkeypatch.setitem(sys.modules, "cv2", None)  # import cv2 -> ImportError
    assert officeframes.downscale_jpeg(b"small") == b"small"
    assert officeframes.downscale_jpeg(b"x" * (officeframes.MAX_FRAME_BYTES + 1)) is None


def test_downscale_with_opencv_shrinks_to_640_wide():
    import pytest

    cv2 = pytest.importorskip("cv2")
    np = pytest.importorskip("numpy")
    img = np.zeros((720, 1280, 3), dtype=np.uint8)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    out = officeframes.downscale_jpeg(buf.tobytes())
    assert out is not None
    decoded = cv2.imdecode(np.frombuffer(out, dtype=np.uint8), cv2.IMREAD_COLOR)
    assert decoded.shape[1] == 640 and decoded.shape[0] == 360


# ---- RTSP stills (2026-10-17): the shop PC has no Eufy bridge, only the camera's /live0 ------


class _Proc:
    def __init__(self, rc=0, stdout=b"", stderr=b""):
        self.returncode, self.stdout, self.stderr = rc, stdout, stderr


def test_rtsp_grab_asks_ffmpeg_for_one_small_video_frame(monkeypatch):
    seen = {}

    def run(cmd, **kw):
        seen["cmd"], seen["kw"] = cmd, kw
        return _Proc(stdout=b"\xff\xd8jpeg")

    monkeypatch.setattr("vision.officeframes.subprocess.run", run)
    assert officeframes.fetch_rtsp_frame("rtsp://cam/live0", timeout_s=7.0, binary="ff") == b"\xff\xd8jpeg"
    cmd, kw = seen["cmd"], seen["kw"]
    assert cmd[0] == "ff"
    assert cmd[cmd.index("-rtsp_transport") + 1] == "tcp"
    assert cmd[cmd.index("-i") + 1] == "rtsp://cam/live0"
    assert cmd[cmd.index("-frames:v") + 1] == "1"
    assert "-an" in cmd  # never decode the audio the capture is already recording
    assert "scale=640:-2" in cmd[cmd.index("-vf") + 1]  # shrink in ffmpeg: no OpenCV on the shop PC
    assert cmd[-1] == "pipe:1"
    assert kw["timeout"] == 7.0 and kw["capture_output"] is True


def test_rtsp_grab_runs_below_normal_priority_on_windows(monkeypatch):
    seen = {}
    monkeypatch.setattr("vision.officeframes._IS_WINDOWS", True)
    monkeypatch.setattr("vision.officeframes.subprocess.run", lambda cmd, **kw: seen.update(kw) or _Proc(stdout=b"j"))
    officeframes.fetch_rtsp_frame("rtsp://cam/live0", binary="ff")
    assert seen["creationflags"] == officeframes.BELOW_NORMAL_PRIORITY_CLASS


def test_rtsp_grab_failures_are_a_missed_frame_never_a_crash(monkeypatch):
    import subprocess

    def timeout(cmd, **kw):
        raise subprocess.TimeoutExpired(cmd, kw.get("timeout"))

    def missing(cmd, **kw):
        raise FileNotFoundError("ffmpeg")

    for run in (
        lambda cmd, **kw: _Proc(rc=1, stderr=b"401 Unauthorized"),
        lambda cmd, **kw: _Proc(rc=0, stdout=b""),
        timeout,
        missing,
    ):
        monkeypatch.setattr("vision.officeframes.subprocess.run", run)
        assert officeframes.fetch_rtsp_frame("rtsp://cam/live0", binary="ff") is None
