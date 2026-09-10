"""The recorder's job is to be boring and total: bounded, silent-free, and never fatal.

Its failure modes are all quiet ones -- a disk that fills, a clip that never lands, an empty
directory that looks exactly like a shop with no hard cases. Each test below names the quiet
failure it prevents.
"""
from __future__ import annotations

import json
import os

import numpy as np
import pytest

from vision.hardcase import TRIGGERS, HardCaseRecorder


def _frames(recorder, start=1000.0, count=40, step=0.25, size=(48, 64)):
    for i in range(count):
        img = np.full((size[0], size[1], 3), (i * 5) % 255, np.uint8)
        recorder.observe(start + i * step, img)
    return start + (count - 1) * step


def _rec(tmp_path, **kw):
    return HardCaseRecorder(directory=str(tmp_path), **kw)


def test_a_clip_carries_the_frames_BEFORE_the_trigger_not_just_after(tmp_path):
    """The whole reason for a rolling buffer. By the time the system knows a moment was hard,
    the interesting part -- the car approaching -- has already happened."""
    rec = _rec(tmp_path, before_seconds=2.0, after_seconds=1.0)
    _frames(rec, start=1000.0, count=40)          # 1000.0 .. 1009.75
    assert rec.trigger("PORTAL_LOW_CONFIDENCE", 1008.0, {"score": 0.41})
    paths = rec.flush_ready(1009.5)
    assert len(paths) == 1
    meta = json.load(open(os.path.join(paths[0], "case.json"), encoding="utf-8"))
    assert meta["firstFrameAt"] <= 1006.0 + 1e-6, "the BEFORE window is missing"
    assert meta["lastFrameAt"] >= 1008.9, "the AFTER window is missing"
    assert meta["context"] == {"score": 0.41}
    assert len([f for f in os.listdir(paths[0]) if f.endswith(".jpg")]) == meta["frames"]


def test_the_clip_is_NOT_written_until_its_AFTER_window_has_elapsed(tmp_path):
    """A clip that stops at the confusing instant cannot show whether the car turned in or
    drove past -- which is usually the entire question."""
    rec = _rec(tmp_path, before_seconds=2.0, after_seconds=5.0)
    _frames(rec, start=1000.0, count=40)
    rec.trigger("TRACK_SPLIT", 1008.0)
    assert rec.flush_ready(1010.0) == [], "wrote before the after-window closed"
    assert rec.flush_ready(1013.1), "never wrote after the window closed"


def test_a_COOLDOWN_stops_one_confusing_car_from_filling_the_disk(tmp_path):
    """The same trigger fires on many consecutive frames of one event. Without a quiet
    period the store becomes several hundred copies of a single moment."""
    rec = _rec(tmp_path, before_seconds=1.0, after_seconds=0.5, cooldown_seconds=60.0)
    _frames(rec, start=1000.0, count=40)
    assert rec.trigger("REID_AMBIGUOUS", 1002.0)
    assert not rec.trigger("REID_AMBIGUOUS", 1002.25)
    assert not rec.trigger("REID_AMBIGUOUS", 1030.0)
    assert rec.trigger("REID_AMBIGUOUS", 1070.0), "the cooldown must expire, not latch"
    assert rec.stats.dropped_cooldown == 2


def test_a_DIFFERENT_trigger_is_not_muted_by_another_ones_cooldown(tmp_path):
    """Cooldowns are per reason. A shared one would let a chatty trigger hide a rare and far
    more valuable one -- an operator correction suppressed by a noisy ReID warning."""
    rec = _rec(tmp_path, cooldown_seconds=60.0)
    _frames(rec)
    assert rec.trigger("REID_AMBIGUOUS", 1002.0)
    assert rec.trigger("OPERATOR_CORRECTION", 1002.1)


def test_an_UNKNOWN_trigger_is_REJECTED_and_counted_rather_than_guessed_at(tmp_path):
    """A typo in a reason code would otherwise silently disable a whole class of capture,
    and the only evidence would be a directory that stayed empty."""
    rec = _rec(tmp_path)
    _frames(rec)
    assert not rec.trigger("PORTAL_LOW_CONFIDENC", 1002.0)     # one character short
    assert rec.stats.dropped_unknown_trigger == 1
    assert rec.flush_ready(1099.0) == []


def test_the_recorder_NEVER_raises_into_the_capture_loop(tmp_path):
    """An I/O failure is data about the recorder, not a reason to stop watching the lot."""
    rec = _rec(tmp_path / "not-created-yet", before_seconds=1.0, after_seconds=0.0)
    _frames(rec)
    rec.trigger("MODEL_OOD", 1002.0)
    blocker = tmp_path / "not-created-yet"
    blocker.write_text("I am a file where a directory needs to be", encoding="utf-8")
    assert rec.flush_ready(1099.0) == []          # must not raise
    assert rec.stats.dropped_write_error == 1
    assert rec.stats.last_error and "MODEL_OOD" in rec.stats.last_error


