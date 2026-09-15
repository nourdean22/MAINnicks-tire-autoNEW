#!/usr/bin/env python
"""
GrowthBook cross-check of the experiment kernel -- 2026-09-15.

docs/UPSTREAMS.md names GrowthBook as the external ORACLE for the kernel in
shared/experimentKernel.ts: feed both engines identical synthetic A/A and
injected-effect streams and compare decisions. This script is that comparison.

  1. `pnpm calibrate:kernel -- --stream aa5 500 > aa5.json` (repeat per scenario)
     emits, per run, the full daily cumulative counts the kernel saw, the
     kernel's ACTUAL verdict on each day (every gate: floor, sample-ratio
     mismatch, no-signal) and the always-valid p behind it.
  2. This script applies gbstats' SequentialTwoSidedTTest (GrowthBook's
     sequential engine; absolute difference, same alpha) to the SAME counts,
     day by day, and records the first day each engine would declare.

The kernel "declares" only when its verdict is `winner` -- a raw p below alpha
on a stream the kernel REFUSES (invalid_design) is not a declaration, which is
what a first draft of this script got wrong (Codex review of #2336). A run the
kernel refused on any day is reported in its own `kernelRefused` bucket and
excluded from the agreement denominator, because gbstats has no design gate to
agree or disagree with there.

Pinned: gbstats == GBSTATS_VERSION. The published numbers are for that release;
a different installed version is refused unless --allow-any-gbstats is passed,
and the version actually used is printed in every report.

Setup (scratch venv; gbstats 0.8.0 pins numpy<2, which has no wheel for
Python 3.14, so install its deps unpinned and gbstats itself with --no-deps):
  python -m venv gbvenv
  gbvenv/Scripts/python -m pip install numpy scipy pandas nbformat pydantic
  gbvenv/Scripts/python -m pip install --no-deps gbstats==0.8.0
  gbvenv/Scripts/python scripts/proof/growthbook-crosscheck.py --self-test
  gbvenv/Scripts/python scripts/proof/growthbook-crosscheck.py aa5.json plus3pp.json ...
  gbvenv/Scripts/python -m unittest scripts/proof/test_growthbook_crosscheck.py

--self-test is the behavioural canary: an agreeing fixture must report full
agreement, a disagreeing fixture must report the disagreement, and a mutation
that replaces the GrowthBook p with the kernel's own p must be CAUGHT (the
fixture where they must differ would otherwise read as perfect agreement).

Read-only, deterministic, no network. Prints a table and, with --json, the
structured result the ledger row cites.
"""
from __future__ import annotations

import importlib.metadata
import json
import statistics
import sys
from typing import Any, Callable

GBSTATS_VERSION = "0.8.0"

GbP = Callable[[int, int, int, int, float, float], float]


def installed_gbstats_version() -> str:
    try:
        return importlib.metadata.version("gbstats")
    except importlib.metadata.PackageNotFoundError:
        return "missing"


def gb_p(nc: int, xc: int, nv: int, xv: int, alpha: float, tuning: float) -> float:
    """GrowthBook's sequential two-sided test on cumulative proportion counts."""
    from gbstats.frequentist.tests import SequentialConfig, SequentialTwoSidedTTest
    from gbstats.models.statistics import ProportionStatistic

    a = ProportionStatistic(n=nc, sum=xc)
    b = ProportionStatistic(n=nv, sum=xv)
    cfg = SequentialConfig(difference_type="absolute", alpha=alpha, sequential_tuning_parameter=tuning)
    r = SequentialTwoSidedTTest(a, b, cfg).compute_result()
    return 1.0 if r.p_value is None else float(r.p_value)


def leading_arm(d: dict[str, Any]) -> str:
    rc = d["xc"] / d["nc"] if d["nc"] else 0.0
    rv = d["xv"] / d["nv"] if d["nv"] else 0.0
    return "variant" if rv > rc else "control"


def kernel_first_declare(days: list[dict[str, Any]]) -> tuple[int | None, str | None, bool]:
    """(first winner day, leading arm, refused-on-any-day) from the kernel's real verdicts."""
    refused = any(d.get("kernelStatus") == "invalid_design" for d in days)
    for d in days:
        if d.get("kernelStatus") == "winner":
            return d["day"], leading_arm(d), refused
    return None, None, refused


