import { describe, it, expect } from "vitest";
import { recoveryArmForEstimate, RECOVERY_EXPERIMENT_VERSION } from "./declinedWorkRecovery";

describe("recoveryArmForEstimate · strike-5 versioned hash assignment", () => {
  it("is deterministic — same id + version always lands the same arm", () => {
    for (const id of [1, 42, 999, 123456]) {
      expect(recoveryArmForEstimate(id, "v3")).toBe(recoveryArmForEstimate(id, "v3"));
    }
  });

  it("holdout fraction over a large id range approximates 15% (hash, not id-order)", () => {
    let holdouts = 0;
    const N = 10_000;
    for (let id = 1; id <= N; id++) {
      if (recoveryArmForEstimate(id, "v3") === 1) holdouts++;
    }
    const pct = (holdouts / N) * 100;
    expect(pct).toBeGreaterThan(12);
    expect(pct).toBeLessThan(18);
  });

  it("consecutive ids do NOT stripe into the same arm (the raw-modulo defect)", () => {
    // id % 100 < 15 puts ids 100-114, 200-214… all in control — assignment
    // correlated with insertion order. The hash must break that stripe.
    const arms = Array.from({ length: 30 }, (_, i) => recoveryArmForEstimate(100 + i, "v3"));
    const distinct = new Set(arms);
    expect(distinct.size).toBe(2); // both arms appear inside one 30-id run
  });

  it("changing the version re-randomizes — v4 disagrees with v3 somewhere", () => {
    let disagreements = 0;
    for (let id = 1; id <= 200; id++) {
      if (recoveryArmForEstimate(id, "v3") !== recoveryArmForEstimate(id, "v4")) disagreements++;
    }
    expect(disagreements).toBeGreaterThan(0);
  });

  it("the shipped version constant is v3", () => {
    expect(RECOVERY_EXPERIMENT_VERSION).toBe("v3");
  });
});
