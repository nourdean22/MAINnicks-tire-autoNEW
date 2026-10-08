import { describe, it, expect } from "vitest";
import { TopDecisionsShape, RevenueTodayShape, LotBriefShape, BRIDGE_SHAPES } from "@shared/bridgeShapes";
import { composeLotBrief } from "../lib/lotBrief";

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

  it("lot_brief: the REAL composed brief parses (no hand fixture to drift), as does the failure branch", () => {
    const brief = composeLotBrief({
      date: "2026-10-15", weekday: "thursday", open: true, arrivals: 30, passThroughs: 2,
      coverage: { pctExpected: 0.92, unmeasured: null },
      prior: [
        { date: "2026-10-08", arrivals: 14, pctExpected: 0.95 },
        { date: "2026-10-01", arrivals: 12, pctExpected: 0.9 },
      ],
      tickets: { count: 6, withheld: null },
      longDwells: { count: 1, longestMinutes: 200, uncertain: 0 },
    });
    const served = { ok: true, ...brief, generatedAt: "2026-10-16T11:00:00.000Z", dataAsOf: null, ageMinutes: null, staleness: "uncollected" };
    expect(LotBriefShape.safeParse(served).success).toBe(true);
    expect(LotBriefShape.safeParse({ ok: false, error: "No DB" }).success).toBe(true);
  });

  it("lot_brief: REJECTS a success with no lines, a fourth line, or a failure without its reason", () => {
    const base = { ok: true, date: "2026-10-15", weekday: "thursday", open: true, arrivals: 1, passThroughs: 0,
      coverage: { pctExpected: null, gatePassed: false, unmeasured: "x" }, events: [], generatedAt: "t", dataAsOf: null, staleness: "uncollected" };
    expect(LotBriefShape.safeParse({ ...base, lines: ["one"] }).success).toBe(true);
    expect(LotBriefShape.safeParse({ ...base, lines: [] }).success).toBe(false);
    expect(LotBriefShape.safeParse({ ...base, lines: ["1", "2", "3", "4"] }).success).toBe(false);
    expect(LotBriefShape.safeParse({ ok: false }).success).toBe(false);
  });

  it("registry maps query names to their schemas", () => {
    expect(Object.keys(BRIDGE_SHAPES).sort()).toEqual(["lot_brief", "revenue_today", "top_decisions"]);
  });
});
