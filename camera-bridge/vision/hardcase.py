"""Record the moments the system found HARD, so they can teach it later.

WHY THIS IS THE COMPOUNDING PIECE. Detectors get superseded every few months; a better one
is a swap. What cannot be swapped in is a corpus of the exact situations THIS lot produces --
Cleveland weather on this driveway, this camera's compression, these bays, the way customers
actually pull in. That corpus only exists if something is capturing it while the system runs,
and it is worth almost nothing if it captures everything.

So the rule is: save the frames around moments where the system was UNCERTAIN or CONTRADICTED,
and nothing else. A detector disagreement near the entry portal is worth more than a thousand
quiet frames of an empty lot, and a thousand quiet frames cost real disk.

THREE THINGS THIS REFUSES TO DO, each because the alternative kills a producer at 3am:

  * It never grows without bound. Memory is capped by frame count and disk by total bytes,
    with oldest-first eviction. A recorder that fills the disk takes the SHOP's camera down
    with it, which is a far worse outcome than missing some training data.
  * It never raises into the capture loop. An I/O failure is data about the recorder, not a
    reason to stop watching the lot.
  * It never goes silent about that. A recorder that quietly writes nothing looks EXACTLY
    like a shop that had no hard cases -- the flywheel appears to be turning while nothing is
    on disk. Every drop is counted and reported, because "no clips" and "the recorder is
    broken" must never render the same way.
"""
from __future__ import annotations

import json
import os
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Dict, List, Optional, Tuple

import numpy as np

#: Reasons a moment is worth keeping. These are the situations where the system's own
#: machinery reported that it was unsure, or where two parts of it disagreed -- which is
#: exactly where a label buys the most and where a silent mistake costs the most.
TRIGGERS = (
    "DETECTOR_DISAGREEMENT",     # primary and adjudicator did not agree
    "PORTAL_LOW_CONFIDENCE",     # an arrival decision made on a weak detection
    "TRACK_SPLIT",               # one vehicle became two
    "TRACK_REACQUIRED",          # a track came back after a gap; was it the same car?
    "REID_AMBIGUOUS",
    "REID_CONTRADICTION",
    "PREEXISTING_DISAGREEMENT",  # census and portal disagreed about whether a car is new
    "SCENE_LOCATOR_LOW_CONFIDENCE",
    "POSE_OFF_HOME",
    "LAYOUT_CHANGE",
    "SOURCE_FAILOVER",
    "MODEL_OOD",
    "OPERATOR_CORRECTION",       # the highest-value label there is: a human said we were wrong
    "CAMERA_VS_RO_MISMATCH",     # the lot says a visit, the shop's records say none
    "UNUSUAL_DWELL",
    "FIRST_EXAMPLE_OF_REGIME",   # first snow, first night after a lens clean, ...
)


#: The subset of `TRIGGERS` that something in the running producer actually fires today.
#: THIS DISTINCTION IS THE POINT. A vocabulary entry with no producer is a class of hard case
#: the corpus will never contain, and the only evidence would be a dataset that quietly lacks
#: it -- so anyone reading the corpus later would conclude the shop never had a ReID
#: contradiction, rather than that nothing was ever watching for one. Keep this honest: add a
#: name here in the SAME change that adds its caller, never before.
TRIGGERS_WIRED = frozenset({
    "DETECTOR_DISAGREEMENT",
    "PORTAL_LOW_CONFIDENCE",
    "POSE_OFF_HOME",
    "SOURCE_FAILOVER",
    "LAYOUT_CHANGE",
    # Both fire from `EdgeLoop._note_reacquisition`, on geometry and time alone. They are
    # the expensive pair: when the tracker loses a car and re-acquires it as a new id, the
    # visit layer can open a SECOND visit for a vehicle that never left -- so the shop's
    # arrival count, the one number anyone reads, goes up by one and both visits look
    # perfectly well-formed.
    "TRACK_REACQUIRED",
    "TRACK_SPLIT",
})
# `SOURCE_FAILOVER` was listed here one commit before it had a caller, which is precisely
# what the comment above forbids. It now fires from the generation-break branch in
# `EdgeLoop.step` -- the place that already knows the capture lane changed.


