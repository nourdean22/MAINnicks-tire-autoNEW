/**
 * Hook signal extraction + the refusal to report a difference from too few posts.
 *
 * The load-bearing test in this file is the LAST one: `compareSignals` must mark
 * a comparison insufficient when either group is thin. Stage 1 exists precisely
 * because 8 posts cannot support a rule, and a measurement tool that happily
 * reports a delta from n=1 would recreate the problem it was built to avoid.
 */
import { describe, it, expect } from "vitest";
import {
  extractHookSignals,
  compareSignals,
  MIN_GROUP_N,
  HOOK_BOOLEAN_SIGNALS,
} from "../../../shared/hookSignals";

describe("extractHookSignals — factual, not evaluative", () => {
  it("flags the exact opener that scored 10/10 and lost 82.6% of viewers", () => {
    // reel #1230001. The existing check called this a perfect first-frame hook.
    const s = extractHookSignals({
      visual: "Extreme macro shot of white crystalline road salt scattered on a dark, wet surface",
      onScreenText: "Cleveland winters bring more than just snow...",
    });
    expect(s.textIsWarmup).toBe(true);
    // The VISUAL was tight — so if the correlation later blames the visual, that
    // would contradict this post. Recorded so the data can decide, not asserted.
    expect(s.opensTight).toBe(true);
  });

  it.each([
    "Ever wonder what that noise is?",
    "Did you know your tires expire?",
    "In Cleveland, roads take a toll on your car",
    "Summers bring heat your battery hates",
    "Something is happening under your car...",
  ])("detects warm-up opener: %s", (t) => {
    expect(extractHookSignals({ visual: "", onScreenText: t }).textIsWarmup).toBe(true);
  });

  it.each([
    "Grinding means metal on metal",
    "Below 2/32 inch you are legally worn",
    "Squeal vs grind",
    "This bolt is not the problem",
  ])("does NOT call a direct opener a warm-up: %s", (t) => {
    expect(extractHookSignals({ visual: "", onScreenText: t }).textIsWarmup).toBe(false);
  });

  it("separates tight from wide openings", () => {
    expect(extractHookSignals({ visual: "extreme close-up of tread", onScreenText: "" }).opensTight).toBe(true);
    expect(extractHookSignals({ visual: "wide establishing shot of the skyline", onScreenText: "" }).opensWide).toBe(true);
  });

  it("detects motion in the opening beat", () => {
    expect(extractHookSignals({ visual: "tire", motion: "slow orbit around the rim", onScreenText: "" }).hasMotion).toBe(true);
    expect(extractHookSignals({ visual: "static tire on a floor", onScreenText: "" }).hasMotion).toBe(false);
  });

  it.each([
    "Below 2/32 inch is legally worn",
    "Squeal vs grind",
    "A spare is rated 50 mph",
  ])("recognises a concrete claim: %s", (t) => {
    expect(extractHookSignals({ visual: "", onScreenText: t }).textIsClaim).toBe(true);
  });

  it("counts overlay words — long openers cost reading time before any payoff", () => {
    expect(extractHookSignals({ visual: "", onScreenText: "one two three" }).textWords).toBe(3);
    expect(extractHookSignals({ visual: "", onScreenText: "" }).textWords).toBe(0);
  });
});

describe("compareSignals — must refuse to report a thin comparison", () => {
  const mk = (warmup: boolean, skipRate: number | null) => ({
    signals: extractHookSignals({
      visual: "",
      onScreenText: warmup ? "Ever wonder about this?" : "Grinding means metal on metal",
    }),
    skipRate,
  });

  it("excludes NULL skip rates rather than treating them as zero", () => {
    // "Instagram did not report this" is not "nobody skipped it". Counting a
    // null as 0 would invent the best possible outcome out of missing data.
    const r = compareSignals([mk(true, null), mk(true, null), mk(false, 50)]);
    const w = r.find((x) => x.signal === "textIsWarmup")!;
    expect(w.withN).toBe(0);
    expect(w.withAvgSkip).toBeNull();
  });

  it(`marks a comparison insufficient below ${MIN_GROUP_N} per group`, () => {
    const r = compareSignals([mk(true, 90), mk(false, 20), mk(false, 25)]);
    expect(r.every((x) => !x.sufficient)).toBe(true);
  });

  it("marks it sufficient once both groups are large enough, and signs the delta", () => {
    const samples = [
      ...Array.from({ length: MIN_GROUP_N }, () => mk(true, 80)),
      ...Array.from({ length: MIN_GROUP_N }, () => mk(false, 40)),
    ];
    const w = compareSignals(samples).find((x) => x.signal === "textIsWarmup")!;
    expect(w.sufficient).toBe(true);
    expect(w.withAvgSkip).toBe(80);
    expect(w.withoutAvgSkip).toBe(40);
    // Positive delta = posts WITH the signal were skipped MORE.
    expect(w.delta).toBe(40);
  });

  it("reports every signal, so a null result is visible rather than omitted", () => {
    const r = compareSignals([mk(true, 50)]);
    expect(r.map((x) => x.signal).sort()).toEqual([...HOOK_BOOLEAN_SIGNALS].sort());
  });
});

describe("motion stems — base form AND inflected form", () => {
  // `orbit\w+` silently failed on the BARE word "orbit": \w+ demands a character
  // after the stem. Third instance of this family in one session, so both forms
  // are now pinned for every stem rather than trusting the pattern reads right.
  it.each([
    "slow orbit around the rim", "orbiting the wheel",
    "the tread spins", "spinning tread",
    "camera turns", "turning left",
    "beam sweeps the seam", "sweeping across",
    "rust spreads", "spreading corrosion",
    "water drips", "dripping coolant",
    "push in on the defect", "pushing in",
    "rust creeps along the seam", "creeping rust",
  ])("detects motion in: %s", (t) => {
    expect(extractHookSignals({ visual: t, onScreenText: "" }).hasMotion).toBe(true);
  });

  it.each([
    "a tire resting on the floor",
    "deep matte black bay, single overhead light",
  ])("does not invent motion in a static shot: %s", (t) => {
    expect(extractHookSignals({ visual: t, onScreenText: "" }).hasMotion).toBe(false);
  });
});
