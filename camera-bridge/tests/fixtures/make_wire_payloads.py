"""Generate `wire_payloads.json`: what the producer actually PUTs on the wire.

THE SEAM THIS EXISTS TO GUARD. `visitd.contract.build_event` renders an `Emission` as the v2
payload; `apps/statenour/lib/services/vehicle-event-contract.ts` decides whether the cloud
accepts it. Nothing has ever compared the two. `camera-bridge/tests/test_contract.py` checks
the Python side against a Python-authored expectation, which cannot catch a disagreement with
the receiver -- and the disagreement is not hypothetical: on 2026-09-10 every single event was
rejected `400 Invalid vehicle event payload` for hours because Zod's `.optional()` accepts a
MISSING KEY and never `null`, while Python's `None` serialises to JSON null.

A cross-language assertion needs both runtimes in one process, which no CI job here has. So
the two halves are joined by a checked-in fixture instead:

  * `tests/test_wire_contract.py` fails when the PRODUCER drifts from this file.
  * `apps/statenour/.../vehicleEventWireContract.test.ts` fails when the SCHEMA stops
    accepting it.

Neither test needs the other language. Regenerate with:

    python tests/fixtures/make_wire_payloads.py

and read the diff -- a change here is a change to what the cloud will be asked to accept.
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from visitd.contract import build_event                              # noqa: E402
from visitd.state_machine import Emission                            # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wire_payloads.json")

#: A fixed clock. The payload carries an ISO timestamp derived from it, so a wall-clock here
#: would make the fixture differ on every regeneration and the drift test would be noise.
T0 = 1757347331.0


def _emission(**overrides) -> Emission:
    base = dict(
        visit_id="9f3e", state="CONFIRMED_ARRIVAL", seq=3, at=T0 + 47.2, estimated=False,
        sighting_id="1757347331.12-abc123", camera="sign", zone="front_lot", priority="high",
        label="car", confidence=0.87, dwell_seconds=47.2, zone_dwell={"front_lot": 47.2},
        stationary=True,
        plate={"status": "CONFIRMED", "text": "ABC 1234", "normalizedText": "ABC1234",
               "confidence": 0.93, "reads": 3},
        direction="entering", frigate_start_time=T0, frigate_end_time=None,
    )
    base.update(overrides)
    return Emission(**base)  # type: ignore[arg-type]


#: One entry per shape the producer really emits. The names are the reason each is here.
CASES = {
    "confirmed_arrival_with_plate": _emission(),
    "entered_zone_no_plate": _emission(
        state="ENTERED_ZONE", seq=1, dwell_seconds=0.0, zone_dwell={}, stationary=False,
        plate={"status": "NONE"}),
    "arrival_candidate_estimated": _emission(
        state="ARRIVAL_CANDIDATE", seq=2, estimated=True, dwell_seconds=10.4,
        plate={"status": "UNREADABLE"}),
    "pass_through": _emission(
        state="PASS_THROUGH", seq=2, estimated=True, dwell_seconds=3.1,
        plate={"status": "NONE"}),
    # THE ONE THAT BROKE PRODUCTION. A completed visit nulls a different set of fields from
    # an arrival -- measured on the real event: confidence, estimated, label, priority,
    # stationary, zone and zoneName were all null in `data`, plus text and normalizedText
    # inside `plate`. Every one is optional-but-not-nullable on the receiver. Somebody had
    # patched exactly one field before (`trackId` is the only `.nullable()` in that schema),
    # which fixed one symptom and left the shape.
    "left_with_everything_optional_absent": _emission(
        state="LEFT", seq=4, zone=None, priority="low", label="car", confidence=0.0,
        dwell_seconds=472.3, zone_dwell={}, stationary=False, estimated=False,
        plate={"status": "NONE"}, frigate_end_time=T0 + 472.3),
    "merged_into_another_visit": _emission(seq=5, merged_into="7a2b"),
    "continues_an_earlier_visit": _emission(seq=1, state="ENTERED_ZONE",
                                            continues_visit_id="5c1d"),
}


def build() -> dict:
    return {name: build_event(em, "v380-shopsign", "Shop Sign", {"front_lot": "Front Lot"},
                              "0.17.2")
            for name, em in CASES.items()}


if __name__ == "__main__":
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(build(), fh, indent=2, sort_keys=True)
        fh.write("\n")
    print(f"wrote {len(CASES)} payloads to {OUT}")
