/**
 * Repair routing (milestone 10 §63-64) — the smallest, cheapest fix per defect.
 * The key discipline: overlay/encode/color defects are DETERMINISTIC (no
 * provider spend); only genuine pixel defects cost credits. And free fixes run
 * before paid ones.
 */
import { describe, expect, it } from "vitest";
import { planRepairs, routeFinding } from "./services/repairRouter";
import type { RenderedFinding } from "./services/renderedQa";

const f = (code: string, beat: number | null = 1, severity: "block" | "warn" = "block"): RenderedFinding =>
  ({ code: code as RenderedFinding["code"], beatNumber: beat, severity, description: "", preserve: ["x"], change: ["y"] });

describe("routeFinding", () => {
  it("a caption obstruction is a DETERMINISTIC reassemble — no credits", () => {
    const r = routeFinding(f("CAPTION_OBSTRUCTION"));
    expect(r.method).toBe("reassemble");
    expect(r.costsProviderCredits).toBe(false);
  });
  it("a malformed wheel needs a PAID regenerate", () => {
    const r = routeFinding(f("MALFORMED_GEOMETRY"));
    expect(r.method).toBe("regenerate");
    expect(r.costsProviderCredits).toBe(true);
  });
  it("palette/lighting drift is a deterministic regrade", () => {
    expect(routeFinding(f("PALETTE_DRIFT")).method).toBe("regrade");
    expect(routeFinding(f("LIGHTING_DRIFT")).costsProviderCredits).toBe(false);
  });
  it("carries preserve/change through from the finding", () => {
    const r = routeFinding(f("SUBJECT_CONTINUITY"));
    expect(r.preserve).toEqual(["x"]);
    expect(r.change).toEqual(["y"]);
  });
});

describe("planRepairs", () => {
  it("counts paid vs deterministic and orders FREE fixes first", () => {
    const plan = planRepairs([
      f("MALFORMED_GEOMETRY", 3),   // paid
      f("CAPTION_OBSTRUCTION", 1),  // free
      f("PALETTE_DRIFT", 2),        // free
    ]);
    expect(plan.paidRegenerations).toBe(1);
    expect(plan.deterministicFixes).toBe(2);
    expect(plan.order[0].costsProviderCredits).toBe(false);
    expect(plan.order[plan.order.length - 1].costsProviderCredits).toBe(true);
  });

  it("dedupes the same (code,beat)", () => {
    const plan = planRepairs([f("SUBJECT_CONTINUITY", 2), f("SUBJECT_CONTINUITY", 2)]);
    expect(plan.routes).toHaveLength(1);
  });

  it("unknown codes never route (defensive against critic drift)", () => {
    const plan = planRepairs([{ ...f("MADE_UP_CODE"), code: "MADE_UP_CODE" as never }]);
    expect(plan.routes).toHaveLength(0);
  });

  it("an all-deterministic finding set costs ZERO provider credits", () => {
    const plan = planRepairs([f("CAPTION_OBSTRUCTION", 1), f("WEAK_COMPOSITION", 2), f("LIGHTING_DRIFT", 3)]);
    expect(plan.paidRegenerations).toBe(0);
    expect(plan.deterministicFixes).toBe(3);
  });
});
