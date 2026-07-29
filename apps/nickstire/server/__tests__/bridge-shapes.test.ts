import { describe, it, expect } from "vitest";
import { TopDecisionsShape, RevenueTodayShape, BRIDGE_SHAPES } from "@shared/bridgeShapes";

/**
 * Bridge contract-shape pins (audit-#11 gate, 2026-07-29). Fixtures
 * mirror the ACTUAL handler returns in server/routes/nour-os-query.ts;
 * a handler edit that drifts the shape reddens here before it silently
 * breaks the statenour TopDecisionsCard / pulse reads. Red-green is
 * built in: each schema must also REJECT a mutated fixture.
 */
const topDecisionsFixture = {
  decisions: [
    {
      id: 42,
      urgency: "today",
      state: "new",
      recommendedAction: "Call Mike about the $940 brake quote",
      valueDollars: 940,
      dataQuality: "inferred",
      attempts: 0,
    },
  ],
  totalLive: 70,
  excludedNoConsent: 2,
  excludedSnoozed: 3,
};

const revenueTodayFixture = { totalCents: 123456, totalDollars: 1234.56, invoiceCount: 4 };

describe("bridge shapes — statenour contract pins", () => {
  it("top_decisions: real-shaped fixture parses", () => {
    expect(TopDecisionsShape.safeParse(topDecisionsFixture).success).toBe(true);
  });

  it("top_decisions: null valueDollars is legal (unpriced decisions exist)", () => {
    const f = { ...topDecisionsFixture, decisions: [{ ...topDecisionsFixture.decisions[0], valueDollars: null }] };
    expect(TopDecisionsShape.safeParse(f).success).toBe(true);
  });

  it("top_decisions: REJECTS a drifted fixture (missing totalLive)", () => {
    const { totalLive: _dropped, ...drifted } = topDecisionsFixture;
    expect(TopDecisionsShape.safeParse(drifted).success).toBe(false);
  });

  it("top_decisions: REJECTS wrong-typed decision id", () => {
    const f = { ...topDecisionsFixture, decisions: [{ ...topDecisionsFixture.decisions[0], id: "42" }] };
    expect(TopDecisionsShape.safeParse(f).success).toBe(false);
  });

  it("revenue_today: real-shaped fixture parses; drifted rejects", () => {
    expect(RevenueTodayShape.safeParse(revenueTodayFixture).success).toBe(true);
    expect(RevenueTodayShape.safeParse({ totalCents: 1 }).success).toBe(false);
  });

  it("registry maps query names to their schemas", () => {
    expect(Object.keys(BRIDGE_SHAPES).sort()).toEqual(["revenue_today", "top_decisions"]);
  });
});
