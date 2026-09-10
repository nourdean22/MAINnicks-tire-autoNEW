"""The Failure Museum: every moment the system found confusing, replayable forever.

A hard case is recorded because the producer was unsure. That makes it the most valuable
frame data this shop will ever have -- and until now it was data you could LOOK at. This
turns each episode into a regression fixture: run the current pipeline over the real pixels,
reduce what it did to a normalised outcome, and compare it against the outcome that was
blessed. A change that alters what the system concludes about a clip it already struggled
with is exactly the change somebody needs to see.

WHY NORMALISE. The raw outcome is full of things that change on every run and mean nothing:
absolute timestamps, visit ids, object identity. Comparing those makes every replay differ
and the suite becomes noise that gets muted. What is compared is the SHAPE of the conclusion
-- how many visits, in what state sequence, how many frames suppressed and for which
reasons. Two runs that reach the same conclusions about the same pixels agree, whatever the
clock said.

A GOLDEN IS EVIDENCE ABOUT ONE CONFIGURATION. Blessed under one calibration and one detector,
it says nothing about another: change the lot polygon and the same pixels legitimately
produce different visits. Each golden records what it was blessed against, and a comparison
across a mismatch is reported as STALE rather than as a failure -- calling it a regression
would train everyone to ignore the suite the first time they touch a calibration.

AN UNBLESSED EPISODE IS NOT A PASS. It is reported as its own outcome. A museum that
silently skipped what it had no answer for would grow quieter as it grew larger.
"""
from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

GOLDEN_NAME = "golden.json"

#: Outcome keys that are compared. Everything else in an outcome is CONTEXT -- recorded so a
#: human reading a diff knows what they are looking at, never compared, because it moves for
#: reasons that are not regressions.
COMPARED = ("frames", "visits", "stateSequences", "suppressedCounts", "emissionCount")


class Outcome(dict):
    """A normalised account of what the pipeline concluded about one episode."""

    @property
    def compared(self) -> Dict[str, Any]:
        return {k: self[k] for k in COMPARED if k in self}


def replay(episode_path: str, build_pipeline) -> Optional[Outcome]:
    """Run one episode's real frames through a freshly built pipeline.

    `build_pipeline` is a callable so the caller owns configuration -- the museum must not
    reach for a calibration of its own, or the fixture and the thing under test would be
    configured by different code and a mismatch would look like a regression.

    None when the episode has no frames. That is a broken fixture, not a passing one, and
    the caller reports it as such.
    """
    from . import episode as ep

    frames = list(ep.read_frames(episode_path))
    if not frames:
        return None
    pipeline = build_pipeline()
    from .frame import Frame

    # ANCHOR THE SCENE TO THE REPLAY. `SceneLock` holds a reference frame captured when the
    # pipeline was built -- from the LIVE camera, in the producer's case -- and every
    # replayed frame is compared against it. A recorded episode is a different scene by
    # construction (it is a cropped pane, possibly from a different day), so without this
    # every frame is suppressed as "capture window occluded" and the outcome is a
    # degenerate all-suppressed record. Blessing those would have produced six goldens that
    # agree with each other, pass forever, and measure nothing -- the silent instrument, in
    # its most convincing costume, because the suite would be green.
    #
    # A replay IS its own scene: the first recorded frame is the correct reference for the
    # frames that follow it.
    scene = getattr(pipeline, "scene", None)
    if scene is not None and hasattr(scene, "set_reference"):
        scene.set_reference(frames[0][1])

    emissions: List[Any] = []
    suppressed: Dict[str, int] = {}
    for seq, (ts, image, meta) in enumerate(frames):
        # The frame's RECORDED meta, replayed as it was. Not invented: the pipeline refuses
        # to let a frame with `window_verified` unset start, advance or end a visit, and
        # stamping it True here would launder exactly the frames that check exists to catch.
        # An episode written before the meta channel existed replays with none, and every
        # frame is suppressed -- which is the honest outcome for pixels whose provenance was
        # never recorded, and reads in the golden as a corpus that needs re-collecting.
        out = pipeline.step(Frame(ts=ts, image=image, seq=seq, source="replay", meta=meta))
        why = out.get("suppressed")
        if why:
            # The REASON, not the message: several carry measured numbers that differ every
            # run ("change=0.31"), and comparing those would make every replay a failure.
            key = str(why).split(":")[0].split("(")[0].strip()
            suppressed[key] = suppressed.get(key, 0) + 1
        emissions.extend(out.get("emissions") or [])

    by_visit: Dict[Any, List[str]] = {}
    for em in emissions:
        by_visit.setdefault(getattr(em, "visit_id", None), []).append(
            str(getattr(em, "state", "?")))
    # Visit IDS are not compared -- they are assigned in arrival order and shift whenever
    # anything upstream changes. The SEQUENCES are, sorted so two runs that produce the same
    # set of visit histories agree regardless of which id got which.
    sequences = sorted(["->".join(v) for v in by_visit.values()])
    return Outcome({
        "frames": len(frames),
        "visits": len(by_visit),
        "stateSequences": sequences,
        "suppressedCounts": dict(sorted(suppressed.items())),
        "emissionCount": len(emissions),
    })


def bless(episode_dir: str, outcome: Outcome, *, calibration: Optional[str],
          detector: Optional[str]) -> str:
    """Record an outcome as the expected one, stamped with what produced it."""
    payload = dict(outcome)
    payload["blessedUnder"] = {"calibration": calibration, "detector": detector}
    path = os.path.join(episode_dir, GOLDEN_NAME)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, sort_keys=True)
    return path