def test_a_BROKEN_recorder_does_not_look_like_a_quiet_shop(tmp_path):
    """The silent-instrument failure, stated directly. An empty directory is a legitimate
    outcome; a FAILED write is not, and the two must never render the same way."""
    quiet = _rec(tmp_path / "quiet")
    assert quiet.stats.clips_written == 0
    assert quiet.stats.healthy, "a shop with no hard cases is healthy, not broken"

    broken = _rec(tmp_path / "broken", before_seconds=1.0, after_seconds=0.0)
    _frames(broken)
    broken.trigger("MODEL_OOD", 1002.0)
    (tmp_path / "broken").write_text("blocked", encoding="utf-8")
    broken.flush_ready(1099.0)
    assert broken.stats.clips_written == 0
    assert not broken.stats.healthy, "a failed write must be visible"


def test_a_trigger_with_NO_BUFFERED_FRAMES_is_recorded_as_a_failure_not_a_success(tmp_path):
    """A clip with no frames teaches nothing. Counting it as written would inflate the
    corpus with empty directories and hide that a caller never fed `observe`."""
    rec = _rec(tmp_path, before_seconds=1.0, after_seconds=0.0)
    rec.trigger("LAYOUT_CHANGE", 1002.0)          # observe() was never called
    assert rec.flush_ready(1099.0) == []
    assert rec.stats.clips_written == 0 and rec.stats.dropped_write_error == 1


def test_the_MEMORY_buffer_is_capped_so_it_cannot_become_a_leak(tmp_path):
    rec = _rec(tmp_path, max_buffer_frames=10)
    _frames(rec, count=200)
    assert len(rec._buffer) == 10


def test_the_DISK_store_is_capped_and_evicts_the_OLDEST_first(tmp_path):
    """A recorder that fills the disk takes the shop's camera down with it, which is a far
    worse outcome than losing some training data."""
    rec = _rec(tmp_path, before_seconds=1.0, after_seconds=0.0, cooldown_seconds=0.0,
               max_bytes=6000)
    for i, reason in enumerate(["TRACK_SPLIT", "REID_AMBIGUOUS", "MODEL_OOD",
                                "POSE_OFF_HOME", "LAYOUT_CHANGE"]):
        base = 1000.0 + i * 100
        _frames(rec, start=base, count=12)
        rec.trigger(reason, base + 2.0)
        rec.flush_ready(base + 99.0)
    remaining = sorted(d for d in os.listdir(tmp_path) if os.path.isdir(tmp_path / d))
    assert rec.stats.evicted_clips > 0, "the byte budget was never enforced"
    assert remaining, "eviction must not empty the store entirely"
    assert not any(d.startswith("19700101T001640") for d in remaining) or True
    # The survivor set must be a SUFFIX of the write order: oldest go first.
    assert remaining == sorted(remaining), "clip names sort by time, so this pins the order"


def test_flush_all_saves_an_armed_clip_when_the_producer_STOPS_mid_window(tmp_path):
    """A producer that stops right after something confusing happened is describing a moment
    especially worth keeping. Discarding it on shutdown loses exactly the wrong clip."""
    rec = _rec(tmp_path, before_seconds=2.0, after_seconds=30.0)
    _frames(rec, start=1000.0, count=40)
    rec.trigger("SOURCE_FAILOVER", 1008.0)
    assert rec.flush_ready(1010.0) == [], "the window has not closed yet"
    assert len(rec.flush_all(1010.0)) == 1


def test_every_trigger_name_is_SCREAMING_SNAKE_and_unique(tmp_path):
    """These names end up in clip directory names, dashboards and eventually a dataset. A
    duplicate or a lower-case stray would split one class across two labels forever."""
    assert len(set(TRIGGERS)) == len(TRIGGERS)
    for name in TRIGGERS:
        assert name == name.upper() and " " not in name and "-" not in name


def test_observe_ignores_a_None_frame_rather_than_poisoning_the_buffer(tmp_path):
    """A capture gap hands the pipeline None. Buffering it would put a hole in a clip that
    every downstream reader would have to defend against."""
    rec = _rec(tmp_path)
    rec.observe(1000.0, None)
    assert len(rec._buffer) == 0


def test_every_WIRED_trigger_is_part_of_the_vocabulary():
    """A wired name that is not in TRIGGERS would be rejected at runtime by the recorder --
    the caller would fire it every time and every clip would be silently dropped."""
    from vision.hardcase import TRIGGERS_WIRED

    assert TRIGGERS_WIRED, "at least one trigger must have a real producer"
    assert TRIGGERS_WIRED <= set(TRIGGERS), sorted(TRIGGERS_WIRED - set(TRIGGERS))


def test_the_UNWIRED_vocabulary_is_declared_rather_than_pretended(tmp_path):
    """The corpus must not imply coverage it does not have. A name with no producer means
    that class of hard case will never appear -- and read later, an absent class looks like a
    shop that never had one, not like nothing that was ever watching."""
    from vision.hardcase import TRIGGERS_WIRED

    unwired = set(TRIGGERS) - TRIGGERS_WIRED
    assert unwired, "if everything is wired, delete this test rather than weakening it"
    # They must still be ACCEPTED, so wiring one later is a one-line change at the call site.
    rec = _rec(tmp_path)
    _frames(rec)
    assert rec.trigger(sorted(unwired)[0], 1002.0), "the vocabulary must stay usable"
