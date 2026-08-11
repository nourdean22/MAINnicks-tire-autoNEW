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

describe("beatRegenCostsCredits — cost truth under the free-lane provider pin (2026-08-11)", () => {
  // The incident: `paid: true` on pixel-defect routes was stamped when
  // "regenerate" meant a Higgsfield call. Under REEL_VIDEO_PROVIDER=
  // template_stock a regen is a $0 local ffmpeg render, but the static label
  // still sent every pixel defect to the operator-spend hold — 39×
  // "held by rendered-QA gate (needs_paid_repair)" on job 1410001, Aug 5-6.

  it("a pixel-defect regen classifies as FREE when the provider charges nothing", () => {
    const r = routeFinding(f("MALFORMED_GEOMETRY"), { beatRegenCostsCredits: false });
    expect(r.method).toBe("regenerate"); // the repair METHOD is unchanged
    expect(r.costsProviderCredits).toBe(false); // only the cost truth changes
  });

  it("default (option absent) keeps the historical paid classification — no caller drifts silently", () => {
    expect(routeFinding(f("MALFORMED_GEOMETRY")).costsProviderCredits).toBe(true);
    expect(routeFinding(f("SUBJECT_CONTINUITY"), {}).costsProviderCredits).toBe(true);
  });

  it("deterministic routes are untouched by the flag in BOTH directions", () => {
    expect(routeFinding(f("CAPTION_OBSTRUCTION"), { beatRegenCostsCredits: false }).costsProviderCredits).toBe(false);
    expect(routeFinding(f("CAPTION_OBSTRUCTION"), { beatRegenCostsCredits: true }).costsProviderCredits).toBe(false);
  });

  it("planRepairs under the free pin counts pixel defects as deterministic fixes", () => {
    const plan = planRepairs(
      [f("MALFORMED_GEOMETRY", 3), f("CAPTION_OBSTRUCTION", 1)],
      { beatRegenCostsCredits: false },
    );
    expect(plan.paidRegenerations).toBe(0);
    expect(plan.deterministicFixes).toBe(2);
  });
});
