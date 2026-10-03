"""Blind pairwise review sheet. Randomizes left/right and hides profile names.

    python bench/make_pairwise.py results/a.jsonl results/b.jsonl --out review.csv --key review.key.json

Reviewers see only case + clip A/B and answer: which is more publishable for
Nick's (A / B / tie / both unusable), plus free-text defects. The key file maps
A/B back to profiles; keep it away from reviewers. Machine rendered-QA verdicts
are joined AFTER review so disagreement between QA and humans is recorded, not
hidden.
"""
from __future__ import annotations

import argparse
import csv
import json
import random
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("results", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--key", required=True)
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    rows = [json.loads(l) for f in a.results for l in Path(f).read_text().splitlines() if l.strip()]
    by_case: dict[str, list[dict]] = {}
    for r in rows:
        if r.get("status") == "succeeded":
            by_case.setdefault(r["case_id"], []).append(r)
    rng = random.Random(a.seed)
    key, sheet = {}, []
    for case, rs in sorted(by_case.items()):
        for i in range(len(rs)):
            for j in range(i + 1, len(rs)):
                left, right = (rs[i], rs[j]) if rng.random() < 0.5 else (rs[j], rs[i])
                pid = f"{case}-{len(sheet):04d}"
                key[pid] = {"A": f"{left['profile']}/{left['arm']}", "B": f"{right['profile']}/{right['arm']}"}
                sheet.append({"pair_id": pid, "case_id": case, "clip_A": left["clip"], "clip_B": right["clip"], "preference": "", "defects_A": "", "defects_B": ""})
    with open(a.out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(sheet[0].keys()) if sheet else ["pair_id"])
        w.writeheader(); w.writerows(sheet)
    Path(a.key).write_text(json.dumps(key, indent=1))
    print(f"{len(sheet)} blind pairs → {a.out}")


if __name__ == "__main__":
    main()