@dataclass
class RecorderStats:
    """What the recorder has actually done. Read this before believing an empty directory."""

    clips_written: int = 0
    frames_written: int = 0
    bytes_written: int = 0
    dropped_cooldown: int = 0
    dropped_unknown_trigger: int = 0
    dropped_write_error: int = 0
    evicted_clips: int = 0
    episodes_written: int = 0
    #: An episode that could not be written or could not be read back. Counted separately
    #: from `dropped_write_error` because the CLIP is still on disk and still useful: losing
    #: the replayable view is a degradation, not a lost sample, and folding the two together
    #: would make the recorder look broken over a missing convenience.
    episodes_failed: int = 0
    #: The budget cannot hold even one clip. Not a write failure -- the clip is on disk --
    #: but the store can never grow, which is a thing an operator must be told rather than
    #: left to infer from a directory that stays at exactly one entry.
    budget_too_small: bool = False
    last_error: Optional[str] = None

    def describe(self) -> str:
        return (f"clips={self.clips_written} frames={self.frames_written} "
                f"bytes={self.bytes_written} dropped_cooldown={self.dropped_cooldown} "
                f"dropped_unknown={self.dropped_unknown_trigger} "
                f"dropped_error={self.dropped_write_error} evicted={self.evicted_clips} "
                f"episodes={self.episodes_written}/{self.episodes_written + self.episodes_failed}"
                + (" BUDGET_TOO_SMALL" if self.budget_too_small else "")
                + (f" last_error={self.last_error}" if self.last_error else ""))

    @property
    def healthy(self) -> bool:
        """Has every write this recorder attempted actually landed?

        Deliberately NOT "clips > 0". A quiet shop legitimately produces no hard cases, and
        conflating that with a broken recorder is the exact failure this class is written
        against. What makes it unhealthy is an attempt that FAILED.
        """
        return self.dropped_write_error == 0


@dataclass
class _Pending:
    reason: str
    at: float
    context: dict
    until: float


