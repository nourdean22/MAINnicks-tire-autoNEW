#!/usr/bin/env python
"""
GrowthBook cross-check of the experiment kernel -- 2026-09-15.

docs/UPSTREAMS.md names GrowthBook as the external ORACLE for the kernel in
shared/experimentKernel.ts: feed both engines identical synthetic A/A and
injected-effect streams and compare decisions. This script is that comparison.

  1. `pnpm calibrate:kernel -- --stream aa5 500 > aa5.json` (repeat per scenario)
     emits, per run, the full daily cumulative counts the kernel saw plus its
     own always-valid p on each day.
  2. This script applies gbstats' SequentialTwoSidedTTest (GrowthBook's
     sequential engine; absolute difference, same alpha) to the SAME counts,
     day by day, and records the first day each engine would declare.

Both engines use the same stopping rule shape (first day p < alpha once both
arms have >= minExposuresPerArm), so the comparison is engine vs engine, not
rule vs rule. Numbers that matter:
  - A/A: each engine's any-peek false-positive rate on identical streams
  - injected: power, wrong-arm rate, and how often the two agree per run

Setup (scratch venv; gbstats 0.8.0 pins numpy<2, which has no wheel for
Python 3.14, so install its deps unpinned and gbstats with --no-deps):
  python -m venv gbvenv
  gbvenv/Scripts/python -m pip install numpy scipy pandas nbformat pydantic
  gbvenv/Scripts/python -m pip install --no-deps gbstats
  gbvenv/Scripts/python scripts/proof/growthbook-crosscheck.py aa5.json plus3pp.json ...

Read-only, deterministic, no network. Prints a table and, with --json, the
structured result the ledger row cites.
"""
from __future__ import annotations

import json
import statistics
import sys
from typing import Any

from gbstats.frequentist.tests import SequentialConfig, SequentialTwoSidedTTest
from gbstats.models.statistics import ProportionStatistic


def gb_p(nc: int, xc: int, nv: int, xv: int, alpha: float, tuning: float) -> float:
    a = ProportionStatistic(n=nc, sum=xc)
    b = ProportionStatistic(n=nv, sum=xv)
    cfg = SequentialConfig(difference_type="absolute", alpha=alpha, sequential_tuning_parameter=tuning)
    r = SequentialTwoSidedTTest(a, b, cfg).compute_result()
    p = r.p_value
    return 1.0 if p is None else float(p)


def first_declare(days: list[dict[str, Any]], key: str, alpha: float, floor: int) -> tuple[int | None, str | None]:
    """First day the engine's p < alpha with both arms at/over the floor; returns (day, leading arm)."""
    for d in days:
        if min(d["nc"], d["nv"]) < floor:
            continue
        if d[key] < alpha:
            rc = d["xc"] / d["nc"] if d["nc"] else 0.0
            rv = d["xv"] / d["nv"] if d["nv"] else 0.0
            return d["day"], ("variant" if rv > rc else "control")
    return None, None


def crosscheck(doc: dict[str, Any], tuning: float) -> dict[str, Any]:
    alpha = doc["alpha"]
    floor = doc["minExposuresPerArm"]
    truly = doc.get("trulyBetter")
    runs = doc["streams"]
    both = neither = only_k = only_g = 0
    k_days: list[int] = []
    g_days: list[int] = []
    k_wrong = g_wrong = 0
    for days in runs:
        for d in days:
            d["gbP"] = gb_p(d["nc"], d["xc"], d["nv"], d["xv"], alpha, tuning)
        kd, karm = first_declare(days, "kernelP", alpha, floor)
        gd, garm = first_declare(days, "gbP", alpha, floor)
        if kd is not None:
            k_days.append(kd)
            if truly is not None and karm != truly:
                k_wrong += 1
        if gd is not None:
            g_days.append(gd)
            if truly is not None and garm != truly:
                g_wrong += 1
        if kd is not None and gd is not None:
            both += 1
        elif kd is None and gd is None:
            neither += 1
        elif kd is not None:
            only_k += 1
        else:
            only_g += 1
    n = len(runs)
    return {
        "scenario": doc["scenario"],
        "name": doc["name"],
        "runs": n,
        "seed": doc["seed"],
        "alpha": alpha,
        "gbSequentialTuningParameter": tuning,
        "kernel": {
            "declareRate": len(k_days) / n,
            "wrongArmRate": k_wrong / n,
            "medianDeclareDay": statistics.median(k_days) if k_days else None,
        },
        "growthbook": {
            "declareRate": len(g_days) / n,
            "wrongArmRate": g_wrong / n,
            "medianDeclareDay": statistics.median(g_days) if g_days else None,
        },
        "agreement": {"both": both / n, "neither": neither / n, "onlyKernel": only_k / n, "onlyGrowthBook": only_g / n},
    }


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    as_json = "--json" in sys.argv
    tuning = 5000.0
    for a in sys.argv[1:]:
        if a.startswith("--tuning="):
            tuning = float(a.split("=", 1)[1])
    if not args:
        print(__doc__)
        sys.exit(2)
    results = []
    for path in args:
        with open(path, encoding="utf-8") as fh:
            results.append(crosscheck(json.load(fh), tuning))
    if as_json:
        print(json.dumps(results, indent=2))
        return
    print(f"kernel vs GrowthBook gbstats sequential (absolute diff, alpha per file, tuning {tuning:g})\n")
    print("scenario   runs | kernel: declare wrong medDay | growthbook: declare wrong medDay | both  neither onlyK onlyGB")
    for r in results:
        k, g, a = r["kernel"], r["growthbook"], r["agreement"]
        print(
            f"{r['scenario']:<10} {r['runs']:>4} | {k['declareRate']:>7.1%} {k['wrongArmRate']:>5.1%} {str(k['medianDeclareDay'] or '-'):>6} | "
            f"{g['declareRate']:>7.1%} {g['wrongArmRate']:>5.1%} {str(g['medianDeclareDay'] or '-'):>6} | "
            f"{a['both']:>5.1%} {a['neither']:>7.1%} {a['onlyKernel']:>5.1%} {a['onlyGrowthBook']:>6.1%}"
        )


if __name__ == "__main__":
    main()
