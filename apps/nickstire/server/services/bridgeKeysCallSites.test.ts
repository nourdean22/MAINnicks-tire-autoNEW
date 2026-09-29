/**
 * The two keys this change exists for, built exactly as their call sites build
 * them (revenueReconciliation.ts, webExperimentResolve.ts). Each asserts the
 * fact identity: the same fact gives the same key, a new fact a new one.
 */
import { describe, expect, it } from "vitest";
import { attributionObligationSubject, bridgeKey, experimentVerdictKey } from "./bridgeKeys";

const obligationKey = (callIds: number[]) =>
  bridgeKey("obligation.opened", "attribution_weak_matches", attributionObligationSubject(callIds));

describe("attribution obligation subject (revenue reconciliation)", () => {
  it("the same call-id set in any order is the same obligation", () => {
    expect(obligationKey([40, 3, 17])).toBe(obligationKey([3, 17, 40]));
    expect(obligationKey([3, 17, 17, 40])).toBe(obligationKey([40, 17, 3]));
  });

  it("one call added or removed is a new obligation", () => {
    const base = obligationKey([3, 17, 40]);
    expect(obligationKey([3, 17, 40, 41])).not.toBe(base);
    expect(obligationKey([3, 17])).not.toBe(base);
  });

  it("depends only on the set, never on a per-run value (the old one-task-per-run shape)", () => {
    // Two runs over the same unchanged set must produce one key.
    const runA = obligationKey([3, 17, 40]);
    const runB = obligationKey([3, 17, 40]);
    expect(runA).toBe(runB);
    expect(runA).toMatch(/^v1:obligation\.opened:attribution_weak_matches:[a-p]{16}$/);
  });
});

describe("experiment verdict key", () => {
  const hash = "0123456789abcdef";
  it("an unchanged status posted again is the same fact", () => {
    expect(experimentVerdictKey("exp", hash, { status: "keep_running" }))
      .toBe(experimentVerdictKey("exp", hash, { status: "keep_running" }));
  });

  it("a winner that flips arms is a new fact", () => {
    const a = experimentVerdictKey("exp", hash, { status: "winner", armId: "control" });
    const b = experimentVerdictKey("exp", hash, { status: "winner", armId: "variant" });
    expect(a).not.toBeNull();
    expect(a).not.toBe(b);
  });

  it("a status change or a new contract is a new fact", () => {
    const base = experimentVerdictKey("exp", hash, { status: "keep_running" });
    expect(experimentVerdictKey("exp", hash, { status: "no_signal" })).not.toBe(base);
    expect(experimentVerdictKey("exp", "fedcba9876543210", { status: "keep_running" })).not.toBe(base);
  });

  it("the arm only counts for a winner", () => {
    expect(experimentVerdictKey("exp", hash, { status: "keep_running", armId: "variant" }))
      .toBe(experimentVerdictKey("exp", hash, { status: "keep_running" }));
  });
});