@dataclass
class HardCaseRecorder:
    """A rolling window of recent frames, flushed to disk only when something is worth keeping.

    The window is what makes this useful: by the time the system knows a moment was hard, the
    interesting part has already happened. Eight seconds of BEFORE is where the car actually
    approached; the trigger fires at the confusing instant, not at the start of it.
    """

    directory: str
    before_seconds: float = 8.0
    after_seconds: float = 15.0
    #: Frames held in memory. At 4 fps, 8s before + 15s after is ~92 -- 160 leaves headroom
    #: for a faster producer without letting the buffer become a memory leak with a nice name.
    max_buffer_frames: int = 160
    #: Total bytes on disk before the oldest clip is evicted. A recorder that fills the disk
    #: takes the shop's camera down with it.
    max_bytes: int = 2 * 1024 * 1024 * 1024
    #: Per-reason quiet period. One confusing car generates the same trigger on many
    #: consecutive frames; without this the disk fills with one event.
    cooldown_seconds: float = 60.0
    jpeg_quality: int = 82
    #: "both" writes an MCAP episode ALONGSIDE the numbered JPEGs; "off" writes only the
    #: JPEGs; "replace" deletes the JPEGs once the episode has been re-read and proven
    #: complete. Default is "both" deliberately: the episode format is new here, and the
    #: numbered frames are what every existing tool and test in this repo reads. "replace"
    #: is the intended steady state and halves the bytes -- move to it once episodes have
    #: earned it in the field, not on the day they land.
    episodes: str = "both"

    stats: RecorderStats = field(default_factory=RecorderStats)
    _buffer: Deque[Tuple[float, np.ndarray]] = field(default_factory=deque, init=False)
    _pending: List[_Pending] = field(default_factory=list, init=False)
    _last_fired: Dict[str, float] = field(default_factory=dict, init=False)

    def observe(self, ts: float, image: Optional[np.ndarray]) -> None:
        """Feed the rolling window. Called on every frame, so it stays cheap and total."""
        if image is None:
            return
        self._buffer.append((ts, image))
        while len(self._buffer) > self.max_buffer_frames:
            self._buffer.popleft()

    def trigger(self, reason: str, at: float, context: Optional[dict] = None) -> bool:
        """Arm a clip around `at`. Returns whether it was armed.

        Returning False is information, not a failure -- a cooldown suppression means the
        event is already being recorded. It is counted so that "we saved one clip" and "we
        saw one event" stay distinguishable.
        """
        if reason not in TRIGGERS:
            # An unknown reason is a caller bug, and swallowing it would let a typo silently
            # disable a whole class of capture. Counted and rejected, never guessed at.
            self.stats.dropped_unknown_trigger += 1
            return False
        last = self._last_fired.get(reason)
        if last is not None and at - last < self.cooldown_seconds:
            self.stats.dropped_cooldown += 1
            return False
        self._last_fired[reason] = at
        self._pending.append(_Pending(reason=reason, at=at, context=dict(context or {}),
                                      until=at + self.after_seconds))
        return True

    def flush_ready(self, now: float) -> List[str]:
        """Write any armed clip whose AFTER window has elapsed. Returns the paths written.

        Writing is deferred rather than immediate so the frames following the trigger -- the
        ones that show how the situation resolved -- are in the clip. A clip that stops at the
        confusing instant cannot show whether the car turned in or drove past, which is
        usually the whole question.
        """
        written: List[str] = []
        still: List[_Pending] = []
        for pending in self._pending:
            if now < pending.until:
                still.append(pending)
                continue
            path = self._write(pending)
            if path:
                written.append(path)
        self._pending = still
        return written

    def flush_all(self, now: float) -> List[str]:
        """Write every armed clip regardless of its window, for a clean shutdown.

        Without this a producer stopping mid-window discards the clip entirely -- and a
        producer that stops right after something confusing happened is describing a moment
        especially worth keeping.
        """
        for pending in self._pending:
            pending.until = now
        return self.flush_ready(now)

    def _window(self, pending: _Pending) -> List[Tuple[float, np.ndarray]]:
        lo, hi = pending.at - self.before_seconds, pending.until
        return [(ts, img) for ts, img in self._buffer if lo <= ts <= hi]

    def _write(self, pending: _Pending) -> Optional[str]:
        frames = self._window(pending)
        if not frames:
            # Nothing in the window is not an error -- the buffer may have been empty when a
            # trigger arrived from a code path that never called observe(). Counted as a
            # write error, because a clip with no frames teaches nothing and its absence
            # should be visible rather than inferred.
            self.stats.dropped_write_error += 1
            self.stats.last_error = f"{pending.reason}: no frames in the window"
            return None
        stamp = time.strftime("%Y%m%dT%H%M%S", time.gmtime(pending.at))
        name = f"{stamp}-{pending.reason}"
        clip_dir = os.path.join(self.directory, name)
        try:
            import cv2

            os.makedirs(clip_dir, exist_ok=True)
            written_bytes = 0
            # imENcode, not imWRITE: the same JPEG bytes go to the numbered file AND to the
            # episode. Re-compressing identical pixels a second time to satisfy a second
            # format would cost CPU on the box that is also running the detector, and would
            # leave the two copies subtly different for no reason.
            episode = _episode_for(clip_dir, self.episodes, pending)
            for index, (ts, image) in enumerate(frames):
                ok, buf = cv2.imencode(".jpg", image,
                                       [int(cv2.IMWRITE_JPEG_QUALITY), self.jpeg_quality])
                if not ok:
                    raise OSError(f"cv2.imencode refused frame {index}")
                jpeg = buf.tobytes()
                frame_path = os.path.join(clip_dir, f"{index:04d}.jpg")
                with open(frame_path, "wb") as fh:
                    fh.write(jpeg)
                written_bytes += len(jpeg)
                if episode is not None:
                    episode.add_image(ts, jpeg)
            meta = {
                "reason": pending.reason,
                "at": pending.at,
                "firstFrameAt": frames[0][0],
                "lastFrameAt": frames[-1][0],
                "frames": len(frames),
                "context": pending.context,
            }
            if episode is not None:
                episode.note("/hardcase/trigger", pending.at,
                             {"reason": pending.reason, "context": pending.context})
                written_bytes += _finish_episode(episode, meta, len(frames), self.stats)
                if self.episodes == "replace" and self.stats.episodes_written and                         meta.get("episode"):
                    written_bytes -= _drop_frames(clip_dir)
            with open(os.path.join(clip_dir, "case.json"), "w", encoding="utf-8") as fh:
                json.dump(meta, fh, indent=2)
            written_bytes += os.path.getsize(os.path.join(clip_dir, "case.json"))
        except Exception as exc:  # noqa: BLE001 - the lot matters more than the training set
            self.stats.dropped_write_error += 1
            self.stats.last_error = f"{pending.reason}: {type(exc).__name__}: {exc}"
            # EVICT ON THE WAY OUT, and this path is the one that matters most. The single
            # likeliest cause of a part-written clip is a FULL DISK -- exactly the condition
            # the byte budget exists to recover from. Returning here without evicting left
            # the partial directory in place and the budget unenforced, so the recorder could
            # never free the space that would let the next clip land.
            self._evict_if_over_budget()
            return None

        self.stats.clips_written += 1
        self.stats.frames_written += len(frames)
        self.stats.bytes_written += written_bytes
        self._evict_if_over_budget()
        return clip_dir

    def _evict_if_over_budget(self) -> None:
        """Drop the OLDEST clips until the store is inside its byte budget.

        Oldest-first because a hard case keeps its teaching value indefinitely but the newest
        ones describe the system as it is NOW -- and because any other order needs a value
        model, which is a thing to build later against real data, not to guess at here.
        """
        try:
            clips = sorted(
                (os.path.join(self.directory, d) for d in os.listdir(self.directory)
                 if os.path.isdir(os.path.join(self.directory, d))))
        except OSError as exc:
            # DO NOT CLOBBER A WRITE ERROR. Eviction now runs on the failure path, and the
            # write failure is the more informative of the two -- it names the clip and the
            # reason. An eviction scan that fails for the same underlying cause (a full disk,
            # a blocked path) would otherwise replace it with a vaguer message about
            # eviction, hiding what actually went wrong.
            if self.stats.last_error is None:
                self.stats.last_error = f"eviction scan failed: {type(exc).__name__}: {exc}"
            return
        sizes = {c: _dir_size(c) for c in clips}
        total = sum(sizes.values())
        # NEVER evict the newest clip, even when it alone exceeds the budget.
        #
        # Without this the store empties completely and STAYS empty: every clip written is
        # immediately over budget, so every clip is immediately deleted, forever, while
        # `healthy` stays True because no WRITE ever failed. An operator reads an empty
        # directory as a quiet shop. Keeping one clip is bounded -- a clip cannot exceed
        # `max_buffer_frames` frames -- and one over-budget clip is a far better outcome
        # than a recorder that has silently recorded nothing since the day it was configured.
        #
        # Reachable in practice as of the episode work: writing both the JPEGs and an
        # episode roughly doubles a clip, which halves the budget that can hold one.
        for clip in clips[:-1] if clips else []:
            if total <= self.max_bytes:
                break
            try:
                for entry in os.listdir(clip):
                    os.remove(os.path.join(clip, entry))
                os.rmdir(clip)
            except OSError as exc:
                if self.stats.last_error is None:
                    self.stats.last_error = f"eviction failed on {clip}: {type(exc).__name__}"
                return
            total -= sizes[clip]
            self.stats.evicted_clips += 1
        if total > self.max_bytes:
            # Say it, rather than letting a permanently-over-budget store look normal. This
            # is a CONFIGURATION fact -- the budget cannot hold a single clip -- and the
            # operator is the only one who can fix it.
            self.stats.budget_too_small = True
            if self.stats.last_error is None:
                self.stats.last_error = (
                    f"byte budget {self.max_bytes} cannot hold one clip ({total} on disk); "
                    "keeping the newest anyway -- raise --hard-case-max-gb")


