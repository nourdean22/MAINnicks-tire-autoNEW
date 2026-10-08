"""The benchmark corpus never asks the generator for a beat its brief declares
real footage or deterministic graphics (shot router,
apps/nickstire/shared/shotRouter.ts). Without the filter, the three Reels
Engine v2 proof packs (2026-10-08) put their "REAL macro ..." beats into the
generation benchmark and reshuffled 46 of the 48 committed cases.
"""
from __future__ import annotations

import json
import unittest

from bench.build_corpus import PACKS, beats_of, declared_not_generated

PROOF_PACKS = (
    "2026-10-08-proof-01-uneven-wear",
    "2026-10-08-proof-02-highway-shake",
    "2026-10-08-proof-03-patch-or-replace",
)


def pool_of(slug: str) -> list[dict]:
    return beats_of(json.loads((PACKS / slug / "brief.json").read_text()))


class DeclaredSourceFilter(unittest.TestCase):
    def test_declared_real_and_deterministic_beats_are_not_generator_workload(self) -> None:
        brief = {"storyboardBeats": [
            {"beatNumber": 1, "visual": "REAL macro: the worn inner edge of the tread under a raking light"},
            {"beatNumber": 2, "visual": "DETERMINISTIC card: three causes of one-edge wear, side by side"},
            {"beatNumber": 3, "visual": "REAL + DETERMINISTIC: nail head in the tread with a zone outline"},
            {"beatNumber": 4, "visual": "a tire rolling through a puddle at dusk, slow dolly", "source": "real"},
            {"beatNumber": 5, "visual": "AI illustrative: fog rolling over an empty lot at dawn"},
            {"beatNumber": 6, "visual": "a worn tire spinning slowly on a dark turntable, rim light"},
            {"beatNumber": 7, "visual": "REAL macro of the tread, re-declared by the field", "source": "ai_illustrative"},
        ]}
        # The `source` field wins over the tag (beat 7 kept, beat 4 dropped);
        # undeclared and AI-illustrative beats stay generator workload.
        self.assertEqual([b["beat"] for b in beats_of(brief)], [5, 6, 7])

    def test_the_tag_is_read_only_at_the_start_never_inferred_from_prose(self) -> None:
        self.assertFalse(declared_not_generated({}, "a really clean shot of a real tire on the lift"))
        self.assertFalse(declared_not_generated({}, "Realistic close-up of a lug nut"))
        self.assertTrue(declared_not_generated({}, "  real macro: tread gauge in the groove"))

    def test_the_proof_packs_add_nothing_to_the_pool_and_an_older_pack_still_does(self) -> None:
        for slug in PROOF_PACKS:
            self.assertEqual(pool_of(slug), [], slug)
        # Control: a pack written before source tags existed still contributes
        # every beat (the penny test pack carries five, all undeclared).
        self.assertEqual(len(pool_of("2026-08-14-penny-test")), 5)


if __name__ == "__main__":
    unittest.main()
