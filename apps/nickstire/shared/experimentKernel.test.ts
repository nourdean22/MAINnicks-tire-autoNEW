import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  assignByKey,
  chiSquareSurvival,
  evaluateWebExperiment,
  findConfoundsIn,
  mSprt,
  srmCheck,
  type ArmMetricCounts,
  type WebExperimentDefinition,
} from "./experimentKernel";
import { assignArm, findConfounds, type ExperimentDefinition } from "./contentExperiments";

const DEF: WebExperimentDefinition = {
  experimentId: "t",
  primaryVariable: "subline",
  primaryMetric: "clicked",
  guardrails: [{ metric: "called", direction: "HIGHER_IS_BETTER" }],
  surfaces: ["/"],
  preregisteredAt: "2026-09-15T00:00:00.000Z",
  arms: [
    { armId: "control", variantValue: "a", heading: "H", subline: "one" },
    { armId: "variant", variantValue: "b", heading: "H", subline: "two" },
  ],
};

const counts = (c: Partial<ArmMetricCounts["conversions"]> & { n?: number }, v: Partial<ArmMetricCounts["conversions"]> & { n?: number }): ArmMetricCounts[] => [
  { armId: "control", exposures: c.n ?? 500, conversions: { clicked: c.clicked ?? 0, called: c.called ?? 0 } },
  { armId: "variant", exposures: v.n ?? 500, conversions: { clicked: v.clicked ?? 0, called: v.called ?? 0 } },
];

describe("confounds + assignment agree with the content kernel", () => {
  it("findConfoundsIn reports the same fields as contentExperiments.findConfounds", () => {
    const def: ExperimentDefinition = {
      experimentId: "x",
      primaryVariable: "cta_type",
      objective: "discovery" as ExperimentDefinition["objective"],
      primaryMetric: "shares_per_reach",
      startedAt: "2026-01-01T00:00:00.000Z",
      arms: [
        { armId: "a", variantValue: "soft", ctaType: "soft" as never, postingSlot: "am" },
        { armId: "b", variantValue: "hard", ctaType: "hard" as never, postingSlot: "pm" },
      ],
    };
    const generic = findConfoundsIn(def.arms, ["ctaType", "postingSlot", "franchiseId"], "ctaType");
    expect(generic).toEqual(["postingSlot"]);
    expect(findConfounds(def)).toEqual(generic);
  });
  it("assignByKey lands the same arm as assignArm for the same key", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 40 }), (key) => {
        const def: ExperimentDefinition = {
          experimentId: "x", primaryVariable: "hook_style", objective: "discovery" as never, primaryMetric: "views",
          startedAt: "2026-01-01T00:00:00.000Z",
          arms: [{ armId: "a", variantValue: "a" }, { armId: "b", variantValue: "b" }, { armId: "c", variantValue: "c" }],
        };
        expect(assignByKey(["a", "b", "c"], key)).toBe(assignArm(def, key).armId);
      }),
    );
  });
  it("assignment splits evenly enough that SRM never fires on it", () => {
    const ex = [0, 0];
    for (let i = 0; i < 4000; i++) ex[assignByKey(["control", "variant"], `s_${i.toString(36)}_home`) === "control" ? 0 : 1]++;
    expect(srmCheck(ex).ok).toBe(true);
  });
});

describe("statistics", () => {
  it("chi-square survival matches known values", () => {
    expect(chiSquareSurvival(3.841, 1)).toBeCloseTo(0.05, 2);
    expect(chiSquareSurvival(10.828, 1)).toBeCloseTo(0.001, 3);
    expect(chiSquareSurvival(0, 1)).toBe(1);
  });
  it("srm flags a broken split and tolerates a fair one", () => {
    expect(srmCheck([600, 400]).ok).toBe(false);
    expect(srmCheck([505, 495]).ok).toBe(true);
    expect(srmCheck([30, 20]).note).toMatch(/too few/);
  });
  it("mSPRT: no effect gives p near 1, a real effect gives p below alpha", () => {
    expect(mSprt({ exposures: 800, conversions: 40 }, { exposures: 800, conversions: 41 }).pValue).toBeGreaterThan(0.5);
    expect(mSprt({ exposures: 800, conversions: 40 }, { exposures: 800, conversions: 90 }).pValue).toBeLessThan(0.05);
    expect(mSprt({ exposures: 0, conversions: 0 }, { exposures: 10, conversions: 1 }).pValue).toBe(1);
  });
  it("mSPRT is always-valid under the null: over many peeks, false alarms stay under alpha", () => {
    // Positive control first: with a real effect the same peeking loop DOES alarm.
    let alarms = 0;
    const trials = 300;
    const seed = fc.sample(fc.integer({ min: 1, max: 1e9 }), 1)[0];
    let s = seed;
    const rand = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    const simulate = (pc: number, pv: number) => {
      let xc = 0, xv = 0;
      for (let n = 1; n <= 2000; n++) {
        if (rand() < pc) xc++;
        if (rand() < pv) xv++;
        if (n >= 50 && n % 25 === 0 && mSprt({ exposures: n, conversions: xc }, { exposures: n, conversions: xv }).pValue < 0.05) return true;
      }
      return false;
    };
    let power = 0;
    for (let t = 0; t < 100; t++) if (simulate(0.05, 0.11)) power++;
    expect(power).toBeGreaterThan(80);
    for (let t = 0; t < trials; t++) if (simulate(0.05, 0.05)) alarms++;
    expect(alarms / trials).toBeLessThan(0.05 + 0.03);
  });
});

describe("evaluateWebExperiment", () => {
  it("refuses a confounded design", () => {
    const bad = { ...DEF, arms: [{ ...DEF.arms[0], heading: "H1" }, { ...DEF.arms[1], heading: "H2" }] as WebExperimentDefinition["arms"] };
    expect(evaluateWebExperiment(bad, counts({}, {}))).toMatchObject({ status: "invalid_design" });
  });
  it("refuses a sample-ratio mismatch as invalid_design", () => {
    expect(evaluateWebExperiment(DEF, counts({ n: 700, clicked: 50 }, { n: 300, clicked: 40 }))).toMatchObject({ status: "invalid_design" });
  });
  it("insufficient below the floor, no_signal when nobody converted", () => {
    expect(evaluateWebExperiment(DEF, counts({ n: 20 }, { n: 20 }))).toMatchObject({ status: "insufficient_data", have: 20 });
    expect(evaluateWebExperiment(DEF, counts({}, {}))).toMatchObject({ status: "no_signal" });
  });
  it("keeps running on a small difference, declares a winner on a clear one", () => {
    expect(evaluateWebExperiment(DEF, counts({ clicked: 40, called: 10 }, { clicked: 44, called: 10 })).status).toBe("keep_running");
    expect(evaluateWebExperiment(DEF, counts({ clicked: 40, called: 10 }, { clicked: 95, called: 10 }))).toMatchObject({ status: "winner", armId: "variant" });
  });
  it("a guardrail breach refuses the win even when the primary metric leads", () => {
    const v = evaluateWebExperiment(DEF, counts({ clicked: 40, called: 60 }, { clicked: 95, called: 15 }));
    expect(v).toMatchObject({ status: "guardrail_breach", metric: "called" });
  });
  it("control can win too", () => {
    expect(evaluateWebExperiment(DEF, counts({ clicked: 95 }, { clicked: 40 }))).toMatchObject({ status: "winner", armId: "control" });
  });
});