def gb_first_declare(days: list[dict[str, Any]], alpha: float, floor: int) -> tuple[int | None, str | None]:
    """First day gbstats' p < alpha with both arms at/over the same per-arm floor the kernel uses."""
    for d in days:
        if min(d["nc"], d["nv"]) < floor:
            continue
        if d["gbP"] < alpha:
            return d["day"], leading_arm(d)
    return None, None


def crosscheck(doc: dict[str, Any], tuning: float, gb: GbP = gb_p) -> dict[str, Any]:
    alpha = doc["alpha"]
    floor = doc["minExposuresPerArm"]
    truly = doc.get("trulyBetter")
    runs = doc["streams"]
    both = neither = only_k = only_g = refused_runs = 0
    k_days: list[int] = []
    g_days: list[int] = []
    k_wrong = g_wrong = 0
    for days in runs:
        for d in days:
            d["gbP"] = gb(d["nc"], d["xc"], d["nv"], d["xv"], alpha, tuning)
        kd, karm, refused = kernel_first_declare(days)
        gd, garm = gb_first_declare(days, alpha, floor)
        if kd is not None:
            k_days.append(kd)
            if truly is not None and karm != truly:
                k_wrong += 1
        if gd is not None:
            g_days.append(gd)
            if truly is not None and garm != truly:
                g_wrong += 1
        if refused:
            refused_runs += 1  # the kernel's design gate fired; gbstats has no such gate to compare
            continue
        if kd is not None and gd is not None:
            both += 1
        elif kd is None and gd is None:
            neither += 1
        elif kd is not None:
            only_k += 1
        else:
            only_g += 1
    n = len(runs)
    compared = n - refused_runs
    frac = lambda x: (x / compared) if compared else 0.0  # noqa: E731
    return {
        "scenario": doc["scenario"],
        "name": doc["name"],
        "runs": n,
        "seed": doc["seed"],
        "alpha": alpha,
        "gbstatsVersion": installed_gbstats_version(),
        "gbSequentialTuningParameter": tuning,
        "kernel": {
            "declareRate": len(k_days) / n,
            "wrongArmRate": k_wrong / n,
            "refusedRate": refused_runs / n,
            "medianDeclareDay": statistics.median(k_days) if k_days else None,
        },
        "growthbook": {
            "declareRate": len(g_days) / n,
            "wrongArmRate": g_wrong / n,
            "medianDeclareDay": statistics.median(g_days) if g_days else None,
        },
        "agreement": {
            "comparedRuns": compared,
            "both": frac(both),
            "neither": frac(neither),
            "onlyKernel": frac(only_k),
            "onlyGrowthBook": frac(only_g),
        },
    }


# --- self-test fixtures ----------------------------------------------------

def _stream(nc_per_day: int, rate_c: float, rate_v: float, days: int, kernel_status: str, kernel_p: float) -> list[dict[str, Any]]:
    out = []
    for day in range(1, days + 1):
        n = nc_per_day * day
        out.append({"day": day, "nc": n, "xc": round(n * rate_c), "nv": n, "xv": round(n * rate_v), "kernelStatus": kernel_status if day > 1 else "insufficient_data", "kernelP": kernel_p})
    return out


def self_test_docs() -> dict[str, dict[str, Any]]:
    base = {"seed": 1, "alpha": 0.05, "minExposuresPerArm": 50}
    return {
        # a huge effect: both engines must declare
        "agree": {**base, "scenario": "agree", "name": "agree", "trulyBetter": "variant", "streams": [_stream(200, 0.05, 0.20, 10, "winner", 1e-6)]},
        # counts show NO effect, but the exported kernel verdict is planted as a winner:
        # gbstats must NOT declare -> onlyKernel. This is the fixture a mutated gb (one
        # that echoes the kernel's p) cannot pass, because it would then "agree".
        "disagree": {**base, "scenario": "disagree", "name": "disagree", "trulyBetter": None, "streams": [_stream(200, 0.05, 0.05, 10, "winner", 1e-6)]},
        # the kernel refused the design: not a declaration, not compared
        "refused": {**base, "scenario": "refused", "name": "refused", "trulyBetter": None, "streams": [_stream(200, 0.05, 0.20, 10, "invalid_design", 1e-6)]},
    }


