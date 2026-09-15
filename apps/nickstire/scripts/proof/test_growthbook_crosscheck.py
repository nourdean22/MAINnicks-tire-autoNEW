"""
Canaries for growthbook-crosscheck.py -- run inside the gbstats venv:

  gbvenv/Scripts/python -m unittest scripts/proof/test_growthbook_crosscheck.py

Break-it-first: the accounting must report a disagreement when the engines
differ, must not count a refused design as a declaration, and a mutated
engine that echoes the kernel's p must be caught by the disagree fixture.
The last test needs the real gbstats and pins that its p is NOT the kernel's
p on the disagree fixture -- the exact substitution the review named.
"""
from __future__ import annotations

import importlib.util
import json
import pathlib
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("gbx", HERE / "growthbook-crosscheck.py")
gbx = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(gbx)


def fresh(name: str) -> dict:
    return json.loads(json.dumps(gbx.self_test_docs()[name]))


class Accounting(unittest.TestCase):
    def test_disagreement_is_reported_when_growthbook_never_declares(self) -> None:
        never = lambda nc, xc, nv, xv, alpha, tuning: 1.0  # noqa: E731
        r = gbx.crosscheck(fresh("agree"), 5000.0, never)
        self.assertEqual(r["agreement"]["onlyKernel"], 1.0)
        self.assertEqual(r["growthbook"]["declareRate"], 0.0)

    def test_agreement_is_reported_when_both_declare(self) -> None:
        always = lambda nc, xc, nv, xv, alpha, tuning: 1e-9  # noqa: E731
        r = gbx.crosscheck(fresh("agree"), 5000.0, always)
        self.assertEqual(r["agreement"]["both"], 1.0)

    def test_growthbook_only_declaration_is_its_own_bucket(self) -> None:
        always = lambda nc, xc, nv, xv, alpha, tuning: 1e-9  # noqa: E731
        doc = fresh("agree")
        for d in doc["streams"][0]:
            d["kernelStatus"] = "keep_running"
        r = gbx.crosscheck(doc, 5000.0, always)
        self.assertEqual(r["agreement"]["onlyGrowthBook"], 1.0)
        self.assertEqual(r["kernel"]["declareRate"], 0.0)

    def test_refused_design_is_neither_a_declaration_nor_compared(self) -> None:
        always = lambda nc, xc, nv, xv, alpha, tuning: 1e-9  # noqa: E731
        r = gbx.crosscheck(fresh("refused"), 5000.0, always)
        self.assertEqual(r["kernel"]["refusedRate"], 1.0)
        self.assertEqual(r["kernel"]["declareRate"], 0.0)
        self.assertEqual(r["agreement"]["comparedRuns"], 0)

    def test_kernel_declares_only_on_a_winner_verdict_not_on_a_low_p(self) -> None:
        doc = fresh("agree")
        for d in doc["streams"][0]:
            d["kernelStatus"] = "keep_running"  # p stays 1e-6 but the verdict is not a winner
        day, arm, refused = gbx.kernel_first_declare(doc["streams"][0])
        self.assertIsNone(day)
        self.assertFalse(refused)

    def test_growthbook_floor_matches_the_kernel_floor(self) -> None:
        always = lambda nc, xc, nv, xv, alpha, tuning: 1e-9  # noqa: E731
        days = fresh("agree")["streams"][0]
        for d in days:
            d["gbP"] = always(0, 0, 0, 0, 0, 0)
        day, _ = gbx.gb_first_declare(days, 0.05, 10_000)
        self.assertIsNone(day)  # never reaches the floor
        day, _ = gbx.gb_first_declare(days, 0.05, 50)
        self.assertEqual(day, 1)


class MutationGuard(unittest.TestCase):
    def test_self_test_passes_with_the_real_engine_and_catches_an_echoing_one(self) -> None:
        self.assertEqual(gbx.self_test(), [])
        echo = lambda nc, xc, nv, xv, alpha, tuning: 1e-6  # noqa: E731
        fails = gbx.self_test(gb=echo)
        self.assertTrue(any("disagree fixture" in f for f in fails), fails)

    def test_real_gbstats_p_is_not_the_kernel_p_on_flat_counts(self) -> None:
        d = fresh("disagree")["streams"][0][-1]
        p = gbx.gb_p(d["nc"], d["xc"], d["nv"], d["xv"], 0.05, 5000.0)
        self.assertGreaterEqual(p, 0.5)  # flat counts: no evidence
        self.assertNotAlmostEqual(p, d["kernelP"])


if __name__ == "__main__":
    unittest.main()