def _drop_frames(clip_dir: str) -> int:
    """Remove the numbered JPEGs the episode now holds. Returns the bytes reclaimed.

    Only ever called after `verify()` reported a COMPLETE episode whose image count matches
    the frames written. Any failure here leaves the frames alone -- a clip with both copies
    wastes disk; a clip with neither is a lost sample.
    """
    freed = 0
    try:
        for name in sorted(os.listdir(clip_dir)):
            if name.endswith(".jpg"):
                path = os.path.join(clip_dir, name)
                size = os.path.getsize(path)
                os.remove(path)
                freed += size
    except Exception:  # noqa: BLE001 - keeping both copies is the safe failure
        pass
    return freed


def _episode_for(clip_dir: str, mode: str, pending: "_Pending"):
    """An open EpisodeWriter for this clip, or None when episodes are off/unavailable.

    Import is local and failure returns None: a box without `mcap` installed must still
    record hard cases. An episode is a better view of a clip, never a precondition for one.
    """
    if mode == "off":
        return None
    try:
        from vision.episode import EpisodeWriter, AVAILABLE

        if not AVAILABLE:
            return None
        writer = EpisodeWriter(os.path.join(clip_dir, "episode.mcap"),
                               frame_id=pending.reason)
        return writer if writer.open else None
    except Exception:  # noqa: BLE001 - never let the replay format cost us the sample
        return None


def _finish_episode(episode, meta: dict, expected_images: int, stats: "RecorderStats") -> int:
    """Close, re-read, and return the episode's bytes. Deletes nothing on its own.

    The re-read is the point. `close()` returning a path means the writer did not raise,
    which is not the same claim as "the frames are in there and can be got out again" --
    and the second claim is the only one that could ever justify removing the originals.
    """
    from vision.episode import verify

    path = episode.close(meta)
    if not path:
        stats.episodes_failed += 1
        stats.last_error = f"episode: {episode.stats.describe()}"
        return 0
    seen = verify(path)
    ok = bool(seen and seen.get("complete")
              and seen["topics"].get("/camera/image", 0) == expected_images)
    if not ok:
        stats.episodes_failed += 1
        stats.last_error = (
            f"episode wrote but did not read back: {seen}" if seen
            else "episode wrote but would not re-open at all")
        return os.path.getsize(path)
    stats.episodes_written += 1
    meta["episode"] = {"messages": seen["messages"], "topics": seen["topics"]}
    return os.path.getsize(path)


def _dir_size(path: str) -> int:
    total = 0
    try:
        for entry in os.listdir(path):
            full = os.path.join(path, entry)
            if os.path.isfile(full):
                total += os.path.getsize(full)
    except OSError:
        return 0
    return total
