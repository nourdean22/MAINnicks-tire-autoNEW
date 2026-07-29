/**
 * tests/services/journey-lens.test.ts — Wave-6 (2026-07-29): the pure
 * chronology math. Honesty contracts: short spans refuse to claim an
 * arc; zero priors refuse to mint a growth percentage.
 */

import { describe, it, expect } from "vitest";
import { identityDeltas, xpGrowthPct } from "@/lib/services/journey-lens";

describe("identityDeltas", () => {
  it("refuses to claim an arc from fewer than 2 snapshots", () => {
    expect(identityDeltas([{ date: "2026-07-01", axes: { focus: 5 } }]).deltas).toEqual([]);
  });

  it("refuses to claim an arc across a span under 30 days", () => {
    const r = identityDeltas([
      { date: "2026-07-01", axes: { focus: 5 } },
      { date: "2026-07-10", axes: { focus: 8 } },
    ]);
    expect(r.deltas).toEqual([]);
    expect(r.spanDays).toBe(9);
  });

  it("computes top movers first across a real span, skipping axes missing on either end", () => {
    const r = identityDeltas([
      { date: "2026-04-01", axes: { focus: 5, discipline: 7, newAxis: 1 } },
      { date: "2026-07-01", axes: { focus: 6, discipline: 3, other: 9 } },
    ]);
    expect(r.spanDays).toBeGreaterThan(30);
    expect(r.deltas[0]).toEqual({ axis: "discipline", from: 7, to: 3, delta: -4 });
    expect(r.deltas.some((d) => d.axis === "newAxis" || d.axis === "other")).toBe(false);
  });
});

describe("xpGrowthPct", () => {
  it("null against a zero prior — no invented infinities", () => {
    expect(xpGrowthPct(500, 0)).toBeNull();
  });
  it("computes signed growth to one decimal", () => {
    expect(xpGrowthPct(150, 100)).toBe(50);
    expect(xpGrowthPct(75, 100)).toBe(-25);
  });
});
