"""One definition of p95, because two were already disagreeing.

`benchmark_openvino.py` reports `latencies[int(0.95 * (len - 1))]` and the heartbeat's
inference latency was computing `sorted[int(len * 0.95)]`. On twenty samples those pick
different values -- index 18 and index 19 -- so the number the shop's camera card would show
and the number the benchmark prints could differ for the same measurements, and nothing
anywhere said which one "p95" meant.

Making the two copies agree today would leave two copies. This is the definition; both call
it. NEAREST-RANK, matching the benchmark that was here first: for n samples the p95 is the
value at `int(0.95 * (n - 1))` of the sorted list, so it is always a value that was actually
measured rather than an interpolation between two that were.
"""
from __future__ import annotations

from typing import Iterable, Optional, Sequence


def p95(values: Iterable[float]) -> Optional[float]:
    """The 95th percentile by nearest rank, or None when there is nothing to rank.

    None rather than 0.0. A zero latency renders as an impossibly fast detector, and "we
    have not measured this" is a different claim from "this took no time" -- only one of
    which is ever true.
    """
    ordered: Sequence[float] = sorted(float(v) for v in values)
    if not ordered:
        return None
    return ordered[int(0.95 * (len(ordered) - 1))]
