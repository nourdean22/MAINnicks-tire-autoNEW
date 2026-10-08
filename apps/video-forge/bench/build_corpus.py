"""Build the Nick's video benchmark corpus from REAL historical reel packs.

Source: apps/nickstire/docs/reel-packs/*/brief.json (shipped storyboards — public
social content, no customer records). Each beat is tagged by category, then a
stratified, seeded sample is drawn so every category the mission names is
represented. Output is deterministic for a given source tree + seed:

    python bench/build_corpus.py            # writes bench/corpus.v1.jsonl
"""
from __future__ import annotations

import glob
import hashlib
import json
import random
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PACKS = ROOT / "apps/nickstire/docs/reel-packs"
OUT = Path(__file__).with_name("corpus.v1.jsonl")
SEED = 20261003
TARGET = 48

CATEGORIES: dict[str, str] = {
    "tires": r"\btire|tread|sidewall|penny|tpms|lug nut|spare",
    "brakes": r"\bbrake|caliper|pad\b|pedal",
    "rotors": r"\brotor",
    "suspension": r"\bstrut|shock|sway bar|ball joint|tie rod|suspension|control arm|bounce",
    "oil": r"\boil\b|dipstick|oil change",
    "batteries": r"\bbattery|terminal|alternator|starter",
    "alignment_wheels": r"\balign|wheel bearing|balance|pull(s|ing)? to",
    "mechanical_macro": r"\bmacro|extreme close|close-up|closeup",
    "object_character": r"\bcharacter|anthropomorph|face on|cartoon|mascot|talking",
    "shop_environment": r"\bshop bay|service bay|garage|lift\b|workbench",
    "abstract_educational": r"\bdiagram|graphic|infograph|split[- ]screen|comparison|abstract",
    "rapid_action": r"\bwhip|fast|quick|snap|rapid|spin",
    "slow_cinematic": r"\bslow|dolly|push-in|drift|glide",
    "fluids_engine": r"\bcoolant|radiator|transmission fluid|engine|exhaust|smoke",
}
PII = re.compile(r"(\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b|[\w.+-]+@[\w-]+\.[\w.]+)")
# A beat its brief DECLARES as real footage or deterministic graphics is never
# generator workload (apps/nickstire/shared/shotRouter.ts): the first must be
# captured, the second is rendered. Benchmarking the generator on it measures
# a job it must never be given. Same reading as declaredBeatSource there: the
# `source` field, else the leading tag of `visual`; nothing inferred from prose.
# Undeclared beats — every pack written before 2026-10-08 — stay in the pool,
# because the lane generated all of them.
DECLARED_NOT_GENERATED = re.compile(r"^(REAL|DETERMINISTIC)\b")


def declared_not_generated(beat: dict, visual: str) -> bool:
    source = str(beat.get("source") or "").strip().lower()
    if source:
        return source in ("real", "deterministic")
    return bool(DECLARED_NOT_GENERATED.match(visual.lstrip()[:24].upper()))


def beats_of(brief: dict) -> list[dict]:
    raw = brief.get("storyboardBeats") or brief.get("beats") or []
    out = []
    for i, b in enumerate(raw if isinstance(raw, list) else []):
        if not isinstance(b, dict):
            continue
        visual = str(b.get("visual") or b.get("prompt") or "").strip()
        if len(visual) < 20 or declared_not_generated(b, visual):
            continue
        out.append({"beat": b.get("beatNumber") or b.get("index") or i + 1, "visual": visual, "motion": str(b.get("motion") or "").strip(), "audioCue": str(b.get("audioCue") or "").strip()})
    return out


def main() -> None:
    pool = []
    for f in sorted(glob.glob(str(PACKS / "*/brief.json"))):
        pack = Path(f).parent.name
        try:
            brief = json.loads(Path(f).read_text())
        except Exception:
            continue
        for b in beats_of(brief):
            text = f"{b['visual']} {b['motion']} {pack.replace('-', ' ')}".lower()
            if PII.search(text):
                continue  # never let a contact detail into an eval corpus
            cats = [c for c, rx in CATEGORIES.items() if re.search(rx, text)]
            oc = brief.get("objectCharacter")
            oc = oc if isinstance(oc, str) else (oc or {}).get("name") if isinstance(oc, dict) else None
            if oc and "object_character" not in cats:
                cats.append("object_character")
            pool.append({**b, "pack": pack, "categories": cats or ["uncategorized"], "objectCharacter": oc or ""})
    rng = random.Random(SEED)
    rng.shuffle(pool)
    chosen, seen = [], set()
    per_pack: dict[str, int] = {}

    def take(p: dict) -> bool:
        key = (p["pack"], p["beat"])
        if key in seen or per_pack.get(p["pack"], 0) >= 2:
            return False
        chosen.append(p); seen.add(key); per_pack[p["pack"]] = per_pack.get(p["pack"], 0) + 1
        return True

    # Stratify: round-robin across categories until each has MIN_PER_CAT (or its
    # pool is exhausted), so a dominant tag (macro/slow) cannot crowd out rare ones.
    MIN_PER_CAT = 3
    def count(cat: str) -> int:
        return sum(cat in q["categories"] for q in chosen)
    progress = True
    while progress and len(chosen) < TARGET:
        progress = False
        for cat in sorted(CATEGORIES, key=lambda c: sum(c in p["categories"] for p in pool)):  # rarest first
            if count(cat) >= MIN_PER_CAT or len(chosen) >= TARGET:
                continue
            for p in pool:
                if cat in p["categories"] and take(p):
                    progress = True
                    break
    for p in pool:
        if len(chosen) >= TARGET:
            break
        take(p)
    with OUT.open("w") as fh:
        for i, p in enumerate(chosen[:TARGET]):
            case = {
                "case_id": f"nt-v1-{i:03d}",
                "source_pack": p["pack"],
                "source_beat": p["beat"],
                "categories": p["categories"],
                "visual": p["visual"],
                "motion": p["motion"],
                "audioCue": p["audioCue"],
                "objectCharacter": p.get("objectCharacter", ""),
                "seed": 1000 + i,
            }
            case["sha256"] = hashlib.sha256(json.dumps({k: case[k] for k in ("visual", "motion", "audioCue", "seed")}, sort_keys=True).encode()).hexdigest()
            fh.write(json.dumps(case) + "\n")
    cov = {c: sum(c in p["categories"] for p in chosen[:TARGET]) for c in CATEGORIES}
    pool_cov = {c: sum(c in p["categories"] for p in pool) for c in CATEGORIES}
    print(json.dumps({"pool_beats": len(pool), "cases": min(TARGET, len(chosen)), "coverage": cov, "pool_coverage": pool_cov}, indent=1))


if __name__ == "__main__":
    main()
