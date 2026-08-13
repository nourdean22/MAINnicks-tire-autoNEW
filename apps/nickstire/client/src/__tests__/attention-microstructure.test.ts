/**
 * compareBooleanSignal — the metric-agnostic generalization of
 * hookSignals.ts's compareSignals. Same MIN_GROUP_N refusal discipline,
 * proven here against saves/shares (the brief's actual ask) instead of only
 * skip rate, and proven to work for a beat-structure signal (hasCta) as well
 * as a hook signal — the whole point of generalizing it.
 */
import { describe, it, expect } from "vitest";
import { extractHookSignals } from "../../../shared/hookSignals";
import { extractBeatStructureSignals } from "../../../shared/beatStructureSignals";
import {
  compareBooleanSignal,
  compareAllSignals,
  swipeFileConviction,
  type SwipeFileSample,
} from "../../../shared/attentionMicrostructure";

function sample(jobId: number, opts: { warmup: boolean; cta: "send" | "none"; savesPerReach: number | null }): SwipeFileSample {
  return {
    jobId,
    hook: extractHookSignals({
      visual: "",
      onScreenText: opts.warmup ? "Ever wonder about this?" : "Grinding means metal on metal",
    }),
    beatStructure: extractBeatStructureSignals({ ctaType: opts.cta }),
    metrics: { savesPerReach: opts.savesPerReach, sharesPerReach: null, skipRate: null },
  };
}

describe("compareBooleanSignal — generalized over metric AND signal family", () => {
  it("excludes NOT-REPORTED metric values rather than treating them as zero", () => {
    const samples = [
      sample(1, { warmup: true, cta: "none", savesPerReach: null }),
      sample(2, { warmup: true, cta: "none", savesPerReach: null }),
      sample(3, { warmup: false, cta: "none", savesPerReach: 0.02 }),
    ];
    const c = compareBooleanSignal(samples, "hook", "textIsWarmup", "savesPerReach", (s) => s.hook);
    expect(c.withN).toBe(0);
    expect(c.withAvg).toBeNull();
  });

  it("marks insufficient below MIN_GROUP_N per side, sufficient once both clear it", () => {
    const thin = [
      sample(1, { warmup: true, cta: "none", savesPerReach: 0.05 }),
      sample(2, { warmup: false, cta: "none", savesPerReach: 0.01 }),
    ];
    expect(compareBooleanSignal(thin, "hook", "textIsWarmup", "savesPerReach", (s) => s.hook).sufficient).toBe(false);

    const enough = [
      ...Array.from({ length: 4 }, (_, i) => sample(i, { warmup: true, cta: "none", savesPerReach: 0.01 })),
      ...Array.from({ length: 4 }, (_, i) => sample(10 + i, { warmup: false, cta: "none", savesPerReach: 0.05 })),
    ];
    const c = compareBooleanSignal(enough, "hook", "textIsWarmup", "savesPerReach", (s) => s.hook);
    expect(c.sufficient).toBe(true);
    expect(c.withAvg).toBeCloseTo(0.01);
    expect(c.withoutAvg).toBeCloseTo(0.05);
    expect(c.delta).toBeCloseTo(-0.04);
  });

  it("works for a BEAT-STRUCTURE signal (hasCta), not just a hook signal — proves the generalization", () => {
    const samples = [
      ...Array.from({ length: 4 }, (_, i) => sample(i, { warmup: false, cta: "send", savesPerReach: 0.03 })),
      ...Array.from({ length: 4 }, (_, i) => sample(10 + i, { warmup: false, cta: "none", savesPerReach: 0.01 })),
    ];
    const c = compareBooleanSignal(samples, "beatStructure", "hasCta", "savesPerReach", (s) => s.beatStructure);
    expect(c.family).toBe("beatStructure");
    expect(c.sufficient).toBe(true);
    expect(c.withAvg).toBeCloseTo(0.03);
  });

  it("compareAllSignals runs every registered signal from both families", () => {
    const samples = [sample(1, { warmup: true, cta: "send", savesPerReach: 0.02 })];
    const results = compareAllSignals(samples, "savesPerReach");
    const families = new Set(results.map((r) => r.family));
    expect(families).toEqual(new Set(["hook", "beatStructure"]));
    expect(results.some((r) => r.signal === "hasCta")).toBe(true);
    expect(results.some((r) => r.signal === "textIsWarmup")).toBe(true);
  });
});

describe("swipeFileConviction — never HIGH from a correlation alone", () => {
  it("a sufficient comparison is MED/INFERRED, not HIGH/OBSERVED", () => {
    const enough = [
      ...Array.from({ length: 4 }, (_, i) => sample(i, { warmup: true, cta: "none", savesPerReach: 0.01 })),
      ...Array.from({ length: 4 }, (_, i) => sample(10 + i, { warmup: false, cta: "none", savesPerReach: 0.05 })),
    ];
    const c = compareBooleanSignal(enough, "hook", "textIsWarmup", "savesPerReach", (s) => s.hook);
    // The calibration ledger's own vocabulary: a correlation, however clean,
    // graduates to HIGH/OBSERVED only via a deliberate contentExperiments.ts
    // run — never from compareBooleanSignal alone, which is exactly why this
    // function has no "HIGH" branch to return.
    expect(swipeFileConviction(c)).toBe("MED/INFERRED");
  });

  it("an insufficient comparison is neither tier — just insufficient", () => {
    const thin = [sample(1, { warmup: true, cta: "none", savesPerReach: 0.02 })];
    const c = compareBooleanSignal(thin, "hook", "textIsWarmup", "savesPerReach", (s) => s.hook);
    expect(swipeFileConviction(c)).toBe("insufficient");
  });
});
