import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  armRates,
  evaluateExperiment,
  metricSpec,
  METRIC_SPECS,
  MIN_SAMPLES_PER_ARM,
  type ExperimentDefinition,
  type ArmObservation,
} from "./contentExperiments";
import { DISTRIBUTION_OBJECTIVE_METRICS } from "./instagramStudio";

/**
 * Locks the metric-aggregation fix (2026-08-01).
 *
 * The first version divided EVERY metric by reach. Correct for counts, wrong
 * for anything already normalised — an arm with the same average watch time but
 * more reach scored LOWER, and a reach experiment collapsed to reach/reach = 1
 * for every arm. Skip rate was also ranked descending, crowning the worst arm.
 */
const baseArms = [
  { armId: "a", variantValue: "reveal_first", hookStyle: "reveal_first" },
  { armId: "b", variantValue: "question_first", hookStyle: "question_first" },
];

function def(primaryMetric: string): ExperimentDefinition {
  return {
    experimentId: "x",
    primaryVariable: "hook_style",
    objective: "DISCOVERY",
    primaryMetric,
    arms: baseArms,
    startedAt: "2026-08-01T00:00:00.000Z",
  } as ExperimentDefinition;
}

/** n observations for one arm at a fixed reach and metric value. */
function obs(armId: string, reach: number, value: number, n = MIN_SAMPLES_PER_ARM): ArmObservation[] {
  return Array.from({ length: n }, (_, i) => ({
    armId,
    mediaId: `${armId}-${i}`,
    horizonHours: 72 as const,
    reach,
    metricValue: value,
  }));
}

describe("average metrics are not divided by reach", () => {
  it("scores identical average watch time equally regardless of reach", () => {
    const rates = armRates(def("ig_reels_avg_watch_time"), [
      ...obs("a", 500, 3000),
      ...obs("b", 5000, 3000),
    ]);
    // Under the old code b was 3000/5000 = 0.6 and a was 3000/500 = 6 — the
    // better-distributed arm lost by 10x on identical performance.
    expect(rates.get("a")!.rate).toBe(3000);
    expect(rates.get("b")!.rate).toBe(3000);
  });

  it("weights a watch-time average by the audience it was averaged over", () => {
    const rates = armRates(def("ig_reels_avg_watch_time"), [
      ...obs("a", 1000, 2000, 1),
      ...obs("a", 9000, 4000, 1),
    ]);
    // (2000*1000 + 4000*9000) / 10000 = 3800, not the unweighted 3000.
    expect(rates.get("a")!.rate).toBe(3800);
  });

  it("does not collapse a reach experiment to 1", () => {
    const rates = armRates(def("reach"), [...obs("a", 500, 500), ...obs("b", 5000, 5000)]);
    expect(rates.get("a")!.rate).toBe(500);
    expect(rates.get("b")!.rate).toBe(5000);
  });

  it("still converts counts to a per-reach rate", () => {
    const rates = armRates(def("shares"), [...obs("a", 1000, 20), ...obs("b", 5000, 20)]);
    expect(rates.get("a")!.rate).toBeCloseTo(0.02);
    expect(rates.get("b")!.rate).toBeCloseTo(0.004);
  });
});

describe("metric direction decides the winner", () => {
  it("picks the LOWER arm on skip rate", () => {
    const v = evaluateExperiment(def("reels_skip_rate"), [
      ...obs("a", 1000, 0.9),
      ...obs("b", 1000, 0.4),
    ]);
    expect(v.status).toBe("winner");
    if (v.status === "winner") expect(v.armId).toBe("b");
  });

  it("picks the HIGHER arm on shares", () => {
    const v = evaluateExperiment(def("shares"), [
      ...obs("a", 1000, 50),
      ...obs("b", 1000, 5),
    ]);
    expect(v.status).toBe("winner");
    if (v.status === "winner") expect(v.armId).toBe("a");
  });
});

describe("the registry covers the vocabulary the system actually declares", () => {
  it("every DISTRIBUTION_OBJECTIVE_METRICS name has a spec", () => {
    // The unknown-metric guard is only safe if the registry covers the names in
    // use. It shipped registering "shares" while every experiment declares
    // "shares_per_reach", so the guard rejected the one metric anyone used and
    // turned a safety check into an outage. Assert coverage, don't assume it.
    const declared = new Set(Object.values(DISTRIBUTION_OBJECTIVE_METRICS).flat());
    const unregistered = [...declared].filter((m) => !metricSpec(m));
    expect(unregistered).toEqual([]);
  });
});

describe("an unregistered metric is refused, not guessed", () => {
  it("returns invalid_design rather than assuming per-reach and higher-is-better", () => {
    const v = evaluateExperiment(def("vibes"), [...obs("a", 1000, 5), ...obs("b", 1000, 1)]);
    expect(v.status).toBe("invalid_design");
    expect(v.note).toContain("METRIC_SPECS");
  });

  it("registers watch time as weighted and skip rate as lower-is-better", () => {
    expect(metricSpec("ig_reels_avg_watch_time")).toEqual({
      aggregation: "WEIGHTED_AVERAGE",
      direction: "HIGHER_IS_BETTER",
    });
    expect(METRIC_SPECS.reels_skip_rate.direction).toBe("LOWER_IS_BETTER");
  });
});

describe("every declarable primary variable has a checkable arm field", () => {
  const src = fs.readFileSync(path.join(__dirname, "contentExperiments.ts"), "utf8");

  it("maps all four newly-checkable variables", () => {
    // A variable you can name must be a field findConfounds can compare, or a
    // hook_style test that also moved narrative format passes as unconfounded.
    for (const field of ["hookStyle", "narrativeFormat", "lengthBand", "voiceMode"]) {
      expect(src).toContain(`"${field}"`);
    }
  });

  it("detects a confound on the new fields", () => {
    const confounded: ExperimentDefinition = {
      ...def("shares"),
      arms: [
        { armId: "a", variantValue: "reveal_first", hookStyle: "reveal_first", lengthBand: "short" },
        { armId: "b", variantValue: "question_first", hookStyle: "question_first", lengthBand: "long" },
      ],
    } as ExperimentDefinition;
    const v = evaluateExperiment(confounded, [...obs("a", 1000, 50), ...obs("b", 1000, 5)]);
    expect(v.status).toBe("invalid_design");
    expect(v.note).toContain("lengthBand");
  });
});

describe("reelPipeline refuses to truncate a caption", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "server", "services", "reelPipeline.ts"),
    "utf8",
  );

  it("no longer slices the composed caption", () => {
    // Truncation cut whatever sat at the end — the CTA, the claim qualifier,
    // and the AI disclosure all live there.
    expect(src).not.toMatch(/\.slice\(0, 2200\)/);
    expect(src).toMatch(/INSTAGRAM_CAPTION_LIMIT/);
  });

  it("passes a real CTA type to the governor, not the campaign keyword", () => {
    expect(src).toMatch(/cta: brief\.ctaType \?\? brief\.campaignKeyword/);
  });
});
