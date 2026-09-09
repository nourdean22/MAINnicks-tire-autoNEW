"""
ReplayLab + FailureInjector: compress reliability testing into today.

You cannot manufacture weeks of field evidence in an afternoon. You CAN run the
equivalent of days of state-machine activity right now, on virtual time, and you can
force the failures that would otherwise take weeks to occur naturally.

So: every real defect and every operator correction becomes a permanent replay
fixture, and the injector reproduces duplicate events, out-of-order arrival, timestamp
skew, a frozen V380 pane, a camera restart, a detector outage, and a cloud/WAN outage
on demand.

Claims from this module are SIMULATION-PROVEN. That is a different and weaker claim
than controlled-field-proven, which is weaker again than long-horizon-proven. Never
merge the three.
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Optional, Sequence

from .frame import Detection, Frame


@dataclass
class ReplayResult:
    steps: int = 0
    emissions: list[Any] = field(default_factory=list)
    suppressed: list[str] = field(default_factory=list)
    summary: dict = field(default_factory=dict)

    def states(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for em in self.emissions:
            s = getattr(em, "state", None)
            if s:
                out[s] = out.get(s, 0) + 1
        return out


class ReplayLab:
    """Drives a VisionPipeline over a frame (and optional detection) sequence."""

    def __init__(self, pipeline: Any) -> None:
        self.pipeline = pipeline

    def run(
        self,
        frames: Iterable[Frame],
        detections_per_frame: Optional[Sequence[Sequence[Detection]]] = None,
    ) -> ReplayResult:
        res = ReplayResult()
        for i, frame in enumerate(frames):
            dets = None
            if detections_per_frame is not None:
                dets = detections_per_frame[i] if i < len(detections_per_frame) else []
            out = self.pipeline.step(frame, detections=dets)
            res.steps += 1
            res.emissions.extend(out.get("emissions", []))
            if out.get("suppressed"):
                res.suppressed.append(out["suppressed"])
        res.summary = self.pipeline.summary()
        return res


class FailureInjector:
    """Transforms a clean frame/detection sequence into a hostile one."""

    def __init__(self, seed: int = 1234) -> None:
        self.rng = random.Random(seed)

    def duplicate_frames(self, frames: Sequence[Frame], every: int = 5) -> list[Frame]:
        out: list[Frame] = []
        for i, f in enumerate(frames):
            out.append(f)
            if every and i % every == every - 1:
                out.append(Frame(seq=f.seq, ts=f.ts, source=f.source,
                                 image=f.image, meta=dict(f.meta, duplicate=True)))
        return out

    def freeze(self, frames: Sequence[Frame], start: int, length: int) -> list[Frame]:
        """Repeat one frame's PIXELS while the clock keeps moving -- a stalled V380 pane."""
        out = [f for f in frames]
        if start >= len(out):
            return out
        stuck = out[start].image
        for i in range(start, min(len(out), start + length)):
            out[i] = Frame(seq=out[i].seq, ts=out[i].ts, source=out[i].source,
                           image=stuck, meta=dict(out[i].meta, frozen=True))
        return out

    def jitter_timestamps(self, frames: Sequence[Frame], max_skew: float = 0.4) -> list[Frame]:
        return [Frame(seq=f.seq, ts=f.ts + self.rng.uniform(-max_skew, max_skew),
                      source=f.source, image=f.image, meta=f.meta) for f in frames]

    def reorder(self, frames: Sequence[Frame], swaps: int = 3) -> list[Frame]:
        out = list(frames)
        for _ in range(swaps):
            if len(out) < 3:
                break
            i = self.rng.randrange(len(out) - 1)
            out[i], out[i + 1] = out[i + 1], out[i]
        return out

    def camera_restart(self, frames: Sequence[Frame], at: int, blackout: int = 4) -> list[Frame]:
        """A gap in the stream, then the scene reappears -- the reconnect case."""
        out = list(frames)
        for i in range(at, min(len(out), at + blackout)):
            out[i] = Frame(seq=out[i].seq, ts=out[i].ts, source=out[i].source,
                           image=None, meta=dict(out[i].meta, blackout=True))
        return out

    def detector_outage(self, detections: Sequence[Sequence[Detection]], at: int,
                        length: int = 5) -> list[list[Detection]]:
        out = [list(d) for d in detections]
        for i in range(at, min(len(out), at + length)):
            out[i] = []
        return out

    @staticmethod
    def flaky_sink(fail_first: int = 3) -> Callable[[Any], bool]:
        """A cloud sink that 5xxs `fail_first` times then recovers -- WAN outage drill."""
        state = {"n": 0}

        def sink(_payload: Any) -> bool:
            state["n"] += 1
            return state["n"] > fail_first

        return sink