def compare(episode_dir: str, outcome: Optional[Outcome], *, calibration: Optional[str],
            detector: Optional[str]) -> Dict[str, Any]:
    """One verdict: PASS, REGRESSION, STALE, UNBLESSED or BROKEN.

    Five outcomes rather than two, because a boolean here would have to lie about three of
    them. STALE and UNBLESSED are not failures and must not be reported as passes either.
    """
    name = os.path.basename(episode_dir.rstrip(os.sep))
    if outcome is None:
        return {"episode": name, "verdict": "BROKEN",
                "why": "the episode has no readable frames"}
    path = os.path.join(episode_dir, GOLDEN_NAME)
    if not os.path.exists(path):
        return {"episode": name, "verdict": "UNBLESSED", "outcome": outcome.compared,
                "why": "no golden recorded; review the outcome and bless it"}
    try:
        with open(path, encoding="utf-8") as fh:
            golden = json.load(fh)
    except Exception as exc:  # noqa: BLE001
        return {"episode": name, "verdict": "BROKEN", "why": f"unreadable golden: {exc}"}

    under = golden.get("blessedUnder") or {}
    if under.get("calibration") != calibration or under.get("detector") != detector:
        return {"episode": name, "verdict": "STALE",
                "blessedUnder": under, "runningUnder": {"calibration": calibration,
                                                        "detector": detector},
                "why": "blessed under a different configuration, so it is not evidence "
                       "about this one -- re-bless deliberately after reviewing"}

    diffs = {k: {"golden": golden.get(k), "now": v}
             for k, v in outcome.compared.items() if golden.get(k) != v}
    if diffs:
        return {"episode": name, "verdict": "REGRESSION", "changed": diffs}
    return {"episode": name, "verdict": "PASS"}


def episodes(corpus_dir: str) -> List[str]:
    """Every episode directory in the corpus, oldest first by name (which is its stamp)."""
    if not os.path.isdir(corpus_dir):
        return []
    found = []
    for entry in sorted(os.listdir(corpus_dir)):
        full = os.path.join(corpus_dir, entry)
        if os.path.isdir(full) and os.path.exists(os.path.join(full, "episode.mcap")):
            found.append(full)
    return found


def run(corpus_dir: str, build_pipeline, *, calibration: Optional[str] = None,
        detector: Optional[str] = None, do_bless: bool = False) -> Dict[str, Any]:
    """Replay the whole corpus. Returns every verdict and a tally."""
    results = []
    for episode_dir in episodes(corpus_dir):
        outcome = replay(os.path.join(episode_dir, "episode.mcap"), build_pipeline)
        if do_bless and outcome is not None:
            bless(episode_dir, outcome, calibration=calibration, detector=detector)
            results.append({"episode": os.path.basename(episode_dir), "verdict": "BLESSED",
                            "outcome": outcome.compared})
            continue
        results.append(compare(episode_dir, outcome, calibration=calibration,
                               detector=detector))
    tally: Dict[str, int] = {}
    for r in results:
        tally[r["verdict"]] = tally.get(r["verdict"], 0) + 1
    return {"results": results, "tally": tally,
            # `ok` is REGRESSION-free and BROKEN-free. Unblessed and stale episodes are
            # neither passes nor failures: they are work for a person, and a run that called
            # them ok would let the museum go quiet exactly as it got interesting.
            "ok": not tally.get("REGRESSION") and not tally.get("BROKEN"),
            "corpus": corpus_dir}


def main(argv=None) -> int:
    """`python -m vision.museum` -- replay the corpus, or bless it.

    Builds the pipeline through `edge_main.build_edge`, deliberately: the fixture and the
    thing under test must be configured by the SAME code, or a configuration difference
    between harness and producer shows up as a regression and everyone learns to ignore the
    suite. It costs a capture source this never reads from, which is a small price.
    """
    import argparse
    import sys

    ap = argparse.ArgumentParser(description="replay the hard-case corpus")
    ap.add_argument("--corpus", default="data/hard-cases")
    ap.add_argument("--config", default="config.yaml")
    ap.add_argument("--camera", default="sign")
    ap.add_argument("--calibration", default=None)
    ap.add_argument("--model", default=None)
    ap.add_argument("--scene-atlas", default=None)
    ap.add_argument("--scene", default=None)
    ap.add_argument("--bless", action="store_true",
                    help="record the CURRENT outcome as expected. Review the diff first: "
                         "blessing a regression makes it the new truth, silently and "
                         "permanently.")
    args = ap.parse_args(argv)

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    import edge_main
    from visitd.config import build_config

    with open(args.config, encoding="utf-8") as fh:
        import yaml

        cfg = build_config(yaml.safe_load(fh), environ=dict(os.environ))
    built = edge_main.parse_args([])
    built.camera, built.calibration, built.model = args.camera, args.calibration, args.model
    built.scene_atlas, built.scene = args.scene_atlas, args.scene
    parts = edge_main.build_edge(cfg, built)
    vision, calibration_version, detector_name = parts[1], parts[3], parts[4]

    report = run(args.corpus, lambda: vision, calibration=str(calibration_version),
                 detector=str(detector_name), do_bless=args.bless)
    for r in report["results"]:
        line = f"  {r['verdict']:11s} {r['episode']}"
        if r.get("why"):
            line += f"  -- {r['why']}"
        if r.get("changed"):
            line += f"  -- {json.dumps(r['changed'])[:200]}"
        print(line)
    print()
    print("  ".join(f"{k}={v}" for k, v in sorted(report["tally"].items())) or "no episodes")
    if not report["results"]:
        # An empty corpus is not a pass. A museum with nothing in it proves nothing, and
        # exiting 0 would let it read as "everything is fine".
        print("the corpus is EMPTY -- this run proved nothing")
        return 2
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
