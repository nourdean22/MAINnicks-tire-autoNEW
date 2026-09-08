"""Feed recorded MQTT messages (JSONL) through the state machine with virtual time.

Each line: {"topic": "frigate/events", "payload": {...}}. Lines starting with #
and blank lines are ignored. Between messages the clock advances in
tick_seconds steps exactly as the live 5 s tick would, so replay and
production evaluate timers identically.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Callable, List, Optional, Sequence, Tuple

from .frigate_events import FrigateEvent, LprUpdate, parse_message
from .state_machine import Emission, VisitTracker

Record = Tuple[str, dict]


@dataclass
class ReplayResult:
    """What a replay produced."""

    emissions: List[Emission] = field(default_factory=list)
    messages: int = 0
    ignored: int = 0
    ticks: int = 0
    last_time: Optional[float] = None


def read_jsonl(path: str) -> List[Record]:
    """Load (topic, payload) records from a JSONL file."""
    records: List[Record] = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            raw = json.loads(line)
            records.append((str(raw["topic"]), raw["payload"]))
    return records


def replay(
    tracker: VisitTracker,
    records: Sequence[Record],
    tick_seconds: float = 5.0,
    tail_seconds: float = 120.0,
    topic_prefix: str = "frigate",
    on_emission: Optional[Callable[[Emission], None]] = None,
) -> ReplayResult:
    """Run records through the tracker; returns every emission in order."""
    result = ReplayResult()
    clock: Optional[float] = None

    def collect(emissions: List[Emission]) -> None:
        for e in emissions:
            result.emissions.append(e)
            if on_emission is not None:
                on_emission(e)

    def advance(until: float) -> None:
        nonlocal clock
        if clock is None:
            return
        next_tick = clock + tick_seconds
        while next_tick < until:
            collect(tracker.tick(next_tick))
            result.ticks += 1
            next_tick += tick_seconds

    for topic, payload in records:
        message = parse_message(topic, payload, topic_prefix=topic_prefix)
        if message is None:
            result.ignored += 1
            continue
        if isinstance(message, FrigateEvent):
            at = message.time
        else:
            at = message.timestamp if message.timestamp is not None else (clock or 0.0)
        advance(at)
        if isinstance(message, FrigateEvent):
            collect(tracker.handle_event(message))
        elif isinstance(message, LprUpdate):
            collect(tracker.handle_lpr(message))
        result.messages += 1
        clock = at if clock is None else max(clock, at)

    if clock is not None and tail_seconds > 0:
        advance(clock + tail_seconds + tick_seconds)
        result.last_time = clock + tail_seconds
    else:
        result.last_time = clock
    return result