def self_test(gb: GbP = gb_p, tuning: float = 5000.0) -> list[str]:
    """Returns the list of failures (empty = pass)."""
    docs = self_test_docs()
    fails: list[str] = []
    agree = crosscheck(json.loads(json.dumps(docs["agree"])), tuning, gb)
    if agree["agreement"]["both"] != 1.0:
        fails.append(f"agree fixture: expected both=1.0, got {agree['agreement']}")
    disagree = crosscheck(json.loads(json.dumps(docs["disagree"])), tuning, gb)
    if disagree["agreement"]["onlyKernel"] != 1.0:
        fails.append(f"disagree fixture: expected onlyKernel=1.0 (gbstats must not declare on flat counts), got {disagree['agreement']}")
    refused = crosscheck(json.loads(json.dumps(docs["refused"])), tuning, gb)
    if refused["kernel"]["refusedRate"] != 1.0 or refused["agreement"]["comparedRuns"] != 0 or refused["kernel"]["declareRate"] != 0.0:
        fails.append(f"refused fixture: a refused design must not count as a declaration nor be compared, got {refused['kernel']} {refused['agreement']}")
    # mutation guard: a gb that merely echoes the kernel's p must be caught by the disagree fixture
    echo: GbP = lambda nc, xc, nv, xv, alpha, tuning: 1e-6  # noqa: E731 -- "agrees" with the planted winner
    mutated = crosscheck(json.loads(json.dumps(docs["disagree"])), tuning, echo)
    if mutated["agreement"]["onlyKernel"] == 1.0:
        fails.append("mutation guard: an engine that echoes the kernel still produced a disagreement -- the fixture is not discriminating")
    return fails


def main() -> None:
    argv = sys.argv[1:]
    as_json = "--json" in argv
    allow_any = "--allow-any-gbstats" in argv
    tuning = 5000.0
    for a in argv:
        if a.startswith("--tuning="):
            tuning = float(a.split("=", 1)[1])
    paths = [a for a in argv if not a.startswith("--")]

    version = installed_gbstats_version()
    if version != GBSTATS_VERSION and not allow_any:
        print(f"refusing: gbstats {version} installed, the published proof is for {GBSTATS_VERSION} (pass --allow-any-gbstats to override; the report will carry the version used)", file=sys.stderr)
        sys.exit(2)

    if "--self-test" in argv:
        fails = self_test(tuning=tuning)
        for f in fails:
            print("FAIL " + f)
        print(f"self-test {'FAILED' if fails else 'ok'} (gbstats {version})")
        sys.exit(1 if fails else 0)

    if not paths:
        print(__doc__)
        sys.exit(2)
    results = []
    for path in paths:
        with open(path, encoding="utf-8") as fh:
            results.append(crosscheck(json.load(fh), tuning))
    if as_json:
        print(json.dumps(results, indent=2))
        return
    print(f"kernel vs GrowthBook gbstats {version} sequential (absolute diff, alpha per file, tuning {tuning:g})\n")
    print("scenario   runs | kernel: declare wrong refused medDay | growthbook: declare wrong medDay | compared  both  neither onlyK onlyGB")
    for r in results:
        k, g, a = r["kernel"], r["growthbook"], r["agreement"]
        print(
            f"{r['scenario']:<10} {r['runs']:>4} | {k['declareRate']:>7.1%} {k['wrongArmRate']:>5.1%} {k['refusedRate']:>7.1%} {str(k['medianDeclareDay'] or '-'):>6} | "
            f"{g['declareRate']:>7.1%} {g['wrongArmRate']:>5.1%} {str(g['medianDeclareDay'] or '-'):>6} | "
            f"{a['comparedRuns']:>8} {a['both']:>5.1%} {a['neither']:>7.1%} {a['onlyKernel']:>5.1%} {a['onlyGrowthBook']:>6.1%}"
        )


if __name__ == "__main__":
    main()
