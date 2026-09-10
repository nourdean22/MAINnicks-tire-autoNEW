"""The producer half of the wire contract: what `build_event` puts on the wire, frozen.

`test_contract.py` already checks the payload against a Python-authored expectation. That
cannot catch a disagreement with the RECEIVER, and the disagreement is not hypothetical: on
2026-09-10 every event was rejected `400 Invalid vehicle event payload` for hours, because
Zod's `.optional()` accepts a MISSING KEY and never `null`, while Python's `None` serialises
to JSON null. Both sides were individually well-tested and green.

A cross-language assertion needs both runtimes in one process and no CI job here has that, so
the halves are joined by a checked-in fixture:

  * THIS FILE fails when the producer drifts from `fixtures/wire_payloads.json`.
  * `apps/statenour/lib/services/__tests__/vehicleEventWireContract.test.ts` fails when the
    SCHEMA stops accepting that same file.

Neither needs the other language, and a change on either side that the other would reject
turns exactly one of them red.
"""
from __future__ import annotations

import json
import os
import unittest

from fixtures.make_wire_payloads import OUT, build


class WirePayloadFixtureTest(unittest.TestCase):

    def setUp(self) -> None:
        with open(OUT, encoding="utf-8") as fh:
            self.recorded = json.load(fh)
        self.current = build()

    def test_the_fixture_matches_what_the_producer_builds_today(self):
        """The drift gate. Regenerate with `python tests/fixtures/make_wire_payloads.py` and
        READ THE DIFF -- a change here is a change to what the cloud will be asked to accept,
        and the statenour half of this contract is the thing that decides whether it will."""
        self.assertEqual(
            self.recorded, self.current,
            "the producer's wire payload changed. Regenerate the fixture, read the diff, and "
            "make sure vehicleEventWireContract.test.ts still passes before shipping it.")

    def test_the_fixture_covers_the_state_that_actually_broke(self):
        """A positive control on the corpus, not on the code. The 400 reproduced on a
        completed visit and not on an arrival, because LEFT nulls a DIFFERENT set of fields.
        A fixture holding only happy-path arrivals would have been green through the outage."""
        self.assertIn("left_with_everything_optional_absent", self.recorded)
        self.assertEqual(
            self.recorded["left_with_everything_optional_absent"]["data"]["state"], "LEFT")

    def test_NO_payload_contains_a_JSON_null_outside_metadata(self):
        """The invariant the receiver actually enforces, asserted here so the producer half
        fails first and locally rather than as a 400 in production.

        `metadata` is exempt by design: it is typed `z.record(z.string(), z.unknown())`, which
        accepts null, and its nulls are MEANINGFUL -- `frigateEndTime: null` says the event has
        not ended, which is not the same claim as the key being absent.
        """
        def nulls(node, path="", inside_metadata=False):
            found = []
            if isinstance(node, dict):
                for k, v in node.items():
                    here = f"{path}.{k}" if path else k
                    if v is None and not inside_metadata:
                        found.append(here)
                    found += nulls(v, here, inside_metadata or k == "metadata")
            elif isinstance(node, list):
                for i, v in enumerate(node):
                    found += nulls(v, f"{path}[{i}]", inside_metadata)
            return found

        offenders = {name: nulls(p) for name, p in self.recorded.items() if nulls(p)}
        self.assertEqual(
            offenders, {},
            "Zod `.optional()` accepts a MISSING KEY and never null, so every one of these "
            "would be rejected by the receiver with the whole event dropped.")

    def test_FALSE_and_ZERO_survive(self):
        """The mutation that a truthiness test instead of an `is not None` test would pass.

        `stationary: false` is a claim about the vehicle and `confidence: 0.0` is a measured
        value. Stripping them because they are falsy would silently change what the cloud is
        told, in the direction that looks like a working fix.
        """
        left = self.recorded["left_with_everything_optional_absent"]["data"]
        self.assertIs(left["stationary"], False)
        self.assertEqual(left["confidence"], 0.0)
        self.assertIs(left["estimated"], False)
        self.assertNotIn("zone", left, "a genuinely absent field is ABSENT, not null")
        self.assertNotIn("zoneName", left)


if __name__ == "__main__":
    unittest.main()
